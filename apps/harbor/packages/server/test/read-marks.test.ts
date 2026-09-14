import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message, ServerFrame } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { liveClient, restClient } from './helpers.js';
import { pgliteDb } from './pglite.js';

// Read state (2026-09-09): per-member cursors the org owns, in OFFSETS —
// a stream mark per space plus a mark per FOLLOWED thread. Runs on both
// stores: the monotone upserts are SQL on Postgres and map logic in memory,
// and the counts must agree.

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

async function post(client: ReturnType<typeof restClient>, body: string, threadRoot?: string): Promise<Message> {
  const r = await client.post(`/v1/spaces/${main}/messages`, {
    body,
    actingMode: 'direct',
    ...(threadRoot ? { threadRoot } : {}),
  });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

async function unreadOf(client: ReturnType<typeof restClient>) {
  const r = await client.get('/v1/unread');
  expect(r.status).toBe(200);
  const space = (r.body.spaces as Array<{ spaceId: string }>).find((s) => s.spaceId === main);
  return space as { head: number; readOffset: number; unreadRoots: number; threads: Array<{ rootMessageId: string; readOffset: number; lastReplyOffset: number; unreadReplies: number }> } | undefined;
}

describe.each([['memory'], ['postgres']] as const)('read marks (%s store)', (storeKind) => {
  let r4: Message;
  let arjunReply: Message;

  beforeAll(async () => {
    await startForStore(storeKind);
  });

  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('a fresh member has a zero mark and nothing unread', async () => {
    const u = await unreadOf(ramnique);
    expect(u).toMatchObject({ readOffset: 0, unreadRoots: 0, threads: [] });
    expect(u!.head).toBeGreaterThan(0); // the joined events
  });

  it("others' roots count; your own post reads the stream up to itself", async () => {
    const r1 = await post(harsh, 'first');
    const r2 = await post(harsh, 'second');
    expect((await unreadOf(ramnique))!.unreadRoots).toBe(2);
    // Harsh's mark rode his own posts: nothing unread, mark at his newest root.
    expect(await unreadOf(harsh)).toMatchObject({ unreadRoots: 0, readOffset: r2.offset });
    expect(r1.offset).toBeLessThan(r2.offset);

    const r3 = await post(ramnique, 'third');
    expect(await unreadOf(ramnique)).toMatchObject({ unreadRoots: 0, readOffset: r3.offset });
    // Harsh's mark sits at r2; ramnique's r3 is past it.
    expect((await unreadOf(harsh))!.unreadRoots).toBe(1);
  });

  it('marking advances, never regresses, and refuses an offset past head', async () => {
    r4 = await post(harsh, 'fourth');
    expect((await unreadOf(ramnique))!.unreadRoots).toBe(1);

    const marked = await ramnique.post(`/v1/spaces/${main}/read`, { offset: r4.offset });
    expect(marked.body).toEqual({ readOffset: r4.offset });
    expect(await unreadOf(ramnique)).toMatchObject({ unreadRoots: 0, readOffset: r4.offset });

    const regress = await ramnique.post(`/v1/spaces/${main}/read`, { offset: 1 });
    expect(regress.body).toEqual({ readOffset: r4.offset });

    const head = (await unreadOf(ramnique))!.head;
    const past = await ramnique.post(`/v1/spaces/${main}/read`, { offset: head + 100 });
    expect(past.status).toBe(400);
    expect(past.body.code).toBe('invalid_request');

    const stream = await ramnique.get(`/v1/spaces/${main}/stream`);
    expect(stream.body.readOffset).toBe(r4.offset);
  });

  it("replying follows the thread; the root's author follows from the first reply on", async () => {
    arjunReply = await post(arjun, 'reply from arjun', r4.id);
    const arjunThread = await arjun.get(`/v1/spaces/${main}/threads/${r4.id}`);
    expect(arjunThread.body).toMatchObject({ following: true, readOffset: arjunReply.offset });
    expect(arjunThread.body.root.lastReplyOffset).toBe(arjunReply.offset);
    // Arjun's own reply is not unread for him.
    expect((await unreadOf(arjun))!.threads).toEqual([]);

    // Harsh authored r4: he now follows it, from the root, with one unread reply.
    expect((await unreadOf(harsh))!.threads).toEqual([
      { rootMessageId: r4.id, readOffset: r4.offset, lastReplyOffset: arjunReply.offset, unreadReplies: 1, unreadMentions: 0 },
    ]);
    // Ramnique never touched the thread: not following, no mark.
    const ramniqueThread = await ramnique.get(`/v1/spaces/${main}/threads/${r4.id}`);
    expect(ramniqueThread.body).toMatchObject({ following: false, readOffset: null });
    expect((await unreadOf(ramnique))!.threads).toEqual([]);
  });

  it('a thread mark clears it; an unfollowed thread takes a mark too, without following', async () => {
    const marked = await harsh.post(`/v1/spaces/${main}/read`, { threadRootId: r4.id, offset: arjunReply.offset });
    expect(marked.body).toEqual({ readOffset: arjunReply.offset });
    expect((await unreadOf(harsh))!.threads).toEqual([]);

    // Ramnique reads the thread without following it (2026-09-11): the mark
    // is kept — Activity needs it — but the thread still badges nobody.
    const unfollowed = await ramnique.post(`/v1/spaces/${main}/read`, { threadRootId: r4.id, offset: arjunReply.offset });
    expect(unfollowed.body).toEqual({ readOffset: arjunReply.offset });
    expect((await ramnique.get(`/v1/spaces/${main}/threads/${r4.id}`)).body).toMatchObject({ following: false, readOffset: arjunReply.offset });
    expect((await unreadOf(ramnique))!.threads).toEqual([]);
    // A reply's id marks its thread (resolves to the root).
    const viaReply = await harsh.post(`/v1/spaces/${main}/read`, { threadRootId: arjunReply.id, offset: arjunReply.offset });
    expect(viaReply.body).toEqual({ readOffset: arjunReply.offset });
  });

  it('unfollowing hides the thread; re-following keeps the mark', async () => {
    const h1 = await post(harsh, 'reply from harsh', r4.id);
    expect((await unreadOf(arjun))!.threads).toEqual([
      { rootMessageId: r4.id, readOffset: arjunReply.offset, lastReplyOffset: h1.offset, unreadReplies: 1, unreadMentions: 0 },
    ]);

    const off = await arjun.post(`/v1/spaces/${main}/threads/${r4.id}/follow`, { following: false });
    expect(off.body).toEqual({ following: false, readOffset: arjunReply.offset });
    expect((await unreadOf(arjun))!.threads).toEqual([]);
    // Ramnique's unfollowed mark advances like any other, and still badges nothing.
    expect((await ramnique.post(`/v1/spaces/${main}/read`, { threadRootId: r4.id, offset: h1.offset })).body).toEqual({ readOffset: h1.offset });
    expect((await unreadOf(ramnique))!.threads).toEqual([]);

    const on = await arjun.post(`/v1/spaces/${main}/threads/${r4.id}/follow`, { following: true });
    expect(on.body).toEqual({ following: true, readOffset: arjunReply.offset });
    expect((await unreadOf(arjun))!.threads).toMatchObject([{ rootMessageId: r4.id, unreadReplies: 1 }]);
  });

  it('a deleted reply stops counting', async () => {
    const h2 = await post(harsh, 'oops', r4.id);
    expect((await unreadOf(arjun))!.threads[0]!.unreadReplies).toBe(2);
    const del = await harsh.post(`/v1/spaces/${main}/messages/${h2.id}/delete`, { actingMode: 'direct' });
    expect(del.status).toBe(200);
    const after = (await unreadOf(arjun))!.threads[0]!;
    expect(after.unreadReplies).toBe(1);
    expect(after.lastReplyOffset).toBeLessThan(h2.offset);
  });

  it("an agent's post does not read the stream for its member", async () => {
    const before = (await unreadOf(harsh))!.readOffset;
    const r = await harsh.post(`/v1/spaces/${main}/messages`, { body: 'digest', actingMode: 'agent', agentName: 'Rowboat' });
    expect(r.status).toBe(200);
    expect((await unreadOf(harsh))!.readOffset).toBe(before);
    // ...but it is a root by someone else for everyone else.
    expect((await unreadOf(ramnique))!.unreadRoots).toBeGreaterThan(0);
  });

  it("marks echo to the member's other connections, and to nobody else", async () => {
    const mine = await liveClient(harbor, 'dev-ramnique');
    const theirs = await liveClient(harbor, 'dev-harsh');
    const head = (await unreadOf(ramnique))!.head;
    const marked = await ramnique.post(`/v1/spaces/${main}/read`, { offset: head });
    expect(marked.body).toEqual({ readOffset: head });
    await mine.until((frames) => frames.some((f) => f.kind === 'read_mark'), 'read_mark frame');
    const frame = mine.frames.find((f): f is Extract<ServerFrame, { kind: 'read_mark' }> => f.kind === 'read_mark')!;
    expect(frame).toMatchObject({ spaceId: main, offset: head });
    expect(frame.threadRootId).toBeUndefined();

    const threadMark = await ramnique.post(`/v1/spaces/${main}/threads/${r4.id}/follow`, { following: true });
    expect(threadMark.body.following).toBe(true);
    await ramnique.post(`/v1/spaces/${main}/read`, { threadRootId: r4.id, offset: head });
    await mine.until((frames) => frames.some((f) => f.kind === 'read_mark' && f.threadRootId === r4.id), 'thread read_mark');
    expect(theirs.frames.filter((f) => f.kind === 'read_mark')).toEqual([]);
    mine.close();
    theirs.close();
  });

  it('leaving drops the marks', async () => {
    expect((await arjun.post(`/v1/spaces/${main}/leave`)).status).toBe(200);
    expect((await arjun.get('/v1/unread')).body.spaces.map((s: { spaceId: string }) => s.spaceId)).not.toContain(main);
    const invite = await ramnique.post('/v1/invites', { spaceId: main });
    expect((await arjun.post('/v1/invites/accept', { token: invite.body.token })).status).toBe(200);
    expect((await arjun.get(`/v1/spaces/${main}/stream`)).body.readOffset).toBe(0);
    expect((await arjun.get(`/v1/spaces/${main}/threads/${r4.id}`)).body).toMatchObject({ following: false, readOffset: null });
  });
});
