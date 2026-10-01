import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGate } from '../src/gate.js';

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

  it('answers 502 when the server is down', async () => {
    const free = await listen(http.createServer());
    servers.pop()!.close();
    const gate = await listen(createGate({ targetPort: free }));
    const res = await fetch(`http://127.0.0.1:${gate}/health`);
    expect(res.status).toBe(502);
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
});
