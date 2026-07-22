import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the store from the real home dir BEFORE importing the module —
// WorkDir is resolved at config.ts import time (same pattern as
// classification_stamp.test.ts).
const tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-chatgpt-auth-test-'));
process.env.ROWBOAT_WORKDIR = tmpWorkDir;

const chatgptAuth = await import('./chatgpt-auth.js');
const {
    saveChatGPTTokens,
    getChatGPTAccessToken,
    getChatGPTStatus,
    signOutChatGPT,
    setTokenCipher,
    decodeJwtClaims,
    ChatGPTAuthRequiredError,
} = chatgptAuth;
const {
    CHATGPT_CLIENT_ID,
    CHATGPT_TOKEN_URL,
    CHATGPT_REVOKE_URL,
    CHATGPT_AUTH_CLAIM_NAMESPACE,
    CHATGPT_PROFILE_CLAIM_NAMESPACE,
} = await import('./chatgpt-constants.js');

const AUTH_FILE = path.join(tmpWorkDir, 'config', 'chatgpt-auth.json');

// Fixed clock so expiry math is deterministic.
const NOW_MS = new Date('2026-07-15T12:00:00Z').getTime();
const NOW = Math.floor(NOW_MS / 1000);

/** Unsigned JWT with the given payload — decodeJwtClaims only reads part [1]. */
function makeJwt(claims: Record<string, unknown>): string {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

function makeIdToken(overrides: Record<string, unknown> = {}): string {
    return makeJwt({
        email: 'user@example.com',
        [CHATGPT_AUTH_CLAIM_NAMESPACE]: { chatgpt_account_id: 'acct_123' },
        ...overrides,
    });
}

function makeAccessToken(expiresInSeconds: number, extra: Record<string, unknown> = {}): string {
    return makeJwt({ exp: NOW + expiresInSeconds, ...extra });
}

/** Reversible fake cipher with a toggleable availability flag. */
const fakeCipher = {
    available: true,
    isAvailable() { return this.available; },
    encrypt(plain: string) { return 'enc:' + Buffer.from(plain).toString('base64'); },
    decrypt(encrypted: string) {
        if (!encrypted.startsWith('enc:')) throw new Error('bad ciphertext');
        return Buffer.from(encrypted.slice(4), 'base64').toString('utf8');
    },
};

function readStoredFile(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    fakeCipher.available = true;
    setTokenCipher(fakeCipher);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fs.rmSync(AUTH_FILE, { force: true });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

afterAll(() => {
    fs.rmSync(tmpWorkDir, { recursive: true, force: true });
});

describe('decodeJwtClaims', () => {
    it('decodes the payload with a pure base64url decode', () => {
        expect(decodeJwtClaims(makeJwt({ exp: 42, foo: 'bar' }))).toEqual({ exp: 42, foo: 'bar' });
    });

    it('returns null for malformed input', () => {
        expect(decodeJwtClaims('not-a-jwt')).toBeNull();
        expect(decodeJwtClaims('a.!!!.c')).toBeNull();
        expect(decodeJwtClaims(`a.${Buffer.from('[1,2]').toString('base64url')}.c`)).toBeNull();
    });
});

describe('token store', () => {
    it('persists tokens encrypted at rest and never writes token values in the clear', async () => {
        const accessToken = makeAccessToken(3600);
        const identity = await saveChatGPTTokens({
            accessToken,
            refreshToken: 'rt_secret_1',
            idToken: makeIdToken(),
        });

        expect(identity).toEqual({ accountId: 'acct_123', email: 'user@example.com' });

        const stored = readStoredFile();
        expect(stored.tokensEncrypted).toMatch(/^enc:/);
        expect(stored.tokens).toBeUndefined();
        expect(stored.plaintext).toBeUndefined();
        expect(stored.expiresAt).toBe(NOW + 3600);
        // No raw token material anywhere in the file.
        const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
        expect(raw).not.toContain(accessToken);
        expect(raw).not.toContain('rt_secret_1');

        await expect(getChatGPTStatus()).resolves.toEqual({
            signedIn: true,
            email: 'user@example.com',
            accountId: 'acct_123',
        });
    });

    it('falls back to plaintext with a marker when the cipher is unavailable', async () => {
        fakeCipher.available = false;
        await saveChatGPTTokens({
            accessToken: makeAccessToken(3600),
            refreshToken: 'rt_1',
            idToken: makeIdToken(),
        });

        const stored = readStoredFile();
        expect(stored.tokensEncrypted).toBeUndefined();
        expect(stored.plaintext).toBe(true);
        expect((stored.tokens as { refreshToken: string }).refreshToken).toBe('rt_1');

        await expect(getChatGPTAccessToken()).resolves.toBe(stored && (stored.tokens as { accessToken: string }).accessToken);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('parses accountId from the access token and email from the profile namespace as fallbacks', async () => {
        // No id_token; access token carries the auth namespace + profile email.
        await saveChatGPTTokens({
            accessToken: makeAccessToken(3600, {
                [CHATGPT_AUTH_CLAIM_NAMESPACE]: { chatgpt_account_id: 'acct_from_at' },
                [CHATGPT_PROFILE_CLAIM_NAMESPACE]: { email: 'profile@example.com' },
            }),
            refreshToken: 'rt_1',
        });

        await expect(getChatGPTStatus()).resolves.toEqual({
            signedIn: true,
            email: 'profile@example.com',
            accountId: 'acct_from_at',
        });
    });

    it('preserves existing identity when a refresh response carries no claims', async () => {
        await saveChatGPTTokens({
            accessToken: makeAccessToken(3600),
            refreshToken: 'rt_1',
            idToken: makeIdToken(),
        });
        // Rotated tokens with no identity claims at all.
        await saveChatGPTTokens({
            accessToken: makeAccessToken(7200),
            refreshToken: 'rt_2',
        });

        await expect(getChatGPTStatus()).resolves.toEqual({
            signedIn: true,
            email: 'user@example.com',
            accountId: 'acct_123',
        });
    });

    it('reports signed out when nothing is stored', async () => {
        await expect(getChatGPTStatus()).resolves.toEqual({ signedIn: false });
        await expect(getChatGPTAccessToken()).rejects.toBeInstanceOf(ChatGPTAuthRequiredError);
    });
});

describe('getChatGPTAccessToken', () => {
    it('returns the cached token without refreshing when >5 min from expiry', async () => {
        const accessToken = makeAccessToken(3600);
        await saveChatGPTTokens({ accessToken, refreshToken: 'rt_1', idToken: makeIdToken() });

        await expect(getChatGPTAccessToken()).resolves.toBe(accessToken);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes within the 5-min window using the verified JSON request shape and persists rotation', async () => {
        await saveChatGPTTokens({
            accessToken: makeAccessToken(60), // inside the 5-min margin
            refreshToken: 'rt_old',
            idToken: makeIdToken(),
        });

        const newAccessToken = makeAccessToken(3600);
        fetchMock.mockResolvedValueOnce(jsonResponse({
            access_token: newAccessToken,
            refresh_token: 'rt_new',
        }));

        await expect(getChatGPTAccessToken()).resolves.toBe(newAccessToken);

        // Request shape verified against codex-rs/login/src/auth/manager.rs.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(CHATGPT_TOKEN_URL);
        expect(init.method).toBe('POST');
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body as string)).toEqual({
            client_id: CHATGPT_CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: 'rt_old',
        });

        // Rotated material persisted (decrypt the file with the fake cipher).
        const stored = readStoredFile();
        const material = JSON.parse(fakeCipher.decrypt(stored.tokensEncrypted as string)) as Record<string, string>;
        expect(material.accessToken).toBe(newAccessToken);
        expect(material.refreshToken).toBe('rt_new');
        expect(stored.expiresAt).toBe(NOW + 3600);

        // Now fresh — no second refresh.
        await expect(getChatGPTAccessToken()).resolves.toBe(newAccessToken);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the old refresh token when the response omits one', async () => {
        await saveChatGPTTokens({ accessToken: makeAccessToken(60), refreshToken: 'rt_keep' });
        fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: makeAccessToken(3600) }));

        await getChatGPTAccessToken();

        const stored = readStoredFile();
        const material = JSON.parse(fakeCipher.decrypt(stored.tokensEncrypted as string)) as Record<string, string>;
        expect(material.refreshToken).toBe('rt_keep');
    });

    it('shares a single in-flight refresh across concurrent callers', async () => {
        await saveChatGPTTokens({ accessToken: makeAccessToken(60), refreshToken: 'rt_1' });

        const newAccessToken = makeAccessToken(3600);
        let release!: (r: Response) => void;
        fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));

        const a = getChatGPTAccessToken();
        const b = getChatGPTAccessToken();
        // Let both callers reach the refresh gate before releasing the response.
        await Promise.resolve();
        release(jsonResponse({ access_token: newAccessToken }));

        await expect(a).resolves.toBe(newAccessToken);
        await expect(b).resolves.toBe(newAccessToken);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('clears to a clean signed-out state and throws the typed error when the refresh token is rejected', async () => {
        await saveChatGPTTokens({ accessToken: makeAccessToken(60), refreshToken: 'rt_revoked' });
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 401));

        await expect(getChatGPTAccessToken()).rejects.toBeInstanceOf(ChatGPTAuthRequiredError);
        expect(fs.existsSync(AUTH_FILE)).toBe(false);
        await expect(getChatGPTStatus()).resolves.toEqual({ signedIn: false });
    });

    it('treats 5xx as transient: throws a plain error and keeps the stored tokens', async () => {
        await saveChatGPTTokens({ accessToken: makeAccessToken(60), refreshToken: 'rt_1', idToken: makeIdToken() });
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'server_error' }, 503));

        const err = await getChatGPTAccessToken().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(ChatGPTAuthRequiredError);
        await expect(getChatGPTStatus()).resolves.toMatchObject({ signedIn: true });
    });

    it('treats network failure as transient and keeps the stored tokens', async () => {
        await saveChatGPTTokens({ accessToken: makeAccessToken(60), refreshToken: 'rt_1' });
        fetchMock.mockRejectedValueOnce(new Error('fetch failed'));

        const err = await getChatGPTAccessToken().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(ChatGPTAuthRequiredError);
        await expect(getChatGPTStatus()).resolves.toMatchObject({ signedIn: true });
    });

    it('clears the store and requires sign-in when decryption fails', async () => {
        await saveChatGPTTokens({ accessToken: makeAccessToken(3600), refreshToken: 'rt_1' });
        const stored = readStoredFile();
        stored.tokensEncrypted = 'corrupted';
        fs.writeFileSync(AUTH_FILE, JSON.stringify(stored));

        await expect(getChatGPTAccessToken()).rejects.toBeInstanceOf(ChatGPTAuthRequiredError);
        expect(fs.existsSync(AUTH_FILE)).toBe(false);
    });
});

describe('signOutChatGPT', () => {
    it('best-effort revokes the refresh token (with client_id) then clears the store', async () => {
        await saveChatGPTTokens({
            accessToken: makeAccessToken(3600),
            refreshToken: 'rt_1',
            idToken: makeIdToken(),
        });
        fetchMock.mockResolvedValueOnce(jsonResponse({}));

        await signOutChatGPT();

        // Revoke shape verified against codex-rs/login/src/auth/revoke.rs.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(CHATGPT_REVOKE_URL);
        expect(JSON.parse(init.body as string)).toEqual({
            token: 'rt_1',
            token_type_hint: 'refresh_token',
            client_id: CHATGPT_CLIENT_ID,
        });

        expect(fs.existsSync(AUTH_FILE)).toBe(false);
        await expect(getChatGPTStatus()).resolves.toEqual({ signedIn: false });
    });

    it('still clears the store when revocation fails', async () => {
        await saveChatGPTTokens({ accessToken: makeAccessToken(3600), refreshToken: 'rt_1' });
        fetchMock.mockRejectedValueOnce(new Error('offline'));

        await signOutChatGPT();

        expect(fs.existsSync(AUTH_FILE)).toBe(false);
    });

    it('is a no-op-safe local clear when nothing is stored', async () => {
        await signOutChatGPT();
        expect(fetchMock).not.toHaveBeenCalled();
        await expect(getChatGPTStatus()).resolves.toEqual({ signedIn: false });
    });
});
