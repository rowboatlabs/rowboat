import { describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS } from '../src/migrations.js';
import { PgStore } from '../src/pg-store.js';
import { pgliteDb } from './pglite.js';

// The migration ladder: fresh databases climb it from the bottom; databases
// from the pre-migration era (bootstrap-style schema, no schema_migrations
// table) adopt it by no-opping through 001. Every other suite exercises the
// runner implicitly via PgStore.init().

describe('schema migrations', () => {
  it('applies all migrations to a fresh database and records them', async () => {
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

  it('004 backfills the chat conventions: general by title, anchors from markers, provenance from reason suffixes', async () => {
    const db = await pgliteDb();
    // A pre-004 database: schema through 003, data written under the client
    // conventions (spaces-conventions.ts) that 004 promotes to real fields.
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
    // Two legacy-titled candidates: the OLDER one is the stream (client tie-break).
    await topic('t-gen-old', 'General', '2026-08-20T09:00:00Z');
    await topic('t-gen-new', 'messages', '2026-08-20T09:01:00Z');
    // Two thread topics claim the same parent; the older seed wins. A third
    // uses the legacy "thread" marker spelling.
    await topic('t-thread-a', 'The parent text', '2026-08-20T10:01:00Z');
    await topic('t-thread-b', 'The parent text', '2026-08-20T10:02:00Z');
    await topic('t-thread-c', 'Other parent', '2026-08-20T10:03:00Z');
    await message('msg-parent', 't-gen-old', 'The parent text', 1);
    await message('seed-a', 't-thread-a', 'The parent text\n\n<!-- rowboat:topic parent=msg:msg-parent by=ramnique at=x -->', 2);
    await message('seed-b', 't-thread-b', 'The parent text\n\n<!-- rowboat:topic parent=msg:msg-parent by=ramnique at=x -->', 3);
    await message('seed-c', 't-thread-c', 'Other parent\n\n<!-- rowboat:thread parent=msg:msg-other by=ramnique at=x -->', 4);
    const changeSet = (id: string, reason: string | null) =>
      db.query(
        `insert into change_sets (id, space_id, asset_path, base_version, result_version, attribution, reason, committed_at, stream_offset)
         values ($1, 's1', 'roadmap.md', 0, 1, '${by}'::jsonb, $2, '2026-08-20T11:00:00Z', 5)`,
        [id, reason],
      );
    await changeSet('cs-suffixed', 'moved SSO to P1 · topic:t-thread-a');
    await changeSet('cs-bare', 'thread:t-thread-c');
    await changeSet('cs-plain', 'just a reason');

    await migrate(db);

    const store = new PgStore(db);
    expect((await store.getTopic('s1', 't-gen-old'))?.kind).toBe('general');
    expect((await store.getTopic('s1', 't-gen-new'))?.kind).toBe('discussion');
    expect((await store.getTopic('s1', 't-thread-a'))?.anchorMessageId).toBe('msg-parent');
    expect((await store.getTopic('s1', 't-thread-b'))?.anchorMessageId).toBeUndefined();
    expect((await store.getTopic('s1', 't-thread-c'))?.anchorMessageId).toBe('msg-other');
    expect((await store.getChangeSet('s1', 'cs-suffixed'))?.topicId).toBe('t-thread-a');
    expect((await store.getChangeSet('s1', 'cs-bare'))?.topicId).toBe('t-thread-c');
    expect((await store.getChangeSet('s1', 'cs-plain'))?.topicId).toBeUndefined();
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
