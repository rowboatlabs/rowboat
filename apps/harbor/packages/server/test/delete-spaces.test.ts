import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, routes, type ServerFrame, type Space } from '@rowboat/spaces-protocol';
import { blobHash, MemoryBlobStore } from '../src/blobs.js';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor, type LiveClient } from './helpers.js';

// Deleting a space (spec §6, built 2026-10-14): an admin act on a shared
// space, never a DM, archived or not. The space and everything that hangs off
// it go (the cascade, migration 039, has its own test); bytes nothing else in
// the org uses go after the commit; everyone who could have the space open is
// told by `space_removed`. No undo: a second delete is not_found.

// A real 1×1 PNG and two variants: three distinct hashes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SHARED = new Uint8Array(PNG);
const ONLY_HERE = new Uint8Array(Buffer.concat([PNG, Buffer.from([1])]));
const AVATAR = new Uint8Array(Buffer.concat([PNG, Buffer.from([2])]));

let harbor: RunningHarbor;
let blobs: MemoryBlobStore;
let lobby: string;
let ramAgent: Client;
let gaganAgent: Client;
const admin = () => restClient(harbor, 'dev-ramnique'); // the seed space's creator is the org's admin
const gagan = () => restClient(harbor, 'dev-gagan');
const prakhar = () => restClient(harbor, 'dev-prakhar');
const del = (token: string, spaceId: string) =>
  fetch(`${harbor.url}/v1/spaces/${spaceId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    .then(async (res) => ({ status: res.status, body: (await res.json()) as any }));
const upload = (token: string, spaceId: string, bytes: Uint8Array) =>
  fetch(`${harbor.url}/v1/spaces/${spaceId}/blobs`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'x-blob-sha256': blobHash(bytes), 'content-type': 'image/png' },
    body: bytes as unknown as BodyInit,
  }).then((res) => res.status);
const removed = (live: LiveClient, spaceId: string) =>
  live.frames.filter((f): f is Extract<ServerFrame, { kind: 'space_removed' }> => f.kind === 'space_removed' && f.spaceId === spaceId);

async function space(name: string, visibility: 'open' | 'private', members: string[] = ['gagan']): Promise<string> {
  const id = (await admin().post('/v1/spaces', { name, visibility })).body.space.id as string;
  await admin().post(`/v1/spaces/${id}/members`, { memberIds: members, actingMode: 'direct' });
  return id;
}

beforeAll(async () => {
  blobs = new MemoryBlobStore();
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    blobs,
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
    ],
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
  });
  lobby = (await admin().get('/v1/spaces')).body.spaces.find((s: Space) => s.name === 'Lobby').id;
  ramAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
  gaganAgent = await agentClient(harbor, 'dev-gagan', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await ramAgent.close();
  await gaganAgent.close();
  await harbor.close();
});

describe('DELETE /v1/spaces/:spaceId', () => {
  it('only an admin deletes, only a shared space, and a refusal deletes nothing', async () => {
    const id = await space('Keep me', 'private');
    expect((await del('dev-gagan', id)).status).toBe(403);
    expect((await del('dev-prakhar', id)).status).toBe(403); // not a member
    const dm = (await admin().post('/v1/direct', { memberId: 'gagan' })).body.space.id;
    expect((await del('dev-ramnique', dm)).status).toBe(400);
    expect(await harbor.store.getSpace(id)).toBeDefined();
    expect(await harbor.store.getSpace(dm)).toBeDefined();
  });

  it('drops the space whole: gone from every listing, every link dead, a second delete not_found', async () => {
    const id = await space('Launch', 'open');
    const root = (await gagan().post(`/v1/spaces/${id}/messages`, { body: 'shipping friday', actingMode: 'direct' })).body.message.id;
    const asset = (await admin().post(`/v1/spaces/${id}/assets`, { path: 'notes.md', newContent: '# Notes\n', reason: 'start', actingMode: 'direct' })).body.asset;
    const invite = (await admin().post('/v1/invites', { spaceId: id })).body.token;

    const r = await del('dev-ramnique', id);
    expect(r.status).toBe(200);
    expect(routes.deleteSpace.response.parse(r.body)).toEqual({ deleted: true });

    expect(((await gagan().get('/v1/spaces')).body.spaces as Space[]).some((s) => s.id === id)).toBe(false);
    expect(((await prakhar().get('/v1/spaces/browse')).body.spaces as Array<{ space: Space }>).some((b) => b.space.id === id)).toBe(false);
    expect((await gagan().get(`/v1/spaces/${id}/stream`)).status).toBe(404);
    expect((await gagan().get(`/v1/spaces/${id}/assets/${asset.id}`)).status).toBe(404);
    expect((await gagan().get(`/v1/spaces/${id}/threads/${root}`)).status).toBe(404);
    // The invite was to the org (2026-10-19): it lives on, listing nothing.
    expect((await prakhar().post('/v1/invites/resolve', { token: invite })).body).toMatchObject({ state: 'ok', spaces: [] });
    expect(await harbor.store.listEventsAfter(id, 0)).toEqual([]);
    expect((await del('dev-ramnique', id)).status).toBe(404);
  });

  it('an archived space can be deleted', async () => {
    const id = await space('Old', 'private');
    expect((await admin().post(`/v1/spaces/${id}/archive`, { actingMode: 'direct' })).status).toBe(200);
    expect((await del('dev-ramnique', id)).status).toBe(200);
    expect(await harbor.store.getSpace(id)).toBeUndefined();
  });

  it('removes the bytes nothing else in the org uses, and keeps the rest', async () => {
    const id = await space('Uploads', 'private');
    for (const bytes of [SHARED, ONLY_HERE, AVATAR]) expect(await upload('dev-gagan', id, bytes)).toBe(200);
    expect(await upload('dev-gagan', lobby, SHARED)).toBe(200); // the same bytes in another space
    const avatar = await fetch(`${harbor.url}/v1/me/avatar`, {
      method: 'PUT', headers: { authorization: 'Bearer dev-gagan', 'content-type': 'image/png' }, body: AVATAR as unknown as BodyInit,
    });
    expect(avatar.status).toBe(200); // the same bytes as a profile image

    expect((await del('dev-ramnique', id)).status).toBe(200);
    expect(await blobs.has(blobHash(ONLY_HERE))).toBe(false);
    expect(await blobs.has(blobHash(SHARED))).toBe(true);
    expect(await blobs.has(blobHash(AVATAR))).toBe(true);
    // The other space still serves its copy.
    const kept = await fetch(`${harbor.url}/v1/spaces/${lobby}/blobs/${blobHash(SHARED)}`, { headers: { authorization: 'Bearer dev-ramnique' } });
    expect(kept.status).toBe(200);
  });

  it('tells every member of a private space, and nobody else', async () => {
    const id = await space('Secret', 'private');
    const [g, p] = [await liveClient(harbor, 'dev-gagan'), await liveClient(harbor, 'dev-prakhar')];
    try {
      expect((await del('dev-ramnique', id)).status).toBe(200);
      await g.until(() => removed(g, id).length > 0, 'space_removed for gagan');
      expect(removed(g, id)[0]).toMatchObject({ spaceId: id, by: 'ramnique' });
      // Prakhar, not a member, learns nothing about a private space; a frame
      // sent after the delete still reaches him, so had his come, it is here.
      const sentinel = await space('Sentinel', 'private', ['prakhar']);
      await p.until((fs) => fs.some((f) => f.kind === 'space_added' && f.spaceId === sentinel), 'space_added for prakhar');
      expect(removed(p, id)).toEqual([]);
    } finally {
      g.close();
      p.close();
    }
  });

  it('tells everyone in the org about an open space, and ends a non-member reader’s subscription', async () => {
    const id = await space('Town square', 'open');
    const p = await liveClient(harbor, 'dev-prakhar');
    try {
      p.send({ kind: 'subscribe', spaceId: id });
      await p.until((fs) => fs.some((f) => f.kind === 'subscribed' && f.spaceId === id), 'subscribed');
      expect((await del('dev-ramnique', id)).status).toBe(200);
      await p.until(() => removed(p, id).length > 0, 'space_removed for a reader');
      expect(harbor.stats.snapshot().live.subscriptions).toBe(0);
    } finally {
      p.close();
    }
  });
});

describe('delete_space (MCP)', () => {
  it('deletes for an admin’s agent, refuses a member’s, and warns that there is no undo', async () => {
    const tool = mcpTools.find((t) => t.name === 'delete_space')!;
    expect(tool.description).toMatch(/no undo/);
    expect(tool.description).toMatch(/explicitly asked/);

    const id = await space('Agent-made', 'private');
    const refusal = await gaganAgent.callTool({ name: 'delete_space', arguments: { spaceId: id } });
    expect(refusal.isError).toBe(true);
    expect(JSON.parse((refusal.content as Array<{ text: string }>)[0]!.text).code).toBe('forbidden');

    const result = await ramAgent.callTool({ name: 'delete_space', arguments: { spaceId: id } });
    expect(result.isError).toBeFalsy();
    expect(tool.output.parse(result.structuredContent)).toEqual({ deleted: true });
    expect(await harbor.store.getSpace(id)).toBeUndefined();
  });
});
