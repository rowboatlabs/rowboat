// OAuth constants for "Sign in with ChatGPT" (ChatGPT subscription auth).
//
// Rowboat authenticates against OpenAI's auth server using the SAME public
// client the open-source Codex CLI uses. Every value below was verified
// against the openai/codex sources on 2026-07-15 — do not edit from memory;
// re-check the linked files instead.
//
// Sources (github.com/openai/codex, main branch):
//   - codex-rs/login/src/auth/manager.rs   → CLIENT_ID, refresh request shape,
//     5-minute access-token refresh window
//   - codex-rs/login/src/server.rs         → DEFAULT_ISSUER, /oauth/authorize,
//     /oauth/token, DEFAULT_PORT 1455, /auth/callback, scopes, extra
//     authorize params
//   - codex-rs/login/src/auth/revoke.rs    → /oauth/revoke request shape
//   - codex-rs/login/src/token_data.rs     → JWT claim names for account id
//     and email

/**
 * OAuth client id of the official Codex CLI.
 * Source: codex-rs/login/src/auth/manager.rs (`pub const CLIENT_ID`).
 * Client ids are public identifiers, not secrets.
 */
export const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** Source: codex-rs/login/src/server.rs (`DEFAULT_ISSUER`). */
export const CHATGPT_ISSUER = 'https://auth.openai.com';

/** Source: codex-rs/login/src/server.rs (`build_authorize_url`: `{issuer}/oauth/authorize`). */
export const CHATGPT_AUTHORIZE_URL = `${CHATGPT_ISSUER}/oauth/authorize`;

/**
 * Token endpoint, used for both code exchange and refresh.
 * Source: codex-rs/login/src/server.rs (`exchange_code_for_tokens`) and
 * codex-rs/login/src/auth/manager.rs (refresh POSTs here).
 *
 * NOTE (verified in manager.rs): the refresh request is a JSON body —
 * `{ client_id, grant_type: "refresh_token", refresh_token }` with
 * Content-Type application/json, NOT the form-encoded body standard OAuth
 * clients send. The response is `{ id_token?, access_token?, refresh_token? }`
 * and carries NO `expires_in` — expiry must be read from the new access
 * token's `exp` claim.
 */
export const CHATGPT_TOKEN_URL = `${CHATGPT_ISSUER}/oauth/token`;

/**
 * Revocation endpoint. Source: codex-rs/login/src/auth/revoke.rs — JSON POST
 * `{ token, token_type_hint: "refresh_token"|"access_token", client_id }`
 * (client_id only when revoking a refresh token), 10s timeout.
 */
export const CHATGPT_REVOKE_URL = `${CHATGPT_ISSUER}/oauth/revoke`;

/**
 * The loopback callback the Codex client id is registered for. The port is
 * fixed — unlike Rowboat's DCR providers there is no scan-to-next-port
 * fallback, because the redirect URI is pre-registered at OpenAI.
 * Source: codex-rs/login/src/server.rs (`DEFAULT_PORT: u16 = 1455`,
 * `http://localhost:{port}/auth/callback`).
 */
export const CHATGPT_CALLBACK_PORT = 1455;
export const CHATGPT_CALLBACK_PATH = '/auth/callback';
export const CHATGPT_REDIRECT_URI = `http://localhost:${CHATGPT_CALLBACK_PORT}${CHATGPT_CALLBACK_PATH}`;

/**
 * Scopes to request at authorize time (Phase 2).
 * Source: codex-rs/login/src/server.rs requests
 * "openid profile email offline_access api.connectors.read api.connectors.invoke";
 * we deliberately drop the two `api.connectors.*` scopes — Rowboat only needs
 * identity + refresh (`offline_access`) for model calls, matching what Zed's
 * ChatGPT provider requests.
 */
export const CHATGPT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

/**
 * Extra authorize-URL query params the Codex flow sends (Phase 2).
 * Source: codex-rs/login/src/server.rs (`build_authorize_url`).
 */
export const CHATGPT_EXTRA_AUTHORIZE_PARAMS: Record<string, string> = {
  id_token_add_organizations: 'true',
  codex_cli_simplified_flow: 'true',
};

/**
 * Refresh the access token when it is within this margin of expiry.
 * Source: codex-rs/login/src/auth/manager.rs
 * (`CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES: i64 = 5`).
 */
export const CHATGPT_REFRESH_MARGIN_SECONDS = 5 * 60;

/**
 * JWT claim namespaces. Source: codex-rs/login/src/token_data.rs — the
 * ChatGPT account id is `chatgpt_account_id` inside the
 * "https://api.openai.com/auth" claim of the id_token; email is the root
 * `email` claim with a fallback to `email` inside
 * "https://api.openai.com/profile".
 */
export const CHATGPT_AUTH_CLAIM_NAMESPACE = 'https://api.openai.com/auth';
export const CHATGPT_PROFILE_CLAIM_NAMESPACE = 'https://api.openai.com/profile';
