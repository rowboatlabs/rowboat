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
