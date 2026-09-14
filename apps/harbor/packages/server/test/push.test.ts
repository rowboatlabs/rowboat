import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory-store.js';
import type { Notification } from '../src/notify.js';
import { PushSender, levelAllows } from '../src/push.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { restClient } from './helpers.js';
import type { Message, Space } from '@rowboat/spaces-protocol';

// Push notifications (PUSH_PLAN.md): the phone half of delivery. The
// decision is notify.ts's (notify.test.ts); this pins the level gate, the
// author-free fan-out to Expo tokens, dead-token pruning and wire-level
// registration — against MemoryStore with a mocked Expo endpoint.

const space = (kind: 'shared' | 'direct'): Space =>
  ({ id: '01HZZZZZZZZZZZZZZZZZZZZZZZ', name: 'general', createdAt: new Date().toISOString(), kind }) as Space;

const msg = (author = 'harsh'): Message =>
  ({
    id: '01HYYYYYYYYYYYYYYYYYYYYYYY',
    spaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
    author: { memberId: author, actingMode: 'direct' },
    body: 'note',
    postedAt: new Date().toISOString(),
    offset: 1,
    replyCount: 0,
    reactions: [],
    mentions: [],
    mentionsHere: false,
    mentionsRowboat: false,
  }) as Message;

const row = (memberId: string, kind: Notification['kind']): Notification => ({ memberId, kind, title: `t:${kind}`, body: 'note' });

describe('levels', () => {
  it("gate like Slack: addressed and followed pass every level but off; dm needs dms; message needs all", () => {
    expect(levelAllows('off', 'mention')).toBe(false);
    expect(levelAllows('off', 'reply')).toBe(false);
    expect(levelAllows('mentions', 'mention')).toBe(true);
    expect(levelAllows('mentions', 'here')).toBe(true);
    expect(levelAllows('mentions', 'reply')).toBe(true);
    expect(levelAllows('mentions', 'dm')).toBe(false);
    expect(levelAllows('dms', 'dm')).toBe(true);
    expect(levelAllows('dms', 'message')).toBe(false);
    expect(levelAllows('all', 'message')).toBe(true);
  });
});

describe('PushSender.send', () => {
  async function setup(level: 'off' | 'mentions' | 'dms' | 'all' | null) {
    const store = new MemoryStore();
    const s = space('shared');
    await store.putSpace(s);
    for (const id of ['harsh', 'gagan']) {
      await store.putMember({ id, displayName: id[0]!.toUpperCase() + id.slice(1), role: 'member' });
      await store.putMembership({ spaceId: s.id, memberId: id, joinedAt: new Date().toISOString() });
    }
    await store.putPushToken('gagan', 'ExponentPushToken[g1]', new Date().toISOString());
    await store.putPushToken('gagan', 'ExponentPushToken[g2]', new Date().toISOString());
    await store.putPushToken('harsh', 'ExponentPushToken[h1]', new Date().toISOString());
    if (level) await store.setPushLevel('gagan', level);
    const calls: any[] = [];
    const fetchImpl = (async (_url: any, init: any) => {
      const batch = JSON.parse(init.body);
      calls.push(...batch);
      return { json: async () => ({ data: batch.map(() => ({ status: 'ok', id: 't' })) }) } as any;
    }) as typeof fetch;
    const sender = new PushSender(store, 'org1', { fetchImpl, receiptDelayMs: 0 });
    return { store, s, sender, calls };
  }

  it('sends only the rows the member’s level allows, to every device; default level is dms', async () => {
    const { s, sender, calls } = await setup(null);
    await sender.send(s, msg('harsh'), [row('gagan', 'message')]);
    expect(calls).toHaveLength(0); // default 'dms': a plain shared message pushes nobody
    await sender.send(s, msg('harsh'), [row('gagan', 'mention')]);
    expect(calls.map((c) => c.to).sort()).toEqual(['ExponentPushToken[g1]', 'ExponentPushToken[g2]']);
    expect(calls[0]).toMatchObject({ title: 't:mention', body: 'note', sound: 'default' });
    expect(calls[0].data).toMatchObject({ kind: 'space', orgId: 'org1', spaceId: s.id, threadRootId: '01HYYYYYYYYYYYYYYYYYYYYYYY' });
  });

  it("level 'all' pushes plain messages; 'off' silences mentions", async () => {
    const all = await setup('all');
    await all.sender.send(all.s, msg('harsh'), [row('gagan', 'message')]);
    expect(all.calls).toHaveLength(2);
    const off = await setup('off');
    await off.sender.send(off.s, msg('harsh'), [row('gagan', 'mention')]);
    expect(off.calls).toHaveLength(0);
  });

  it('prunes DeviceNotRegistered tokens from tickets', async () => {
    const store = new MemoryStore();
    const s = space('shared');
    await store.putSpace(s);
    await store.putMember({ id: 'gagan', displayName: 'Gagan', role: 'member' });
    await store.putMembership({ spaceId: s.id, memberId: 'gagan', joinedAt: new Date().toISOString() });
    await store.putPushToken('gagan', 'ExponentPushToken[dead]', new Date().toISOString());
    await store.setPushLevel('gagan', 'all');
    const fetchImpl = (async () =>
      ({ json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) }) as any) as typeof fetch;
    const sender = new PushSender(store, 'org1', { fetchImpl, receiptDelayMs: 0 });
    await sender.send(s, msg('harsh'), [row('gagan', 'message')]);
    expect(await store.listPushTokens('gagan')).toEqual([]);
  });
});

describe('wire registration', () => {
  let harbor: RunningHarbor;
  beforeAll(async () => {
    harbor = await startHarbor({
      orgName: 'Rowboat Labs',
      seedMembers: [{ id: 'gagan', displayName: 'Gagan' }],
    });
  });
  afterAll(async () => {
    await harbor.close();
  });

  it('registers, re-registers, and unregisters a device', async () => {
    const gagan = restClient(harbor, 'dev-gagan');
    const reg = await gagan.post('/v1/push/register', { token: 'ExponentPushToken[x]', level: 'mentions' });
    expect(reg.status).toBe(200);
    expect(reg.body).toEqual({ ok: true });
    // level updates ride the same call
    const reg2 = await gagan.post('/v1/push/register', { token: 'ExponentPushToken[x]', level: 'all' });
    expect(reg2.status).toBe(200);
    const un = await gagan.post('/v1/push/unregister', { token: 'ExponentPushToken[x]' });
    expect(un.body).toEqual({ ok: true });
    const bad = await gagan.post('/v1/push/register', { token: '', level: 'all' });
    expect(bad.status).toBe(400);
  });
});
