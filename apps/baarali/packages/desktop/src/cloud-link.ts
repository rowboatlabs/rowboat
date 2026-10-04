// Joins the desktop app to its account's instance (option A, decided
// 01/10/2026; architecture §3.5 « Les instances », security §2).
//
// The person signs in with the upstream onboarding, which writes the
// session to `${workDir}/config/oauth.json`. As soon as a session appears,
// this asks the control plane for a device key, then switches the app to
// remote mode on the gateway, with the upstream's own `connectRemoteServer`.
// Signing out detaches the app from the instance, so the next sign-in joins
// the instance of the account signed in (03/10/2026, see `staysOnDevice`).
// The app also remembers whose instance it joined (`linkFile`): a sign-in
// with another account, even without signing out first, moves it to that
// account's instance (04/10/2026). It notes this computer's device for each
// account too, and revokes it before asking for a new one: joining again
// never piles up devices against the account's limit.
// No upstream file changes: the Baarali build copies this file into
// apps/x/apps/main/src and calls `startCloudLink` once (scripts/brand.mjs).
// It may only import Node's builtins, for it compiles in main's project.

export type HostMode = 'in-process' | 'child' | 'remote';

export interface CloudLinkDeps {
  /** The control plane (API_URL). */
  apiUrl: string;
  /** The oauth.json the upstream writes on sign-in. */
  oauthFile: string;
  /** Where the link notes whose instance the app joined. */
  linkFile: string;
  mode: () => HostMode;
  /** server-host.ts `connectRemoteServer`. */
  connect: (url: string, key: string) => Promise<{ success: boolean; error?: string }>;
  /** server-host.ts `disconnectRemoteServer`: back to the app's own server. */
  disconnect: () => Promise<{ success: boolean; error?: string }>;
  /** ipc.ts `broadcastReload`: every window describes the old server until reloaded. */
  reload: () => void;
  /** Tells the person what blocks; the link waits for the next sign-in. */
  notify: (problem: LinkProblem) => void;
  deviceName: () => string;
  readFile: (file: string) => Promise<string>;
  writeFile: (file: string, data: string) => Promise<void>;
  /** Calls back on every change of the file; returns the unsubscribe. */
  watch: (file: string, onChange: () => void) => () => void;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

/** What the person is told, in their words (the app's strings, scripts/brand.mjs). */
export type LinkProblem = 'instances_full' | 'unavailable';

/**
 * A new instance boots for the first time when its first device connects:
 * the gateway answers, the machine needs up to a minute more.
 */
const CONNECT_ATTEMPTS = 8;
const CONNECT_PAUSE_MS = 8_000;

interface Session {
  accessToken: string;
  /** Seconds since the epoch, as the upstream stores it. */
  expiresAt: number | null;
}

/** The `rowboat` provider's session in oauth.json (core auth/repo.ts), or null. */
export function sessionFrom(raw: string): Session | null {
  try {
    const parsed = JSON.parse(raw) as { providers?: { rowboat?: { tokens?: { access_token?: unknown; expires_at?: unknown } | null } } };
    const tokens = parsed.providers?.rowboat?.tokens;
    if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token) return null;
    return { accessToken: tokens.access_token, expiresAt: typeof tokens.expires_at === 'number' ? tokens.expires_at : null };
  } catch {
    return null;
  }
}

/**
 * True only when oauth.json was read whole and holds no `rowboat` session:
 * the person signed out. A file being rewritten, or missing, is not that.
 */
export function signedOut(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && sessionFrom(raw) === null;
  } catch {
    return false;
  }
}

/**
 * Whether an IPC call stays in this app instead of going to the instance.
 * Joined to an instance, the upstream forwards the sign-in calls there too,
 * so signing in or out replaced the instance's own session with the
 * person's: the app and its instance could then act for two accounts, one
 * spending the other's plan (seen 03/10/2026). Baarali's sign-in is the
 * device's: it stays here, and the link follows it. Other providers (Google,
 * Microsoft...) stay with the instance, which runs their syncs.
 */
export function staysOnDevice(channel: string, args: unknown, mode: HostMode): boolean {
  if (mode !== 'remote' || (channel !== 'oauth:connect' && channel !== 'oauth:disconnect')) return false;
  return typeof args === 'object' && args !== null && (args as { provider?: unknown }).provider === 'rowboat';
}

export interface LinkNote {
  /** Whose instance the app joined last; null when none is noted. */
  accountId: string | null;
  /** This computer's device, per account it joined. */
  devices: Record<string, string>;
}

/** The link file, read leniently: anything unreadable is an empty note. */
export function readNote(raw: string): LinkNote {
  try {
    const parsed = JSON.parse(raw) as { accountId?: unknown; devices?: unknown } | null;
    const devices: Record<string, string> = {};
    if (parsed?.devices && typeof parsed.devices === 'object' && !Array.isArray(parsed.devices)) {
      for (const [account, device] of Object.entries(parsed.devices)) if (typeof device === 'string' && device) devices[account] = device;
    }
    return { accountId: typeof parsed?.accountId === 'string' && parsed.accountId ? parsed.accountId : null, devices };
  } catch {
    return { accountId: null, devices: {} };
  }
}

export function startCloudLink(deps: CloudLinkDeps): () => void {
  // Each session is tried once: a refusal waits for the next sign-in, it
  // does not loop on every write of the file.
  const tried = new Set<string>();
  // Joined: the sessions already matched to the instance's account. A
  // refreshed session is the same account; it costs one /v1/me.
  const matched = new Set<string>();
  let busy = false;
  let again = false;
  let stopped = false;

  /** The session's account on the control plane; null when it is not one of ours. */
  async function accountOf(session: Session): Promise<string | null> {
    const res = await deps.fetch(`${deps.apiUrl}/v1/me`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`/v1/me: ${res.status}`);
    const body = (await res.json()) as { user?: { id?: unknown } };
    return typeof body.user?.id === 'string' ? body.user.id : null;
  }

  const note = async () => readNote(await deps.readFile(deps.linkFile).catch(() => ''));

  async function link(session: Session, account: string): Promise<void> {
    const before = await note();
    const previous = before.devices[account];
    if (previous) {
      // Its key went with the instance left: a device nobody uses any more.
      const res = await deps
        .fetch(`${deps.apiUrl}/v1/devices/${encodeURIComponent(previous)}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${session.accessToken}` },
          signal: AbortSignal.timeout(30_000),
        })
        .catch(() => null);
      deps.log(`[baarali] previous device ${res?.ok || res?.status === 404 ? 'revoked' : 'not revoked'}`);
    }
    const res = await deps.fetch(`${deps.apiUrl}/v1/devices`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: deps.deviceName() }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      const code = body?.error?.code ?? String(res.status);
      deps.log(`[baarali] no device key: ${code}`);
      // 401: not one of our sessions (another provider's sign-in); nothing to say.
      if (res.status !== 401) deps.notify(code === 'instances_full' ? 'instances_full' : 'unavailable');
      return;
    }
    const { device, server } = (await res.json()) as { device?: { id?: unknown }; server: { url: string; key: string } };
    const devices = { ...before.devices };
    if (typeof device?.id === 'string') devices[account] = device.id;
    else delete devices[account];
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS && !stopped; attempt++) {
      const result = await deps.connect(server.url, server.key);
      if (result.success) {
        await deps.writeFile(deps.linkFile, JSON.stringify({ accountId: account, devices }) + '\n').catch((err: unknown) => {
          deps.log(`[baarali] could not note the account: ${err instanceof Error ? err.message : String(err)}`);
        });
        deps.log('[baarali] connected to the instance');
        deps.reload();
        return;
      }
      deps.log(`[baarali] instance not ready (${attempt}/${CONNECT_ATTEMPTS}): ${result.error ?? 'unknown'}`);
      if (attempt < CONNECT_ATTEMPTS) await deps.sleep(CONNECT_PAUSE_MS);
    }
    // Not joined, but the device exists: noted, so the next try revokes it.
    await deps.writeFile(deps.linkFile, JSON.stringify({ accountId: before.accountId, devices }) + '\n').catch(() => {});
    deps.notify('unavailable');
  }

  // The instance stays its account's; the app leaves it.
  async function detach(why: string): Promise<boolean> {
    const result = await deps.disconnect().catch((err: unknown) => ({ success: false, error: err instanceof Error ? err.message : String(err) }));
    if (!result.success) {
      deps.log(`[baarali] could not leave the instance: ${result.error ?? 'unknown'}`);
      return false;
    }
    deps.log(`[baarali] ${why}: left the instance`);
    return true;
  }

  // Joined, and a session is there: is it the instance's account? Another
  // account (or a link from before the app noted it) moves to the session's.
  async function follow(session: Session): Promise<void> {
    if (matched.has(session.accessToken)) return;
    if (session.expiresAt !== null && session.expiresAt * 1000 <= deps.now()) return;
    let account: string | null;
    try {
      account = await accountOf(session);
    } catch (err) {
      // Offline or the control plane down: looked at again on the next write.
      deps.log(`[baarali] could not check the account: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!account) return;
    matched.add(session.accessToken);
    const linked = (await note()).accountId;
    if (linked === account) return;
    if (!(await detach(linked ? 'another account signed in' : 'account not noted yet'))) return;
    tried.add(session.accessToken);
    try {
      await link(session, account);
    } finally {
      // Not joined again (a full early access, an instance not answering):
      // the windows still describe the instance left.
      if (deps.mode() !== 'remote') deps.reload();
    }
  }

  async function check(): Promise<void> {
    if (busy) {
      // A sign-in or out during a link or a detach is looked at once it is over.
      again = true;
      return;
    }
    if (stopped) return;
    busy = true;
    try {
      const raw = await deps.readFile(deps.oauthFile).catch(() => '');
      if (deps.mode() === 'remote') {
        if (signedOut(raw)) {
          if (await detach('signed out')) deps.reload();
          return;
        }
        const joined = sessionFrom(raw);
        if (joined) await follow(joined);
        return;
      }
      const session = sessionFrom(raw);
      if (!session || tried.has(session.accessToken)) return;
      // An expired session is refreshed by core, which writes the file again.
      if (session.expiresAt !== null && session.expiresAt * 1000 <= deps.now()) return;
      tried.add(session.accessToken);
      const account = await accountOf(session);
      // 401: not one of our sessions (another provider's sign-in); nothing to say.
      if (!account) return;
      await link(session, account);
    } catch (err) {
      deps.log(`[baarali] link failed: ${err instanceof Error ? err.message : String(err)}`);
      deps.notify('unavailable');
    } finally {
      busy = false;
      if (again) {
        again = false;
        void check();
      }
    }
  }

  const unwatch = deps.watch(deps.oauthFile, () => void check());
  void check();
  return () => {
    stopped = true;
    unwatch();
  };
}
