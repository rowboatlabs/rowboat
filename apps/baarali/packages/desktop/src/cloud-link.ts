// Joins the desktop app to its account's instance (option A, decided
// 01/10/2026; architecture §3.5 « Les instances », security §2).
//
// The person signs in with the upstream onboarding, which writes the
// session to `${workDir}/config/oauth.json`. As soon as a session appears,
// this asks the control plane for a device key, then switches the app to
// remote mode on the gateway, with the upstream's own `connectRemoteServer`.
// No upstream file changes: the Baarali build copies this file into
// apps/x/apps/main/src and calls `startCloudLink` once (scripts/brand.mjs).
// It may only import Node's builtins, for it compiles in main's project.

export type HostMode = 'in-process' | 'child' | 'remote';

export interface CloudLinkDeps {
  /** The control plane (API_URL). */
  apiUrl: string;
  /** The oauth.json the upstream writes on sign-in. */
  oauthFile: string;
  mode: () => HostMode;
  /** server-host.ts `connectRemoteServer`. */
  connect: (url: string, key: string) => Promise<{ success: boolean; error?: string }>;
  /** ipc.ts `broadcastReload`: every window describes the old server until reloaded. */
  reload: () => void;
  /** Tells the person what blocks; the link waits for the next sign-in. */
  notify: (problem: LinkProblem) => void;
  deviceName: () => string;
  readFile: (file: string) => Promise<string>;
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

export function startCloudLink(deps: CloudLinkDeps): () => void {
  // Each session is tried once: a refusal waits for the next sign-in, it
  // does not loop on every write of the file.
  const tried = new Set<string>();
  let busy = false;
  let again = false;
  let stopped = false;

  async function link(session: Session): Promise<void> {
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
    const { server } = (await res.json()) as { server: { url: string; key: string } };
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS && !stopped; attempt++) {
      const result = await deps.connect(server.url, server.key);
      if (result.success) {
        deps.log('[baarali] connected to the instance');
        deps.reload();
        return;
      }
      deps.log(`[baarali] instance not ready (${attempt}/${CONNECT_ATTEMPTS}): ${result.error ?? 'unknown'}`);
      if (attempt < CONNECT_ATTEMPTS) await deps.sleep(CONNECT_PAUSE_MS);
    }
    deps.notify('unavailable');
  }

  async function check(): Promise<void> {
    if (busy) {
      // A sign-in during a link is looked at once it is over.
      again = true;
      return;
    }
    if (stopped || deps.mode() === 'remote') return;
    const session = sessionFrom(await deps.readFile(deps.oauthFile).catch(() => ''));
    if (!session || tried.has(session.accessToken)) return;
    // An expired session is refreshed by core, which writes the file again.
    if (session.expiresAt !== null && session.expiresAt * 1000 <= deps.now()) return;
    tried.add(session.accessToken);
    busy = true;
    try {
      await link(session);
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
