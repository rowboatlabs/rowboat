import { describe, expect, it, vi } from 'vitest';
import { SpacesClient, type SpacesSessionCookie } from './client.js';
import { SpacesLive } from './live.js';

// The web app's credential (2026-10-12): Harbor's session cookie. Requests go
// with credentials and no bearer, and a 401 asks the host for a fresh cookie
// once. The live socket opens with no token in its URL.

const session = (): SpacesSessionCookie & { calls: Array<{ forceRefresh?: boolean } | undefined> } => {
  const calls: Array<{ forceRefresh?: boolean } | undefined> = [];
  return { session: 'cookie', calls, ensure: async (opts) => { calls.push(opts); } };
};

const spacesBody = { spaces: [] };

describe('SpacesClient on the session cookie', () => {
  it('sends credentials and no bearer, after making sure of the cookie', async () => {
    const cookie = session();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(spacesBody));
    await new SpacesClient({ baseUrl: 'https://acme.test', token: cookie, fetchImpl }).listSpaces();
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(cookie.calls).toEqual([undefined]);
  });

  it('asks for a fresh cookie once on a 401, then retries', async () => {
    const cookie = session();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'unauthorized', message: 'expired', retryable: false }, { status: 401 }))
      .mockResolvedValueOnce(Response.json(spacesBody));
    await new SpacesClient({ baseUrl: 'https://acme.test', token: cookie, fetchImpl }).listSpaces();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cookie.calls).toEqual([undefined, { forceRefresh: true }]);
  });

  it('sends raw-byte uploads the same way', async () => {
    const cookie = session();
    const fetchImpl = vi.fn(async () => Response.json({ blob: { hash: 'a'.repeat(64), size: 1, mime: 'text/plain' } }));
    await new SpacesClient({ baseUrl: 'https://acme.test', token: cookie, fetchImpl: fetchImpl as unknown as typeof fetch })
      .uploadBlob('S1', new Uint8Array([1]), { declaredMime: 'text/plain' });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect((init.headers as Record<string, string>)['x-blob-sha256']).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('SpacesLive on the session cookie', () => {
  it('opens the socket with no token in its URL', async () => {
    const cookie = session();
    const urls: string[] = [];
    class FakeSocket {
      onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: () => void;
      readyState = 0;
      constructor(url: string) { urls.push(url); }
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    const live = new SpacesLive({ baseUrl: 'https://acme.test', token: cookie, webSocketImpl: FakeSocket as unknown as typeof WebSocket });
    live.subscribe('S1', () => {});
    await vi.waitFor(() => expect(urls).toEqual(['wss://acme.test/v1/live']));
    expect(cookie.calls.length).toBeGreaterThan(0);
    live.close();
  });
});
