import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { appRoute, createGate } from '../src/gate.js';

const servers: http.Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

describe('gate', () => {
  it('forwards HTTP with a loopback Host, keeping the bearer', async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const target = await listen(http.createServer((req, res) => { seen.push(req.headers); res.end('ok'); }));
    const gate = await listen(createGate({ targetPort: target }));
    const res = await fetch(`http://127.0.0.1:${gate}/health`, { headers: { host: 'baarali-x.fly.dev', authorization: 'Bearer k' } });
    expect(await res.text()).toBe('ok');
    expect(seen[0].host).toBe(`127.0.0.1:${target}`);
    expect(seen[0].authorization).toBe('Bearer k');
  });

  it('says the server is starting while it does not listen yet, so the app asks again', async () => {
    const free = await listen(http.createServer());
    servers.pop()!.close();
    const gate = await listen(createGate({ targetPort: free }));
    const res = await fetch(`http://127.0.0.1:${gate}/health`);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('instance_starting');
  });

  // A request cut short on either side — the app giving up while the
  // instance wakes, the server going down mid-answer — must cost that request
  // only: an unheard stream error would take the whole machine down.
  it('survives a caller that hangs up mid-answer, and a server that does', async () => {
    let finish: (() => void) | null = null;
    const target = await listen(http.createServer((req, res) => {
      if (req.url === '/slow') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('first');
        finish = () => res.end('last');
        return;
      }
      if (req.url === '/dies') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('half');
        setTimeout(() => res.socket?.destroy(), 20);
        return;
      }
      res.end('ok');
    }));
    const gate = await listen(createGate({ targetPort: target }));

    // The caller leaves after the first bytes, upload still open.
    await new Promise<void>((resolve) => {
      const s = net.connect(gate, '127.0.0.1', () => {
        s.write('POST /slow HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n');
      });
      s.on('data', () => { s.destroy(); setTimeout(resolve, 50); });
    });
    (finish as (() => void) | null)?.();
    await new Promise((r) => setTimeout(r, 50));

    const cut = await fetch(`http://127.0.0.1:${gate}/dies`).then((r) => r.text()).catch((e: unknown) => e);
    expect(cut).toBeInstanceOf(Error);

    const res = await fetch(`http://127.0.0.1:${gate}/health`);
    expect(await res.text()).toBe('ok');
  });

  it('replays a WebSocket handshake with a loopback Host and splices the sockets', async () => {
    let handshake = '';
    const target = http.createServer();
    target.on('upgrade', (req, socket) => {
      handshake = `${req.headers.host}|${req.headers.authorization}`;
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      socket.on('data', (d) => socket.write(d));
    });
    const targetPort = await listen(target);
    const gate = await listen(createGate({ targetPort }));
    const echoed = await new Promise<string>((resolve) => {
      const s = net.connect(gate, '127.0.0.1', () => {
        s.write('GET /ws HTTP/1.1\r\nHost: baarali-x.fly.dev\r\nAuthorization: Bearer k\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      });
      let buf = '';
      s.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('\r\n\r\n') && !buf.includes('ping')) s.write('ping');
        if (buf.endsWith('ping')) { s.destroy(); resolve(buf); }
      });
    });
    expect(echoed).toContain('101 Switching Protocols');
    expect(handshake).toBe(`127.0.0.1:${targetPort}|Bearer k`);
  });

  it('opens an app to the key holder only, under the app\'s own Host', async () => {
    const seen: { url?: string; headers: http.IncomingHttpHeaders }[] = [];
    const appsServer = await listen(http.createServer((req, res) => { seen.push({ url: req.url, headers: req.headers }); res.end('app'); }));
    const target = await listen(http.createServer((_req, res) => res.end('server')));
    const gate = await listen(createGate({ targetPort: target, apps: { port: appsServer, serverKey: () => 'k' } }));
    const denied = await fetch(`http://127.0.0.1:${gate}/_apps/finance-tracker/`, { headers: { authorization: 'Bearer nope' } });
    expect(denied.status).toBe(401);
    const res = await fetch(`http://127.0.0.1:${gate}/_apps/finance-tracker/_rowboat/data?x=1`, { headers: { authorization: 'Bearer k' } });
    expect(await res.text()).toBe('app');
    expect(seen[0].url).toBe('/_rowboat/data?x=1');
    expect(seen[0].headers.host).toBe(`finance-tracker.apps.localhost:${appsServer}`);
    expect(seen[0].headers.authorization).toBeUndefined();
    // Everything else still goes to the server.
    expect(await (await fetch(`http://127.0.0.1:${gate}/health`)).text()).toBe('server');
  });

  it('reads an app path, and nothing that is not one', () => {
    expect(appRoute('/_apps/stock')).toEqual({ folder: 'stock', path: '/' });
    expect(appRoute('/_apps/stock?x=1')).toEqual({ folder: 'stock', path: '/?x=1' });
    expect(appRoute('/_apps/Bad_Name/')).toBeNull();
    expect(appRoute('/rpc/sessions:list')).toBeNull();
  });
});
