import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGateway } from '../src/gateway.js';
import type { InstanceTarget } from '../src/instances.js';
import { MemoryStore, hashToken, type Account, type InstanceRecord } from '../src/store.js';

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
const ME: Account = { id: 'acc_me', email: null, planId: 'p', createdAt: T0 };
const RECORD: InstanceRecord = { accountId: ME.id, app: 'baarali-instances', machineId: 'm_1', volumeId: 'v', image: 'i', managed: true };

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Stands for rowboat-server: records what reaches it. */
async function instance() {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'application/json', 'x-from': 'instance' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  server.on('upgrade', (req, socket) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: '' });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(d));
  });
  return { seen, port: await listen(server) };
}

async function setup() {
  const target = await instance();
  const store = new MemoryStore(new Map([[hashToken('tok'), ME]]), []);
  await store.saveInstance(RECORD);
  await store.addDevice({ id: 'dev_1', accountId: ME.id, name: 'Mac', createdAt: T0, lastSeenAt: null, revokedAt: null }, hashToken('bdk_mine'));
  const woken: string[] = [];
  const reach: InstanceTarget = { host: '127.0.0.1', port: target.port, headers: { 'fly-force-instance-id': 'm_1' }, key: 'instance-key' };
  const gateway = createGateway({
    store,
    instances: {
      wake: async (r) => void woken.push(r.machineId ?? ''),
      target: () => reach,
    },
    now: () => T0,
    fetch: globalThis.fetch,
  });
  const call = (path: string, init: RequestInit = {}) => gateway.http(new Request(`https://app.baarali.test${path}`, init));
  return { store, gateway, call, target, woken };
}

describe('gateway, HTTP', () => {
  it('relays an RPC with the instance key, never the device key nor its Fly headers', async () => {
    const { call, target, woken, store } = await setup();
    const res = await call('/instance/rpc/sessions:list?x=1', {
      method: 'POST',
      headers: { authorization: 'Bearer bdk_mine', 'content-type': 'application/json', 'fly-force-instance-id': 'm_someone_else' },
      body: '{"a":1}',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('x-from')).toBe('instance');
    const seen = target.seen[0];
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/rpc/sessions:list?x=1');
    expect(seen.body).toBe('{"a":1}');
    expect(seen.headers.authorization).toBe('Bearer instance-key');
    expect(seen.headers['fly-force-instance-id']).toBe('m_1');
    expect(woken).toEqual(['m_1']);
    expect((await store.devices(ME.id))[0].lastSeenAt).toBe(T0);
  });

  it('takes the key from ?token= and drops it before relaying', async () => {
    const { call, target } = await setup();
    const res = await call('/instance/workspace/a%20b.md?token=bdk_mine&v=2');
    expect(res.status).toBe(200);
    expect(target.seen[0].url).toBe('/workspace/a%20b.md?v=2');
  });

  it('refuses a wrong or revoked key, and relays nothing', async () => {
    const { call, target, store } = await setup();
    expect((await call('/instance/rpc/x', { headers: { authorization: 'Bearer bdk_wrong' } })).status).toBe(401);
    expect((await call('/instance/rpc/x')).status).toBe(401);
    await store.revokeDevice(ME.id, 'dev_1', T0);
    expect((await call('/instance/rpc/x', { headers: { authorization: 'Bearer bdk_mine' } })).status).toBe(401);
    expect(target.seen).toHaveLength(0);
  });

  it('answers the health check itself, before any key', async () => {
    const { call, target } = await setup();
    const res = await call('/instance/health');
    expect(await res.json()).toEqual({ name: 'rowboat-server', via: 'baarali-gateway' });
    expect(target.seen).toHaveLength(0);
  });

  it('says an instance that would not wake is waking, relaying nothing, so the app asks again', async () => {
    const { store, target } = await setup();
    const gateway = createGateway({
      store,
      instances: { wake: async () => { throw new Error('deadline_exceeded'); }, target: () => { throw new Error('unreached'); } },
      now: () => T0,
      fetch: globalThis.fetch,
    });
    const res = await gateway.http(new Request('https://app.baarali.test/instance/rpc/sessions:get', { method: 'POST', headers: { authorization: 'Bearer bdk_mine' }, body: '{}' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('instance_waking');
    expect(target.seen).toHaveLength(0);
  });

  it('says so when the account has no instance yet', async () => {
    const { call, store } = await setup();
    await store.saveInstance({ ...RECORD, machineId: null });
    expect((await call('/instance/rpc/x', { headers: { authorization: 'Bearer bdk_mine' } })).status).toBe(409);
  });
});

describe('gateway, WebSocket', () => {
  it('replays the handshake with the instance key and without the token, then splices', async () => {
    const { gateway, target } = await setup();
    const front = http.createServer((_req, res) => res.end());
    front.on('upgrade', gateway.upgrade);
    const port = await listen(front);
    const echoed = await new Promise<string>((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.write('GET /instance/events?token=bdk_mine HTTP/1.1\r\nHost: app.baarali.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nFly-Force-Instance-Id: m_x\r\n\r\n');
      });
      let buf = '';
      s.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('\r\n\r\n') && !buf.includes('ping')) s.write('ping');
        if (buf.endsWith('ping')) {
          s.destroy();
          resolve(buf);
        }
      });
    });
    expect(echoed).toContain('101 Switching Protocols');
    const seen = target.seen[0];
    expect(seen.url).toBe('/events');
    expect(seen.headers.authorization).toBe('Bearer instance-key');
    expect(seen.headers['fly-force-instance-id']).toBe('m_1');
    expect(seen.headers.upgrade).toBe('websocket');
  });

  it('refuses a handshake without a valid key', async () => {
    const { gateway, target } = await setup();
    const front = http.createServer();
    front.on('upgrade', gateway.upgrade);
    const port = await listen(front);
    const answer = await new Promise<string>((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.write('GET /instance/events?token=bdk_wrong HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      });
      let buf = '';
      s.on('data', (d) => (buf += d.toString()));
      s.on('close', () => resolve(buf));
    });
    expect(answer).toMatch(/^HTTP\/1.1 401/);
    expect(target.seen).toHaveLength(0);
  });
});
