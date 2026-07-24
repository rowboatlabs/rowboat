import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkDir } from '../config/config.js';
import {
    CHATGPT_AUTH_CLAIM_NAMESPACE,
    CHATGPT_CLIENT_ID,
    CHATGPT_PROFILE_CLAIM_NAMESPACE,
    CHATGPT_REDIRECT_URI,
    CHATGPT_REFRESH_MARGIN_SECONDS,
    CHATGPT_REVOKE_URL,
    CHATGPT_TOKEN_URL,
} from './chatgpt-constants.js';

// "Sign in with ChatGPT" token layer. Owns storage + refresh of the OAuth
// tokens acquired via the Codex CLI client (see chatgpt-constants.ts). The
// interactive sign-in flow (PKCE + loopback server on 127.0.0.1:1455) lives
// in the Electron main process and lands in Phase 2; it persists tokens here
// via saveChatGPTTokens(). Consumers (the Codex Responses model client) must
// go through getChatGPTAccessToken() and never read the store directly.
//
// IMPORTANT: never log token values — log events only.

const AUTH_FILE = path.join(WorkDir, 'config', 'chatgpt-auth.json');

// Token-at-rest encryption is provided by the Electron main process
// (safeStorage) — core stays electron-free. When no cipher is wired (or the
// OS keychain is unavailable) tokens are stored plaintext with a marker,
// matching the existing GitHub token storage in apps/github-auth.ts.
export interface TokenCipher {
    isAvailable(): boolean;
    encrypt(plain: string): string; // returns base64
    decrypt(encrypted: string): string;
}
let cipher: TokenCipher | null = null;
export function setTokenCipher(c: TokenCipher): void {
    cipher = c;
}

/** The sensitive material — stored encrypted when the cipher is available. */
type TokenMaterial = {
    accessToken: string;
    refreshToken: string;
};

type StoredChatGPTAuth = {
    /** ChatGPT account id, parsed from the id_token (see extractIdentity). */
    accountId?: string;
    email?: string;
    /** Unix seconds — the access token's `exp` claim. */
    expiresAt: number;
    createdAt: string;
    /** base64 ciphertext of JSON TokenMaterial, via the injected cipher. */
    tokensEncrypted?: string;
    /** Plaintext fallback when no cipher/keychain is available. */
    tokens?: TokenMaterial;
    plaintext?: boolean;
};

/**
 * Thrown when there is no usable ChatGPT session — never signed in, refresh
 * token revoked/expired, or the stored tokens are unreadable. Callers should
 * surface "Sign in with ChatGPT" and must not retry.
 */
export class ChatGPTAuthRequiredError extends Error {
    constructor(message = 'ChatGPT sign-in required') {
        super(message);
        this.name = 'ChatGPTAuthRequiredError';
    }
}

/**
 * Decode a JWT's payload claims with a pure base64url decode — no signature
 * verification. Fine for our use: we only mine identity/expiry hints from
 * tokens we received directly from the token endpoint over TLS.
 */
export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
    const parts = jwt.split('.');
    if (parts.length < 2 || !parts[1]) return null;
    try {
        const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
        const parsed: unknown = JSON.parse(payload);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function claimString(source: unknown, key: string): string | undefined {
    if (source !== null && typeof source === 'object') {
        const value = (source as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

/**
 * Identity claims, per codex-rs/login/src/token_data.rs:
 *   - accountId: `chatgpt_account_id` inside "https://api.openai.com/auth"
 *   - email: root `email` claim, falling back to `email` inside
 *     "https://api.openai.com/profile"
 * We check the id_token first (codex parses identity from it), then the
 * access token, which carries the same auth claim namespace.
 */
function extractIdentity(tokens: Array<string | undefined>): { accountId?: string; email?: string } {
    let accountId: string | undefined;
    let email: string | undefined;
    for (const token of tokens) {
        if (!token) continue;
        const claims = decodeJwtClaims(token);
        if (!claims) continue;
        accountId ??= claimString(claims[CHATGPT_AUTH_CLAIM_NAMESPACE], 'chatgpt_account_id');
        email ??= claimString(claims, 'email')
            ?? claimString(claims[CHATGPT_PROFILE_CLAIM_NAMESPACE], 'email');
    }
    return { accountId, email };
}

async function readAuth(): Promise<StoredChatGPTAuth | null> {
    try {
        return JSON.parse(await fs.readFile(AUTH_FILE, 'utf-8')) as StoredChatGPTAuth;
    } catch {
        return null;
    }
}

async function writeAuth(auth: StoredChatGPTAuth): Promise<void> {
    await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
    await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

async function clearStore(): Promise<void> {
    await fs.rm(AUTH_FILE, { force: true });
}

/**
 * Read the sensitive token material from a stored entry. Returns null when it
 * cannot be read; a failed DECRYPT additionally clears the store (keychain
 * changed / corrupt ciphertext is unrecoverable — force a clean re-sign-in,
 * mirroring the GitHub token path).
 */
async function getTokenMaterial(auth: StoredChatGPTAuth): Promise<TokenMaterial | null> {
    if (auth.tokensEncrypted && cipher?.isAvailable()) {
        try {
            const material = JSON.parse(cipher.decrypt(auth.tokensEncrypted)) as TokenMaterial;
            if (typeof material.accessToken === 'string' && typeof material.refreshToken === 'string') {
                return material;
            }
            throw new Error('malformed token material');
        } catch {
            console.warn('[ChatGPTAuth] Failed to decrypt stored tokens; clearing auth');
            await clearStore();
            return null;
        }
    }
    if (auth.tokens) return auth.tokens;
    if (auth.tokensEncrypted) {
        // Encrypted store but no cipher wired (e.g. keychain unavailable this
        // launch). Don't clear — the tokens may become readable again.
        console.warn('[ChatGPTAuth] Stored tokens are encrypted but no cipher is available');
    }
    return null;
}

/**
 * Persist tokens (called by the Phase 2 sign-in flow and by refresh).
 * Derives expiry from the access token's `exp` claim and identity from the
 * id_token / access token claims; existing identity is preserved when a
 * refresh response doesn't carry the claims.
 */
export async function saveChatGPTTokens(input: {
    accessToken: string;
    refreshToken: string;
    idToken?: string;
}): Promise<{ accountId?: string; email?: string }> {
    const existing = await readAuth();

    const identity = extractIdentity([input.idToken, input.accessToken]);
    const accountId = identity.accountId ?? existing?.accountId;
    const email = identity.email ?? existing?.email;

    const exp = decodeJwtClaims(input.accessToken)?.exp;
    let expiresAt: number;
    if (typeof exp === 'number') {
        expiresAt = exp;
    } else {
        // The token endpoint returns no expires_in (verified against
        // codex-rs/login/src/auth/manager.rs) — the JWT exp claim is the only
        // expiry source. Without it, assume a conservative 1h lifetime.
        console.warn('[ChatGPTAuth] Access token has no exp claim; assuming 1h lifetime');
        expiresAt = Math.floor(Date.now() / 1000) + 3600;
    }

    const auth: StoredChatGPTAuth = {
        ...(accountId ? { accountId } : {}),
        ...(email ? { email } : {}),
        expiresAt,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const material: TokenMaterial = {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
    };
    if (cipher?.isAvailable()) {
        auth.tokensEncrypted = cipher.encrypt(JSON.stringify(material));
    } else {
        auth.tokens = material;
        auth.plaintext = true;
    }
    await writeAuth(auth);
    return { accountId, email };
}

/**
 * Exchange an authorization code for tokens and persist them (called by the
 * main process sign-in flow after the loopback callback). Request/response
 * shape verified against codex-rs/login/src/server.rs
 * (`exchange_code_for_tokens`): form-encoded POST — unlike the JSON refresh —
 * response `{ id_token, access_token, refresh_token }`, no expires_in.
 * Returns the parsed identity for the caller to surface.
 */
export async function exchangeChatGPTCode(
    code: string,
    codeVerifier: string,
): Promise<{ accountId?: string; email?: string }> {
    const res = await fetch(CHATGPT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: CHATGPT_REDIRECT_URI,
            client_id: CHATGPT_CLIENT_ID,
            code_verifier: codeVerifier,
        }).toString(),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        throw new Error(`ChatGPT token exchange failed: HTTP ${res.status}`);
    }
    const body = await res.json() as {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
    };
    if (!body.access_token || !body.refresh_token) {
        throw new Error('ChatGPT token exchange response is missing tokens');
    }
    const identity = await saveChatGPTTokens({
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        ...(body.id_token ? { idToken: body.id_token } : {}),
    });
    console.log('[ChatGPTAuth] Sign-in token exchange complete');
    return identity;
}

// Single-flight refresh: concurrent expired-token callers share one request
// (same pattern as the Rowboat gateway token in auth/tokens.ts). One refresh
// owner matters here — parallel refreshes racing on one refresh_token can
// invalidate each other's grant.
let refreshInFlight: Promise<string> | null = null;

async function performRefresh(refreshToken: string): Promise<string> {
    // Request/response shape verified against codex-rs/login/src/auth/manager.rs:
    // JSON body (not form-encoded), response may omit refresh_token (keep the
    // old one) and never carries expires_in.
    let res: Response;
    try {
        res = await fetch(CHATGPT_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CHATGPT_CLIENT_ID,
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }),
            signal: AbortSignal.timeout(30_000),
        });
    } catch (error) {
        // Network failure: transient — keep the stored tokens so the next
        // call retries instead of forcing a re-sign-in.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ChatGPT token refresh failed: ${message}`);
    }

    if (res.status === 400 || res.status === 401) {
        // Refresh token revoked or expired — unrecoverable without the user.
        console.log(`[ChatGPTAuth] Refresh rejected (HTTP ${res.status}); signing out`);
        await clearStore();
        throw new ChatGPTAuthRequiredError('ChatGPT session expired. Please sign in again.');
    }
    if (!res.ok) {
        // 5xx / rate limit: transient — keep the stored tokens.
        throw new Error(`ChatGPT token refresh failed: HTTP ${res.status}`);
    }

    const body = await res.json() as {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
    };
    if (!body.access_token) {
        throw new Error('ChatGPT token refresh returned no access token');
    }

    await saveChatGPTTokens({
        accessToken: body.access_token,
        refreshToken: body.refresh_token || refreshToken,
        ...(body.id_token ? { idToken: body.id_token } : {}),
    });
    console.log('[ChatGPTAuth] Access token refreshed');
    return body.access_token;
}

/**
 * The one seam for consumers (the Codex Responses model client): returns a
 * valid access token, transparently refreshing when within 5 minutes of
 * expiry. Throws ChatGPTAuthRequiredError when there is no usable session.
 */
export async function getChatGPTAccessToken(): Promise<string> {
    const auth = await readAuth();
    if (!auth) {
        throw new ChatGPTAuthRequiredError();
    }
    const material = await getTokenMaterial(auth);
    if (!material) {
        throw new ChatGPTAuthRequiredError();
    }

    const now = Math.floor(Date.now() / 1000);
    if (auth.expiresAt - now > CHATGPT_REFRESH_MARGIN_SECONDS) {
        return material.accessToken;
    }

    if (!refreshInFlight) {
        refreshInFlight = performRefresh(material.refreshToken).finally(() => {
            refreshInFlight = null;
        });
    }
    return refreshInFlight;
}

/** Connection state for the UI. Never returns token values. */
export async function getChatGPTStatus(): Promise<{ signedIn: boolean; email?: string; accountId?: string }> {
    const auth = await readAuth();
    if (!auth || (!auth.tokensEncrypted && !auth.tokens)) {
        return { signedIn: false };
    }
    return {
        signedIn: true,
        ...(auth.email ? { email: auth.email } : {}),
        ...(auth.accountId ? { accountId: auth.accountId } : {}),
    };
}

/**
 * Sign out: best-effort revocation at auth.openai.com (endpoint + request
 * shape verified in codex-rs/login/src/auth/revoke.rs — refresh token first,
 * with client_id; access token as fallback, without), then clear the local
 * store. Revocation failure never blocks the local sign-out.
 */
export async function signOutChatGPT(): Promise<void> {
    const auth = await readAuth();
    if (auth) {
        const material = await getTokenMaterial(auth);
        if (material) {
            const body = material.refreshToken
                ? { token: material.refreshToken, token_type_hint: 'refresh_token', client_id: CHATGPT_CLIENT_ID }
                : { token: material.accessToken, token_type_hint: 'access_token' };
            try {
                const res = await fetch(CHATGPT_REVOKE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(10_000),
                });
                if (!res.ok) {
                    console.warn(`[ChatGPTAuth] Token revocation returned HTTP ${res.status}; continuing with local sign-out`);
                }
            } catch {
                console.warn('[ChatGPTAuth] Token revocation failed; continuing with local sign-out');
            }
        }
    }
    await clearStore();
    // Signing out disconnects the codex provider: drop the model selections
    // that reference it (same dangling-ref cleanup as removing any
    // provider). Lazy import — models/catalog imports this module.
    const { clearCodexSelections } = await import('../models/chatgpt-selection.js');
    await clearCodexSelections();
    console.log('[ChatGPTAuth] Signed out');
}
