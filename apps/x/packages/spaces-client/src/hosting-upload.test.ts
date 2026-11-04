import { describe, expect, it, vi } from 'vitest';
import { SpacesClient } from './client.js';

describe('managed file upload transport', () => {
  it('sends binary bytes with authenticated, encoded destination metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ path: '/data/reports & images/résumé.png', size: 4 }), { status: 200 }));
    const client = new SpacesClient({ baseUrl: 'https://harbor.example', token: 'dev-owner', fetchImpl });
    const bytes = new Uint8Array([0, 255, 128, 65]);
    expect(await client.uploadHostingFile('agent', '/data/reports & images', 'résumé.png', bytes)).toEqual({ path: '/data/reports & images/résumé.png', size: 4 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/v1/agents/agent/hosting/files/upload');
    expect(parsed.searchParams.get('directory')).toBe('/data/reports & images');
    expect(parsed.searchParams.get('name')).toBe('résumé.png');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toEqual(bytes);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer dev-owner');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/octet-stream');
  });

  it('refuses path-bearing filenames before sending a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new SpacesClient({ baseUrl: 'https://harbor.example', token: 'dev-owner', fetchImpl });
    await expect(client.uploadHostingFile('agent', '/data', '../escape', new Uint8Array())).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


it('downloads exact base64 bytes using an authenticated, encoded path', async () => {
  const result = { path: '/data/résumé & notes.png', bytes: 'AP+AQQ==', mime: 'image/png' };
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result)));
  const client = new SpacesClient({ baseUrl: 'https://harbor.example', token: 'dev-owner', fetchImpl });
  expect(await client.downloadHostingFile('agent', result.path)).toEqual(result);
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(new URL(String(url)).searchParams.get('path')).toBe(result.path);
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer dev-owner');
});

it('creates a file using the exclusive-create endpoint and preserves the requested name', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ path: '/data/notes & résumé.txt' })));
  const client = new SpacesClient({ baseUrl: 'https://harbor.example', token: 'dev-owner', fetchImpl });
  expect(await client.createHostingFile('agent', '/data', 'notes & résumé.txt')).toEqual({ path: '/data/notes & résumé.txt' });
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(new URL(String(url)).pathname).toBe('/v1/agents/agent/hosting/files/create');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({ directory: '/data', name: 'notes & résumé.txt' });
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer dev-owner');
});
