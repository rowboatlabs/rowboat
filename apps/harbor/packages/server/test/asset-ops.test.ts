import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangeSet, CreateAssetResult, MoveAssetResult, ReadAssetResult } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, callStructured, startTestHarbor } from './helpers.js';

// Namespace ops (move/delete/restore) with ids as the wire identity
// (2026-09-14): the path is a display property of the record, so a move is a
// property update — history and bytes never relocate, and nothing addressed
// by id notices.

let harbor: RunningHarbor;
let spaceId: string;
/** The traveller: created in setup, moved/trashed/restored through the suite. */
let ssoId: string;

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

describe('asset move/delete/restore', () => {
  beforeAll(async () => {
    harbor = await startTestHarbor({
      orgName: 'Ops Test Org',
      seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
    });
    ramnique = api('dev-ramnique');
    const created = await ramnique.post('/v1/spaces', { name: 'Ops' });
    spaceId = created.body.space.id;
    // A file with two versions, so history has something to say.
    const birth = await ramnique.post(`/v1/spaces/${spaceId}/assets`, {
      path: 'notes/sso.md', newContent: '# SSO\n- scope\n', reason: 'start', actingMode: 'direct',
    });
    expect(birth.status).toBe(200);
    const { asset, changeSet } = birth.body as CreateAssetResult;
    expect(asset).toMatchObject({ path: 'notes/sso.md', version: 1 });
    expect(changeSet).toMatchObject({ assetId: asset.id, assetPath: 'notes/sso.md', baseVersion: 0, resultVersion: 1 });
    ssoId = asset.id;
    const edit = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetId: ssoId, baseVersion: 1, newContent: '# SSO\n- scope\n- SAML vs OIDC\n', reason: 'expand', actingMode: 'direct',
    });
    expect(edit.body.outcome).toBe('applied');
  }, 20_000);

  afterAll(async () => {
    await harbor.close();
  });

  it('moves a file into a new folder: same id at the new path, history travels, the version does not bump', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/assets/move`, {
      assetId: ssoId, toPath: 'decisions/sso.md', baseVersion: 2, reason: 'promote to a decision', actingMode: 'direct',
    });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('moved');
    const cs = r.body.changeSet as ChangeSet;
    expect(cs).toMatchObject({
      op: 'move', assetId: ssoId, assetPath: 'decisions/sso.md', movedFrom: 'notes/sso.md', baseVersion: 2, resultVersion: 2,
    });

    const listing = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    const entries = listing.body.entries as Array<{ id: string; path: string }>;
    expect(entries.find((e) => e.id === ssoId)?.path).toBe('decisions/sso.md');
    expect(entries.map((e) => e.path)).not.toContain('notes/sso.md');

    // Lineage history is a filter on the id: both content edits + the move.
    const history = await ramnique.get(`/v1/spaces/${spaceId}/history?assetId=${ssoId}`);
    const ops = (history.body.changeSets as ChangeSet[]).map((c) => c.op ?? 'edit');
    expect(ops).toEqual(['move', 'edit', 'edit']);

    // Time travel still works by id — rows never moved.
    const v1 = await ramnique.get(`/v1/spaces/${spaceId}/assets/${ssoId}?version=1`);
    expect(v1.status).toBe(200);
    expect((v1.body as ReadAssetResult).content).toBe('# SSO\n- scope\n');
    expect((v1.body as ReadAssetResult).path).toBe('decisions/sso.md');
  });

  it('reading by id after the move answers with the NEW path — there is no path-based read', async () => {
    const r = await ramnique.get(`/v1/spaces/${spaceId}/assets/${ssoId}`);
    expect(r.status).toBe(200);
    const asset = r.body as ReadAssetResult;
    expect(asset.id).toBe(ssoId);
    expect(asset.path).toBe('decisions/sso.md');
    expect(asset.version).toBe(2);
    expect(asset.content).toContain('SAML');
  });

  it('the vacated path is a vacant lot: a new file there is a fresh lineage; wrong bases on the moved id behave as ever', async () => {
    const create = await ramnique.post(`/v1/spaces/${spaceId}/assets`, {
      path: 'notes/sso.md', newContent: '# fresh file, reused name\n', actingMode: 'direct',
    });
    expect(create.status).toBe(200);
    const fresh = (create.body as CreateAssetResult).asset;
    expect(fresh.id).not.toBe(ssoId); // a new lineage, not the traveller's
    expect(fresh.version).toBe(1);
    const read = await ramnique.get(`/v1/spaces/${spaceId}/assets/${fresh.id}`);
    expect((read.body as ReadAssetResult).content).toContain('fresh file');

    // The moved file is untouched by the newcomer: ahead → 400, stale → merge/conflict.
    const ahead = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetId: ssoId, baseVersion: 3, newContent: 'x', actingMode: 'direct',
    });
    expect(ahead.status).toBe(400);
    expect(ahead.body.message).toContain('ahead');
    const stale = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetId: ssoId, baseVersion: 1, newContent: '# SSO\n- scope\n- something else entirely\n', actingMode: 'direct',
    });
    expect(stale.status).toBe(200);
    expect(stale.body.outcome).toBe('conflict');
    expect(stale.body.currentVersion).toBe(2);
  });

  it('stale moves conflict with the retry bundle; occupied destinations and no-op moves are refused', async () => {
    const stale = await ramnique.post(`/v1/spaces/${spaceId}/assets/move`, {
      assetId: ssoId, toPath: 'archive/sso.md', baseVersion: 1, actingMode: 'direct',
    });
    expect(stale.status).toBe(200);
    expect(stale.body.outcome).toBe('conflict');
    expect(stale.body.currentVersion).toBe(2);
    expect(stale.body.currentContent).toContain('SAML');
    expect(stale.body.recentHistory.length).toBeGreaterThan(0);

    const occupied = await ramnique.post(`/v1/spaces/${spaceId}/assets/move`, {
      assetId: ssoId, toPath: 'notes/sso.md', baseVersion: 2, actingMode: 'direct',
    });
    expect(occupied.status).toBe(400);
    expect(occupied.body.message).toContain('never overwrite');

    const same = await ramnique.post(`/v1/spaces/${spaceId}/assets/move`, {
      assetId: ssoId, toPath: 'decisions/sso.md', baseVersion: 2, actingMode: 'direct',
    });
    expect(same.status).toBe(400);
    expect(same.body.message).toContain('same path');
  });

  /** The fresh occupant of notes/sso.md, trashed and restored below. */
  let freshId: string;

  it('delete by id freezes the file: gone from the listing, visible in trash, history intact', async () => {
    const listing = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    freshId = (listing.body.entries as Array<{ id: string; path: string }>).find((e) => e.path === 'notes/sso.md')!.id;

    const del = await ramnique.post(`/v1/spaces/${spaceId}/assets/delete`, {
      assetId: freshId, baseVersion: 1, reason: 'scratch file, superseded', actingMode: 'direct',
    });
    expect(del.status).toBe(200);
    expect(del.body.outcome).toBe('deleted');
    expect(del.body.changeSet).toMatchObject({ op: 'delete', assetId: freshId, assetPath: 'notes/sso.md', baseVersion: 1, resultVersion: 1 });

    const live = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    expect(live.body.entries.map((e: { id: string }) => e.id)).not.toContain(freshId);

    const withTrash = await ramnique.get(`/v1/spaces/${spaceId}/assets?includeDeleted=true`);
    const trashed = withTrash.body.entries.find((e: { id: string }) => e.id === freshId);
    expect(trashed).toMatchObject({ path: 'notes/sso.md', state: 'deleted' });

    const read = await ramnique.get(`/v1/spaces/${spaceId}/assets/${freshId}`);
    expect(read.status).toBe(404);
    expect(read.body.message).toContain('Trash');

    // The record outlives the file: lineage history still answers by id.
    const history = await ramnique.get(`/v1/spaces/${spaceId}/history?assetId=${freshId}`);
    expect((history.body.changeSets as ChangeSet[]).map((c) => c.op ?? 'edit')).toEqual(['delete', 'edit']);
  });

  it('restore by id flips the file back to life with its version intact', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/assets/restore`, {
      assetId: freshId, actingMode: 'direct',
    });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('restored');
    expect(r.body.version).toBe(1);
    expect(r.body.changeSet).toMatchObject({ op: 'restore', assetId: freshId, assetPath: 'notes/sso.md' });

    const read = await ramnique.get(`/v1/spaces/${spaceId}/assets/${freshId}`);
    expect(read.status).toBe(200);
    expect((read.body as ReadAssetResult).content).toContain('fresh file');

    // A living file is not restorable.
    const again = await ramnique.post(`/v1/spaces/${spaceId}/assets/restore`, {
      assetId: freshId, actingMode: 'direct',
    });
    expect(again.status).toBe(400);
    expect(again.body.message).toContain('not in the trash');
  });

  it('a trashed name can be reused by create; the trashed file is restorable only once the occupant moves away', async () => {
    await ramnique.post(`/v1/spaces/${spaceId}/assets/delete`, {
      assetId: freshId, baseVersion: 1, actingMode: 'direct',
    });
    const squat = await ramnique.post(`/v1/spaces/${spaceId}/assets`, {
      path: 'notes/sso.md', newContent: 'the squatter\n', actingMode: 'direct',
    });
    expect(squat.status).toBe(200);
    const squatter = (squat.body as CreateAssetResult).asset;
    expect(squatter.id).not.toBe(freshId);
    expect(squatter.version).toBe(1);

    // Occupied: the human message says what to do.
    const blocked = await ramnique.post(`/v1/spaces/${spaceId}/assets/restore`, {
      assetId: freshId, actingMode: 'direct',
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain('move it first');

    // A live occupant also blocks a birth at that name (and names itself).
    const twice = await ramnique.post(`/v1/spaces/${spaceId}/assets`, {
      path: 'notes/sso.md', newContent: 'another\n', actingMode: 'direct',
    });
    expect(twice.status).toBe(400);
    expect(twice.body.message).toContain(squatter.id);

    // The occupant moves away → the trashed file restores at its old name.
    const moved = await ramnique.post(`/v1/spaces/${spaceId}/assets/move`, {
      assetId: squatter.id, toPath: 'notes/squatter.md', baseVersion: 1, actingMode: 'direct',
    });
    expect(moved.body.outcome).toBe('moved');
    const restored = await ramnique.post(`/v1/spaces/${spaceId}/assets/restore`, {
      assetId: freshId, actingMode: 'direct',
    });
    expect(restored.status).toBe(200);
    expect(restored.body.outcome).toBe('restored');
    const listing = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    const byId = new Map((listing.body.entries as Array<{ id: string; path: string }>).map((e) => [e.id, e.path]));
    expect(byId.get(freshId)).toBe('notes/sso.md');
    expect(byId.get(squatter.id)).toBe('notes/squatter.md');
  });

  it('agents create, move and delete over MCP by id, attributed with their name', async () => {
    const agent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
    const born = await callStructured<CreateAssetResult>(agent, 'create_asset', {
      spaceId, path: 'decisions/2026/index.md', newContent: '# 2026 decisions\n', reason: 'an index for the year',
    });
    expect(born.asset).toMatchObject({ path: 'decisions/2026/index.md', version: 1 });
    expect(born.changeSet.attribution).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });
    const listing = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    expect(listing.body.entries.map((e: { id: string }) => e.id)).toContain(born.asset.id);

    const moved = await callStructured<MoveAssetResult>(agent, 'move_asset', {
      spaceId, assetId: ssoId, toPath: 'decisions/2026/sso.md', baseVersion: 2, reason: 'file under the year',
    });
    expect(moved.outcome).toBe('moved');
    if (moved.outcome === 'moved') {
      expect(moved.changeSet.attribution).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });
      expect(moved.changeSet).toMatchObject({ assetId: ssoId, assetPath: 'decisions/2026/sso.md', movedFrom: 'decisions/sso.md' });
    }
    const deleted = await callStructured<{ outcome: string; changeSet?: ChangeSet }>(agent, 'delete_asset', {
      spaceId, assetId: ssoId, baseVersion: 2, reason: 'testing the shredder (it keeps everything)',
    });
    expect(deleted.outcome).toBe('deleted');
    expect(deleted.changeSet?.attribution).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });
    await agent.close();
  });
});
