import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as oauthClient from '../auth/oauth-client.js';
import { ensureRowboatSession } from '../auth/oauth-flows.js';
import { getSessionAccessToken, readSession } from '../auth/tokens.js';
import { parseInviteLink, SpacesClient } from '@x/spaces-client';
import {
  dropSessionOrgs,
  getClient,
  getOrg,
  isSessionBacked,
  listOrgs,
  managedIssuer,
  sameIssuer,
  SPACES_SERVER_ID,
  upsertOAuthOrg,
  upsertSessionOrg,
  type OrgRecord,
} from './orgs.js';
import type { AcceptInviteResult, ResolveInviteResult } from '@rowboat/spaces-protocol';

// The app side of the OAuth journey (spec §4). Two roads, chosen by the
// server's issuer (its RFC 9728 metadata names its authorization server):
//
//   ROWBOAT'S SERVER — it trusts the Rowboat login desk, the same one the
//   Rowboat account comes from. No dance of our own: the account session is
//   the identity (auth/tokens.ts, one session two uses). If no session
//   exists yet, the ordinary Rowboat sign-in runs once and the session is
//   stamped spaces-only. The first call, POST /v1/me, makes the account a
//   member (2026-11-09: there is no org to be listed in; a cold start with
//   no invite lands on an empty chat list), so a reinstall recovers the
//   person's chats with one sign-in.
//
//   SELF-HOSTED — a Harbor on its own login desk: discovery → DCR → PKCE in
//   the SYSTEM browser with a single-use loopback callback → token exchange,
//   composed from the house OAuth toolkit (auth/oauth-client.ts); orgs.ts
//   owns those tokens after the dance. Connected by its address (the
//   advanced door), and the one server this install then talks to.
//
// Loopback discipline (the Outlook lessons): one dance at a time, the
// callback response closes its connection, and the server dies with the flow.

const SCOPES = ['openid', 'email', 'profile'];
const DANCE_TIMEOUT_MS = 5 * 60_000;
export type OpenBrowser = (url: string) => Promise<void> | void;

/** The server's RFC 9728 metadata names its AS; absence means dev auth. */
export async function discoverOrgIssuer(baseUrl: string): Promise<string | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`).catch(() => null);
  if (!res || res.status === 404) return null;
  if (!res.ok) throw new Error(`server metadata request failed (${res.status})`);
  const meta = (await res.json()) as { authorization_servers?: string[] };
  const issuer = meta.authorization_servers?.[0];
  if (!issuer) throw new Error('server metadata names no authorization server');
  return issuer;
}

interface DanceResult {
  issuer: string;
  clientId: string;
  tokens: { access: string; refresh: string; expiresAt: number };
}

let danceInFlight = false;

/**
 * Run the full browser dance against a server. Resolves when the person has
 * signed in and consented; rejects on timeout, denial, or a server that
 * doesn't speak OAuth (a dev-auth Harbor is connected with a dev token instead).
 */
export async function danceForTokens(input: { baseUrl: string; openBrowser: OpenBrowser }): Promise<DanceResult> {
  if (danceInFlight) throw new Error('a sign-in is already in progress — finish or wait for it first');
  danceInFlight = true;
  try {
    const issuer = await discoverOrgIssuer(input.baseUrl);
    if (!issuer) {
      throw new Error('this server runs dev auth (no authorization server) — connect with a dev token instead');
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
          `this server's authorization server did not accept client registration — it may require approved clients (ask whoever runs it). AS said: ${message}`,
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
/** Is this issuer the Rowboat login desk — i.e. does the server ride the account session? */
async function isManagedIssuer(issuer: string): Promise<boolean> {
  const managed = await managedIssuer();
  return managed !== null && sameIssuer(issuer, managed);
}

/** A client on the account session — the 401 path forces one refresh. */
function sessionClient(baseUrl: string): SpacesClient {
  return new SpacesClient({ baseUrl, token: (opts) => getSessionAccessToken(opts) });
}

/**
 * Sign in to a server (Rowboat's through the account session, signing in to
 * Rowboat first if there is none; a self-hosted one through its own dance),
 * become a member if not one yet (POST /v1/me, 2026-11-09), and persist the
 * record. The one server this install talks to from then on.
 */
export async function signInOrg(input: { baseUrl: string; openBrowser: OpenBrowser }): Promise<OrgRecord> {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const issuer = await discoverOrgIssuer(baseUrl);
  if (issuer && (await isManagedIssuer(issuer))) {
    await ensureRowboatSession();
    const probe = sessionClient(baseUrl);
    const health = await probe.health();
    const { member } = await probe.enroll();
    invalidateManagedSync();
    return upsertSessionOrg({ baseUrl, name: health.server.name, address: health.server.address, issuer, memberId: member.id });
  }
  const dance = await danceForTokens({ baseUrl, openBrowser: input.openBrowser });
  const probe = new SpacesClient({ baseUrl, token: dance.tokens.access });
  const health = await probe.health();
  const { member } = await probe.enroll();
  return upsertOAuthOrg({
    baseUrl,
    name: health.server.name,
    address: health.server.address,
    issuer: dance.issuer,
    clientId: dance.clientId,
    memberId: member.id,
    tokens: dance.tokens,
  });
}

/**
 * Rowboat's Spaces server. Resolution order: ROWBOAT_SPACES_SERVER (dev /
 * local-stack override) → the api's /v1/config `spacesApexUrl` (the field
 * keeps its pre-2026-11-09 name on the backend; it names the one server now,
 * per environment — the staging api names the staging server) → error, since
 * a null config means no Spaces server exists for this environment yet.
 */
export async function serverUrl(): Promise<string> {
  const override = process.env.ROWBOAT_SPACES_SERVER ?? process.env.ROWBOAT_SPACES_APEX;
  if (override) return override.replace(/\/$/, '');
  const { getRemoteConfig } = await import('../config/remote-config.js');
  const config = await getRemoteConfig();
  if (!config.spacesApexUrl) {
    throw new Error('Spaces is not available for this environment yet (no server configured)');
  }
  return config.spacesApexUrl.replace(/\/$/, '');
}

/** Pre-auth resolution of a pasted invite link — what the join card shows. */
export async function resolveInviteLink(url: string): Promise<{ baseUrl: string; token: string; resolved: ResolveInviteResult }> {
  const parsed = parseInviteLink(url);
  if (!parsed) throw new Error('not an invite link — expected https://<server>/join/<token>');
  const client = new SpacesClient({ baseUrl: parsed.baseUrl, token: '' });
  return { ...parsed, resolved: await client.resolveInvite(parsed.token) };
}

/**
 * Who the accept made us. A person's link accepted by its own maker, or an
 * invite whose target is gone, carries no membership to read it from.
 */
async function memberIdAfterAccept(client: SpacesClient, result: AcceptInviteResult): Promise<string> {
  return result.membership?.memberId ?? (await client.me()).member.id;
}

/**
 * The full join: parse → identity (the account session for Rowboat's server —
 * signing in to Rowboat once if there is none; this install's own dance for
 * a self-hosted one it has no working auth on) → accept (the bind ceremony
 * server-side) → persist the server with the member we became. A link to
 * another server than the one connected makes that server the connected one.
 */
export async function joinViaInviteLink(input: {
  url: string;
  openBrowser: OpenBrowser;
}): Promise<{ org: OrgRecord; result: AcceptInviteResult }> {
  const parsed = parseInviteLink(input.url);
  if (!parsed) throw new Error('not an invite link — expected https://<server>/join/<token>');

  // The server we're already signed into (dev, session-backed, or healthy oauth): plain accept.
  const existing = getOrg(SPACES_SERVER_ID);
  if (existing && existing.baseUrl === parsed.baseUrl) {
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
      name: health.server.name,
      address: health.server.address,
      issuer,
      memberId: await memberIdAfterAccept(client, result),
    });
    invalidateManagedSync();
    return { org, result };
  }

  const dance = await danceForTokens({ baseUrl: parsed.baseUrl, openBrowser: input.openBrowser });
  const client = new SpacesClient({ baseUrl: parsed.baseUrl, token: dance.tokens.access });
  const result = await client.acceptInvite(parsed.token);
  const health = await client.health();
  const org = upsertOAuthOrg({
    baseUrl: parsed.baseUrl,
    name: health.server.name,
    address: health.server.address,
    issuer: dance.issuer,
    clientId: dance.clientId,
    memberId: await memberIdAfterAccept(client, result),
    tokens: dance.tokens,
  });
  return { org, result };
}

// --- the account session and Rowboat's server ------------------------------

/** What the Spaces UI needs to know about the Rowboat session (auth/tokens.ts): is there one, and is the app signed in on it? */
export async function accountState(): Promise<{ hasSession: boolean; appSignedIn: boolean }> {
  const session = await readSession();
  return { hasSession: session !== null, appSignedIn: session?.appSignedIn ?? false };
}

let lastManagedSyncAt = 0;
let managedSyncInFlight: Promise<void> | null = null;
let serverIssuerCache: { server: string; issuer: string | null } | null = null;

/** Something changed the session (a sign-in, a sign-out): the next sync runs regardless of age. */
export function invalidateManagedSync(): void {
  lastManagedSyncAt = 0;
}

/** The pre-2026-11-09 name, kept for the hosts' subscriptions. */
export const invalidateManagedOrgsSync = invalidateManagedSync;

/**
 * Make the record match the Rowboat session. No session: a session-backed
 * record goes (signed out). A session and no record: Rowboat's server is
 * connected on it — the account becomes a member on first contact (POST
 * /v1/me). A record already (Rowboat's, a self-hosted one, a dev Harbor):
 * left alone — the person's choice of server stands. No server for this
 * environment, or a server on some other login desk: nothing to do. A failed
 * probe leaves the record as it was (the caller logs). `maxAgeMs` makes the
 * call cheap from hot paths (the listing IPC): a recent sync is reused.
 */
export async function syncManagedServer(opts: { maxAgeMs?: number } = {}): Promise<void> {
  if (managedSyncInFlight) return managedSyncInFlight;
  if (opts.maxAgeMs !== undefined && Date.now() - lastManagedSyncAt < opts.maxAgeMs) return;
  managedSyncInFlight = (async () => {
    const session = await readSession();
    if (!session) {
      dropSessionOrgs();
      lastManagedSyncAt = Date.now();
      return;
    }
    if (getOrg(SPACES_SERVER_ID)) {
      lastManagedSyncAt = Date.now();
      return;
    }
    const issuer = await managedIssuer();
    if (!issuer) return;
    let server: string;
    try {
      server = await serverUrl();
    } catch {
      lastManagedSyncAt = Date.now();
      return;
    }
    if (!serverIssuerCache || serverIssuerCache.server !== server) {
      serverIssuerCache = { server, issuer: await discoverOrgIssuer(server) };
    }
    if (!serverIssuerCache.issuer || !sameIssuer(serverIssuerCache.issuer, issuer)) {
      lastManagedSyncAt = Date.now();
      return;
    }
    const client = sessionClient(server);
    const health = await client.health();
    const { member } = await client.enroll();
    upsertSessionOrg({ baseUrl: server, name: health.server.name, address: health.server.address, issuer, memberId: member.id });
    lastManagedSyncAt = Date.now();
  })().finally(() => {
    managedSyncInFlight = null;
  });
  return managedSyncInFlight;
}

/** The pre-2026-11-09 name, kept for the hosts. */
export const syncManagedOrgs = syncManagedServer;

/**
 * The Spaces door's "Sign in with Rowboat": a session (browser sign-in if
 * there is none — stamped spaces-only, the app stays signed out), then
 * Rowboat's server connected on it.
 */
export async function signInForSpaces(): Promise<OrgRecord[]> {
  await ensureRowboatSession();
  invalidateManagedSync();
  await syncManagedServer();
  return listOrgs();
}

/** A server typed by hand: a full URL or a bare host. Resolves to its base URL. */
export function normalizeServerAddress(raw: string): string {
  const text = raw.trim();
  if (!text) throw new Error('enter a server address');
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return new URL(withScheme).origin;
}

/** Connect to a server by its address (the advanced door, for self-hosters): sign in to it and become a member. */
export async function addOrgByAddress(input: { address: string; openBrowser: OpenBrowser }): Promise<OrgRecord> {
  return signInOrg({ baseUrl: normalizeServerAddress(input.address), openBrowser: input.openBrowser });
}
