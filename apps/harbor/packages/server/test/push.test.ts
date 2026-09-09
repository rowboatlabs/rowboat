import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory-store.js';
import { PushSender, classifyFor, levelAllows, buildPushText, mentionsRecipient } from '../src/push.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { restClient } from './helpers.js';
import type { Message, Space } from '@rowboat/spaces-protocol';

// Push notifications (PUSH_PLAN.md): the decision matrix, author exclusion,
// wire-level registration, and dead-token pruning — all against MemoryStore
// with a mocked Expo endpoint (no real pushes leave a test).

const space = (kind: 'shared' | 'direct'): Space =>
  ({ id: '01HZZZZZZZZZZZZZZZZZZZZZZZ', name: 'general', createdAt: new Date().toISOString(), kind }) as Space;

const msg = (body: string, author = 'harsh'): Message =>
  ({
    id: '01HYYYYYYYYYYYYYYYYYYYYYYY',
    spaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
    author: { memberId: author, actingMode: 'direct' },
    body,
    postedAt: new Date().toISOString(),
    offset: 1,
    replyCount: 0,
    reactions: [],
  }) as Message;

describe('classification', () => {
  it('mentions beat dm beats message; code spans are cites', () => {
    expect(classifyFor('gagan', space('shared'), msg('hello @gagan'))).toBe('mention');
    expect(classifyFor('gagan', space('shared'), msg('hi @here everyone'))).toBe('mention');
    expect(classifyFor('gagan', space('direct'), msg('just words'))).toBe('dm');
    expect(classifyFor('gagan', space('direct'), msg('ping @gagan'))).toBe('mention');
    expect(classifyFor('gagan', space('shared'), msg('plain message'))).toBe('message');
    expect(classifyFor('gagan', space('shared'), msg('`@gagan` in code'))).toBe('message');
    expect(classifyFor('gagan', space('shared'), msg('```\n@gagan\n```'))).toBe('message');
    expect(mentionsRecipient('email@gagan.com', 'gagan')).toBe(false); // mid-word @ is not an address
  });

  it('levels gate kinds like Slack', () => {
    expect(levelAllows('off', 'mention')).toBe(false);
    expect(levelAllows('mentions', 'mention')).toBe(true);
    expect(levelAllows('mentions', 'dm')).toBe(false);
    expect(levelAllows('dms', 'dm')).toBe(true);
    expect(levelAllows('dms', 'message')).toBe(false);
    expect(levelAllows('all', 'message')).toBe(true);
  });

  it('titles read like the desktop notifier; mentions resolve to names', () => {
    const names = new Map([['harsh', 'Harsh'], ['gagan', 'Gagan']]);
    expect(buildPushText({ kind: 'message', space: space('shared'), direct: false, authorName: 'Harsh', body: 'hi @gagan', names }))
      .toEqual({ title: 'Harsh · general', body: 'hi @Gagan' });
    expect(buildPushText({ kind: 'mention', space: space('shared'), direct: false, authorName: 'Harsh', body: 'yo', names }).title)
      .toBe('Harsh mentioned you · general');
    expect(buildPushText({ kind: 'dm', space: space('direct'), direct: true, authorName: 'Harsh', body: 'yo', names }).title)
      .toBe('Harsh');
  });
});

describe('PushSender.onMessage', () => {
  async function setup(level: 'off' | 'mentions' | 'dms' | 'all' | null) {
    const store = new MemoryStore();
    const s = space('shared');
    await store.putSpace(s);
    for (const id of ['harsh', 'gagan']) {
      await store.putMember({ id, displayName: id[0]!.toUpperCase() + id.slice(1), role: 'member' });
      await store.putMembership({ spaceId: s.id, memberId: id, joinedAt: new Date().toISOString() });
    }
    await store.putPushToken('gagan', 'ExponentPushToken[g1]', new Date().toISOString());
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

  it('never pushes the author; default level is dms', async () => {
    const { s, sender, calls } = await setup(null);
    await sender.onMessage(s, msg('plain note', 'harsh'));
    expect(calls).toHaveLength(0); // default 'dms': a plain shared message pushes nobody
    await sender.onMessage(s, msg('hey @gagan', 'harsh'));
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe('ExponentPushToken[g1]'); // harsh authored — his token untouched
    expect(calls[0].title).toBe('Harsh mentioned you · general');
  });

  it("level 'all' pushes plain messages; 'off' silences mentions", async () => {
    const all = await setup('all');
    await all.sender.onMessage(all.s, msg('plain note', 'harsh'));
    expect(all.calls).toHaveLength(1);
    const off = await setup('off');
    await off.sender.onMessage(off.s, msg('hey @gagan', 'harsh'));
    expect(off.calls).toHaveLength(0);
  });

  it('prunes DeviceNotRegistered tokens from tickets', async () => {
    const store = new MemoryStore();
    const s = space('shared');
    await store.putSpace(s);
    await store.putMember({ id: 'harsh', displayName: 'Harsh', role: 'member' });
    await store.putMember({ id: 'gagan', displayName: 'Gagan', role: 'member' });
    await store.putMembership({ spaceId: s.id, memberId: 'harsh', joinedAt: new Date().toISOString() });
    await store.putMembership({ spaceId: s.id, memberId: 'gagan', joinedAt: new Date().toISOString() });
    await store.putPushToken('gagan', 'ExponentPushToken[dead]', new Date().toISOString());
    await store.setPushLevel('gagan', 'all');
    const fetchImpl = (async () =>
      ({ json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) }) as any) as typeof fetch;
    const sender = new PushSender(store, 'org1', { fetchImpl, receiptDelayMs: 0 });
    await sender.onMessage(s, msg('note', 'harsh'));
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
