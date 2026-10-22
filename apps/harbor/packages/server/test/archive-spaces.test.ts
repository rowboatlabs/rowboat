import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, routes, type Space } from '@rowboat/spaces-protocol';
import { blobHash } from '../src/blobs.js';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, restClient, startTestHarbor } from './helpers.js';

// Archive and unarchive (spec §6, built 2026-10-13): an admin act on a shared
// space, never a DM. An archived space refuses every write that adds to it and
// stays readable; leaving and read marks still work. Both are idempotent, and
// each real flip is one event on the space's own log. Every assertion here is
// about the SPACE's `archived` flag, not a topic's.

const PNG_1PX = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
));

let harbor: RunningHarbor;
let spaceId: string;
let notesId: string;
let rootId: string;
let ramAgent: Client;
let gaganAgent: Client;
const admin = () => restClient(harbor, 'dev-ramnique'); // the seed space's creator is the org's admin
const gagan = () => restClient(harbor, 'dev-gagan');
const prakhar = () => restClient(harbor, 'dev-prakhar');
const archive = (client = admin(), id = spaceId) => client.post(`/v1/spaces/${id}/archive`, { actingMode: 'direct' });
const unarchive = (client = admin(), id = spaceId) => client.post(`/v1/spaces/${id}/unarchive`, { actingMode: 'direct' });
const eventsOf = async (type: string) =>
  (await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === type);

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`tool ${name} errored: ${JSON.stringify(result.content)}`);
  const parsed = mcpTools.find((t) => t.name === name)!.output.safeParse(result.structuredContent);
  if (!parsed.success) throw new Error(`tool ${name} output failed its schema: ${parsed.error.message}`);
  return result.structuredContent as T;
}

async function refused(client: Client, name: string, args: Record<string, unknown>): Promise<{ code: string }> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { code: string };
}

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
    ],
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
  });
  spaceId = (await admin().post('/v1/spaces', { name: 'Launch', visibility: 'open' })).body.space.id;
  await gagan().post(`/v1/spaces/${spaceId}/join`);
  notesId = (await admin().post(`/v1/spaces/${spaceId}/assets`, {
    path: 'notes.md', newContent: '# Notes\n', reason: 'start', actingMode: 'direct',
  })).body.asset.id;
  rootId = (await gagan().post(`/v1/spaces/${spaceId}/messages`, { body: 'shipping friday', actingMode: 'direct' })).body.message.id;
  ramAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
  gaganAgent = await agentClient(harbor, 'dev-gagan', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await ramAgent.close();
  await gaganAgent.close();
  await harbor.close();
});

describe('archive and unarchive a space', () => {
  it('a new space is live; only an admin archives, and a DM never does', async () => {
    const listed = (await gagan().get('/v1/spaces')).body.spaces as Space[];
    expect(listed.find((s) => s.id === spaceId)).toMatchObject({ archived: false });

    expect((await archive(gagan())).status).toBe(403);
    expect((await archive(prakhar())).status).toBe(403); // not a member
    const dm = (await admin().post('/v1/direct', { memberId: 'gagan' })).body.space.id;
    expect((await archive(admin(), dm)).status).toBe(400);
    expect(await eventsOf('space_archived')).toHaveLength(0);
  });

  it('archiving flips the flag with one attributed event; again is a no-op', async () => {
    const r = await archive();
    expect(r.status).toBe(200);
    expect(routes.archiveSpace.response.parse(r.body).space).toMatchObject({ id: spaceId, archived: true });
    const [event] = await eventsOf('space_archived');
    expect(event!.event).toMatchObject({ space: { id: spaceId, archived: true }, by: { memberId: 'ramnique', actingMode: 'direct' } });

    expect((await archive()).body.space.archived).toBe(true);
    expect(await eventsOf('space_archived')).toHaveLength(1);
  });

  it('an archived space refuses every write that adds to it', async () => {
    const forbidden = async (p: Promise<{ status: number; body: any }>) => {
      const r = await p;
      expect(r.status).toBe(403);
      expect(r.body.message).toMatch(/archived/);
    };
    await forbidden(gagan().post(`/v1/spaces/${spaceId}/messages`, { body: 'one more thing', actingMode: 'direct' }));
    await forbidden(gagan().post(`/v1/spaces/${spaceId}/messages/${rootId}/reactions`, { emoji: '👀', action: 'add', actingMode: 'direct' }));
    await forbidden(gagan().post(`/v1/spaces/${spaceId}/assets`, { path: 'b.md', newContent: 'b', reason: 'r', actingMode: 'direct' }));
    await forbidden(gagan().post(`/v1/spaces/${spaceId}/rename`, { name: 'Renamed', actingMode: 'direct' }));
    await forbidden(admin().post('/v1/invites', { spaceId }));
    await forbidden(admin().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['prakhar'], actingMode: 'direct' }));
    await forbidden(prakhar().post(`/v1/spaces/${spaceId}/join`));
    const upload = await fetch(`${harbor.url}/v1/spaces/${spaceId}/blobs`, {
      method: 'PUT',
      headers: { authorization: 'Bearer dev-gagan', 'x-blob-sha256': blobHash(PNG_1PX), 'content-type': 'image/png' },
      body: PNG_1PX,
    });
    expect(upload.status).toBe(403);
    // The agent face is refused the same way.
    expect((await refused(gaganAgent, 'post_message', { spaceId, body: 'via the agent' })).code).toBe('forbidden');
  });

  it('an archived space stays readable, listed with its flag, and leavable', async () => {
    const stream = await gagan().get(`/v1/spaces/${spaceId}/stream`);
    expect(stream.status).toBe(200);
    expect(JSON.stringify(stream.body)).toContain('shipping friday');
    expect((await gagan().get(`/v1/spaces/${spaceId}/assets/${notesId}`)).status).toBe(200);
    expect((await gagan().get(`/v1/spaces/${spaceId}/search?q=shipping`)).status).toBe(200);
    // Listings keep it, flagged — the client files it under Archived.
    expect(((await gagan().get('/v1/spaces')).body.spaces as Space[]).find((s) => s.id === spaceId)).toMatchObject({ archived: true });
    const browsed = (await prakhar().get('/v1/spaces/browse')).body.spaces as Array<{ space: Space }>;
    expect(browsed.find((b) => b.space.id === spaceId)?.space.archived).toBe(true);
    // Personal state and leaving still work.
    expect((await gagan().post(`/v1/spaces/${spaceId}/read`, { offset: 1 })).status).toBe(200);
    expect((await gagan().post(`/v1/spaces/${spaceId}/leave`)).status).toBe(200);
  });

  it('unarchive is an admin act too, flips it back with one event, and writes land again', async () => {
    expect((await unarchive(prakhar())).status).toBe(403);
    const r = await unarchive();
    expect(r.status).toBe(200);
    expect(r.body.space.archived).toBe(false);
    expect((await unarchive()).body.space.archived).toBe(false);
    expect(await eventsOf('space_unarchived')).toHaveLength(1);
    expect((await admin().post(`/v1/spaces/${spaceId}/messages`, { body: 'back', actingMode: 'direct' })).status).toBe(200);
  });

  it('the agent face: archive_space and unarchive_space, attributed to the member', async () => {
    expect((await refused(gaganAgent, 'archive_space', { spaceId })).code).toBe('forbidden');
    expect((await call<{ space: Space }>(ramAgent, 'archive_space', { spaceId })).space.archived).toBe(true);
    const archived = await eventsOf('space_archived');
    expect(archived.at(-1)!.event).toMatchObject({ by: { memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' } });
    expect((await call<{ space: Space }>(ramAgent, 'unarchive_space', { spaceId })).space.archived).toBe(false);
    expect(await eventsOf('space_unarchived')).toHaveLength(2);
  });
});
