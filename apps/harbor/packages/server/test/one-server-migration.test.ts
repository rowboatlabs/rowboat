import { describe, expect, it } from 'vitest';
import { migrate } from '../src/migrations.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb } from '../src/sql.js';

// Migration 061 (spec §4, 2026-11-09): a multi-org database becomes one
// server. Seeded here in the shape production had the day before: two orgs,
// one person in both, a DM between the same two people in each, a device
// registered twice, a sealed credential. The rules under test are the ones
// CONTRACT.md's "One server, no orgs" block states.

const T = '2026-11-08T10:00:00.000Z';

async function seed(db: SqlDb): Promise<void> {
  await migrate(db, { upTo: '060-message-session' });
  await db.query(`insert into orgs (id, name, created_at) values ('team', 'Team', $1), ('side', 'Side', $1)`, [T]);
  await db.query(`insert into org_domains (domain, org_id) values ('team.test', 'team'), ('side.test', 'side')`);
  await db.query(`insert into org_settings (org_id, jev_enabled, set_by, set_at) values ('team', false, 'ram-t', $1)`, [T]);
  // Ramnique is in both orgs; Gagan too; Harsh only in Team; Solo only in Side. Ramnique was Team's admin.
  await db.query(`insert into members (org_id, id, display_name, role, kind) values
    ('team', 'ram-t', 'Ramnique', 'admin', 'human'), ('team', 'gagan-t', 'Gagan', 'member', 'human'), ('team', 'harsh-t', 'Harsh', 'member', 'human'),
    ('side', 'ram-s', 'Ramnique', 'admin', 'human'), ('side', 'gagan-s', 'Gagan', 'member', 'human'), ('side', 'solo-s', 'Solo', 'member', 'human'),
    ('team', 'kicked-t', 'Kicked', 'member', 'human')`);
  await db.query(`update members set removed_at = $1 where id = 'kicked-t'`, [T]);
  await db.query(`insert into members (org_id, id, display_name, role, kind, owner_id, agent_kind, agent_connection, personal) values
    ('side', 'bot-s', 'Bot', 'member', 'agent', 'ram-s', 'hermes', 'plugin', true)`);
  await db.query(`insert into member_identities (org_id, iss, sub, member_id) values
    ('team', 'iss', 'ram', 'ram-t'), ('side', 'iss', 'ram', 'ram-s'),
    ('team', 'iss', 'gagan', 'gagan-t'), ('side', 'iss', 'gagan', 'gagan-s'),
    ('team', 'iss', 'harsh', 'harsh-t'), ('side', 'iss', 'solo', 'solo-s'), ('team', 'iss', 'kicked', 'kicked-t')`);
  // Spaces: Team's room and the Ramnique–Gagan DM; Side's room and the same pair's DM, made later.
  await db.query(`insert into spaces (org_id, id, name, created_at, kind, visibility, direct_key, is_default) values
    ('team', '01HTEAM00000000000000000000', 'Roadboard', $1, 'shared', 'open', null, true),
    ('team', '01HTEAMDM000000000000000000', 'Direct message', $1, 'direct', 'private', '["gagan-t","ram-t"]', false),
    ('side', '01HSIDE00000000000000000000', 'Side room', $1, 'shared', 'private', null, false),
    ('side', '01HSIDEDM000000000000000000', 'Direct message', '2026-11-08T11:00:00.000Z', 'direct', 'private', '["gagan-s","ram-s"]', false),
    ('team', '01HTEAMSELF0000000000000000', 'Direct message', $1, 'direct', 'private', '["ram-t"]', false),
    ('side', '01HSIDESELF0000000000000000', 'Direct message', '2026-11-08T11:00:00.000Z', 'direct', 'private', '["ram-s"]', false)`, [T]);
  // Notes to self in both orgs, never written in: the newer one is an empty duplicate after the fold.
  await db.query(`insert into memberships (space_id, member_id, joined_at) values
    ('01HTEAM00000000000000000000', 'ram-t', $1), ('01HTEAM00000000000000000000', 'gagan-t', '2026-11-08T10:01:00.000Z'), ('01HTEAM00000000000000000000', 'harsh-t', '2026-11-08T10:02:00.000Z'),
    ('01HTEAMDM000000000000000000', 'ram-t', $1), ('01HTEAMDM000000000000000000', 'gagan-t', $1),
    ('01HSIDE00000000000000000000', 'ram-s', $1), ('01HSIDE00000000000000000000', 'gagan-s', $1), ('01HSIDE00000000000000000000', 'solo-s', $1), ('01HSIDE00000000000000000000', 'bot-s', $1),
    ('01HSIDEDM000000000000000000', 'ram-s', $1), ('01HSIDEDM000000000000000000', 'gagan-s', $1),
    ('01HTEAMSELF0000000000000000', 'ram-t', $1), ('01HSIDESELF0000000000000000', 'ram-s', $1)`, [T]);
  // Ramnique talked in Team; Gagan talked more in Side.
  const msg = (id: string, space: string, author: string, offset: number) =>
    db.query(`insert into messages (id, space_id, author, body, search_text, posted_at, stream_offset) values ($1, $2, $3::jsonb, 'hi', 'hi', $4, $5)`,
      [id, space, JSON.stringify({ memberId: author, actingMode: 'direct' }), T, offset]);
  await msg('01HMSG000000000000000000001', '01HTEAM00000000000000000000', 'ram-t', 1);
  await msg('01HMSG000000000000000000002', '01HTEAM00000000000000000000', 'ram-t', 2);
  await msg('01HMSG000000000000000000003', '01HSIDE00000000000000000000', 'gagan-s', 1);
  // The Side DM was used, so it is kept (as a two-person space) rather than deleted as an empty duplicate.
  await msg('01HMSG000000000000000000006', '01HSIDEDM000000000000000000', 'gagan-s', 1);
  await msg('01HMSG000000000000000000004', '01HSIDE00000000000000000000', 'gagan-s', 2);
  await msg('01HMSG000000000000000000005', '01HTEAM00000000000000000000', 'gagan-t', 3);
  // Read marks in both orgs; the same phone registered in both; seen marks in both.
  await db.query(`insert into space_read_marks (space_id, member_id, read_offset, updated_at) values ('01HTEAM00000000000000000000', 'ram-t', 2, $1), ('01HSIDE00000000000000000000', 'ram-s', 1, $1)`, [T]);
  await db.query(`insert into push_tokens (org_id, token, member_id, updated_at) values ('team', 'ExponentPushToken[x]', 'ram-t', $1), ('side', 'ExponentPushToken[x]', 'ram-s', '2026-11-08T12:00:00.000Z')`, [T]);
  // Plus a seen mark left from the single-org era, naming Ramnique's Team row under Side, where
  // that row never was (production had three such rows on 2026-11-09).
  await db.query(`insert into activity_seen (org_id, member_id, seen_at) values ('team', 'ram-t', $1), ('side', 'ram-s', $1), ('side', 'ram-t', '2026-09-15T05:23:23.503Z')`, [T]);
  // A credential sealed under Side's id, and one backfill ledger row per org.
  await db.query(`insert into agent_connection_credentials (org_id, agent_id, sealed, hint, set_by, set_at) values ('side', 'bot-s', 'v1.primary.a.b.c', '…abcd', 'ram-s', $1)`, [T]);
  await db.query(`insert into schema_migrations (id, applied_at) values ('backfill:mentions:team', $1), ('backfill:mentions:side', $1)`, [T]);
}

describe('migration 062 — one server', () => {
  it('folds a multi-org database into one server, keeping every message its author', { timeout: 30_000 }, async () => {
    const db = await pgliteDb();
    try {
      await seed(db);
      await migrate(db);

      // The person: the most active row wins (Ramnique's Team row, Gagan's Side row); losers stay, departed.
      const ids = await db.query<{ iss: string; sub: string; member_id: string }>('select iss, sub, member_id from member_identities order by sub');
      expect(ids).toEqual([
        { iss: 'iss', sub: 'gagan', member_id: 'gagan-s' },
        { iss: 'iss', sub: 'harsh', member_id: 'harsh-t' },
        { iss: 'iss', sub: 'kicked', member_id: 'kicked-t' },
        { iss: 'iss', sub: 'ram', member_id: 'ram-t' },
        { iss: 'iss', sub: 'solo', member_id: 'solo-s' },
      ]);
      const departed = await db.query<{ id: string }>('select id from members where removed_at is not null order by id');
      expect(departed.map((r) => r.id)).toEqual(['gagan-t', 'ram-s']);
      // Someone an admin had removed from an org is a person again.
      expect(await db.query(`select removed_at from members where id = 'kicked-t'`)).toEqual([{ removed_at: null }]);
      // Messages keep their authors (the log is untouched); memberships follow the winner.
      expect(await db.query(`select author_member_id from messages where id = '01HMSG000000000000000000005'`)).toEqual([{ author_member_id: 'gagan-t' }]);
      const rooms = await db.query<{ space_id: string; member_id: string }>(`select space_id, member_id from memberships where member_id in ('ram-t', 'gagan-s') order by space_id, member_id`);
      expect(rooms.map((r) => `${r.space_id.slice(3, 9)}:${r.member_id}`)).toEqual([
        'SIDE00:gagan-s', 'SIDE00:ram-t', 'SIDEDM:gagan-s', 'SIDEDM:ram-t', 'TEAM00:gagan-s', 'TEAM00:ram-t', 'TEAMDM:gagan-s', 'TEAMDM:ram-t', 'TEAMSE:ram-t',
      ]);
      // The agent follows its owner; its credential remembers what it was sealed under.
      expect(await db.query(`select owner_id from members where id = 'bot-s'`)).toEqual([{ owner_id: 'ram-t' }]);
      expect(await db.query(`select sealed_scope from agent_connection_credentials where agent_id = 'bot-s'`)).toEqual([{ sealed_scope: 'side' }]);

      // DMs: the older pair stays the DM; the newer became a two-person space named after them.
      const dms = await db.query<{ id: string; kind: string; direct_key: string | null; name: string }>(`select id, kind, direct_key, name from spaces where id like '%DM%' order by created_at`);
      expect(dms).toEqual([
        { id: '01HTEAMDM000000000000000000', kind: 'direct', direct_key: '["gagan-s","ram-t"]', name: 'Direct message' },
        { id: '01HSIDEDM000000000000000000', kind: 'shared', direct_key: null, name: 'Gagan & Ramnique' },
      ]);
      // The older notes-to-self stays, keyed on the one row; the empty newer one is gone with its membership.
      expect(await db.query(`select id, direct_key from spaces where id like '%SELF%'`)).toEqual([{ id: '01HTEAMSELF0000000000000000', direct_key: '["ram-t"]' }]);
      expect(await db.query(`select space_id from memberships where space_id like '%SELF%'`)).toEqual([{ space_id: '01HTEAMSELF0000000000000000' }]);
      expect([
      ]);

      // Per-member state: one read mark per space, one device row, one seen mark.
      expect(await db.query(`select space_id, read_offset from space_read_marks where member_id = 'ram-t' order by space_id`)).toEqual([
        { space_id: '01HSIDE00000000000000000000', read_offset: 1 }, { space_id: '01HTEAM00000000000000000000', read_offset: 2 },
      ]);
      expect(await db.query(`select member_id from push_tokens`)).toEqual([{ member_id: 'ram-t' }]);
      expect(await db.query(`select member_id, seen_at from activity_seen`)).toEqual([{ member_id: 'ram-t', seen_at: T }]);
      // The ledger has one row per backfill; the tenancy is gone.
      expect(await db.query(`select id from schema_migrations where id like 'backfill:%' order by id`)).toEqual([{ id: 'backfill:mentions' }, { id: 'backfill:mentions:side' }, { id: 'backfill:mentions:team' }]);
      const tables = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('orgs', 'org_domains', 'org_logos', 'org_images', 'images')`);
      expect(tables.map((t) => t.table_name).sort()).toEqual(['images']);
      const orgCols = await db.query<{ table_name: string }>(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'org_id' order by table_name`);
      expect(orgCols.map((c) => c.table_name)).toEqual(['org_settings']);
    } finally {
      await db.close();
    }
  });
});
