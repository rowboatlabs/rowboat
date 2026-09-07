import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkDir } from '../config/config.js';
import {
    ANTIGRAVITY_CLIENT_ID,
    ANTIGRAVITY_CLIENT_SECRET,
    ANTIGRAVITY_REFRESH_MARGIN_SECONDS,
    ANTIGRAVITY_REVOKE_URL,
    ANTIGRAVITY_TOKEN_URL,
    antigravityRedirectUri,
} from './antigravity-constants.js';

// "Sign in with Google" → Antigravity gateway token layer. Owns storage +
// refresh of the OAuth tokens acquired via the Antigravity desktop client
// (see antigravity-constants.ts). The interactive sign-in flow (PKCE +
// loopback) lives in antigravity-signin.ts and persists tokens here via
// saveAntigravityTokens(). Consumers (the antigravity model client) must go
// through getAntigravityAccessToken() and never read the store directly.
//
// Structurally identical to auth/chatgpt-auth.ts; the differences are all
// Google's: the token endpoint returns `expires_in` (so expiry is not read
// from a JWT), rarely rotates the refresh token, and identity comes only from
// the id_token (Google access tokens are opaque, not JWTs).
//
// IMPORTANT: never log token values — log events only.

const AUTH_FILE = path.join(WorkDir, 'config', 'antigravity-auth.json');

// Token-at-rest encryption is provided by the Electron main process
// (safeStorage) — core stays electron-free. When no cipher is wired (or the
// OS keychain is unavailable) tokens are stored plaintext with a marker,
// matching auth/chatgpt-auth.ts.
export interface TokenCipher {
    isAvailable(): boolean;
    encrypt(plain: string): string; // returns base64
    decrypt(encrypted: string): string;
}
let cipher: TokenCipher | null = null;
export function setAntigravityTokenCipher(c: TokenCipher): void {
    cipher = c;
}

/** The sensitive material — stored encrypted when the cipher is available. */
type TokenMaterial = {
    accessToken: string;
    refreshToken: string;
};

type StoredAntigravityAuth = {
    email?: string;
    /** Unix seconds. */
    expiresAt: number;
    createdAt: string;
    /** base64 ciphertext of JSON TokenMaterial, via the injected cipher. */
    tokensEncrypted?: string;
    /** Plaintext fallback when no cipher/keychain is available. */
    tokens?: TokenMaterial;
    plaintext?: boolean;
};

/**
 * Thrown when there is no usable Antigravity session — never signed in,
 * refresh token revoked/expired, or the stored tokens are unreadable. Callers
 * should surface "Sign in with Google" and must not retry.
 */
export class AntigravityAuthRequiredError extends Error {
    constructor(message = 'Antigravity (Google) sign-in required') {
        super(message);
        this.name = 'AntigravityAuthRequiredError';
    }
}

/**
 * Decode a JWT's payload claims with a pure base64url decode — no signature
 * verification. Fine for our use: we only mine identity/expiry hints from the
 * id_token we received directly from Google's token endpoint over TLS.
 */
function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
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

function extractEmail(idToken: string | undefined): string | undefined {
    if (!idToken) return undefined;
    const claims = decodeJwtClaims(idToken);
    const email = claims?.email;
    return typeof email === 'string' && email.length > 0 ? email : undefined;
}

async function readAuth(): Promise<StoredAntigravityAuth | null> {
    try {
        return JSON.parse(await fs.readFile(AUTH_FILE, 'utf-8')) as StoredAntigravityAuth;
    } catch {
        return null;
    }
}

async function writeAuth(auth: StoredAntigravityAuth): Promise<void> {
    await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
    await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

async function clearStore(): Promise<void> {
    await fs.rm(AUTH_FILE, { force: true });
}

/**
 * Read the sensitive token material from a stored entry. Returns null when it
 * cannot be read; a failed DECRYPT additionally clears the store (keychain
 * changed / corrupt ciphertext is unrecoverable — force a clean re-sign-in).
 */
async function getTokenMaterial(auth: StoredAntigravityAuth): Promise<TokenMaterial | null> {
    if (auth.tokensEncrypted && cipher?.isAvailable()) {
        try {
            const material = JSON.parse(cipher.decrypt(auth.tokensEncrypted)) as TokenMaterial;
            if (typeof material.accessToken === 'string' && typeof material.refreshToken === 'string') {
                return material;
            }
            throw new Error('malformed token material');
        } catch {
            console.warn('[AntigravityAuth] Failed to decrypt stored tokens; clearing auth');
            await clearStore();
            return null;
        }
    }
    if (auth.tokens) return auth.tokens;
    if (auth.tokensEncrypted) {
        console.warn('[AntigravityAuth] Stored tokens are encrypted but no cipher is available');
    }
    return null;
}

/**
 * Persist tokens (called by the sign-in flow and by refresh). Expiry comes
 * from Google's `expiresInSeconds`; identity (email) from the id_token when
 * present, else the existing stored email is preserved.
 */
export async function saveAntigravityTokens(input: {
    accessToken: string;
    refreshToken: string;
    expiresInSeconds?: number;
    idToken?: string;
}): Promise<{ email?: string }> {
    const existing = await readAuth();
    const email = extractEmail(input.idToken) ?? existing?.email;

    const lifetime = typeof input.expiresInSeconds === 'number' && input.expiresInSeconds > 0
        ? input.expiresInSeconds
        : 3600; // Google omits expires_in only on error; assume 1h defensively.
    const expiresAt = Math.floor(Date.now() / 1000) + lifetime;

    const auth: StoredAntigravityAuth = {
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
    return { email };
}

/**
 * Exchange an authorization code for tokens and persist them (called by the
 * sign-in flow after the loopback callback). Google's token endpoint is a
 * form-encoded POST that requires the desktop client_secret alongside the
 * PKCE verifier; the response carries access_token, refresh_token, expires_in
 * and id_token. The redirect_uri must match the one sent at authorize time.
 */
export async function exchangeAntigravityCode(
    code: string,
    codeVerifier: string,
    port: number,
): Promise<{ email?: string }> {
    const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: antigravityRedirectUri(port),
            code_verifier: codeVerifier,
        }).toString(),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        throw new Error(`Antigravity token exchange failed: HTTP ${res.status}`);
    }
    const body = await res.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        id_token?: string;
    };
    if (!body.access_token || !body.refresh_token) {
        throw new Error('Antigravity token exchange response is missing tokens');
    }
    const identity = await saveAntigravityTokens({
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        ...(typeof body.expires_in === 'number' ? { expiresInSeconds: body.expires_in } : {}),
        ...(body.id_token ? { idToken: body.id_token } : {}),
    });
    console.log('[AntigravityAuth] Sign-in token exchange complete');
    return identity;
}

// Single-flight refresh: concurrent expired-token callers share one request
// (same pattern as auth/chatgpt-auth.ts).
let refreshInFlight: Promise<string> | null = null;

async function performRefresh(refreshToken: string): Promise<string> {
    let res: Response;
    try {
        res = await fetch(ANTIGRAVITY_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }).toString(),
            signal: AbortSignal.timeout(30_000),
        });
    } catch (error) {
        // Network failure: transient — keep the stored tokens so the next
        // call retries instead of forcing a re-sign-in.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Antigravity token refresh failed: ${message}`);
    }

    if (res.status === 400 || res.status === 401) {
        // Refresh token revoked or expired — unrecoverable without the user.
        console.log(`[AntigravityAuth] Refresh rejected (HTTP ${res.status}); signing out`);
        await clearStore();
        throw new AntigravityAuthRequiredError('Antigravity session expired. Please sign in again.');
    }
    if (!res.ok) {
        // 5xx / rate limit: transient — keep the stored tokens.
        throw new Error(`Antigravity token refresh failed: HTTP ${res.status}`);
    }

    const body = await res.json() as {
        access_token?: string;
        expires_in?: number;
        id_token?: string;
    };
    if (!body.access_token) {
        throw new Error('Antigravity token refresh returned no access token');
    }

    // Google rarely rotates the refresh token on refresh — keep the existing
    // one when the response omits it (it always does for this grant).
    await saveAntigravityTokens({
        accessToken: body.access_token,
        refreshToken,
        ...(typeof body.expires_in === 'number' ? { expiresInSeconds: body.expires_in } : {}),
        ...(body.id_token ? { idToken: body.id_token } : {}),
    });
    console.log('[AntigravityAuth] Access token refreshed');
    return body.access_token;
}

/**
 * The one seam for consumers (the antigravity model client): returns a valid
 * access token, transparently refreshing when within 5 minutes of expiry.
 * Throws AntigravityAuthRequiredError when there is no usable session.
 */
export async function getAntigravityAccessToken(): Promise<string> {
    const auth = await readAuth();
    if (!auth) {
        throw new AntigravityAuthRequiredError();
    }
    const material = await getTokenMaterial(auth);
    if (!material) {
        throw new AntigravityAuthRequiredError();
    }

    const now = Math.floor(Date.now() / 1000);
    if (auth.expiresAt - now > ANTIGRAVITY_REFRESH_MARGIN_SECONDS) {
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
export async function getAntigravityStatus(): Promise<{ signedIn: boolean; email?: string }> {
    const auth = await readAuth();
    if (!auth || (!auth.tokensEncrypted && !auth.tokens)) {
        return { signedIn: false };
    }
    return {
        signedIn: true,
        ...(auth.email ? { email: auth.email } : {}),
    };
}

/**
 * Sign out: best-effort revocation at Google's revoke endpoint, then clear
 * the local store. Revocation failure never blocks local sign-out. Also drops
 * the model selections that reference the provider.
 */
export async function signOutAntigravity(): Promise<void> {
    const auth = await readAuth();
    if (auth) {
        const material = await getTokenMaterial(auth);
        if (material) {
            try {
                const res = await fetch(ANTIGRAVITY_REVOKE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ token: material.refreshToken }).toString(),
                    signal: AbortSignal.timeout(10_000),
                });
                if (!res.ok) {
                    console.warn(`[AntigravityAuth] Token revocation returned HTTP ${res.status}; continuing with local sign-out`);
                }
            } catch {
                console.warn('[AntigravityAuth] Token revocation failed; continuing with local sign-out');
            }
        }
    }
    await clearStore();
    const { clearAntigravitySession } = await import('../models/antigravity-gateway.js');
    clearAntigravitySession();
    const { clearAntigravitySelections } = await import('../models/antigravity-selection.js');
    await clearAntigravitySelections();
    console.log('[AntigravityAuth] Signed out');
}
