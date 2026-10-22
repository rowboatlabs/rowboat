import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrations.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb } from '../src/sql.js';
import { freshStore, restClient } from './helpers.js';

// Every space-keyed table hangs off its space with a cascading foreign key
// (spec §6, the deletion doctrine; migration 039, 2026-10-13), so deleting a
// space is one statement. These tests hold the schema to it: a new table with
// a space_id and no cascade fails here, not in production as rows a space
// delete silently left behind.

/** Every table with a space_id column, and whether a cascading foreign key on it points at spaces(id). */
async function spaceKeyedTables(db: SqlDb): Promise<Array<{ table: string; cascades: boolean }>> {
  return db.query<{ table: string; cascades: boolean }>(
    `select c.table_name as "table",
       exists (
         select 1 from pg_constraint k
         join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
         where k.conrelid = (quote_ident(c.table_name))::regclass
           and k.contype = 'f' and k.confrelid = 'spaces'::regclass
           and k.confdeltype = 'c' and a.attname = 'space_id' and array_length(k.conkey, 1) = 1
       ) as cascades
     from information_schema.columns c
     where c.table_schema = current_schema() and c.column_name = 'space_id'
     order by c.table_name`,
  );
}

describe('space cascade (migration 039)', () => {
  it('every table with a space_id cascades from spaces', async () => {
    const db = await pgliteDb();
    try {
      await migrate(db);
      const tables = await spaceKeyedTables(db);
      expect(tables.length).toBeGreaterThanOrEqual(19);
      expect(tables.filter((t) => !t.cascades).map((t) => t.table)).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('drops orphaned rows before adding the constraints, and keeps everything that has a space', async () => {
    const db = await pgliteDb();
    try {
      await migrate(db);
      // Step back below 039, as a database that predates it. Tables created
      // after 039 carry their constraint from birth and are not stepped back.
      const after039 = new Set(['invite_spaces']);
      for (const { table } of (await spaceKeyedTables(db)).filter((t) => !after039.has(t.table))) {
        await db.query(`alter table ${table} drop constraint ${table}_space_fk`);
      }
      await db.query(`delete from schema_migrations where id = '039-space-cascade-fks'`);
      await db.query(`insert into spaces (org_id, id, name, created_at) values ('org-default', 'live', 'Live', '2026-10-13T00:00:00Z')`);
      for (const space of ['live', 'gone']) {
        await db.query(`insert into memberships (space_id, member_id, joined_at) values ($1, 'm', '2026-10-13T00:00:00Z')`, [space]);
        await db.query(`insert into events (space_id, stream_offset, at, event) values ($1, 1, '2026-10-13T00:00:00Z', '{}'::jsonb)`, [space]);
      }
      await migrate(db);
      expect(await db.query('select space_id from memberships')).toEqual([{ space_id: 'live' }]);
      expect(await db.query('select space_id from events')).toEqual([{ space_id: 'live' }]);
      expect((await spaceKeyedTables(db)).every((t) => t.cascades)).toBe(true);
    } finally {
      await db.close();
    }
  });
});

describe('deleting a space row', () => {
  let harbor: RunningHarbor;
  let db: SqlDb;
  let doomed: string;
  let kept: string;

  beforeAll(async () => {
    const fresh = await freshStore();
    db = fresh.db;
    harbor = await startHarbor({
      store: fresh.store,
      orgName: 'Rowboat Labs',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'gagan', displayName: 'Gagan' },
      ],
      seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
    });
    const ramnique = restClient(harbor, 'dev-ramnique');
    const gagan = restClient(harbor, 'dev-gagan');
    // The same activity in two spaces: one is deleted, the other must not notice.
    const fill = async (name: string): Promise<string> => {
      const id = (await ramnique.post('/v1/spaces', { name, visibility: 'open' })).body.space.id as string;
      await gagan.post(`/v1/spaces/${id}/join`);
      const root = (await gagan.post(`/v1/spaces/${id}/messages`, { body: 'shipping friday', actingMode: 'direct' })).body.message.id;
      await ramnique.post(`/v1/spaces/${id}/messages`, { body: 'agreed', threadRoot: root, actingMode: 'direct' });
      await ramnique.post(`/v1/spaces/${id}/messages/${root}/reactions`, { emoji: '👀', action: 'add', actingMode: 'direct' });
      await ramnique.post(`/v1/spaces/${id}/topics`, { rootMessageId: root, title: 'Launch', actingMode: 'direct' });
      const asset = (await ramnique.post(`/v1/spaces/${id}/assets`, { path: 'notes.md', newContent: '# Notes\n', reason: 'start', actingMode: 'direct' })).body.asset;
      await ramnique.post(`/v1/spaces/${id}/assets/move`, { assetId: asset.id, toPath: 'plan.md', baseVersion: 1, reason: 'rename', actingMode: 'direct' });
      await gagan.post(`/v1/spaces/${id}/read`, { offset: 1 });
      await ramnique.post('/v1/invites', { spaceId: id });
      return id;
    };
    doomed = await fill('Doomed');
    kept = await fill('Kept');
  });

  afterAll(async () => {
    await harbor.close();
    await db.close();
  });

  it('takes every row that hangs off the space with it, and nothing else', async () => {
    const tables = (await spaceKeyedTables(db)).map((t) => t.table);
    const count = async (spaceId: string) => {
      const rows: Record<string, number> = {};
      for (const table of tables) {
        const [r] = await db.query<{ n: string | number }>(`select count(*) as n from ${table} where space_id = $1`, [spaceId]);
        rows[table] = Number(r!.n);
      }
      return rows;
    };
    const before = await count(kept);
    const doomedBefore = await count(doomed);
    // The fill reached the tables a space delete matters most for.
    for (const table of ['memberships', 'events', 'messages', 'reactions', 'topics', 'assets', 'asset_versions', 'change_sets', 'asset_search', 'space_read_marks', 'invite_spaces']) {
      expect(doomedBefore[table], table).toBeGreaterThan(0);
    }

    await db.query('delete from spaces where id = $1', [doomed]);

    expect(Object.values(await count(doomed)).every((n) => n === 0)).toBe(true);
    expect(await count(kept)).toEqual(before);
  });
});
