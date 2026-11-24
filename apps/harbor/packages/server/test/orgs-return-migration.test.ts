import { describe, expect, it } from 'vitest';
import { migrate } from '../src/migrations.js';
import { pgliteDb } from '../src/sql-pglite.js';

describe('067 restores orgs', () => {
  it.each([false, true])('adopts flat data with an existing general = %s', async (hasGeneral) => {
    const db = await pgliteDb();
    try {
      await migrate(db, { upTo: '066-space-graph' });
      await db.query(`insert into spaces (id, name, created_at) values ('s', $1, '2026-11-09'), ('t','Design','2026-11-11')`, [hasGeneral ? 'general' : 'Team']);
      await db.query(`insert into members (id, display_name, kind, agent_connection, agent_kind) values
        ('a','First','human',null,null),('b','Second','human',null,null),('l','Local','agent','local','claude-code'),
        ('p','Personal','agent','plugin','hermes'),('m','Mixed','agent','plugin','hermes')`);
      await db.query(`insert into memberships (space_id, member_id, joined_at, invocable_by) values
        ('s','p','now','owner'),('s','m','now','owner'),('t','m','now','members')`);
      await db.query(`insert into invites (token, space_id, created_by, created_at, direct)
        values ('space','s','a','now',false), ('person',null,'b','now',true)`);
      await migrate(db);
      await migrate(db);
      expect(await db.query('select name, visibility from spaces where is_default')).toEqual([{ name: 'general', visibility: 'open' }]);
      expect(await db.query("select is_default from spaces where id = 's'")).toEqual([{ is_default: hasGeneral }]);
      expect(await db.query("select id from members where role = 'admin'")).toEqual([{ id: 'a' }]);
      expect(await db.query('select id from members where personal order by id')).toEqual([{ id: 'l' }, { id: 'p' }]);
      expect(await db.query('select token, org_id, space_id from invites')).toEqual([{ token: 'space', org_id: 'org-default', space_id: null }]);
      expect(await db.query('select token, space_id from invite_spaces')).toEqual([{ token: 'space', space_id: 's' }]);
      await db.query("insert into members (org_id, id, display_name) values ('other','a','Other')");
      await expect(db.query("insert into spaces (id,name,created_at,visibility,is_default) values ('g','general','now','open',true)")).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
