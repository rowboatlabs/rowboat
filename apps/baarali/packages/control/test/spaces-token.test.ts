import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import * as client from 'openid-client';
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAuth, migrateAuth, spacesClaims, type AuthDeps } from '../src/auth.js';
import { LogSender } from '../src/codes.js';
import { migrate } from '../src/db.js';
import { PgStore } from '../src/pg-store.js';
import { pgliteDb } from './pglite.js';

// Spaces (decided 02/10/2026: we host them ourselves). Harbor, the Spaces
// server (apps/harbor), only ever checks a token alone: it finds our keys
// from the issuer's metadata and verifies an ES256 or RS256 JWT
// (apps/harbor/packages/server/src/auth-oidc.ts). This plays the phone app
// (apps/x/apps/mobile src/lib/spaces/oauth.ts) and then reads the token the
// way Harbor does.

const PUBLIC = 'https://control.test';
const ISSUER = `${PUBLIC}/auth/v1`;
const SPACES = 'https://spaces.control.test';
const REDIRECT = 'com.baarali.app.mobile:/oauth-callback';

let pg: PGlite;
let visitors = 0;
beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
}, 60_000);

async function setup(spacesUrl?: string) {
  const db = pgliteDb(pg);
  await db.query('DROP SCHEMA IF EXISTS baarali CASCADE');
  await migrate(db);
  await db.query('SET search_path TO baarali');
  const store = new PgStore(db, [{ id: 'decouverte', category: 'free', displayName: 'Découverte', weekCredits: 1, monthlyPrices: [], models: null }]);
  const sender = new LogSender();
  const deps: AuthDeps = {
    publicUrl: PUBLIC,
    secret: 'test-secret-test-secret-test-secret-0123',
    database: { dialect: new PGliteDialect(pg), type: 'postgres' },
    db,
    sender,
    social: {},
    onUserCreated: (u) => store.upsertAccount({ id: u.id, email: u.email, planId: 'decouverte', createdAt: u.createdAt }),
    now: Date.now,
    spacesUrl,
  };
  await migrateAuth(deps);
  const auth = createAuth(deps);
  const app = createApp({
    store, openRouterKey: 'or', publicUrl: PUBLIC, appName: 'Baarali', mediaPacks: [], auth, spacesUrl,
    fetch: (async () => new Response('{}')) as typeof fetch, now: Date.now,
  });
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => app.request(url instanceof Request ? url : String(url), init)) as typeof fetch;

  const jar = new Map<string, string>();
  const browser = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    headers.set('origin', PUBLIC);
    const res = await app.request(new URL(url, PUBLIC).toString(), { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
  // One address per test: the send limit (3 a minute) is kept in memory for the whole file.
  const ip = `203.0.113.${++visitors}`;
  const post = (path: string, body: unknown) =>
    browser(`/auth/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': ip }, body: JSON.stringify(body) });
  const form = (params: Record<string, string>) =>
    fetcher(`${ISSUER}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });

  /** The phone's journey: registration, sign-in by email code, consent, code exchange. */
  async function signInFromPhone(email: string) {
    const meta = await (await fetcher(`${ISSUER}/.well-known/oauth-authorization-server`)).json();
    const registered = await fetcher(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'fly-client-ip': ip },
      body: JSON.stringify({
        client_name: 'Baarali Mobile',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    expect(registered.status).toBe(201);
    const clientId: string = (await registered.json()).client_id;

    const verifier = client.randomPKCECodeVerifier();
    const authorize = new URL(meta.authorization_endpoint);
    for (const [k, v] of Object.entries({
      response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'openid email profile', state: 'st',
      code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
    })) authorize.searchParams.set(k, v);
    const login = new URL((await browser(authorize.toString())).headers.get('location') ?? '', PUBLIC);
    expect(login.pathname).toBe('/auth/v1/sign-in');
    const oauth_query = login.search.slice(1);
    await post('/email-otp/send-verification-otp', { email, type: 'sign-in', oauth_query });
    const signedIn = await post('/sign-in/email-otp', { email, otp: sender.sent.at(-1)!.code, oauth_query });
    const consent = new URL((await signedIn.json()).url, PUBLIC);
    const callback = new URL((await (await post('/oauth2/consent', { accept: true, oauth_query: consent.search.slice(1) })).json()).url);
    expect(`${callback.protocol}${callback.pathname}`).toBe(REDIRECT);

    const res = await form({ grant_type: 'authorization_code', code: callback.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
    expect(res.status).toBe(200);
    return { clientId, tokens: (await res.json()) as { access_token: string; refresh_token: string; id_token: string } };
  }

  return { app, db, store, fetcher, form, signInFromPhone };
}

/** auth-oidc.ts, step by step: metadata at the issuer, same issuer, its keys, ES256/RS256 only. */
async function verifyAsHarbor(fetcher: typeof fetch, token: string) {
  const meta = await (await fetcher(`${ISSUER}/.well-known/oauth-authorization-server`)).json();
  expect(meta.issuer).toBe(ISSUER);
  // Harbor fetches the keys itself; the app here lives in memory, so they are handed over.
  const keys = await (await fetcher(meta.jwks_uri)).json();
  return (await jwtVerify(token, createLocalJWKSet(keys), { issuer: ISSUER, algorithms: ['ES256', 'RS256'] })).payload;
}

describe('the tokens Spaces receive', () => {
  it('signs the phone in and gives it a token Harbor verifies alone', async () => {
    const { app, fetcher, signInFromPhone } = await setup(SPACES);
    const { tokens } = await signInFromPhone('awa@example.test');

    const payload = await verifyAsHarbor(fetcher, tokens.access_token);
    expect(payload.sub).toBeTruthy();
    expect(payload.email).toBe('awa@example.test');
    expect(payload.aud).toContain(SPACES);

    // The same token still opens our own routes.
    expect((await app.request('/v1/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(200);
    // And the apps learn where Spaces are.
    expect((await (await app.request('/v1/config')).json()).spacesApexUrl).toBe(SPACES);
  });

  it('keeps Spaces signed in after the refresh', async () => {
    const { fetcher, form, signInFromPhone } = await setup(SPACES);
    const { clientId, tokens } = await signInFromPhone('awa@example.test');
    const refreshed = await (await form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })).json();
    expect((await verifyAsHarbor(fetcher, refreshed.access_token)).email).toBe('awa@example.test');
  });

  it('signs only Spaces tokens with the second key', async () => {
    const { signInFromPhone } = await setup(SPACES);
    const { tokens } = await signInFromPhone('awa@example.test');
    expect(decodeProtectedHeader(tokens.access_token).alg).toBe('ES256');
  });

  it('without a Spaces server, changes nothing and tells the apps none exists', async () => {
    const { app, signInFromPhone } = await setup();
    const { tokens } = await signInFromPhone('awa@example.test');
    expect(() => decodeJwt(tokens.access_token)).toThrow();
    expect((await app.request('/v1/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(200);
    expect((await (await app.request('/v1/config')).json()).spacesApexUrl).toBeNull();
  });
});

describe('the token a cloud instance trades', () => {
  async function instanceOf(email: string, spacesUrl?: string) {
    const ctx = await setup(spacesUrl);
    const { tokens } = await ctx.signInFromPhone(email);
    const me = await (await ctx.app.request('/v1/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
    await ctx.store.grantToken('inst-token', me.user.id);
    const trade = () => ctx.app.request('/v1/spaces/token', { method: 'POST', headers: { authorization: 'Bearer inst-token' } });
    return { ...ctx, me, tokens, trade };
  }

  it('is a Spaces token for the same person the phone signs in as', async () => {
    const { fetcher, tokens, trade } = await instanceOf('awa@example.test', SPACES);
    const res = await trade();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expires_in).toBe(900);
    const traded = await verifyAsHarbor(fetcher, body.access_token);
    const phone = await verifyAsHarbor(fetcher, tokens.access_token);
    expect(traded.sub).toBe(phone.sub);
    expect(traded.email).toBe('awa@example.test');
    expect(traded.aud).toEqual([SPACES]);
    expect(decodeProtectedHeader(body.access_token).alg).toBe('ES256');
  });

  it('is refused without a token', async () => {
    const { app } = await instanceOf('awa@example.test', SPACES);
    expect((await app.request('/v1/spaces/token', { method: 'POST' })).status).toBe(401);
  });

  it('does not exist without a Spaces server', async () => {
    const { trade } = await instanceOf('awa@example.test');
    expect((await trade()).status).toBe(404);
  });
});

describe('who a Spaces token says you are', () => {
  it('gives an email only once verified, and never the phone placeholder', () => {
    expect(spacesClaims({ email: 'awa@example.test', emailVerified: true, name: 'Awa' })).toEqual({ email: 'awa@example.test', name: 'Awa' });
    expect(spacesClaims({ email: 'awa@example.test', emailVerified: false })).toEqual({});
    expect(spacesClaims({ email: '22670000001@phone.baarali.invalid', emailVerified: true })).toEqual({});
  });

  it('gives no name when it is only the phone number', () => {
    expect(spacesClaims({ name: '+226 70 00 00 01' })).toEqual({});
    expect(spacesClaims(null)).toEqual({});
  });
});
