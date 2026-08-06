import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workDir = vi.hoisted(() =>
    `${process.env.TMPDIR?.replace(/\/$/, '') ?? '/tmp'}/composio-client-test-${process.pid}`,
);

vi.mock('../config/config.js', () => ({ WorkDir: workDir }));
vi.mock('../account/account.js', () => ({ isSignedIn: async () => false }));
vi.mock('../auth/tokens.js', () => ({ getAccessToken: async () => null }));
vi.mock('../config/env.js', () => ({ API_URL: 'https://rowboat.example' }));

import { createConnectedAccountLink } from './client.js';

let fetchMock: ReturnType<typeof vi.fn>;
const originalApiKey = process.env.COMPOSIO_API_KEY;

beforeEach(() => {
    process.env.COMPOSIO_API_KEY = 'ak_test';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    if (originalApiKey === undefined) {
        delete process.env.COMPOSIO_API_KEY;
    } else {
        process.env.COMPOSIO_API_KEY = originalApiKey;
    }
    vi.unstubAllGlobals();
});

describe('createConnectedAccountLink', () => {
    it('uses the Connect Link endpoint for managed OAuth', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            link_token: 'link-token',
            redirect_url: 'https://connect.composio.dev/link/link-token',
            expires_at: '2026-08-06T12:00:00.000Z',
            connected_account_id: 'ca_test',
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
        }));

        const request = {
            auth_config_id: 'ac_test',
            user_id: 'rowboat-user',
            callback_url: 'http://localhost:8081/oauth/callback',
        };
        const result = await createConnectedAccountLink(request);

        expect(result).toEqual({
            link_token: 'link-token',
            redirect_url: 'https://connect.composio.dev/link/link-token',
            expires_at: '2026-08-06T12:00:00.000Z',
            connected_account_id: 'ca_test',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.toString()).toBe('https://backend.composio.dev/api/v3/connected_accounts/link');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual(request);

        const headers = new Headers(init.headers);
        expect(headers.get('x-api-key')).toBe('ak_test');
        expect(headers.get('content-type')).toBe('application/json');
    });
});
