import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkDir } from '../config/config.js';
import { GITHUB_OAUTH_CLIENT_ID } from '../config/env.js';

// GitHub authentication via the OAuth device flow (spec §10). Sign-in is
// required ONLY for publishing; create/run/install/update never touch it.
// The token doubles as publisher identity (D6).

const AUTH_FILE = path.join(WorkDir, 'config', 'github-auth.json');

// Token-at-rest encryption is provided by the Electron main process
// (safeStorage) — core stays electron-free. When no cipher is wired (or the OS
// keychain is unavailable) the token is stored plaintext with a marker,
// matching the existing token-storage approach in auth/.
export interface TokenCipher {
    isAvailable(): boolean;
    encrypt(plain: string): string; // returns base64
    decrypt(encrypted: string): string;
}
let cipher: TokenCipher | null = null;
export function setTokenCipher(c: TokenCipher): void {
    cipher = c;
}

type StoredAuth = {
    login: string;
    createdAt: string;
    token?: string; // plaintext fallback
    tokenEncrypted?: string; // base64 via cipher
    plaintext?: boolean;
};

type PendingFlow = {
    deviceCode: string;
    intervalMs: number;
    expiresAt: number;
};
let pending: PendingFlow | null = null;

async function readAuth(): Promise<StoredAuth | null> {
    try {
        return JSON.parse(await fs.readFile(AUTH_FILE, 'utf-8')) as StoredAuth;
    } catch {
        return null;
    }
}

async function writeAuth(auth: StoredAuth): Promise<void> {
    await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
    await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

/** Start the device flow. Returns the code the user enters on github.com. */
export async function startDeviceFlow(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }> {
    const res = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_OAUTH_CLIENT_ID, scope: 'public_repo' }),
    });
    if (!res.ok) throw new Error(`device_code_failed: HTTP ${res.status}`);
    const body = await res.json() as {
        device_code: string; user_code: string; verification_uri: string;
        expires_in: number; interval: number;
    };
    pending = {
        deviceCode: body.device_code,
        intervalMs: (body.interval || 5) * 1000,
        expiresAt: Date.now() + body.expires_in * 1000,
    };
    return { userCode: body.user_code, verificationUri: body.verification_uri, expiresIn: body.expires_in };
}

export type PollResult =
    | { status: 'pending' }
    | { status: 'authorized'; login: string }
    | { status: 'expired' }
    | { status: 'denied' };

/** Poll once for device-flow completion (renderer drives the cadence). */
export async function pollDeviceFlow(): Promise<PollResult> {
    if (!pending) return { status: 'expired' };
    if (Date.now() > pending.expiresAt) {
        pending = null;
        return { status: 'expired' };
    }

    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: GITHUB_OAUTH_CLIENT_ID,
            device_code: pending.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
    });
    const body = await res.json() as { access_token?: string; error?: string };

    if (body.error === 'authorization_pending') return { status: 'pending' };
    if (body.error === 'slow_down') {
        pending.intervalMs += 5000;
        return { status: 'pending' };
    }
    if (body.error === 'expired_token') {
        pending = null;
        return { status: 'expired' };
    }
    if (body.error === 'access_denied') {
        pending = null;
        return { status: 'denied' };
    }
    if (!body.access_token) return { status: 'pending' };

    // Identity: cache login alongside the token.
    const userRes = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${body.access_token}`, 'Accept': 'application/vnd.github+json' },
    });
    if (!userRes.ok) throw new Error(`identity_failed: HTTP ${userRes.status}`);
    const user = await userRes.json() as { login: string };

    const auth: StoredAuth = { login: user.login, createdAt: new Date().toISOString() };
    if (cipher?.isAvailable()) {
        auth.tokenEncrypted = cipher.encrypt(body.access_token);
    } else {
        auth.token = body.access_token;
        auth.plaintext = true;
    }
    await writeAuth(auth);
    pending = null;
    return { status: 'authorized', login: user.login };
}

export async function getAuthStatus(): Promise<{ signedIn: boolean; login?: string }> {
    const auth = await readAuth();
    return auth ? { signedIn: true, login: auth.login } : { signedIn: false };
}

/** The stored token, or null. Callers hitting a 401 MUST call clearAuth(). */
export async function getGithubToken(): Promise<{ token: string; login: string } | null> {
    const auth = await readAuth();
    if (!auth) return null;
    if (auth.tokenEncrypted && cipher?.isAvailable()) {
        try {
            return { token: cipher.decrypt(auth.tokenEncrypted), login: auth.login };
        } catch {
            await clearAuth();
            return null;
        }
    }
    if (auth.token) return { token: auth.token, login: auth.login };
    return null;
}

/** Sign out / expire (a 401 from any GitHub call surfaces as github_auth_expired). */
export async function clearAuth(): Promise<void> {
    pending = null;
    await fs.rm(AUTH_FILE, { force: true });
}
