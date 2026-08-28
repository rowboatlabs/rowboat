import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message, Topic, TopicListing } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';
import { agentClient, callStructured } from './helpers.js';

// Message pagination (v0 breaking change, by decision — dogfooding, no legacy
// mode): listMessages returns the NEWEST page by default, never the full
// history; beforeOffset pages back; listTopics always folds each topic's
// first message in. Runs on both stores, the §11 dual gate.

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let spaceId: string;
let topicId: string;
let posted: Message[];

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

describe.each([['memory'], ['postgres']] as const)('message pagination (%s store)', (storeKind) => {
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
    // Seven messages in one topic: the seed plus six replies.
    posted = [];
    const first = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { body: 'm1 — the opener', actingMode: 'direct' });
    topicId = first.body.topic.id;
    posted.push(first.body.message);
    for (let i = 2; i <= 7; i += 1) {
      const res = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { topicId, body: `m${i}`, actingMode: 'direct' });
      posted.push(res.body.message);
    }
  });

  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('returns the latest page by default (never full history), oldest first within the window', async () => {
    const res = await ramnique.get(`/v1/spaces/${spaceId}/topics/${topicId}/messages?limit=3`);
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    expect((res.body.messages as Message[]).map((m) => m.body)).toEqual(['m5', 'm6', 'm7']);
  });

  it('a window that covers everything says hasMore: false', async () => {
    const res = await ramnique.get(`/v1/spaces/${spaceId}/topics/${topicId}/messages?limit=200`);
    expect(res.body.hasMore).toBe(false);
    expect((res.body.messages as Message[]).map((m) => m.body)).toEqual(['m1 — the opener', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('beforeOffset pages back to the start, offsets as the cursor', async () => {
    const all: Message[] = [];
    let before: number | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const q = before !== undefined ? `&beforeOffset=${before}` : '';
      const res = await ramnique.get(`/v1/spaces/${spaceId}/topics/${topicId}/messages?limit=3${q}`);
      all.unshift(...(res.body.messages as Message[]));
      if (!res.body.hasMore) break;
      before = (res.body.messages as Message[])[0]!.offset;
    }
    expect(all.map((m) => m.body)).toEqual(['m1 — the opener', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    // Every page is disjoint and complete — nothing duplicated, nothing lost.
    expect(new Set(all.map((m) => m.id)).size).toBe(7);
  });

  it('reactions are folded live on windowed reads', async () => {
    const target = posted[6]!;
    await ramnique.post(`/v1/spaces/${spaceId}/messages/${target.id}/reactions`, { emoji: '👍', action: 'add', actingMode: 'direct' });
    const res = await ramnique.get(`/v1/spaces/${spaceId}/topics/${topicId}/messages?limit=2`);
    const m7 = (res.body.messages as Message[]).find((m) => m.id === target.id);
    expect(m7?.reactions).toEqual([{ emoji: '👍', memberIds: ['ramnique'] }]);
  });

  it('listTopics always carries each topic firstMessage', async () => {
    const res = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    const listing = (res.body.topics as TopicListing[]).find((t) => t.id === topicId);
    expect(listing?.firstMessage?.id).toBe(posted[0]!.id);
    expect(listing?.firstMessage?.body).toBe('m1 — the opener');
  });

  it('read_topic (MCP) windows the same way and states truncation', async () => {
    const agent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
    const page = await callStructured<{ topic: Topic; messages: Message[]; truncated: boolean }>(agent, 'read_topic', {
      spaceId, topicId, limit: 2,
    });
    expect(page.truncated).toBe(true);
    expect(page.messages.map((m) => m.body)).toEqual(['m6', 'm7']);
    const older = await callStructured<{ messages: Message[]; truncated: boolean }>(agent, 'read_topic', {
      spaceId, topicId, limit: 2, beforeOffset: page.messages[0]!.offset,
    });
    expect(older.messages.map((m) => m.body)).toEqual(['m4', 'm5']);
    await agent.close();
  });
});
