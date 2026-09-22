import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.COMPOSIO_API_KEY = 'test-api-key';

vi.mock('../account/account.js', () => ({
    isSignedIn: vi.fn().mockResolvedValue(false),
}));

const { createConnectedAccount } = await import('./client.js');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('createConnectedAccount', () => {
    it('uses the managed OAuth link endpoint and normalizes its response', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({
            link_token: 'link-token',
            redirect_url: 'https://connect.example.test/oauth',
            connected_account_id: 'account-123',
            expires_at: '2026-09-16T23:00:00Z',
        }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
        }));

        await expect(createConnectedAccount({
            auth_config: { id: 'auth-123' },
            connection: {
                user_id: 'rowboat-user',
                callback_url: 'http://localhost:8081/oauth/callback',
            },
        })).resolves.toEqual({
            id: 'account-123',
            connectionData: {
                authScheme: 'OAUTH2',
                val: {
                    status: 'INITIATED',
                    redirectUrl: 'https://connect.example.test/oauth',
                },
            },
        });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.toString()).toBe('https://backend.composio.dev/api/v3/connected_accounts/link');
        expect(options.method).toBe('POST');
        expect(JSON.parse(String(options.body))).toEqual({
            auth_config_id: 'auth-123',
            user_id: 'rowboat-user',
            callback_url: 'http://localhost:8081/oauth/callback',
        });
    });
});
