import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningHarbor } from '../src/server.js';
import { LiveStats } from '../src/stats.js';
import { liveClient, startTestHarbor } from './helpers.js';

// The operator face (2026-09-22): what one instance carries on the live face,
// read over the wire behind the operator key. These pin that the counters
// track the sockets and subscriptions they claim to, and that the route does
// not exist without a key.

const KEY = 'operator-key-for-tests';
let harbor: RunningHarbor;
let main: string;

beforeAll(async () => {
  harbor = await startTestHarbor({
    internal: { key: KEY },
    seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  });
  main = (await harbor.service.listSpaces({ memberId: 'ramnique' }))[0]!.id;
});
afterAll(async () => {
  await harbor.close();
});

const stats = async (auth?: string) => {
  const res = await fetch(`${harbor.url}/internal/stats`, { headers: auth ? { authorization: auth } : {} });
  return { status: res.status, body: (await res.json()) as any };
};
const eventually = async (pred: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 3000;
  while (!(await pred())) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('GET /internal/stats', () => {
  it('needs the operator key', async () => {
    expect((await stats()).status).toBe(401);
    expect((await stats('Bearer wrong')).status).toBe(401);
    expect((await stats(`Bearer ${KEY}x`)).status).toBe(401);
    const ok = await stats(`Bearer ${KEY}`);
    expect(ok.status).toBe(200);
    expect(ok.body.instance.pid).toBe(process.pid);
    expect(ok.body.live).toEqual({ connections: 0, subscriptions: 0 });
  });

  it('counts sockets, subscriptions, and the frames that went through the hub', async () => {
    const client = await liveClient(harbor, 'dev-ramnique');
    await eventually(async () => (await stats(`Bearer ${KEY}`)).body.live.connections === 1, 'connection counted');

    client.send({ kind: 'subscribe', spaceId: main });
    await client.until((f) => f.some((x) => x.kind === 'subscribed'), 'subscribed');
    expect((await stats(`Bearer ${KEY}`)).body.live.subscriptions).toBe(1);

    // Re-subscribing replaces, never double-counts.
    client.send({ kind: 'subscribe', spaceId: main });
    await client.until((f) => f.filter((x) => x.kind === 'subscribed').length === 2, 'resubscribed');
    expect((await stats(`Bearer ${KEY}`)).body.live.subscriptions).toBe(1);

    await harbor.service.postMessage({ memberId: 'ramnique' }, main, { body: 'hello', actingMode: 'direct' });
    await client.until((f) => f.some((x) => x.kind === 'event'), 'event delivered');
    const after = (await stats(`Bearer ${KEY}`)).body;
    expect(after.published.sinceBoot.event).toBeGreaterThanOrEqual(1);
    expect(after.delivered.sinceBoot).toBeGreaterThanOrEqual(1);

    client.send({ kind: 'unsubscribe', spaceId: main });
    await eventually(async () => (await stats(`Bearer ${KEY}`)).body.live.subscriptions === 0, 'unsubscribed');

    client.close();
    await eventually(async () => (await stats(`Bearer ${KEY}`)).body.live.connections === 0, 'connection released');
  });

  it('does not exist without a key', async () => {
    const bare = await startTestHarbor({ seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }] });
    try {
      expect((await fetch(`${bare.url}/internal/stats`, { headers: { authorization: `Bearer ${KEY}` } })).status).toBe(404);
    } finally {
      await bare.close();
    }
  });
});

describe('LiveStats windows', () => {
  it('rotate closes the window: current becomes lastMinute, totals keep counting', () => {
    const s = new LiveStats({ windowMs: 60_000 });
    try {
      const event = { kind: 'event', spaceId: 's', offset: 1, at: 'now', event: {} } as any;
      const presence = { kind: 'presence', spaceId: 's' } as any;
      s.published(event, 3);
      s.published(presence, 0);
      expect(s.snapshot().published.lastMinute).toEqual({});
      s.rotate();
      expect(s.snapshot().published.lastMinute).toEqual({ event: 1, presence: 1 });
      expect(s.snapshot().delivered).toEqual({ lastMinute: 3, sinceBoot: 3 });
      s.published(event, 2);
      s.rotate();
      expect(s.snapshot().published.lastMinute).toEqual({ event: 1 });
      expect(s.snapshot().published.sinceBoot).toEqual({ event: 2, presence: 1 });
      expect(s.snapshot().delivered).toEqual({ lastMinute: 2, sinceBoot: 5 });
    } finally {
      s.close();
    }
  });
});
