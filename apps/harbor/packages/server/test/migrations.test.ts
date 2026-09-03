import { describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS } from '../src/migrations.js';
import { PgStore } from '../src/pg-store.js';
import { pgliteDb } from './pglite.js';

// The migration ladder: fresh databases climb it from the bottom; databases
// from the pre-migration era (bootstrap-style schema, no schema_migrations
// table) adopt it by no-opping through 001. Every other suite exercises the
// runner implicitly via PgStore.init().

describe('schema migrations', () => {
  // The full ladder on PGlite takes seconds; the default 5s got too snug.
  it('applies all migrations to a fresh database and records them', { timeout: 20_000 }, async () => {
    const db = await pgliteDb();
    await migrate(db);
    const applied = await db.query<{ id: string }>('select id from schema_migrations order by id');
    expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    // The 002 column exists.
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'members'`,
    );
    expect(cols.map((c) => c.column_name)).toContain('role');
    await db.close();
  });

  it('is idempotent — a second run applies nothing and changes nothing', async () => {
    const db = await pgliteDb();
    await migrate(db);
    const before = await db.query('select id, applied_at from schema_migrations order by id');
    await migrate(db);
    const after = await db.query('select id, applied_at from schema_migrations order by id');
    expect(after).toEqual(before);
    await db.close();
  });

  it('004 + 011 reinterpret the container world end to end: legacy conventions → one stream, pointer threads, annotation topics', { timeout: 20_000 }, async () => {
    const db = await pgliteDb();
    // A pre-004 database: schema through 003, data written under the client
    // conventions the ladder later promotes (004) and reinterprets (011).
    for (const m of MIGRATIONS.slice(0, 3)) for (const s of m.statements) await db.query(s);
    const by = '{"memberId":"ramnique","actingMode":"direct"}';
    const topic = (id: string, title: string, createdAt: string) =>
      db.query(
        `insert into topics (id, space_id, title, created_by, created_at, archived, last_activity_at, message_count)
         values ($1, 's1', $2, '${by}'::jsonb, $3, false, $3, 1)`,
        [id, title, createdAt],
      );
    const message = (id: string, topicId: string, body: string, offset: number) =>
      db.query(
        `insert into messages (id, space_id, topic_id, author, body, posted_at, stream_offset)
         values ($1, 's1', $2, '${by}'::jsonb, $3, '2026-08-20T10:0${offset}:00Z', $4)`,
        [id, topicId, body, offset],
      );
    // The legacy stream, a marker-anchored thread (pre-004 style, with the
    // machine COPY of the parent as its seed), a first-line-titled standalone
    // topic (an accident of the reply gesture), and an explicitly-renamed one.
    await topic('t-gen', 'messages', '2026-08-20T09:00:00Z');
    await topic('t-thread-a', 'The parent text', '2026-08-20T10:01:00Z');
    await topic('t-standalone', 'standalone opener', '2026-08-20T10:02:00Z');
    await topic('t-renamed', 'Decide: renamed goal', '2026-08-20T10:03:00Z');
    await message('msg-parent', 't-gen', 'The parent text', 1);
    await message('seed-a', 't-thread-a', 'The parent text\n\n<!-- rowboat:topic parent=msg:msg-parent by=ramnique at=x -->', 2);
    await message('reply-a1', 't-thread-a', 'first real reply', 3);
    await message('msg-s1', 't-standalone', 'standalone opener', 4);
    await message('reply-s1', 't-standalone', 'standalone reply', 5);
    await message('msg-r1', 't-renamed', 'original opener text', 6);
    await message('reply-r1', 't-renamed', 'renamed reply', 7);
    await message('msg-g2', 't-gen', 'hello world', 8);
    const changeSet = (id: string, reason: string | null, offset: number) =>
      db.query(
        `insert into change_sets (id, space_id, asset_path, base_version, result_version, attribution, reason, committed_at, stream_offset)
         values ($1, 's1', 'roadmap.md', 0, 1, '${by}'::jsonb, $2, '2026-08-20T11:00:00Z', $3)`,
        [id, reason, offset],
      );
    await changeSet('cs-suffixed', 'moved SSO to P1 · topic:t-thread-a', 9);
    await changeSet('cs-plain', 'just a reason', 10);

    await migrate(db);

    const store = new PgStore(db);
    // The stream = every root, at its original offset; replies never leak in.
    const stream = await store.listStream('s1');
    expect(stream.map((m) => m.id)).toEqual(['msg-parent', 'msg-s1', 'msg-r1', 'msg-g2']);
    // The anchored thread re-pointed at the real parent; the machine copy is gone.
    const thread = await store.listThread('s1', 'msg-parent');
    expect(thread.map((m) => m.id)).toEqual(['reply-a1']);
    expect(stream.find((m) => m.id === 'msg-parent')?.replyCount).toBe(1);
    expect(stream.find((m) => m.id === 'msg-parent')?.lastReplyAt).toBe('2026-08-20T10:03:00Z');
    expect((await store.listThread('s1', 'msg-s1')).map((m) => m.id)).toEqual(['reply-s1']);
    // Only the explicitly-renamed topic survives as an annotation row.
    const topics = await store.listTopics('s1', true);
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ id: 't-renamed', rootMessageId: 'msg-r1', title: 'Decide: renamed goal', archived: false });
    // Provenance: the topic id became the thread's root (via 004's suffix parse).
    expect((await store.getChangeSet('s1', 'cs-suffixed'))?.threadRootId).toBe('msg-parent');
    expect((await store.getChangeSet('s1', 'cs-plain'))?.threadRootId).toBeUndefined();
    // The container key is gone from messages.
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'messages'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain('topic_id');
    expect(cols.map((c) => c.column_name)).toContain('thread_root');
    await db.close();
  });

  it('adopts a pre-migration-era database (existing tables, no ledger)', async () => {
    const db = await pgliteDb();
    // Simulate the bootstrap era: 001's objects exist, without the role
    // column, and there is no schema_migrations table.
    for (const statement of MIGRATIONS[0]!.statements) await db.query(statement);
    await db.query(`insert into members (id, display_name) values ('ramnique', 'Ramnique')`);

    await migrate(db);

    const applied = await db.query<{ id: string }>('select id from schema_migrations order by id');
    expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    // The legacy row survived and picked up the role default via 002.
    const store = new PgStore(db);
    const member = await store.getMember('ramnique');
    expect(member).toEqual({ id: 'ramnique', displayName: 'Ramnique', role: 'member' });
    await db.close();
  });
});
