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
    /** Last time we actually hit GitHub's token endpoint (pacing). */
    lastTokenPollAt?: number;
    /** Token already issued but the identity fetch failed — retry that step. */
    issuedToken?: string;
    identityAttempts?: number;
};

const GH_HEADERS = { 'Accept': 'application/json', 'User-Agent': 'rowboat-apps' };
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
    // GitHub's OAuth endpoints take form-encoded params (JSON is not reliable).
    const res = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: { ...GH_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: GITHUB_OAUTH_CLIENT_ID, scope: 'public_repo' }).toString(),
    });
    if (!res.ok) throw new Error(`device_code_failed: HTTP ${res.status}`);
    const body = await res.json() as {
        device_code: string; user_code: string; verification_uri: string;
        expires_in: number; interval: number;
    };
    pending = {
        deviceCode: body.device_code,
        // +1s safety margin: GitHub measures arrival spacing, and a request
        // that lands even slightly early gets `slow_down`, which RAISES the
        // required interval for the rest of the flow.
        intervalMs: ((body.interval || 5) + 1) * 1000,
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

    let accessToken = pending.issuedToken;
    if (!accessToken) {
        // Pacing lives HERE, not in the renderer: the renderer's timer is just
        // a heartbeat. GitHub rate-limits the token endpoint per device code —
        // polling faster than the flow's interval returns `slow_down` and
        // permanently raises the required interval, and a caller that keeps
        // its own fixed cadence then gets `slow_down` on EVERY poll (looks
        // "pending" forever, even after the user authorized). Skip the request
        // entirely until the current interval has elapsed.
        const now = Date.now();
        if (pending.lastTokenPollAt !== undefined && now - pending.lastTokenPollAt < pending.intervalMs) {
            return { status: 'pending' };
        }
        pending.lastTokenPollAt = now;
        const res = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { ...GH_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GITHUB_OAUTH_CLIENT_ID,
                device_code: pending.deviceCode,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }).toString(),
        });
        const body = await res.json() as { access_token?: string; error?: string; error_description?: string };
        console.log(`[GitHubAuth] poll: http=${res.status} error=${body.error ?? 'none'} token=${body.access_token ? 'ISSUED' : 'no'}`);

        if (body.error === 'authorization_pending') return { status: 'pending' };
        if (body.error === 'slow_down') {
            pending.intervalMs += 5000;
            return { status: 'pending' };
        }
        if (body.error === 'expired_token' || body.error === 'incorrect_device_code') {
            pending = null;
            return { status: 'expired' };
        }
        if (body.error === 'access_denied') {
            pending = null;
            return { status: 'denied' };
        }
        if (body.error) {
            // Unknown/config errors (unsupported_grant_type, device_flow_disabled…)
            // must FAIL loudly, not spin as pending forever.
            pending = null;
            throw new Error(`device_flow_error: ${body.error}${body.error_description ? ` — ${body.error_description}` : ''}`);
        }
        if (!body.access_token) return { status: 'pending' };
        accessToken = body.access_token;
        // The device code is consumed once the token is issued — remember the
        // token so a transient identity failure below can retry next poll.
        pending.issuedToken = accessToken;
    }

    // Identity: cache login alongside the token. Bounded retries — a
    // persistent failure must surface, never spin as "pending" forever.
    const userRes = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'rowboat-apps' },
    });
    console.log(`[GitHubAuth] identity: http=${userRes.status}`);
    if (!userRes.ok) {
        pending.identityAttempts = (pending.identityAttempts ?? 0) + 1;
        if (pending.identityAttempts >= 3) {
            const detail = await userRes.text().catch(() => '');
            pending = null;
            throw new Error(`identity_failed: GET /user → HTTP ${userRes.status} ${detail.slice(0, 160)}`);
        }
        return { status: 'pending' };
    }
    const user = await userRes.json() as { login: string };

    const auth: StoredAuth = { login: user.login, createdAt: new Date().toISOString() };
    if (cipher?.isAvailable()) {
        auth.tokenEncrypted = cipher.encrypt(accessToken);
    } else {
        auth.token = accessToken;
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
