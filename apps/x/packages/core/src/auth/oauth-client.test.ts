import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerClientAtEndpoint, resourceParameters } from './oauth-client.js';
import { getProviderConfig } from './providers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('explicit OAuth dynamic client registration', () => {
  it('posts the RFC 7591 public PKCE registration and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      client_id: 'wispr-client-123',
      client_id_issued_at: 1_786_000_000,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(registerClientAtEndpoint(
      'https://mcp-auth.wisprflow.com/oauth2/register',
      {
        redirect_uris: ['http://127.0.0.1:19876/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_name: 'RowboatX Desktop App',
        scope: 'openid email profile offline_access',
      },
    )).resolves.toMatchObject({ client_id: 'wispr-client-123' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mcp-auth.wisprflow.com/oauth2/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      redirect_uris: ['http://127.0.0.1:19876/oauth/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'RowboatX Desktop App',
      scope: 'openid email profile offline_access',
    });
  });

  it('returns a bounded provider error without accepting a failed registration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(1_200), {
      status: 400,
    })));

    await expect(registerClientAtEndpoint(
      'https://mcp-auth.wisprflow.com/oauth2/register',
      { redirect_uris: ['http://127.0.0.1:19876/oauth/callback'] },
    )).rejects.toThrow(/^Dynamic client registration failed \(400\): x{1000}$/);
  });
});

describe('OAuth protected-resource binding', () => {
  it('binds the Wispr authorization and token requests to the protected MCP resource', async () => {
    const provider = await getProviderConfig('wispr-flow');
    expect(provider.resource).toBe('https://api.wisprflow.ai/connect/mcp');
    expect(resourceParameters(provider.resource)).toEqual({
      resource: 'https://api.wisprflow.ai/connect/mcp',
    });
  });

  it('does not add a resource parameter for ordinary providers', () => {
    expect(resourceParameters()).toBeUndefined();
  });
});
