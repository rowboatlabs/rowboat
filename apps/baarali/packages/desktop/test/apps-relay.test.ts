import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppsRelay, folderOf } from '../src/apps-relay.js';

// The apps of a cloud account, opened on the computer (03/10/2026).

const servers: http.Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

/** A request to the relay as an app's page sends it: to its own origin. */
function get(port: number, host: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { host, origin: `http://${host}` } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

describe('apps relay', () => {
  it('knows an app by its host, and nothing else', () => {
    expect(folderOf('finance-tracker.apps.localhost:3210')).toBe('finance-tracker');
    expect(folderOf('apps.localhost:3210')).toBeNull();
    expect(folderOf('example.com')).toBeNull();
  });

  it('passes the request to the gateway, under the app\'s folder, with the device key', async () => {
    const seen: { url?: string; headers: http.IncomingHttpHeaders }[] = [];
    const gateway = await listen(http.createServer((req, res) => { seen.push({ url: req.url, headers: req.headers }); res.end('hello'); }));
    const relay = await listen(createAppsRelay({ target: () => ({ url: `http://127.0.0.1:${gateway}/instance`, key: 'device-key' }) }));
    const res = await get(relay, 'stock.apps.localhost:3210', '/_rowboat/data?x=1');
    expect(res).toEqual({ status: 200, body: 'hello' });
    expect(seen[0].url).toBe('/instance/_apps/stock/_rowboat/data?x=1');
    expect(seen[0].headers.authorization).toBe('Bearer device-key');
    expect(seen[0].headers.origin).toBe('http://stock.apps.localhost:3210');
  });

  it('says so outside cloud mode, and for a host that is no app', async () => {
    const relay = await listen(createAppsRelay({ target: () => null }));
    expect((await get(relay, 'stock.apps.localhost:3210', '/')).status).toBe(503);
    expect((await get(relay, 'localhost:3210', '/')).status).toBe(404);
  });
});
