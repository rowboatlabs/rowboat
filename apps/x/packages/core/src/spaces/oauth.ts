import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as oauthClient from '../auth/oauth-client.js';
import { SpacesClient, SpacesRequestError } from './client.js';
import { getClient, getOrg, listOrgs, upsertOAuthOrg, type OrgRecord } from './orgs.js';
import type { AcceptInviteResult, ResolveInviteResult } from '@rowboat/spaces-protocol';

// The app side of the OAuth journey (spec §4): discovery via the org's
// RFC 9728 metadata → DCR → PKCE in the SYSTEM browser with a single-use
// loopback callback → token exchange. Composes the house OAuth toolkit
// (auth/oauth-client.ts); orgs.ts owns the tokens after the dance.
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

/**
 * Sign in to an org (existing member — e.g. a new device, or a needs-relogin
 * org): dance, learn who we are via /v1/me, persist. A stranger to the org
 * gets the honest not_a_member message: they need an invite link.
 */
export async function signInOrg(input: { baseUrl: string; openBrowser: OpenBrowser; orgId?: string }): Promise<OrgRecord> {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const dance = await danceForTokens({ baseUrl, openBrowser: input.openBrowser });
  const probe = new SpacesClient({ baseUrl, token: dance.tokens.access });
  const health = await probe.health();
  const me = await probe.me().catch((err) => {
    if (err instanceof SpacesRequestError && err.code === 'not_a_member') {
      throw new Error(`you're signed in but not a member of ${health.org.name} — ask for an invite link and join with it`);
    }
    throw err;
  });
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
 * Self-serve org creation on the managed deployment: dance against the apex
 * (same discovery, same flow), POST the org, and — because shared-realm
 * tokens are realm-generic — the dance's tokens work at the new org's
 * subdomain immediately. The caller is the org's provisioned first admin.
 */
export async function createOrgOnDeployment(input: {
  name: string;
  slug: string;
  openBrowser: OpenBrowser;
  apexUrl?: string;
}): Promise<OrgRecord> {
  const apex = (input.apexUrl ?? (await apexUrl())).replace(/\/$/, '');
  const dance = await danceForTokens({ baseUrl: apex, openBrowser: input.openBrowser });
  const res = await fetch(`${apex}/v1/orgs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dance.tokens.access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: input.name, slug: input.slug }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    org?: { id: string; name: string; address: string };
    member?: { id: string };
  };
  if (!res.ok || !body.org || !body.member) {
    throw new Error(body.message ?? `org creation failed (${res.status})`);
  }
  return upsertOAuthOrg({
    baseUrl: `${new URL(apex).protocol}//${body.org.address}`,
    name: body.org.name,
    address: body.org.address,
    issuer: dance.issuer,
    clientId: dance.clientId,
    memberId: body.member.id,
    tokens: dance.tokens,
  });
}

/** Pre-auth resolution of a pasted invite link — what the join card shows. */
export async function resolveInviteLink(url: string): Promise<{ baseUrl: string; token: string; resolved: ResolveInviteResult }> {
  const parsed = parseInviteLink(url);
  if (!parsed) throw new Error('not an invite link — expected https://<org>/join/<token>');
  const client = new SpacesClient({ baseUrl: parsed.baseUrl, token: '' });
  return { ...parsed, resolved: await client.resolveInvite(parsed.token) };
}

/**
 * The full join: parse → (dance if this install has no working auth on the
 * org) → accept (the bind ceremony server-side) → persist the org with the
 * member we became. policy_refused surfaces verbatim.
 */
export async function joinViaInviteLink(input: {
  url: string;
  openBrowser: OpenBrowser;
}): Promise<{ org: OrgRecord; result: AcceptInviteResult }> {
  const parsed = parseInviteLink(input.url);
  if (!parsed) throw new Error('not an invite link — expected https://<org>/join/<token>');

  // An org we're already signed into (dev or healthy oauth): plain accept.
  const existing = listOrgs().find(
    (o) => o.baseUrl === parsed.baseUrl && (o.auth.kind === 'dev' || !o.auth.error),
  );
  if (existing) {
    const result = await getClient(existing.id).acceptInvite(parsed.token);
    return { org: getOrg(existing.id) ?? existing, result };
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
