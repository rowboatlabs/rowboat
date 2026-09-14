import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as oauthClient from '../auth/oauth-client.js';
import { ensureRowboatSession } from '../auth/oauth-flows.js';
import { getSessionAccessToken, readSession } from '../auth/tokens.js';
import { SpacesClient, SpacesRequestError } from './client.js';
import {
  applyManagedListing,
  dropSessionOrgs,
  getClient,
  getOrg,
  isSessionBacked,
  listOrgs,
  managedIssuer,
  sameIssuer,
  upsertOAuthOrg,
  upsertSessionOrg,
  type ManagedOrgListing,
  type OrgRecord,
} from './orgs.js';
import type { AcceptInviteResult, ResolveInviteResult } from '@rowboat/spaces-protocol';

// The app side of the OAuth journey (spec §4). Two roads, chosen by the
// org's issuer (its RFC 9728 metadata names its authorization server):
//
//   MANAGED — the org trusts the Rowboat login desk, the same one the
//   Rowboat account comes from. No dance of our own: the account session is
//   the identity (auth/tokens.ts, one session two uses). If no session
//   exists yet, the ordinary Rowboat sign-in runs once and the session is
//   stamped spaces-only. The apex's "my orgs" listing then tells us every
//   managed org we belong to (syncManagedOrgs) — a reinstall recovers them
//   all with one sign-in, and an invite to a second managed org needs no
//   browser at all.
//
//   FOREIGN — a self-hosted Harbor on its own login desk: discovery → DCR →
//   PKCE in the SYSTEM browser with a single-use loopback callback → token
//   exchange, composed from the house OAuth toolkit (auth/oauth-client.ts);
//   orgs.ts owns those tokens after the dance.
//
// Loopback discipline (the Outlook lessons): one dance at a time, the
// callback response closes its connection, and the server dies with the flow.

const SCOPES = ['openid', 'email', 'profile'];
const DANCE_TIMEOUT_MS = 5 * 60_000;

export type OpenBrowser = (url: string) => Promise<void> | void;

export function parseInviteLink(url: string): { baseUrl: string; token: string } | null {
  try {
    const u = new URL(url.trim());
    const match = u.pathname.match(/^\/join\/([^/]+)$/);
    if (!match?.[1]) return null;
    return { baseUrl: u.origin, token: match[1] };
  } catch {
    return null;
  }
}

/** The org's RFC 9728 metadata names its AS; absence means dev auth. */
export async function discoverOrgIssuer(baseUrl: string): Promise<string | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`).catch(() => null);
  if (!res || res.status === 404) return null;
  if (!res.ok) throw new Error(`org metadata request failed (${res.status})`);
  const meta = (await res.json()) as { authorization_servers?: string[] };
  const issuer = meta.authorization_servers?.[0];
  if (!issuer) throw new Error('org metadata names no authorization server');
  return issuer;
}

interface DanceResult {
  issuer: string;
  clientId: string;
  tokens: { access: string; refresh: string; expiresAt: number };
}

let danceInFlight = false;

/**
 * Run the full browser dance against an org. Resolves when the person has
 * signed in and consented; rejects on timeout, denial, or an org that
 * doesn't speak OAuth (dev-auth orgs — add those as dev orgs instead).
 */
export async function danceForTokens(input: { baseUrl: string; openBrowser: OpenBrowser }): Promise<DanceResult> {
  if (danceInFlight) throw new Error('a sign-in is already in progress — finish or wait for it first');
  danceInFlight = true;
  try {
    const issuer = await discoverOrgIssuer(input.baseUrl);
    if (!issuer) {
      throw new Error('this org runs dev auth (no authorization server) — add it as a dev org instead');
    }

    // Loopback first: DCR must register the exact redirect URI, port included.
    const pending = await startLoopback();
    try {
      let config;
      let clientId: string;
      try {
        const registered = await oauthClient.registerClient(issuer, [pending.redirectUri], SCOPES, 'Rowboat');
        config = registered.config;
        clientId = registered.registration.client_id;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `this org's authorization server did not accept client registration — it may require approved clients (ask the org admin). AS said: ${message}`,
        );
      }

      const { verifier, challenge } = await oauthClient.generatePKCE();
      const state = oauthClient.generateState();
      const authorizeUrl = oauthClient.buildAuthorizationUrl(config, {
        redirect_uri: pending.redirectUri,
        scope: SCOPES.join(' '),
        state,
        code_challenge: challenge,
      });

      await input.openBrowser(authorizeUrl.toString());
      const callbackUrl = await pending.waitForCallback();
      const tokens = await oauthClient.exchangeCodeForTokens(config, callbackUrl, verifier, state);
      if (!tokens.refresh_token) {
        throw new Error('the authorization server returned no refresh token — unattended access is not possible');
      }
      return {
        issuer,
        clientId,
        tokens: { access: tokens.access_token, refresh: tokens.refresh_token, expiresAt: tokens.expires_at },
      };
    } finally {
      pending.close();
    }
  } finally {
    danceInFlight = false;
  }
}

interface Loopback {
  redirectUri: string;
  waitForCallback(): Promise<URL>;
  close(): void;
}

function startLoopback(): Promise<Loopback> {
  return new Promise((resolveStart, rejectStart) => {
    // The callback promise is armed BEFORE the browser ever opens — a
    // redirect that lands while nobody has awaited waitForCallback yet must
    // not be lost (same family as the WS listener race).
    let settle!: (url: URL) => void;
    let fail!: (err: Error) => void;
    const callback = new Promise<URL>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    callback.catch(() => {}); // never unhandled, even if close() wins the race
    const server = createServer((req, res) => {
      // Base includes the PORT (via Host) — the exchange derives redirect_uri
      // from this URL, and the AS rejects a port-stripped mismatch.
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { connection: 'close' }).end();
        return;
      }
      const denied = url.searchParams.get('error');
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
        .end(
          denied
            ? `<p style="font-family:system-ui;margin:3rem">Sign-in was not completed (${denied}). You can close this tab.</p>`
            : `<p style="font-family:system-ui;margin:3rem">You're signed in — return to Rowboat.</p>`,
        );
      if (denied) fail(new Error(`sign-in ${denied}: ${url.searchParams.get('error_description') ?? 'denied'}`));
      else settle(url);
    });
    server.on('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      setTimeout(() => fail(new Error('sign-in timed out — the browser flow was not completed')), DANCE_TIMEOUT_MS).unref();
      resolveStart({
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCallback: () => callback,
        close: () => {
          // Defer so the callback response finishes flushing (Outlook lesson).
          setTimeout(() => server.close(), 1_000).unref();
        },
      });
    });
  });
}

/** Is this issuer the Rowboat login desk — i.e. does the org ride the account session? */
async function isManagedIssuer(issuer: string): Promise<boolean> {
  const managed = await managedIssuer();
  return managed !== null && sameIssuer(issuer, managed);
}

/** A client on the account session — the 401 path forces one refresh. */
function sessionClient(baseUrl: string): SpacesClient {
  return new SpacesClient({ baseUrl, token: (opts) => getSessionAccessToken(opts) });
}

function notAMember(orgName: string) {
  return (err: unknown): never => {
    if (err instanceof SpacesRequestError && err.code === 'not_a_member') {
      throw new Error(`you're signed in but not a member of ${orgName} — ask for an invite link and join with it`);
    }
    throw err;
  };
}

/**
 * Sign in to an org (existing member — e.g. a new device, a needs-relogin
 * org, or a server address typed by hand): managed orgs through the account
 * session (signing in to Rowboat first if there is none), foreign ones
 * through their own dance; then learn who we are via /v1/me and persist. A
 * stranger to the org gets the honest not_a_member message: they need an
 * invite link.
 */
export async function signInOrg(input: { baseUrl: string; openBrowser: OpenBrowser; orgId?: string }): Promise<OrgRecord> {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const issuer = await discoverOrgIssuer(baseUrl);
  if (issuer && (await isManagedIssuer(issuer))) {
    await ensureRowboatSession();
    const probe = sessionClient(baseUrl);
    const health = await probe.health();
    const me = await probe.me().catch(notAMember(health.org.name));
    invalidateManagedOrgsSync();
    return upsertSessionOrg({ baseUrl, name: health.org.name, address: health.org.address, issuer, memberId: me.member.id });
  }
  const dance = await danceForTokens({ baseUrl, openBrowser: input.openBrowser });
  const probe = new SpacesClient({ baseUrl, token: dance.tokens.access });
  const health = await probe.health();
  const me = await probe.me().catch(notAMember(health.org.name));
  return upsertOAuthOrg({
    ...(input.orgId ? { orgId: input.orgId } : {}),
    baseUrl,
    name: health.org.name,
    address: health.org.address,
    issuer: dance.issuer,
    clientId: dance.clientId,
    memberId: me.member.id,
    tokens: dance.tokens,
  });
}

/**
 * The managed deployment's apex (create-org, my-orgs). Resolution order:
 * ROWBOAT_SPACES_APEX (dev/local-stack override) → the api's /v1/config
 * `spacesApexUrl` (per-environment, follows API_URL — staging api names the
 * staging fleet) → error, since the config being null means no spaces fleet
 * exists for this environment yet.
 */
export async function apexUrl(): Promise<string> {
  const override = process.env.ROWBOAT_SPACES_APEX;
  if (override) return override.replace(/\/$/, '');
  const { getRemoteConfig } = await import('../config/remote-config.js');
  const config = await getRemoteConfig();
  if (!config.spacesApexUrl) {
    throw new Error('Spaces is not available for this environment yet (no fleet configured)');
  }
  return config.spacesApexUrl.replace(/\/$/, '');
}

/**
 * The org's address is generated, never chosen (decision 2026-09-07: names
 * are display-only; the address is opaque). The name-derived prefix keeps
 * logs and DB rows legible; the random suffix is ALWAYS appended — never try
 * the bare name — so creation reveals nothing about taken slugs and the
 * clean namespace stays free for a future vanity claim. Prefix 35 + '-' + 4
 * fits the server's 40-char slug cap.
 */
function generatedSlug(name: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const prefix =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 35).replace(/-+$/, '') || 'server';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${suffix}`;
}

/**
 * Self-serve org creation on the managed deployment: the account session is
 * the identity (the apex trusts the Rowboat login desk; a local-stack apex
 * on some other desk gets its own dance, as before), POST the org, and —
 * because shared-realm tokens are realm-generic — the same session works at
 * the new org's subdomain immediately. The caller is the org's provisioned
 * first admin. The slug is generated here, not passed in: a suffix collision
 * is ~one in 1.7M per prefix, so the retry is a formality; any other failure
 * surfaces verbatim on the first pass.
 */
export async function createOrgOnDeployment(input: {
  name: string;
  openBrowser: OpenBrowser;
  apexUrl?: string;
}): Promise<OrgRecord> {
  const apex = (input.apexUrl ?? (await apexUrl())).replace(/\/$/, '');
  const apexIssuer = await discoverOrgIssuer(apex);
  const managed = apexIssuer !== null && (await isManagedIssuer(apexIssuer));
  let dance: DanceResult | null = null;
  if (managed) await ensureRowboatSession();
  else dance = await danceForTokens({ baseUrl: apex, openBrowser: input.openBrowser });
  const bearer = async () => (dance ? dance.tokens.access : getSessionAccessToken());
  let failure = 'org creation failed';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${apex}/v1/orgs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: input.name, slug: generatedSlug(input.name) }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      org?: { id: string; name: string; address: string };
      member?: { id: string };
    };
    if (res.ok && body.org && body.member) {
      const baseUrl = `${new URL(apex).protocol}//${body.org.address}`;
      if (!dance) {
        invalidateManagedOrgsSync();
        return upsertSessionOrg({
          baseUrl,
          name: body.org.name,
          address: body.org.address,
          serverOrgId: body.org.id,
          issuer: apexIssuer!,
          memberId: body.member.id,
        });
      }
      return upsertOAuthOrg({
        baseUrl,
        name: body.org.name,
        address: body.org.address,
        serverOrgId: body.org.id,
        issuer: dance.issuer,
        clientId: dance.clientId,
        memberId: body.member.id,
        tokens: dance.tokens,
      });
    }
    failure = body.message ?? `org creation failed (${res.status})`;
    if (!/is taken/.test(failure)) break;
  }
  throw new Error(failure);
}

/** Pre-auth resolution of a pasted invite link — what the join card shows. */
export async function resolveInviteLink(url: string): Promise<{ baseUrl: string; token: string; resolved: ResolveInviteResult }> {
  const parsed = parseInviteLink(url);
  if (!parsed) throw new Error('not an invite link — expected https://<org>/join/<token>');
  const client = new SpacesClient({ baseUrl: parsed.baseUrl, token: '' });
  return { ...parsed, resolved: await client.resolveInvite(parsed.token) };
}

/**
 * The full join: parse → identity (the account session for a managed org —
 * signing in to Rowboat once if there is none; this install's own dance for
 * a foreign org it has no working auth on) → accept (the bind ceremony
 * server-side) → persist the org with the member we became. policy_refused
 * surfaces verbatim.
 */
export async function joinViaInviteLink(input: {
  url: string;
  openBrowser: OpenBrowser;
}): Promise<{ org: OrgRecord; result: AcceptInviteResult }> {
  const parsed = parseInviteLink(input.url);
  if (!parsed) throw new Error('not an invite link — expected https://<org>/join/<token>');

  // An org we're already signed into (dev, session-backed, or healthy oauth): plain accept.
  const existing = listOrgs().find((o) => o.baseUrl === parsed.baseUrl);
  if (existing) {
    const sessionBacked = await isSessionBacked(existing.auth);
    const usable = existing.auth.kind === 'dev' || sessionBacked || (existing.auth.kind === 'oauth' && !existing.auth.error);
    if (usable) {
      if (sessionBacked) await ensureRowboatSession();
      const result = await getClient(existing.id).acceptInvite(parsed.token);
      return { org: getOrg(existing.id) ?? existing, result };
    }
  }

  const issuer = await discoverOrgIssuer(parsed.baseUrl);
  if (issuer && (await isManagedIssuer(issuer))) {
    await ensureRowboatSession();
    const client = sessionClient(parsed.baseUrl);
    const result = await client.acceptInvite(parsed.token);
    const health = await client.health();
    const org = upsertSessionOrg({
      baseUrl: parsed.baseUrl,
      name: health.org.name,
      address: health.org.address,
      issuer,
      memberId: result.membership.memberId,
    });
    invalidateManagedOrgsSync();
    return { org, result };
  }

  const dance = await danceForTokens({ baseUrl: parsed.baseUrl, openBrowser: input.openBrowser });
  const client = new SpacesClient({ baseUrl: parsed.baseUrl, token: dance.tokens.access });
  const result = await client.acceptInvite(parsed.token);
  const health = await client.health();
  const org = upsertOAuthOrg({
    baseUrl: parsed.baseUrl,
    name: health.org.name,
    address: health.org.address,
    issuer: dance.issuer,
    clientId: dance.clientId,
    memberId: result.membership.memberId,
    tokens: dance.tokens,
  });
  return { org, result };
}

// --- the account session and the managed orgs it lists ----------------------

/** What the Spaces UI needs to know about the Rowboat session (auth/tokens.ts): is there one, and is the app signed in on it? */
export async function accountState(): Promise<{ hasSession: boolean; appSignedIn: boolean }> {
  const session = await readSession();
  return { hasSession: session !== null, appSignedIn: session?.appSignedIn ?? false };
}

let lastManagedSyncAt = 0;
let managedSyncInFlight: Promise<void> | null = null;
let apexManagedCache: { apex: string; issuer: string | null } | null = null;

/** Something changed what the apex would list (a join, a sign-in): the next sync runs regardless of age. */
export function invalidateManagedOrgsSync(): void {
  lastManagedSyncAt = 0;
}

/**
 * Make the registry's managed orgs match the apex's "my orgs" listing —
 * the truth for them. No session: the managed records go (signed out).
 * No fleet for this environment, or a local-stack apex on some other
 * login desk: nothing to list, records untouched. A failed fetch leaves
 * the cache as it was (the caller logs). `maxAgeMs` makes the call cheap
 * from hot paths (the org listing IPC): a recent sync is reused.
 */
export async function syncManagedOrgs(opts: { maxAgeMs?: number } = {}): Promise<void> {
  if (managedSyncInFlight) return managedSyncInFlight;
  if (opts.maxAgeMs !== undefined && Date.now() - lastManagedSyncAt < opts.maxAgeMs) return;
  managedSyncInFlight = (async () => {
    const session = await readSession();
    if (!session) {
      dropSessionOrgs();
      lastManagedSyncAt = Date.now();
      return;
    }
    const issuer = await managedIssuer();
    if (!issuer) return;
    let apex: string;
    try {
      apex = await apexUrl();
    } catch {
      lastManagedSyncAt = Date.now();
      return;
    }
    if (!apexManagedCache || apexManagedCache.apex !== apex) {
      apexManagedCache = { apex, issuer: await discoverOrgIssuer(apex) };
    }
    if (!apexManagedCache.issuer || !sameIssuer(apexManagedCache.issuer, issuer)) {
      lastManagedSyncAt = Date.now();
      return;
    }
    const token = await getSessionAccessToken();
    const res = await fetch(`${apex}/v1/orgs`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`org listing failed (${res.status})`);
    const body = (await res.json()) as { orgs?: ManagedOrgListing[] };
    applyManagedListing(body.orgs ?? [], { apexOrigin: apex, issuer });
    lastManagedSyncAt = Date.now();
  })().finally(() => {
    managedSyncInFlight = null;
  });
  return managedSyncInFlight;
}

/**
 * The Spaces door's "Sign in with Rowboat": a session (browser sign-in if
 * there is none — stamped spaces-only, the app stays signed out), then
 * every managed org the person belongs to, listed.
 */
export async function signInForSpaces(): Promise<OrgRecord[]> {
  await ensureRowboatSession();
  invalidateManagedOrgsSync();
  await syncManagedOrgs();
  return listOrgs();
}

/**
 * A server typed by hand: a full URL, a bare host, or — on the managed
 * deployment — just the org's slug. Resolves to the org's base URL.
 */
export async function normalizeServerAddress(raw: string): Promise<string> {
  const text = raw.trim();
  if (!text) throw new Error('enter a server address');
  if (/^[a-z0-9][a-z0-9-]*$/i.test(text)) {
    const apex = new URL(await apexUrl());
    return `${apex.protocol}//${text.toLowerCase()}.${apex.host}`;
  }
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return new URL(withScheme).origin;
}

/** Add an org by its address (the advanced door): sign in to it as an existing member. */
export async function addOrgByAddress(input: { address: string; openBrowser: OpenBrowser }): Promise<OrgRecord> {
  return signInOrg({ baseUrl: await normalizeServerAddress(input.address), openBrowser: input.openBrowser });
}
