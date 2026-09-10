import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActivityItem, ActivityPage, Message, Space } from '@rowboat/spaces-protocol';
import { readActivity } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { agentClient, callStructured, restClient } from './helpers.js';
import { pgliteDb } from './pglite.js';

// Activity (2026-09-10, layer 3): everything that involves the member, as a
// query over the facts the org already keeps — stamps, follow rows, the DM
// kind, reactions — never a second table. Both stores must agree on the
// rows, their order, the kinds' priority, what the read marks say is
// unread, and the cursor. The agent face gets names resolved.

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let ramnique: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let arjun: ReturnType<typeof restClient>;
let main: string;

async function startForStore(kind: 'memory' | 'postgres'): Promise<void> {
  const options: HarborOptions = {
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'arjun', displayName: 'Arjun' },
    ],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  };
  if (kind === 'postgres') {
    sqlDb = await pgliteDb();
    const store = new PgStore(sqlDb);
    await store.init();
    options.store = store;
  }
  harbor = await startHarbor(options);
  ramnique = restClient(harbor, 'dev-ramnique');
  harsh = restClient(harbor, 'dev-harsh');
  arjun = restClient(harbor, 'dev-arjun');
  main = (await ramnique.get('/v1/spaces')).body.spaces[0].id;
  for (const member of [harsh, arjun]) {
    const invite = await ramnique.post('/v1/invites', { spaceId: main });
    expect((await member.post('/v1/invites/accept', { token: invite.body.token })).status).toBe(200);
  }
}

async function post(client: ReturnType<typeof restClient>, spaceId: string, body: string, extra: Record<string, unknown> = {}): Promise<Message> {
  const r = await client.post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

async function react(client: ReturnType<typeof restClient>, spaceId: string, messageId: string, emoji: string): Promise<void> {
  const r = await client.post(`/v1/spaces/${spaceId}/messages/${messageId}/reactions`, { emoji, action: 'add', actingMode: 'direct' });
  expect(r.status).toBe(200);
}

async function activity(client: ReturnType<typeof restClient>, qs = ''): Promise<ActivityPage> {
  const r = await client.get(`/v1/activity${qs}`);
  expect(r.status).toBe(200);
  return r.body as ActivityPage;
}

const kinds = (page: ActivityPage) => page.items.map((i) => i.kind);
const tick = () => new Promise((resolve) => setTimeout(resolve, 2)); // distinct instants, the order under test

describe.each([['memory'], ['postgres']] as const)('activity (%s store)', (storeKind) => {
  let r1: Message;
  let h1: Message;
  let dm: Space;

  beforeAll(async () => {
    await startForStore(storeKind);
    r1 = await post(ramnique, main, 'kickoff: what should we ship first?');
    await tick();
    h1 = await post(harsh, main, 'hey [@Ramnique](#member:ramnique) look at this');
    await tick();
    await post(harsh, main, 'a plain root nobody is addressed by');
    await tick();
    await post(arjun, main, 'a reply from arjun', { threadRoot: r1.id }); // ramnique authored the root: follows from here
    await tick();
    await post(harsh, main, 'in-thread [@Ramnique](#member:ramnique) ping', { threadRoot: r1.id });
    await tick();
    await react(arjun, main, r1.id, '👍');
    await tick();
    await react(harsh, main, r1.id, '👍');
    await tick();
    await react(harsh, main, r1.id, '🎉');
    await tick();
    dm = (await harsh.post('/v1/direct', { memberId: 'ramnique' })).body.space as Space;
    await post(harsh, dm.id, 'dm: got a minute?');
    await tick();
    await post(ramnique, dm.id, 'my own dm message, never an item for me');
    await tick();
    await post(arjun, main, '[@here](#here) standup in 5');
  });
  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('lists everything that involves me, newest first, one kind per message by priority', async () => {
    const page = await activity(ramnique);
    expect(kinds(page)).toEqual(['here', 'dm', 'reaction', 'reaction', 'mention', 'reply', 'mention']);
    const [here, dmItem, party, thumbs, inThread, reply, root] = page.items as ActivityItem[];
    expect(here).toMatchObject({ spaceId: main, spaceKind: 'shared', spaceName: 'Main', actors: [{ memberId: 'arjun' }], unread: true });
    expect(here!.threadRootId).toBeUndefined();
    // Read already: my own direct post in the DM advanced my mark past it (posting reads).
    expect(dmItem).toMatchObject({ spaceId: dm.id, spaceKind: 'direct', actors: [{ memberId: 'harsh' }], unread: false });
    expect(party).toMatchObject({ id: `r:${r1.id}:🎉`, emoji: '🎉', actors: [{ memberId: 'harsh' }], message: { id: r1.id }, unread: true });
    // Folded per emoji; reactors newest first.
    expect(thumbs).toMatchObject({ id: `r:${r1.id}:👍`, emoji: '👍', message: { id: r1.id } });
    expect(thumbs!.actors.map((a) => a.memberId)).toEqual(['harsh', 'arjun']);
    expect(inThread).toMatchObject({ kind: 'mention', threadRootId: r1.id, actors: [{ memberId: 'harsh' }] });
    expect(reply).toMatchObject({ kind: 'reply', threadRootId: r1.id, actors: [{ memberId: 'arjun' }] });
    expect(root).toMatchObject({ id: `m:${h1.id}`, message: { id: h1.id } });
    expect(page.names).toEqual({ ramnique: 'Ramnique', harsh: 'Harsh', arjun: 'Arjun' });
    expect(page.seenAt).toBeNull();
    expect(page.nextCursor).toBeUndefined();
  });

  it('filters by kind and by space', async () => {
    expect(kinds(await activity(ramnique, '?kinds=mention,here'))).toEqual(['here', 'mention', 'mention']);
    expect(kinds(await activity(ramnique, '?kinds=reaction'))).toEqual(['reaction', 'reaction']);
    expect(kinds(await activity(ramnique, `?spaceId=${dm.id}`))).toEqual(['dm']);
    expect((await ramnique.get('/v1/activity?kinds=bogus')).status).toBe(400);
    expect((await ramnique.get('/v1/activity?cursor=nonsense')).status).toBe(400);
    expect([403, 404]).toContain((await harsh.get(`/v1/activity?spaceId=${'01HZZZZZZZZZZZZZZZZZZZZZZZ'}`)).status);
  });

  it('pages by cursor without gaps or overlap', async () => {
    const first = await activity(ramnique, '?limit=3');
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeDefined();
    const second = await activity(ramnique, `?limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items).toHaveLength(3);
    const third = await activity(ramnique, `?limit=3&cursor=${encodeURIComponent(second.nextCursor!)}`);
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeUndefined();
    const all = [...first.items, ...second.items, ...third.items].map((i) => i.id);
    expect(all).toEqual((await activity(ramnique)).items.map((i) => i.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('unread is the read marks’ answer for messages and the seen mark’s for reactions', async () => {
    expect(kinds(await activity(ramnique, '?unread=true'))).toEqual(['here', 'reaction', 'reaction', 'mention', 'reply', 'mention']);
    const head = (await ramnique.get('/v1/unread')).body.spaces.find((s: { spaceId: string }) => s.spaceId === main).head;
    await ramnique.post(`/v1/spaces/${main}/read`, { offset: head }); // roots read: the @here and the root mention
    expect(kinds(await activity(ramnique, '?unread=true'))).toEqual(['reaction', 'reaction', 'mention', 'reply']);
    await ramnique.post(`/v1/spaces/${main}/read`, { threadRootId: r1.id, offset: head }); // the followed thread read
    expect(kinds(await activity(ramnique, '?unread=true'))).toEqual(['reaction', 'reaction']);
    const seen = await ramnique.post('/v1/activity/seen', { at: new Date().toISOString() });
    expect(seen.status).toBe(200);
    expect(kinds(await activity(ramnique, '?unread=true'))).toEqual([]);
    const page = await activity(ramnique);
    expect(page.seenAt).toBe(seen.body.seenAt);
    expect(page.items.every((i) => !i.unread)).toBe(true);
    // Monotone: an older mark leaves it.
    const older = await ramnique.post('/v1/activity/seen', { at: '2020-01-01T00:00:00.000Z' });
    expect(older.body.seenAt).toBe(seen.body.seenAt);
  });

  it('a deleted message leaves the feed; my own messages never enter it', async () => {
    const del = await harsh.post(`/v1/spaces/${main}/messages/${h1.id}/delete`, { actingMode: 'direct' });
    expect(del.status).toBe(200);
    const ids = (await activity(ramnique)).items.map((i) => i.id);
    expect(ids).not.toContain(`m:${h1.id}`);
    expect(ids).toHaveLength(6);
    // Harsh's own view: the @here, my DM reply to him, and arjun's reply in a thread he follows (he replied in it).
    expect(kinds(await activity(harsh))).toEqual(['here', 'dm', 'reply']);
  });

  it('the agent face reads it in one call, names resolved', async () => {
    const agent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
    const out = await callStructured<{ items: Array<{ kind: string; message: Message; actors: Array<{ memberId: string; displayName: string }> }>; truncated: boolean }>(
      agent,
      'read_activity',
      { kinds: ['mention', 'reply'], limit: 10 },
    );
    expect(readActivity.output.safeParse(out).success).toBe(true);
    expect(out.truncated).toBe(false);
    expect(out.items.map((i) => i.kind)).toEqual(['mention', 'reply']);
    expect(out.items[0]!.message.body).toBe('in-thread [@Ramnique](#member:ramnique) ping');
    expect(out.items[0]!.actors[0]).toMatchObject({ memberId: 'harsh', displayName: 'Harsh' });
    await agent.close();
  });
});
