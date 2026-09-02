import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMember } from '../src/auth.js';
import { SpaceHub } from '../src/hub.js';
import { PgStore } from '../src/pg-store.js';
import { extractSearchText } from '../src/search.js';
import { HarborService } from '../src/service.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';

// Space search on real Postgres (migration 012): the GIN-backed queries, the
// generated-column invariants (tombstone/edit reindex with zero code), query-
// time mention expansion against the live roster, asset extraction, and the
// boot backfill. Service-level on purpose — both faces are thin over search().

let db: SqlDb;
let store: PgStore;
let service: HarborService;
let spaceId: string;

const ram = { memberId: 'ramnique' };
const harsh = { memberId: 'harshv01' };

beforeAll(async () => {
  db = await pgliteDb();
  store = new PgStore(db);
  await store.init();
  service = new HarborService(store, new SpaceHub(), { name: 'Search Org', address: 'search.test' });
  await ensureMember(store, 'ramnique');
  await store.putMember({ id: 'harshv01', displayName: 'Harsh Verma', role: 'member' });
  const space = await service.createSpace(ram, 'Search Space');
  spaceId = space.id;
  const invite = await service.createInvite(ram, spaceId);
  await service.acceptInvite(harsh, invite.token);
});

afterAll(async () => {
  await db.close();
});

describe('message search', () => {
  it('ANDs words, prefix-matches the final term, returns newest first', async () => {
    await service.postMessage(ram, spaceId, { body: 'The deploy pipeline is green again', actingMode: 'direct' });
    await service.postMessage(ram, spaceId, { body: 'Deploy is blocked on the billing migration', actingMode: 'direct' });
    await service.postMessage(ram, spaceId, { body: 'Lunch options thread', actingMode: 'direct' });

    const both = await service.search(ram, spaceId, 'deploy');
    expect(both.messages.map((m) => m.snippet)).toEqual([
      'Deploy is blocked on the billing migration',
      'The deploy pipeline is green again',
    ]);

    const anded = await service.search(ram, spaceId, 'deploy pipeline');
    expect(anded.messages.length).toBe(1);
    expect(anded.messages[0]!.snippet).toContain('pipeline');

    // "pipe" (live typing) prefix-matches "pipeline"; "ploy" matches nothing.
    expect((await service.search(ram, spaceId, 'pipe')).messages.length).toBe(1);
    expect((await service.search(ram, spaceId, 'ploy')).messages.length).toBe(0);
  });

  it('expands member names to mention ids at query time — rename-safe', async () => {
    const posted = await service.postMessage(ram, spaceId, {
      body: 'hey @harshv01 can you review the invite flow?',
      actingMode: 'direct',
    });

    // "harsh" is nobody's literal word in the body — it matches via the roster.
    const byName = await service.search(ram, spaceId, 'harsh review');
    expect(byName.messages.map((m) => m.messageId)).toContain(posted.message.id);
    // Words of a multi-word display name resolve independently.
    expect((await service.search(ram, spaceId, 'verma')).messages.length).toBe(1);

    // Rename: the index never stored a name, so the new name works instantly
    // and the old one stops matching.
    await store.putMember({ id: 'harshv01', displayName: 'Hrsvrn', role: 'member' });
    expect((await service.search(ram, spaceId, 'hrsvrn review')).messages.length).toBe(1);
    expect((await service.search(ram, spaceId, 'verma')).messages.length).toBe(0);
    await store.putMember({ id: 'harshv01', displayName: 'Harsh Verma', role: 'member' });
  });

  it('tombstones and edits reindex via the generated column, no code involved', async () => {
    const posted = await service.postMessage(harsh, spaceId, { body: 'ephemeral zanzibar detail', actingMode: 'agent' });
    expect((await service.search(ram, spaceId, 'zanzibar')).messages.length).toBe(1);

    await service.editMessage(harsh, spaceId, posted.message.id, { body: 'ephemeral madagascar detail', actingMode: 'agent' });
    expect((await service.search(ram, spaceId, 'zanzibar')).messages.length).toBe(0);
    expect((await service.search(ram, spaceId, 'madagascar')).messages.length).toBe(1);

    await service.deleteMessage(harsh, spaceId, posted.message.id, { actingMode: 'agent' });
    expect((await service.search(ram, spaceId, 'madagascar')).messages.length).toBe(0);
  });

  it('joins thread + topic context at query time', async () => {
    const root = await service.postMessage(ram, spaceId, { body: 'Quarterly kickoff agenda draft', actingMode: 'direct' });
    const reply = await service.postMessage(harsh, spaceId, {
      threadRoot: root.message.id,
      body: 'agenda addendum: budget review',
      actingMode: 'direct',
    });
    await service.createTopic(ram, spaceId, { rootMessageId: root.message.id, title: 'Q3 Kickoff', actingMode: 'direct' });

    const hits = await service.search(ram, spaceId, 'agenda');
    const replyHit = hits.messages.find((m) => m.messageId === reply.message.id);
    expect(replyHit?.threadRootId).toBe(root.message.id);
    expect(replyHit?.topicTitle).toBe('Q3 Kickoff');

    // Topic titles are their own category.
    const topicHits = await service.search(ram, spaceId, 'kickoff');
    expect(topicHits.topics.map((t) => t.topic.title)).toContain('Q3 Kickoff');
  });
});

describe('asset search', () => {
  it('matches extracted content with a snippet, and filenames without one', async () => {
    await service.proposeChange(ram, spaceId, {
      assetPath: 'notes/roadmap.md',
      baseVersion: 0,
      newContent: '# Roadmap\nGardening agents ship in October.',
      reason: 'seed',
      actingMode: 'direct',
    });

    const byContent = await service.search(ram, spaceId, 'gardening');
    expect(byContent.assets.length).toBe(1);
    expect(byContent.assets[0]!.path).toBe('notes/roadmap.md');
    expect(byContent.assets[0]!.snippet).toContain('Gardening');

    const byName = await service.search(ram, spaceId, 'roadmap');
    expect(byName.assets.map((a) => a.path)).toContain('notes/roadmap.md');
  });

  it('indexes whiteboard text elements, never Excalidraw geometry JSON', async () => {
    const board = JSON.stringify({
      type: 'excalidraw',
      elements: [
        { type: 'rectangle', strokeColor: '#1e1e1e', width: 200 },
        { type: 'text', text: 'Auth flow v2', strokeColor: '#1e1e1e' },
        { type: 'frame', name: 'Login screens' },
      ],
    });
    await service.proposeChange(ram, spaceId, {
      assetPath: 'boards/auth.excalidraw',
      baseVersion: 0,
      newContent: board,
      reason: 'board',
      actingMode: 'direct',
    });

    expect((await service.search(ram, spaceId, 'auth flow')).assets.length).toBe(1);
    expect((await service.search(ram, spaceId, 'login screens')).assets.length).toBe(1);
    // Geometry noise is not searchable text.
    const noise = await service.search(ram, spaceId, 'strokecolor');
    expect(noise.assets.length).toBe(0);
  });

  it('follows renames and drops deleted files at query time — the index never moves', async () => {
    await service.proposeChange(ram, spaceId, {
      assetPath: 'scratch.md',
      baseVersion: 0,
      newContent: 'contains a very findable xylophone',
      reason: 'seed',
      actingMode: 'direct',
    });
    await service.moveAsset(ram, spaceId, {
      fromPath: 'scratch.md',
      toPath: 'archive/keep.md',
      baseVersion: 1,
      reason: 'tidy',
      actingMode: 'direct',
    });
    const moved = await service.search(ram, spaceId, 'xylophone');
    expect(moved.assets.map((a) => a.path)).toEqual(['archive/keep.md']);

    await service.deleteAsset(ram, spaceId, { path: 'archive/keep.md', baseVersion: 1, reason: 'done', actingMode: 'direct' });
    expect((await service.search(ram, spaceId, 'xylophone')).assets.length).toBe(0);
  });

  it('boot backfill re-derives missing rows from asset heads', async () => {
    await db.query('delete from asset_search', []);
    expect((await service.search(ram, spaceId, 'gardening')).assets.length).toBe(0);
    const filled = await store.backfillAssetSearch();
    expect(filled).toBeGreaterThan(0);
    expect((await service.search(ram, spaceId, 'gardening')).assets.length).toBe(1);
  });
});

describe('shape and scoping', () => {
  it('honors kinds and per-category limit with truncated flags', async () => {
    for (let i = 0; i < 4; i++) {
      await service.postMessage(ram, spaceId, { body: `flamingo sighting number ${i}`, actingMode: 'direct' });
    }
    const capped = await service.search(ram, spaceId, 'flamingo', { limit: 2 });
    expect(capped.messages.length).toBe(2);
    expect(capped.truncated.messages).toBe(true);

    const only = await service.search(ram, spaceId, 'flamingo', { kinds: ['assets'] });
    expect(only.messages.length).toBe(0);
    expect(only.assets.length).toBe(0);
  });

  it('refuses non-members and returns empty for a term-free query', async () => {
    await ensureMember(store, 'outsider');
    await expect(service.search({ memberId: 'outsider' }, spaceId, 'deploy')).rejects.toMatchObject({ code: 'forbidden' });
    const empty = await service.search(ram, spaceId, '  ~~ !! ');
    expect(empty.messages).toEqual([]);
    expect(empty.truncated.messages).toBe(false);
  });
});

describe('extractSearchText', () => {
  it('passes prose through, strips generic JSON to string leaves', () => {
    expect(extractSearchText('a.md', '# Hello world')).toBe('# Hello world');
    const json = JSON.stringify({ title: 'Budget 2027', nested: { note: 'draft only', count: 7 } });
    const out = extractSearchText('data.json', json);
    expect(out).toContain('Budget 2027');
    expect(out).toContain('draft only');
    expect(out).not.toContain('count');
  });
});
