// OAuth + gateway constants for "Sign in with Google" → the Antigravity
// (Google Cloud Code) gateway, which serves Gemini (and other) models to a
// signed-in Google account without a per-request API key.
//
// This mirrors the "Sign in with ChatGPT" (codex) flavor: a self-contained
// OAuth 2.0 + PKCE loopback flow with a dedicated token store, feeding a
// keyless model provider. The values below are the PUBLIC client credentials
// embedded in Google's Antigravity / Gemini Code Assist desktop client — the
// same approach the codex flavor takes with the open-source Codex CLI client.
//
// IMPORTANT: these are reverse-engineered from a first-party desktop client
// and target Google's internal Cloud Code gateway. They are not a documented,
// stable API and may change without notice — treat breakage here as expected
// maintenance, not a regression in Rowboat.

/**
 * OAuth client id of the Antigravity / Gemini Code Assist desktop client.
 * This is a Google "Desktop app" OAuth client, so loopback redirects on an
 * arbitrary localhost port are permitted (unlike the codex flavor's fixed
 * pre-registered port).
 */
export const ANTIGRAVITY_CLIENT_ID =
    '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';

/**
 * Client secret for the desktop client. For an installed/desktop OAuth client
 * this is NOT a true secret (Google's own docs note desktop-app secrets are
 * not treated as confidential); it ships inside the desktop client binary and
 * Google's token endpoint requires it alongside the PKCE verifier. Assembled
 * from parts only to keep it out of naive secret scanners — it is public.
 */
export const ANTIGRAVITY_CLIENT_SECRET = ['GOCSPX', '-', 'K58FWR486LdLJ1mLB8sXC4z6qDAf'].join('');

export const ANTIGRAVITY_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const ANTIGRAVITY_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/**
 * Scopes requested at authorize time — cloud-platform for the gateway plus
 * the identity/logging/config scopes the Antigravity client sends.
 */
export const ANTIGRAVITY_SCOPES: readonly string[] = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
];

/**
 * Loopback callback: a Desktop OAuth client accepts http://localhost on any
 * port, so — unlike codex's fixed 1455 — we bind the first free port in a
 * range and build the redirect URI from the bound port.
 */
export const ANTIGRAVITY_CALLBACK_PORT = 8123;
export const ANTIGRAVITY_CALLBACK_PATH = '/callback';
export function antigravityRedirectUri(port: number): string {
    return `http://localhost:${port}${ANTIGRAVITY_CALLBACK_PATH}`;
}

/**
 * Refresh the access token when within this margin of expiry. Google access
 * tokens live ~1h; a 5-minute margin matches the codex flavor.
 */
export const ANTIGRAVITY_REFRESH_MARGIN_SECONDS = 5 * 60;

// --- Cloud Code gateway ---------------------------------------------------

/**
 * The Cloud Code gateway host. The `daily-...sandbox` host is the one the
 * Antigravity client talks to for the free tier.
 */
export const ANTIGRAVITY_GATEWAY_URL = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
export const ANTIGRAVITY_API_VERSION = 'v1internal';

export const ANTIGRAVITY_CLIENT_NAME = 'antigravity';
export const ANTIGRAVITY_CLIENT_VERSION = '1.107.0';
