import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseMentions, type Message, type ServerFrame, type Space } from '@rowboat/spaces-protocol';
import { SpaceHub } from '../src/hub.js';
import { MemoryStore } from '../src/memory-store.js';
import { Notifier, buildNotifyText, classifyFor, decideNotifications, type Notification } from '../src/notify.js';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { liveClient, restClient } from './helpers.js';
import { pgliteDb } from './pglite.js';

// Notifications (2026-09-10): the org decides once who a message reaches and
// why — off the stamp and the thread's followers, never the text — and the
// decision rides the member channel as a `notify` frame (and push.ts to
// phones). Unit half over MemoryStore; wire half on both stores, watching
// the frames land on the right sockets and nobody else's.

const SPACE = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
const ROOT = '01HXXXXXXXXXXXXXXXXXXXXXXX';

const space = (kind: 'shared' | 'direct'): Space =>
  ({ id: SPACE, name: 'general', createdAt: new Date().toISOString(), kind }) as Space;

const msg = (body: string, author = 'harsh', opts: { agent?: boolean; threadRoot?: string } = {}): Message =>
  ({
    id: '01HYYYYYYYYYYYYYYYYYYYYYYY',
    spaceId: SPACE,
    ...(opts.threadRoot ? { threadRoot: opts.threadRoot } : {}),
    author: { memberId: author, actingMode: opts.agent ? 'agent' : 'direct', ...(opts.agent ? { agentName: 'Rowboat' } : {}) },
    body,
    postedAt: new Date().toISOString(),
    offset: 2,
    replyCount: 0,
    reactions: [],
    ...(({ members, here, rowboat }) => ({ mentions: members, mentionsHere: here, mentionsRowboat: rowboat }))(parseMentions(body)),
  }) as Message;

describe('classification', () => {
  const none = new Set<string>();
  const gaganFollows = new Set(['gagan']);

  it('mention > here > dm > reply > message; only tokens address, tokens in code are cites', () => {
    expect(classifyFor('gagan', space('shared'), msg('hello [@Gagan](#member:gagan)'), none)).toBe('mention');
    expect(classifyFor('gagan', space('shared'), msg('hi [@here](#here) everyone'), none)).toBe('here');
    expect(classifyFor('gagan', space('shared'), msg('[@here](#here) and [@Gagan](#member:gagan)'), none)).toBe('mention');
    expect(classifyFor('gagan', space('direct'), msg('just words'), none)).toBe('dm');
    expect(classifyFor('gagan', space('direct'), msg('ping [@Gagan](#member:gagan)'), none)).toBe('mention');
    expect(classifyFor('gagan', space('direct'), msg('reply', 'harsh', { threadRoot: ROOT }), gaganFollows)).toBe('dm');
    expect(classifyFor('gagan', space('shared'), msg('reply', 'harsh', { threadRoot: ROOT }), gaganFollows)).toBe('reply');
    expect(classifyFor('gagan', space('shared'), msg('reply', 'harsh', { threadRoot: ROOT }), none)).toBe('message');
    expect(classifyFor('gagan', space('shared'), msg('a root'), gaganFollows)).toBe('message');
    expect(classifyFor('gagan', space('shared'), msg('a bare @gagan is prose, not an address'), none)).toBe('message');
    expect(classifyFor('gagan', space('shared'), msg('`[@Gagan](#member:gagan)` in code'), none)).toBe('message');
    expect(classifyFor('gagan', space('shared'), msg('```\n[@Gagan](#member:gagan)\n```'), none)).toBe('message');
    expect(classifyFor('gagan', space('shared'), msg('[@rowboat](#rowboat) summarize'), none)).toBe('message');
  });

  it('titles name the person in a DM and the space elsewhere; mentions in the body resolve to names', () => {
    const names = new Map([['harsh', 'Harsh'], ['gagan', 'Gagan']]);
    const t = (kind: Notification['kind'], kindSpace = space('shared')) =>
      buildNotifyText({ kind, space: kindSpace, authorName: 'Harsh', body: 'hi [@G](#member:gagan)', names });
    expect(t('message')).toEqual({ title: 'Harsh · general', body: 'hi @Gagan' });
    expect(t('mention').title).toBe('Harsh mentioned you · general');
    expect(t('here').title).toBe('Harsh · general');
    expect(t('reply').title).toBe('Harsh replied in a thread · general');
    expect(t('dm', space('direct')).title).toBe('Harsh');
    expect(t('mention', space('direct')).title).toBe('Harsh mentioned you');
  });
});

describe('decideNotifications + Notifier (memory store)', () => {
  async function setup() {
    const store = new MemoryStore();
    const s = space('shared');
    await store.putSpace(s);
    for (const id of ['harsh', 'gagan', 'arjun']) {
      await store.putMember({ id, displayName: id[0]!.toUpperCase() + id.slice(1), role: 'member' });
      await store.putMembership({ spaceId: s.id, memberId: id, joinedAt: new Date().toISOString() });
    }
    await store.setThreadFollowing(s.id, ROOT, 'gagan', true, new Date().toISOString());
    return { store, s };
  }
  const byMember = (rows: Notification[]) => Object.fromEntries(rows.map((r) => [r.memberId, r.kind]));

  it('a reply reaches its followers as reply and everyone else as message; the direct author is left out', async () => {
    const { store, s } = await setup();
    const rows = await decideNotifications(store, s, msg('a reply', 'harsh', { threadRoot: ROOT }));
    expect(byMember(rows)).toEqual({ gagan: 'reply', arjun: 'message' });
    expect(rows.find((r) => r.memberId === 'gagan')).toMatchObject({ title: 'Harsh replied in a thread · general', body: 'a reply' });
  });

  it('a mention outranks following; your own agent addressing you counts', async () => {
    const { store, s } = await setup();
    expect(byMember(await decideNotifications(store, s, msg('[@Gagan](#member:gagan) look', 'harsh', { threadRoot: ROOT })))).toEqual({
      gagan: 'mention',
      arjun: 'message',
    });
    // Harsh's agent posts, naming Harsh: the agent's act, so Harsh is a recipient.
    expect(byMember(await decideNotifications(store, s, msg('done, [@Harsh](#member:harsh)', 'harsh', { agent: true })))).toEqual({
      harsh: 'mention',
      gagan: 'message',
      arjun: 'message',
    });
  });

  it('frames go to every reason but message; push gets every row', async () => {
    const { store, s } = await setup();
    const hub = new SpaceHub();
    const got = new Map<string, ServerFrame[]>();
    for (const id of ['harsh', 'gagan', 'arjun']) {
      got.set(id, []);
      hub.subscribeMember(id, (frame) => got.get(id)!.push(frame));
    }
    const pushed: Notification[][] = [];
    const push = { send: async (_s: Space, _m: Message, rows: readonly Notification[]) => void pushed.push([...rows]) };
    const notifier = new Notifier(store, hub, push as never);
    const message = msg('[@here](#here) standup in 5', 'harsh', { threadRoot: ROOT });
    await notifier.onMessage(s, message);
    expect(got.get('harsh')).toEqual([]);
    expect(got.get('gagan')).toHaveLength(1);
    expect(got.get('arjun')).toHaveLength(1);
    expect(got.get('gagan')![0]).toMatchObject({
      kind: 'notify',
      spaceId: s.id,
      threadRootId: ROOT,
      messageId: message.id,
      reason: 'here',
      author: { memberId: 'harsh', actingMode: 'direct' },
      title: 'Harsh · general',
      body: '@here standup in 5',
    });
    expect(pushed).toEqual([[expect.objectContaining({ memberId: 'gagan', kind: 'here' }), expect.objectContaining({ memberId: 'arjun', kind: 'here' })]]);

    // A plain root: nobody hears a frame, push still sees the rows (its `all` level).
    await notifier.onMessage(s, msg('plain root', 'harsh'));
    expect(got.get('gagan')).toHaveLength(1);
    expect(pushed[1]!.map((r) => r.kind)).toEqual(['message', 'message']);
  });

  it('a failing push never surfaces past the notifier', async () => {
    const { store, s } = await setup();
    const hub = new SpaceHub();
    const push = { send: async () => { throw new Error('expo down'); } };
    const notifier = new Notifier(store, hub, push as never);
    await expect(notifier.onMessage(s, msg('[@Gagan](#member:gagan)', 'harsh'))).resolves.toBeUndefined();
  });
});

// --- wire ---------------------------------------------------------------------

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

type Notify = Extract<ServerFrame, { kind: 'notify' }>;
const notifies = (frames: ServerFrame[]): Notify[] => frames.filter((f): f is Notify => f.kind === 'notify');

async function post(client: ReturnType<typeof restClient>, spaceId: string, body: string, extra: Record<string, unknown> = {}): Promise<Message> {
  const r = await client.post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

describe.each([['memory'], ['postgres']] as const)('notify frames on the wire (%s store)', (storeKind) => {
  let liveR: Awaited<ReturnType<typeof liveClient>>;
  let liveH: Awaited<ReturnType<typeof liveClient>>;
  let liveA: Awaited<ReturnType<typeof liveClient>>;

  beforeAll(async () => {
    await startForStore(storeKind);
    liveR = await liveClient(harbor, 'dev-ramnique');
    liveH = await liveClient(harbor, 'dev-harsh');
    liveA = await liveClient(harbor, 'dev-arjun');
  });
  afterAll(async () => {
    liveR.close();
    liveH.close();
    liveA.close();
    await harbor.close();
    await sqlDb?.close();
  });

  it('a mention reaches the named member on their member channel, nobody else', async () => {
    const root = await post(ramnique, main, 'hey [@Harsh](#member:harsh) look');
    await liveH.until((f) => notifies(f).length === 1, "harsh's notify");
    expect(notifies(liveH.frames)[0]).toMatchObject({
      spaceId: main,
      messageId: root.id,
      reason: 'mention',
      author: { memberId: 'ramnique', actingMode: 'direct' },
      title: 'Ramnique mentioned you · Main',
      body: 'hey @Harsh look',
    });
    expect(notifies(liveH.frames)[0]!.threadRootId).toBeUndefined();
    expect(notifies(liveA.frames)).toEqual([]);
    expect(notifies(liveR.frames)).toEqual([]);
  });

  it('a reply reaches the thread’s followers: the mentioned member and the root’s author, not the replier', async () => {
    const root = await post(ramnique, main, 'thread [@Harsh](#member:harsh)');
    await liveH.until((f) => notifies(f).length === 2, "harsh's second notify");
    const reply = await post(arjun, main, 'a reply from arjun', { threadRoot: root.id });
    await liveH.until((f) => notifies(f).length === 3, "harsh's reply notify");
    await liveR.until((f) => notifies(f).length === 1, "ramnique's reply notify");
    expect(notifies(liveH.frames)[2]).toMatchObject({ reason: 'reply', threadRootId: root.id, messageId: reply.id, title: 'Arjun replied in a thread · Main' });
    expect(notifies(liveR.frames)[0]).toMatchObject({ reason: 'reply', threadRootId: root.id, messageId: reply.id });
    expect(notifies(liveA.frames)).toEqual([]);
  });

  it('@here reaches everyone but the poster; a plain root reaches nobody', async () => {
    const before = { r: notifies(liveR.frames).length, a: notifies(liveA.frames).length, h: notifies(liveH.frames).length };
    await post(harsh, main, '[@here](#here) standup');
    await liveR.until((f) => notifies(f).length === before.r + 1, "ramnique's here");
    await liveA.until((f) => notifies(f).length === before.a + 1, "arjun's here");
    expect(notifies(liveA.frames).at(-1)).toMatchObject({ reason: 'here', title: 'Harsh · Main', body: '@here standup' });
    expect(notifies(liveH.frames)).toHaveLength(before.h);
    await post(harsh, main, 'nothing to see');
    await post(harsh, main, 'still nothing');
    await liveA.until((f) => f.filter((x) => x.kind === 'event').length >= 0); // let the loop turn
    expect(notifies(liveR.frames)).toHaveLength(before.r + 1);
    expect(notifies(liveA.frames)).toHaveLength(before.a + 1);
  });

  it('every DM message reaches the other person, titled by name', async () => {
    const dm = (await ramnique.post('/v1/direct', { memberId: 'arjun' })).body.space as Space;
    const before = notifies(liveA.frames).length;
    const m = await post(ramnique, dm.id, 'just words');
    await liveA.until((f) => notifies(f).length === before + 1, "arjun's dm notify");
    expect(notifies(liveA.frames).at(-1)).toMatchObject({ spaceId: dm.id, messageId: m.id, reason: 'dm', title: 'Ramnique', body: 'just words' });
  });
});
