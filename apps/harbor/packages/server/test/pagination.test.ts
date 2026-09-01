import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message, Topic, TopicListing } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';
import { agentClient, callStructured } from './helpers.js';

// Windowed reads under the annotation model: the stream (roots only) and each
// flat thread page the same way — NEWEST window by default, never the full
// history; beforeOffset pages back on the space's one offset sequence.
// listTopics always folds each topic's root message in. Runs on both stores,
// the §11 dual gate.

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let spaceId: string;
let rootId: string;
let replies: Message[];
let roots: Message[];

function api(token: string) {
  return {
    async get(path: string) {
      const res = await fetch(`${harbor.url}${path}`, { headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, body: (await res.json()) as any };
    },
    async post(path: string, body?: unknown) {
      const res = await fetch(`${harbor.url}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      return { status: res.status, body: (await res.json()) as any };
    },
  };
}

let ramnique: ReturnType<typeof api>;

describe.each([['memory'], ['postgres']] as const)('windowed reads (%s store)', (storeKind) => {
  beforeAll(async () => {
    const options: HarborOptions = {
      orgName: 'Page Test Org',
      seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
    };
    if (storeKind === 'postgres') {
      sqlDb = await pgliteDb();
      const store = new PgStore(sqlDb);
      await store.init();
      options.store = store;
    }
    harbor = await startHarbor(options);
    ramnique = api('dev-ramnique');
    const created = await ramnique.post('/v1/spaces', { name: 'Paging' });
    spaceId = created.body.space.id;
    // Five roots in the stream; the first grows a six-reply thread. Replies
    // interleave with later roots on the one offset sequence — the windows
    // must stay disjoint anyway.
    roots = [];
    replies = [];
    const first = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { body: 'r1 — the opener', actingMode: 'direct' });
    rootId = first.body.message.id;
    roots.push(first.body.message);
    for (let i = 2; i <= 7; i += 1) {
      const reply = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { threadRoot: rootId, body: `reply${i - 1}`, actingMode: 'direct' });
      replies.push(reply.body.message);
      if (i <= 5) {
        const root = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { body: `r${i}`, actingMode: 'direct' });
        roots.push(root.body.message);
      }
    }
  });

  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('the stream returns the latest page of ROOTS by default, oldest first within the window', async () => {
    const res = await ramnique.get(`/v1/spaces/${spaceId}/stream?limit=3`);
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    expect((res.body.messages as Message[]).map((m) => m.body)).toEqual(['r3', 'r4', 'r5']);
  });

  it('a stream window that covers everything says hasMore: false and never leaks replies', async () => {
    const res = await ramnique.get(`/v1/spaces/${spaceId}/stream?limit=200`);
    expect(res.body.hasMore).toBe(false);
    expect((res.body.messages as Message[]).map((m) => m.body)).toEqual(['r1 — the opener', 'r2', 'r3', 'r4', 'r5']);
  });

  it('beforeOffset pages the stream back to the start, offsets as the cursor', async () => {
    const all: Message[] = [];
    let before: number | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const q = before !== undefined ? `&beforeOffset=${before}` : '';
      const res = await ramnique.get(`/v1/spaces/${spaceId}/stream?limit=2${q}`);
      all.unshift(...(res.body.messages as Message[]));
      if (!res.body.hasMore) break;
      before = (res.body.messages as Message[])[0]!.offset;
    }
    expect(all.map((m) => m.body)).toEqual(['r1 — the opener', 'r2', 'r3', 'r4', 'r5']);
    // Every page is disjoint and complete — nothing duplicated, nothing lost.
    expect(new Set(all.map((m) => m.id)).size).toBe(5);
  });

  it('a thread windows its replies the same way', async () => {
    const res = await ramnique.get(`/v1/spaces/${spaceId}/threads/${rootId}?limit=3`);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.root.id).toBe(rootId);
    expect((res.body.messages as Message[]).map((m) => m.body)).toEqual(['reply4', 'reply5', 'reply6']);
    const older = await ramnique.get(
      `/v1/spaces/${spaceId}/threads/${rootId}?limit=3&beforeOffset=${(res.body.messages as Message[])[0]!.offset}`,
    );
    expect(older.body.hasMore).toBe(false);
    expect((older.body.messages as Message[]).map((m) => m.body)).toEqual(['reply1', 'reply2', 'reply3']);
  });

  it('reactions are folded live on windowed reads', async () => {
    const target = replies[5]!;
    await ramnique.post(`/v1/spaces/${spaceId}/messages/${target.id}/reactions`, { emoji: '👍', action: 'add', actingMode: 'direct' });
    const res = await ramnique.get(`/v1/spaces/${spaceId}/threads/${rootId}?limit=2`);
    const hit = (res.body.messages as Message[]).find((m) => m.id === target.id);
    expect(hit?.reactions).toEqual([{ emoji: '👍', memberIds: ['ramnique'] }]);
  });

  it('listTopics always carries each topic rootMessage with its live reply denorm', async () => {
    const made = await ramnique.post(`/v1/spaces/${spaceId}/topics`, {
      rootMessageId: rootId,
      title: 'Decide: the opener thread',
      actingMode: 'direct',
    });
    const res = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    const listing = (res.body.topics as TopicListing[]).find((t) => t.id === made.body.topic.id);
    expect(listing?.rootMessage?.id).toBe(rootId);
    expect(listing?.rootMessage?.replyCount).toBe(6);
    expect(listing?.lastActivityAt).toBe(listing?.rootMessage?.lastReplyAt);
  });

  it('read_stream and read_thread (MCP) window the same way and state truncation', async () => {
    const agent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
    const page = await callStructured<{ messages: Message[]; topics: Topic[]; truncated: boolean }>(agent, 'read_stream', {
      spaceId, limit: 2,
    });
    expect(page.truncated).toBe(true);
    expect(page.messages.map((m) => m.body)).toEqual(['r4', 'r5']);
    const older = await callStructured<{ messages: Message[]; truncated: boolean }>(agent, 'read_stream', {
      spaceId, limit: 2, beforeOffset: page.messages[0]!.offset,
    });
    expect(older.messages.map((m) => m.body)).toEqual(['r2', 'r3']);

    const thread = await callStructured<{ root: Message; topic: Topic | null; messages: Message[]; truncated: boolean }>(
      agent, 'read_thread', { spaceId, rootMessageId: rootId, limit: 2 },
    );
    expect(thread.truncated).toBe(true);
    expect(thread.root.id).toBe(rootId);
    expect(thread.topic?.title).toBe('Decide: the opener thread');
    expect(thread.messages.map((m) => m.body)).toEqual(['reply5', 'reply6']);
    await agent.close();
  });
});
