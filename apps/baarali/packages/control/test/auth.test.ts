import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import * as client from 'openid-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAuth, migrateAuth, type AuthDeps, type SocialProvider } from '../src/auth.js';
import { LogSender } from '../src/codes.js';
import { migrate } from '../src/db.js';
import { PgStore } from '../src/pg-store.js';
import type { Plan } from '../src/store.js';
import { pgliteDb } from './pglite.js';

// The sign-in server, driven the way core drives it (core auth/oauth-client.ts
// and oauth-flows.ts): the same openid-client, discovery at the same URL,
// dynamic registration with the same metadata, PKCE, then /v1/me with the
// access token. The browser part is played by a cookie-keeping fetch.

const PUBLIC = 'https://control.test';
const REDIRECT = 'http://localhost:8080/oauth/callback';
const PLANS: Plan[] = [
  { id: 'decouverte', category: 'free', displayName: 'Découverte', weekCredits: 8_000_000, monthlyPrices: [], models: null },
];

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
}, 60_000);

async function setup(opts: { social?: Partial<Record<SocialProvider, { clientId: string; clientSecret: string }>>; spacesUrl?: string } = {}) {
  const db = pgliteDb(pg);
  await db.query('DROP SCHEMA IF EXISTS baarali CASCADE');
  await migrate(db);
  await db.query('SET search_path TO baarali');
  const store = new PgStore(db, PLANS);
  const sender = new LogSender();
  const deps: AuthDeps = {
    publicUrl: PUBLIC,
    secret: 'test-secret-test-secret-test-secret-0123',
    database: { dialect: new PGliteDialect(pg), type: 'postgres' },
    db,
    sender,
    social: opts.social ?? {},
    onUserCreated: (u) => store.upsertAccount({ id: u.id, email: u.email, planId: 'decouverte', createdAt: u.createdAt }),
    now: Date.now,
    spacesUrl: opts.spacesUrl,
  };
  await migrateAuth(deps);
  const auth = createAuth(deps);
  const app = createApp({
    store, openRouterKey: 'or', publicUrl: PUBLIC, appName: 'Baarali', mediaPacks: [], auth,
    fetch: (async () => new Response('{}')) as typeof fetch, now: Date.now,
  });

  // A browser: keeps cookies, never follows redirects by itself.
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
  const post = (path: string, body: unknown, ip = '203.0.113.200') =>
    browser(`/auth/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': ip }, body: JSON.stringify(body) });

  const fetcher: client.CustomFetch = async (url, options) => app.request(url, options as RequestInit);
  // A fresh browser: same server, no cookie.
  const forgetCookies = () => jar.clear();
  return { app, store, sender, browser, post, fetcher, db, forgetCookies };
}

/** Core's registration, then an authorization URL with PKCE. */
async function startAppSignIn(fetcher: client.CustomFetch) {
  const config = await client.dynamicClientRegistration(
    new URL(`${PUBLIC}/auth/v1/.well-known/oauth-authorization-server`),
    {
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'RowboatX Desktop App',
      scope: 'openid email profile',
    },
    client.None(),
    { [client.customFetch]: fetcher },
  );
  config[client.customFetch] = fetcher;
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: REDIRECT,
    scope: 'openid email profile',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
  });
  return { config, verifier, state, url };
}

const location = (res: Response) => new URL(res.headers.get('location') ?? '', PUBLIC);
const queryOf = (u: URL) => u.search.slice(1);

describe('signing the app in, as core does', () => {
  // With Spaces on, every app asks for their resource too (spaces-token.test.ts):
  // core's sign-in must not notice.
  it.each([['', undefined], [' with Spaces on', 'https://spaces.control.test']])('registers, signs in by email code, consents, and calls /v1/me%s', async (_, spacesUrl) => {
    const { browser, post, fetcher, sender, app } = await setup({ spacesUrl });
    const { config, verifier, state, url } = await startAppSignIn(fetcher);

    const toLogin = await browser(url.toString());
    expect(toLogin.status).toBe(302);
    const login = location(toLogin);
    expect(login.pathname).toBe('/auth/v1/sign-in');
    const page = await browser(login.toString());
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Adresse email');

    const oauth_query = queryOf(login);
    expect((await post('/email-otp/send-verification-otp', { email: 'awa@example.test', type: 'sign-in', oauth_query })).status).toBe(200);
    const code = sender.sent.at(-1)!.code;
    const signedIn = await post('/sign-in/email-otp', { email: 'awa@example.test', otp: code, oauth_query });
    expect(signedIn.status).toBe(200);
    // Relative, like every URL the flow hands the page.
    const next = new URL((await signedIn.json()).url, PUBLIC);
    expect(next.pathname).toBe('/auth/v1/consent');

    const consented = await post('/oauth2/consent', { accept: true, oauth_query: queryOf(next) });
    expect(consented.status).toBe(200);
    const callback = new URL((await consented.json()).url, PUBLIC);
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT);

    const tokens = await client.authorizationCodeGrant(config, callback, { pkceCodeVerifier: verifier, expectedState: state });
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.expires_in).toBe(900);

    const me = await app.request('/v1/me', { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe('awa@example.test');
    expect(body.billing.planId).toBe('decouverte');

    // The refresh token rotates: the new one works, the old one no longer does.
    const refreshed = await client.refreshTokenGrant(config, tokens.refresh_token!);
    expect((await app.request('/v1/me', { headers: { authorization: `Bearer ${refreshed.access_token}` } })).status).toBe(200);
    await expect(client.refreshTokenGrant(config, tokens.refresh_token!)).rejects.toThrow();
  });

  it('signs in from the page alone, outside the app, and says so', async () => {
    const { browser, post, sender, store } = await setup();
    expect(await (await browser('/auth/v1/sign-in')).text()).toContain('Vous êtes connecté');
    await post('/email-otp/send-verification-otp', { email: 'direct@example.test', type: 'sign-in', oauth_query: '' });
    const res = await post('/sign-in/email-otp', { email: 'direct@example.test', otp: sender.sent.at(-1)!.code, oauth_query: '' });
    // No authorization flow to resume: no URL, the page shows its done panel.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBeUndefined();
    expect(await store.account(body.user.id)).toMatchObject({ planId: 'decouverte' });
  });

  it('refuses /v1 to a made-up token', async () => {
    const { app } = await setup();
    expect((await app.request('/v1/me', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });
});

describe('a password, the person\'s choice', () => {
  const EMAIL = 'awa@example.test';
  // Better Auth's rate limit outlives each setup: every send from its own address.
  let caller = 0;
  async function signInByCode(post: (path: string, body: unknown, ip?: string) => Promise<Response>, sender: LogSender, email = EMAIL, oauth_query = '') {
    const ip = `198.51.100.${++caller}`;
    await post('/email-otp/send-verification-otp', { email, type: 'sign-in', oauth_query }, ip);
    return post('/sign-in/email-otp', { email, otp: sender.sent.at(-1)!.code, oauth_query }, ip);
  }

  it('is chosen after a code, then signs the app in on its own', async () => {
    const { post, sender, fetcher, browser, forgetCookies } = await setup();
    expect((await signInByCode(post, sender)).status).toBe(200);
    expect((await post('/password/choose', { password: 'karite-2026' })).status).toBe(200);

    forgetCookies();
    const { url } = await startAppSignIn(fetcher);
    const oauth_query = queryOf(location(await browser(url.toString())));
    const sent = sender.sent.length;
    expect((await post('/sign-in/email', { email: EMAIL, password: 'nope-nope-nope', oauth_query })).status).toBe(401);
    const signedIn = await post('/sign-in/email', { email: EMAIL, password: 'karite-2026', oauth_query });
    expect(signedIn.status).toBe(200);
    // The app's authorization resumes, as after a code; and no code was sent.
    expect(new URL((await signedIn.json()).url, PUBLIC).pathname).toBe('/auth/v1/consent');
    expect(sender.sent.length).toBe(sent);
  });

  it('is changed the same way when forgotten', async () => {
    const { post, sender, forgetCookies } = await setup();
    await signInByCode(post, sender);
    await post('/password/choose', { password: 'premier-mot' });
    forgetCookies();
    await signInByCode(post, sender);
    expect((await post('/password/choose', { password: 'second-mot' })).status).toBe(200);
    forgetCookies();
    expect((await post('/sign-in/email', { email: EMAIL, password: 'premier-mot' })).status).toBe(401);
    expect((await post('/sign-in/email', { email: EMAIL, password: 'second-mot' })).status).toBe(200);
  });

  it('never makes an account from a password alone', async () => {
    const { post, db } = await setup();
    // Else anyone could put their password on an address before its owner signs in.
    expect((await post('/sign-up/email', { email: 'victime@example.test', password: 'a-moi-maintenant', name: 'x' })).status).toBe(400);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM baarali.users WHERE email = 'victime@example.test'");
    expect(rows[0].n).toBe(0);
  });

  it('is chosen only with a session just opened, and an email proved', async () => {
    const { post, sender, db, forgetCookies } = await setup();
    expect((await post('/password/choose', { password: 'sans-session' })).status).toBe(401);
    await signInByCode(post, sender);
    expect((await post('/password/choose', { password: 'court' })).status).toBe(400);
    await db.query(`UPDATE baarali.sessions SET "createdAt" = now() - interval '20 minutes'`);
    expect((await post('/password/choose', { password: 'trop-tard-2026' })).status).toBe(403);

    // A phone account has no address of its own to sign in with.
    forgetCookies();
    await post('/phone-number/send-otp', { phoneNumber: '+22507000003' }, '198.51.100.250');
    expect((await post('/phone-number/verify', { phoneNumber: '+22507000003', code: sender.sent.at(-1)!.code }, '198.51.100.250')).status).toBe(200);
    expect((await post('/password/choose', { password: 'telephone-2026' })).status).toBe(403);
  });
});

describe('codes by SMS', () => {
  it('signs in by phone with a code kept hashed', async () => {
    const { post, sender, db, store } = await setup();
    expect((await post('/phone-number/send-otp', { phoneNumber: '+22507000001' })).status).toBe(200);
    const code = sender.sent.at(-1)!.code;
    const { rows } = await db.query<{ code_hash: string }>('SELECT code_hash FROM baarali.phone_codes');
    expect(rows[0].code_hash).not.toContain(code);
    expect((await post('/phone-number/verify', { phoneNumber: '+22507000001', code: code === '000000' ? '111111' : '000000' })).status).not.toBe(200);
    const ok = await post('/phone-number/verify', { phoneNumber: '+22507000001', code });
    expect(ok.status).toBe(200);
    const userId = (await ok.json()).user.id;
    // A phone account has no email of ours: the placeholder never leaks.
    expect(await store.account(userId)).toMatchObject({ email: null, planId: 'decouverte' });
  });

  it('sends only to the open countries', async () => {
    const { post, sender } = await setup();
    expect((await post('/phone-number/send-otp', { phoneNumber: '+33612345678' })).status).toBe(400);
    expect(sender.sent).toHaveLength(0);
  });

  it('caps the sends per number, answering the same way', async () => {
    const { post, sender } = await setup();
    // From four addresses, so the per-address rate limit is not what stops it.
    for (let i = 0; i < 4; i++) {
      expect((await post('/phone-number/send-otp', { phoneNumber: '+22670000002' }, `203.0.113.${i}`)).status).toBe(200);
    }
    expect(sender.sent).toHaveLength(3);
  });
});

describe('the sign-in page', () => {
  it('offers only the configured methods, in the person’s language', async () => {
    const { browser } = await setup({ social: { github: { clientId: 'gh', clientSecret: 's' } } });
    const fr = await (await browser('/auth/v1/sign-in')).text();
    expect(fr).toContain('Continuer avec GitHub');
    expect(fr).not.toContain('Google');
    const en = await (await browser('/auth/v1/sign-in', { headers: { 'accept-language': 'en-US,en' } })).text();
    expect(en).toContain('Continue with GitHub');
  });

  it('runs only its own script and cannot be framed', async () => {
    const { browser } = await setup();
    const res = await browser('/auth/v1/sign-in');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1];
    const page = await res.text();
    expect(page).toContain(`<script nonce="${nonce}">`);
    // The code form starts hidden, and the stylesheet must not show it anyway.
    expect(page).toContain('[hidden] { display: none !important; }');
    expect(page).toContain('Connexion à Baarali');
    // Sign-up is the same door: the page says so (02/10/2026).
    expect(page).toContain('Se connecter ou créer un compte');
    expect(page).toContain('Il se crée à votre première connexion');
    // A code or a password (02/10/2026).
    expect(page).toContain('Se connecter avec un mot de passe');
    expect(page).toContain('Pas encore de mot de passe, ou oublié ?');
  });
});

describe('ResendSender', () => {
  it('sends the code by Resend’s API, code first in the subject', async () => {
    const { ResendSender } = await import('../src/codes.js');
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const sender = new ResendSender('re_key', 'Baarali <connexion@example.test>', (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response('{"id":"e1"}');
    }) as typeof fetch);
    await sender.sendEmailCode('awa@example.test', '123456');
    expect(seen[0].url).toBe('https://api.resend.com/emails');
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    const body = JSON.parse(seen[0].init.body as string);
    expect(body).toMatchObject({ from: 'Baarali <connexion@example.test>', to: ['awa@example.test'] });
    expect(body.subject.startsWith('123456')).toBe(true);
    expect(sender.sms).toBe(false);
  });
});
