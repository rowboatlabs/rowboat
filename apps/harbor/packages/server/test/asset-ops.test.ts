import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangeSet, MoveAssetResult, ReadAssetResult } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';
import { agentClient, callStructured } from './helpers.js';

// Namespace ops (move/delete/restore) on the inode model: paths stay the wire
// identity, storage keys on internal asset ids, so these are property updates
// — history and bytes never relocate. Runs on both stores, the §11 dual gate.

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let spaceId: string;

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

describe.each([['memory'], ['postgres']] as const)('asset move/delete/restore (%s store)', (storeKind) => {
  beforeAll(async () => {
    const options: HarborOptions = {
      orgName: 'Ops Test Org',
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
    const created = await ramnique.post('/v1/spaces', { name: 'Ops' });
    spaceId = created.body.space.id;
    // A file with two versions, so history has something to say.
    await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes/sso.md', baseVersion: 0, newContent: '# SSO\n- scope\n', reason: 'start', actingMode: 'direct',
    });
    await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes/sso.md', baseVersion: 1, newContent: '# SSO\n- scope\n- SAML vs OIDC\n', reason: 'expand', actingMode: 'direct',
    });
  });

  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('moves a file into a new folder: history travels, the version does not bump', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/assets/move`, {
      fromPath: 'notes/sso.md', toPath: 'decisions/sso.md', baseVersion: 2, reason: 'promote to a decision', actingMode: 'direct',
    });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('moved');
    const cs = r.body.changeSet as ChangeSet;
    expect(cs).toMatchObject({ op: 'move', assetPath: 'decisions/sso.md', movedFrom: 'notes/sso.md', baseVersion: 2, resultVersion: 2 });

    const listing = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    const paths = listing.body.entries.map((e: { path: string }) => e.path);
    expect(paths).toContain('decisions/sso.md');
    expect(paths).not.toContain('notes/sso.md');

    // Lineage history follows the file: both content edits + the move.
    const history = await ramnique.get(`/v1/spaces/${spaceId}/history?path=${encodeURIComponent('decisions/sso.md')}`);
    const ops = (history.body.changeSets as ChangeSet[]).map((c) => c.op ?? 'edit');
    expect(ops).toEqual(['move', 'edit', 'edit']);

    // Time travel still works at the new path — rows never moved.
    const v1 = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=${encodeURIComponent('decisions/sso.md')}&version=1`);
    expect((v1.body as ReadAssetResult).content).toBe('# SSO\n- scope\n');
  });

  it('old links follow the redirect — the read answers with the CURRENT path', async () => {
    const r = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=${encodeURIComponent('notes/sso.md')}`);
    expect(r.status).toBe(200);
    const asset = r.body as ReadAssetResult;
    expect(asset.path).toBe('decisions/sso.md'); // the redirect signal
    expect(asset.version).toBe(2);
  });

  it('a stale propose at the old path is told where the file went; a create there is allowed (vacant lot)', async () => {
    const stale = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes/sso.md', baseVersion: 2, newContent: 'x', actingMode: 'direct',
    });
    expect(stale.status).toBe(400);
    expect(stale.body.message).toContain('decisions/sso.md');

    const create = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes/sso.md', baseVersion: 0, newContent: '# fresh file, reused name\n', actingMode: 'direct',
    });
    expect(create.body.outcome).toBe('applied');
    expect(create.body.version).toBe(1); // a new lineage, not the traveller's

    // The reused name now shadows the redirect: reads serve the new occupant.
    const read = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=${encodeURIComponent('notes/sso.md')}`);
    expect((read.body as ReadAssetResult).content).toContain('fresh file');
  });

  it('stale moves conflict with the retry bundle; occupied destinations are refused', async () => {
    const stale = await ramnique.post(`/v1/spaces/${spaceId}/assets/move`, {
      fromPath: 'decisions/sso.md', toPath: 'archive/sso.md', baseVersion: 1, actingMode: 'direct',
    });
    expect(stale.status).toBe(200);
    expect(stale.body.outcome).toBe('conflict');
    expect(stale.body.currentVersion).toBe(2);
    expect(stale.body.currentContent).toContain('SAML');
    expect(stale.body.recentHistory.length).toBeGreaterThan(0);

    const occupied = await ramnique.post(`/v1/spaces/${spaceId}/assets/move`, {
      fromPath: 'decisions/sso.md', toPath: 'notes/sso.md', baseVersion: 2, actingMode: 'direct',
    });
    expect(occupied.status).toBe(400);
    expect(occupied.body.message).toContain('never overwrite');
  });

  it('delete freezes the file: gone from the listing, visible in trash, history intact', async () => {
    const del = await ramnique.post(`/v1/spaces/${spaceId}/assets/delete`, {
      path: 'notes/sso.md', baseVersion: 1, reason: 'scratch file, superseded', actingMode: 'direct',
    });
    expect(del.status).toBe(200);
    expect(del.body.outcome).toBe('deleted');
    expect(del.body.changeSet).toMatchObject({ op: 'delete', baseVersion: 1, resultVersion: 1 });

    const live = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    expect(live.body.entries.map((e: { path: string }) => e.path)).not.toContain('notes/sso.md');

    const withTrash = await ramnique.get(`/v1/spaces/${spaceId}/assets?includeDeleted=true`);
    const trashed = withTrash.body.entries.find((e: { path: string }) => e.path === 'notes/sso.md');
    expect(trashed?.state).toBe('deleted');

    const read = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=${encodeURIComponent('notes/sso.md')}`);
    expect(read.status).toBe(404);
    expect(read.body.message).toContain('Trash');

    // The record outlives the file: lineage history still answers.
    const history = await ramnique.get(`/v1/spaces/${spaceId}/history?path=${encodeURIComponent('notes/sso.md')}`);
    expect((history.body.changeSets as ChangeSet[]).map((c) => c.op ?? 'edit')).toEqual(['delete', 'edit']);
  });

  it('restore flips the file back to life with its version intact', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/assets/restore`, {
      path: 'notes/sso.md', actingMode: 'direct',
    });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('restored');
    expect(r.body.version).toBe(1);
    expect(r.body.changeSet).toMatchObject({ op: 'restore', assetPath: 'notes/sso.md' });

    const read = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=${encodeURIComponent('notes/sso.md')}`);
    expect(read.status).toBe(200);
    expect((read.body as ReadAssetResult).content).toContain('fresh file');
  });

  it('restore refuses an occupied path with a human message', async () => {
    await ramnique.post(`/v1/spaces/${spaceId}/assets/delete`, {
      path: 'notes/sso.md', baseVersion: 1, actingMode: 'direct',
    });
    await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes/sso.md', baseVersion: 0, newContent: 'the squatter\n', actingMode: 'direct',
    });
    const r = await ramnique.post(`/v1/spaces/${spaceId}/assets/restore`, {
      path: 'notes/sso.md', actingMode: 'direct',
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('move it first');
  });

  it('agents move and delete over MCP, attributed with their name', async () => {
    const agent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
    const moved = await callStructured<MoveAssetResult>(agent, 'move_asset', {
      spaceId, fromPath: 'decisions/sso.md', toPath: 'decisions/2026/sso.md', baseVersion: 2, reason: 'file under the year',
    });
    expect(moved.outcome).toBe('moved');
    if (moved.outcome === 'moved') {
      expect(moved.changeSet.attribution).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });
    }
    const deleted = await callStructured<{ outcome: string }>(agent, 'delete_asset', {
      spaceId, path: 'decisions/2026/sso.md', baseVersion: 2, reason: 'testing the shredder (it keeps everything)',
    });
    expect(deleted.outcome).toBe('deleted');
    await agent.close();
  });
});
