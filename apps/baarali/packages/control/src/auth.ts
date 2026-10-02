import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { emailOTP, jwt, phoneNumber } from 'better-auth/plugins';
import { checkPhoneCode, newCode, smsAllowed, storePhoneCode, takeSend, type CodeSender } from './codes.js';
import type { Queryable } from './db.js';
import { html } from './html.js';
import { consentPage, signInPage, type SignInMethods } from './sign-in-page.js';

// The sign-in server (architecture §3.5 "Comptes et connexion", decided
// 01/10/2026). Core already looks for an OAuth 2.1 server at
// `${supabaseUrl}/auth/v1` and registers itself there (core
// auth/providers.ts, DCR + PKCE): the control plane serves it at that path,
// so no upstream file changes. Better Auth does the protocol work; our rules
// (caps, open countries, hashed codes, linking by verified email only) sit
// in its extension points.

export const AUTH_BASE_PATH = '/auth/v1';

/** The scopes core asks for, plus offline_access (see `asAppRequest`). */
const SCOPES = ['openid', 'profile', 'email', 'offline_access'];

/** OAuth credentials of one external identity provider. */
export interface SocialCredentials {
  clientId: string;
  clientSecret: string;
}

/** Providers we offer; one is shown only once its credentials are set. */
export const SOCIAL_PROVIDERS = ['google', 'apple', 'github', 'microsoft'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export interface AuthDeps {
  publicUrl: string;
  /** Signs sessions and the authorization flow; 32 random bytes or more. */
  secret: string;
  /** Better Auth's connection (a pg Pool in production), on the `baarali` search path. */
  database: BetterAuthOptions['database'];
  /** Our own tables (codes, caps), same database. */
  db: Queryable;
  sender: CodeSender;
  social: Partial<Record<SocialProvider, SocialCredentials>>;
  /** A new person: their account is created on Découverte (architecture §3.5). */
  onUserCreated: (user: { id: string; email: string | null; createdAt: number }) => Promise<void>;
  now: () => number;
  /**
   * The Spaces server's address (Harbor, apps/harbor), when we host one. Its
   * access tokens must be JWTs it verifies alone against our keys (Harbor
   * auth-oidc.ts): this resource is what makes them so.
   */
  spacesUrl?: string;
}

/**
 * Phone sign-ups need an email to exist in Better Auth's user table. This
 * one never receives mail (RFC 2606 `.invalid`) and is never verified, so it
 * can never link to another identity.
 */
const PHONE_EMAIL_DOMAIN = 'phone.baarali.invalid';
const phoneEmail = (phone: string) => `${phone.replace(/\D/g, '')}@${PHONE_EMAIL_DOMAIN}`;
export const realEmail = (email: string) => (email.endsWith(`@${PHONE_EMAIL_DOMAIN}`) ? null : email);

function authOptions(deps: AuthDeps) {
  const socialProviders = Object.fromEntries(
    SOCIAL_PROVIDERS.flatMap((p) => (deps.social[p] ? [[p, { ...deps.social[p] }]] : [])),
  );
  return {
    appName: 'Baarali',
    baseURL: deps.publicUrl,
    basePath: AUTH_BASE_PATH,
    secret: deps.secret,
    database: deps.database,
    // Off by default already; written down so an upgrade cannot turn it on.
    telemetry: { enabled: false },
    trustedOrigins: [deps.publicUrl],
    // No password, anywhere (decided 01/10/2026).
    emailAndPassword: { enabled: false },
    socialProviders,
    user: { modelName: 'users' },
    session: { modelName: 'sessions' },
    verification: { modelName: 'verifications' },
    account: {
      modelName: 'user_identities',
      // Implicit linking only when the provider says the email is verified
      // AND ours is too (`requireLocalEmailVerified` defaults to true). No
      // provider is trusted beyond what it attests.
      accountLinking: { enabled: true, trustedProviders: [] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/phone-number/send-otp': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 60, max: 10 },
        '/phone-number/verify': { window: 60, max: 10 },
      },
    },
    // Fly puts the caller's address here; without it every request looks
    // like the proxy's and one abuser would rate-limit everyone.
    advanced: { ipAddress: { ipAddressHeaders: ['fly-client-ip', 'x-forwarded-for'] } },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; email: string; createdAt: Date }) => {
            await deps.onUserCreated({ id: user.id, email: realEmail(user.email), createdAt: user.createdAt.getTime() });
          },
        },
      },
    },
    plugins: [
      // Signs the ID tokens, and with a key in ES256 the access tokens of
      // Spaces: Harbor accepts ES256 or RS256, not the EdDSA of the main key
      // (auth-oidc.ts, decided 02/10/2026).
      jwt({ jwks: { keyPairConfigs: [{ alg: 'ES256' }] } }),
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp }) {
          if (!deps.sender.email) return;
          if (await takeSend(deps.db, `email:${email.toLowerCase()}`, deps.now())) await deps.sender.sendEmailCode(email, otp);
        },
      }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        phoneNumberValidator: (phone) => deps.sender.sms && smsAllowed(phone),
        // Better Auth would keep its code in clear; ours is kept hashed
        // (security §4.1) and is the only one ever sent.
        async sendOTP({ phoneNumber: phone }) {
          if (!(await takeSend(deps.db, `phone:${phone}`, deps.now()))) return;
          const code = newCode();
          await storePhoneCode(deps.db, phone, code, deps.now());
          await deps.sender.sendSmsCode(phone, code);
        },
        verifyOTP: ({ phoneNumber: phone, code }) => checkPhoneCode(deps.db, phone, code, deps.now()),
        signUpOnVerification: { getTempEmail: phoneEmail, getTempName: (phone) => phone },
      }),
      oauthProvider({
        loginPage: `${AUTH_BASE_PATH}/sign-in`,
        consentPage: `${AUTH_BASE_PATH}/consent`,
        scopes: SCOPES,
        // Core registers itself, without an initial token (core auth/oauth-client.ts).
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: SCOPES,
        clientRegistrationAllowedScopes: SCOPES,
        // Security §4.2: a short access token, a rotating refresh token.
        accessTokenExpiresIn: 15 * 60,
        // Every app may ask for Spaces: our own server, and clients
        // registered before it existed must keep signing in.
        ...(deps.spacesUrl
          ? { resources: [{ identifier: deps.spacesUrl, signingAlgorithm: 'ES256' as const }], resourceSeedMode: 'merge' as const, enforcePerClientResources: false }
          : {}),
        // Who is speaking, for Harbor (auth-oidc.ts): an email only once
        // verified, since a space may admit people by their email's domain,
        // and no name when it is only the phone number of a phone sign-up.
        customAccessTokenClaims: ({ user }) => spacesClaims(user),
      }),
    ],
  } satisfies BetterAuthOptions;
}

export function spacesClaims(user: { email?: unknown; emailVerified?: unknown; name?: unknown } | null | undefined): Record<string, string> {
  if (!user) return {};
  const claims: Record<string, string> = {};
  const email = typeof user.email === 'string' ? realEmail(user.email) : null;
  if (email && user.emailVerified === true) claims.email = email;
  if (typeof user.name === 'string' && user.name.trim() && !/^\+?[\d\s]+$/.test(user.name.trim())) claims.name = user.name.trim();
  return claims;
}

/**
 * Two things core's registration leaves out (core auth/oauth-client.ts), both
 * filled in here so no upstream file changes (decided 01/10/2026):
 * - `offline_access`: core asks for `openid email profile` only, so it would
 *   get no refresh token and sign the person out every 15 minutes. The app
 *   always gets the rotating refresh token of security §4.2.
 * - `application_type: native`: without it a client counts as a web app,
 *   which may not redirect to http://localhost. Core is a desktop app
 *   receiving the code on a loopback port (RFC 8252), so it is native when
 *   every redirect URI is such a loopback one.
 */
async function asAppRequest(req: Request, spacesUrl?: string): Promise<Request> {
  const url = new URL(req.url);
  const add = (scope: string | null) => {
    const scopes = new Set((scope ?? '').split(' ').filter(Boolean));
    scopes.add('offline_access');
    return [...scopes].join(' ');
  };
  if (req.method === 'GET' && url.pathname === `${AUTH_BASE_PATH}/oauth2/authorize` && url.searchParams.get('response_type') === 'code') {
    url.searchParams.set('scope', add(url.searchParams.get('scope')));
    if (spacesUrl && !url.searchParams.has('resource')) url.searchParams.set('resource', spacesUrl);
    return new Request(url, req);
  }
  if (req.method === 'POST' && url.pathname === `${AUTH_BASE_PATH}/oauth2/register`) {
    const body = (await req.clone().json().catch(() => null)) as Record<string, unknown> | null;
    if (body && typeof body === 'object') {
      const grants = Array.isArray(body.grant_types) ? body.grant_types : [];
      if (grants.includes('refresh_token')) body.scope = add(typeof body.scope === 'string' ? body.scope : null);
      const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      const loopback = (u: unknown) => typeof u === 'string' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(u);
      // The phone app comes back through its own reverse-domain scheme, the
      // form RFC 8252 §7.1 allows (com.baarali.app.mobile:/oauth-callback).
      const appScheme = (u: unknown) => typeof u === 'string' && /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:\/(?!\/)/i.test(u);
      if (body.application_type === undefined && uris.length > 0 && uris.every((u) => loopback(u) || appScheme(u))) body.application_type = 'native';
      return new Request(url, { method: 'POST', headers: req.headers, body: JSON.stringify(body) });
    }
  }
  return req;
}

/**
 * Creates or completes Better Auth's tables, before the server starts: it
 * never drops anything, and refuses a change it cannot make safely.
 */
export async function migrateAuth(deps: AuthDeps): Promise<void> {
  const { runMigrations } = await getMigrations(authOptions(deps));
  await runMigrations();
}

/** What the app needs from the sign-in server; Better Auth stays behind it. */
export interface BaaraliAuth {
  methods: SignInMethods;
  /** Everything under /auth/v1. */
  handle(req: Request): Promise<Response>;
  /** The user an access token from our OAuth server belongs to, or null. */
  userIdForAccessToken(token: string): Promise<string | null>;
}

export function createAuth(deps: AuthDeps): BaaraliAuth {
  const auth = betterAuth(authOptions(deps));
  const methods: SignInMethods = {
    email: deps.sender.email,
    phone: deps.sender.sms,
    social: SOCIAL_PROVIDERS.filter((p) => deps.social[p]),
  };

  return {
    methods,

    // Our two pages, then Better Auth.
    async handle(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const lang = req.headers.get('accept-language');
      if (req.method === 'GET' && url.pathname === `${AUTH_BASE_PATH}/sign-in`) {
        return html((nonce) => signInPage({ methods, lang, nonce }));
      }
      if (req.method === 'GET' && url.pathname === `${AUTH_BASE_PATH}/consent`) {
        return html((nonce) => consentPage({ lang, nonce }));
      }
      return auth.handler(await asAppRequest(req, deps.spacesUrl));
    },

    async userIdForAccessToken(token: string): Promise<string | null> {
      try {
        const info = (await auth.api.oauth2UserInfo({ headers: new Headers({ authorization: `Bearer ${token}` }) })) as { sub?: unknown };
        return typeof info?.sub === 'string' ? info.sub : null;
      } catch {
        return null;
      }
    },
  };
}
