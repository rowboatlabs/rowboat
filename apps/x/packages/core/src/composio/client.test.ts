import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectedAccount, createConnectedAccountLink } from './client.js';

// Mock auth & config dependencies
vi.mock('../account/account.js', () => ({
    isSignedIn: async () => false,
}));

vi.mock('../auth/tokens.js', () => ({
    getAccessToken: async () => 'test-access-token',
}));

describe('Composio client - Connect Link & Connected Account', () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.COMPOSIO_API_KEY;

    beforeEach(() => {
        process.env.COMPOSIO_API_KEY = 'test-api-key';
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        process.env.COMPOSIO_API_KEY = originalApiKey;
        vi.restoreAllMocks();
    });

    it('createConnectedAccountLink POSTs to /connected_accounts/link', async () => {
        let requestedUrl = '';
        let requestedMethod = '';
        let requestedBody: unknown = null;

        globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
            requestedUrl = url.toString();
            requestedMethod = init?.method || 'GET';
            requestedBody = init?.body ? JSON.parse(init.body as string) : null;

            return new Response(JSON.stringify({
                link_token: 'token_123',
                redirect_url: 'https://connect.composio.dev/link_abc',
                connected_account_id: 'ca_999',
                expires_at: '2026-10-13T20:00:00Z',
            }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        const res = await createConnectedAccountLink({
            auth_config_id: 'ac_test_1',
            user_id: 'user_test',
            callback_url: 'http://localhost:8081/callback',
        });

        expect(requestedUrl).toContain('/connected_accounts/link');
        expect(requestedMethod).toBe('POST');
        expect(requestedBody).toEqual({
            auth_config_id: 'ac_test_1',
            user_id: 'user_test',
            callback_url: 'http://localhost:8081/callback',
        });
        expect(res.connected_account_id).toBe('ca_999');
        expect(res.redirect_url).toBe('https://connect.composio.dev/link_abc');
    });

    it('createConnectedAccount maps link response to connected account shape for downstream consumers', async () => {
        globalThis.fetch = vi.fn().mockImplementation(async () => {
            return new Response(JSON.stringify({
                link_token: 'token_xyz',
                redirect_url: 'https://connect.composio.dev/link_xyz',
                connected_account_id: 'ca_conn_123',
            }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        const response = await createConnectedAccount({
            auth_config: { id: 'ac_managed_oauth' },
            connection: {
                user_id: 'rowboat-user',
                callback_url: 'http://localhost:8081/callback',
            },
        });

        expect(response.id).toBe('ca_conn_123');
        expect(response.connectionData?.authScheme).toBe('OAUTH2');
        expect(response.connectionData?.val.status).toBe('INITIALIZING');
        expect((response.connectionData?.val as Record<string, unknown>).redirectUrl).toBe('https://connect.composio.dev/link_xyz');
    });

    it('createConnectedAccount defensively handles camelCase response fields', async () => {
        globalThis.fetch = vi.fn().mockImplementation(async () => {
            return new Response(JSON.stringify({
                linkToken: 'token_camel',
                redirectUrl: 'https://connect.composio.dev/link_camel',
                connectedAccountId: 'ca_camel_456',
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        const response = await createConnectedAccount({
            auth_config: { id: 'ac_camel' },
            connection: {
                user_id: 'rowboat-user',
                callback_url: 'http://localhost:8081/callback',
            },
        });

        expect(response.id).toBe('ca_camel_456');
        expect((response.connectionData?.val as Record<string, unknown>).redirectUrl).toBe('https://connect.composio.dev/link_camel');
    });

    it('throws error when connected_account_id is missing from response', async () => {
        globalThis.fetch = vi.fn().mockImplementation(async () => {
            return new Response(JSON.stringify({
                redirect_url: 'https://connect.composio.dev/link_no_id',
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        await expect(createConnectedAccount({
            auth_config: { id: 'ac_missing' },
            connection: {
                user_id: 'rowboat-user',
            },
        })).rejects.toThrow('missing connected_account_id');
    });
});
