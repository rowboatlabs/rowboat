import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { BaaraliAuth } from '../src/auth.js';
import type { FlyApi, MachineConfig } from '../src/fly.js';
import { createGateway } from '../src/gateway.js';
import { Instances } from '../src/instances.js';
import { MemoryStore, hashToken, type Account, type Plan } from '../src/store.js';

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
const PLAN: Plan = { id: 'decouverte', category: 'free', displayName: 'Découverte', weekCredits: 1, monthlyPrices: [], models: null };
const ME: Account = { id: 'user_me', email: 'me@example.test', planId: 'decouverte', createdAt: T0 };
const OTHER: Account = { id: 'user_other', email: null, planId: 'decouverte', createdAt: T0 };

// The OAuth access tokens of two signed-in people.
const auth: BaaraliAuth = {
  methods: { email: true, phone: false, social: [] },
  handle: async () => new Response(null, { status: 404 }),
  userIdForAccessToken: async (t) => ({ 'at-me': ME.id, 'at-other': OTHER.id })[t] ?? null,
  spacesTokenFor: async () => null,
};

const fly: FlyApi = {
  createVolume: async () => ({ id: 'vol_1' }),
  createMachine: async (_app, { config }: { region: string; config: MachineConfig }) => ({ id: 'm_1', state: 'started', config }),
  machine: async (_app, id) => ({ id, state: 'started', config: { image: 'img' } }),
  updateMachine: async (_app, id, config) => ({ id, state: 'started', config }),
  start: async () => {},
  waitStarted: async () => {},
};

function setup(maxInstances = 5) {
  const store = new MemoryStore(new Map([[hashToken('instance-token'), ME], [hashToken('other-token'), OTHER]]), [PLAN]);
  const instances = new Instances({
    store,
    secret: 'test-secret-0123456789abcdef0123',
    fly,
    config: { app: 'baarali-instances', region: 'cdg', image: 'img', apiUrl: 'https://app.baarali.test', maxInstances },
    now: () => T0,
  });
  const app = createApp({
    store,
    openRouterKey: 'k',
    publicUrl: 'https://app.baarali.test',
    appName: 'Baarali',
    mediaPacks: [],
    auth,
    instances,
    gateway: createGateway({ store, instances, now: () => T0, fetch: globalThis.fetch }),
    now: () => T0,
    fetch: globalThis.fetch,
  });
  const call = (path: string, token: string | null, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return { store, call };
}

describe('/v1/devices', () => {
  it('creates the instance and gives the device a key of its own for the gateway', async () => {
    const { store, call } = setup();
    const res = await call('/v1/devices', 'at-me', { method: 'POST', body: JSON.stringify({ name: 'MacBook de Awa' }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { device: { id: string; name: string }; server: { url: string; key: string } };
    expect(body.device.name).toBe('MacBook de Awa');
    expect(body.server.url).toBe('https://app.baarali.test/instance');
    expect(body.server.key).toMatch(/^bdk_/);
    expect((await store.deviceByKey(body.server.key))?.accountId).toBe(ME.id);
    expect((await store.instance(ME.id))?.machineId).toBe('m_1');
  });

  it('is only for a signed-in person: an instance token or a device key adds no device', async () => {
    const { call } = setup();
    expect((await call('/v1/devices', 'instance-token', { method: 'POST' })).status).toBe(401);
    const { server } = (await (await call('/v1/devices', 'at-me', { method: 'POST' })).json()) as { server: { key: string } };
    expect((await call('/v1/devices', server.key, { method: 'POST' })).status).toBe(401);
    expect((await call('/v1/devices', null)).status).toBe(401);
  });

  it('lists and revokes only the person\'s own devices', async () => {
    const { call } = setup();
    const { device, server } = (await (await call('/v1/devices', 'at-me', { method: 'POST' })).json()) as { device: { id: string }; server: { key: string } };
    const mine = (await (await call('/v1/devices', 'at-me')).json()) as { data: Array<{ id: string; name: string; revoked_at: string | null }> };
    expect(mine.data).toEqual([expect.objectContaining({ id: device.id, name: 'Appareil', revoked_at: null })]);
    expect(((await (await call('/v1/devices', 'at-other')).json()) as { data: unknown[] }).data).toEqual([]);

    expect((await call(`/v1/devices/${device.id}`, 'at-other', { method: 'DELETE' })).status).toBe(404);
    expect((await call('/instance/rpc/x', server.key)).status).not.toBe(401);
    expect((await call(`/v1/devices/${device.id}`, 'at-me', { method: 'DELETE' })).status).toBe(204);
    expect((await call('/instance/rpc/x', server.key)).status).toBe(401);
  });

  it('caps the devices of one person', async () => {
    const { call } = setup();
    for (let i = 0; i < 10; i++) expect((await call('/v1/devices', 'at-me', { method: 'POST' })).status).toBe(201);
    expect((await call('/v1/devices', 'at-me', { method: 'POST' })).status).toBe(409);
  });

  it('says when early access is full', async () => {
    const { call } = setup(1);
    expect((await call('/v1/devices', 'at-me', { method: 'POST' })).status).toBe(201);
    const res = await call('/v1/devices', 'at-other', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: 'instances_full' } });
  });
});
