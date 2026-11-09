import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, routes, type Space } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// Invites (spec §4 Invites, rewritten 2026-11-09): an invite is to one space,
// or it is a person's link whose acceptance opens a DM with them. Anyone in a
// space may invite to it. Accepting binds a newcomer, then joins the space the
// inviter is still in, or opens the DM. The reach rule for DMs rides on it.

let harbor: RunningHarbor;
let lobbyId: string;
let launchId: string;
let secretId: string; // gagan and ramnique
let ramAgent: Client;
let gaganAgent: Client;
const admin = () => restClient(harbor, 'dev-ramnique');
const gagan = () => restClient(harbor, 'dev-gagan');
const prakhar = () => restClient(harbor, 'dev-prakhar');
let newcomers = 0;
/** A person new to the org: the dev driver makes the member on first sight, as a bind would. */
const newcomer = () => {
  const id = `new${++newcomers}`;
  return { id, client: restClient(harbor, `dev-${id}`) };
};
const joinedIds = async (memberId: string) =>
  (await restClient(harbor, `dev-${memberId}`).get('/v1/spaces')).body.spaces.map((s: Space) => s.id);

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
    name: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
    ],
    seedSpaces: [{ name: 'Seed', creator: 'ramnique' }],
  });
  lobbyId = (await admin().post('/v1/spaces', { name: 'Lobby' })).body.space.id;
  launchId = (await admin().post('/v1/spaces', { name: 'Launch' })).body.space.id;
  await admin().post(`/v1/spaces/${launchId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
  secretId = (await gagan().post('/v1/spaces', { name: 'Secret' })).body.space.id;
  await gagan().post(`/v1/spaces/${secretId}/members`, { memberIds: ['ramnique'], actingMode: 'direct' });
  ramAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
  gaganAgent = await agentClient(harbor, 'dev-gagan', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await ramAgent.close();
  await gaganAgent.close();
  await harbor.close();
});

describe('an invite to one space', () => {
  it('resolve names the space pre-auth; accepting binds a newcomer and joins it; again is a no-op', async () => {
    const invite = (await gagan().post('/v1/invites', { spaceId: secretId })).body;
    const resolved = await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token });
    expect(resolved.status).toBe(200);
    expect(routes.resolveInvite.response.parse(resolved.body)).toEqual({ state: 'ok', space: { id: secretId, name: 'Secret' }, invitedBy: 'Gagan' });

    const { id, client } = newcomer();
    const accepted = await client.post('/v1/invites/accept', { token: invite.token });
    expect(accepted.status).toBe(200);
    const body = routes.acceptInvite.response.parse(accepted.body);
    expect(body.space?.id).toBe(secretId);
    expect(body.membership).toMatchObject({ spaceId: secretId, memberId: id, role: 'member' });
    expect(await joinedIds(id)).toEqual([secretId]);
    const joins = (await harbor.store.listEventsAfter(secretId, 0)).filter((e) => e.event.type === 'membership' && e.event.membership.memberId === id);
    expect(joins).toHaveLength(1);

    const head = await harbor.store.head(secretId);
    const again = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(again.space.id).toBe(secretId);
    expect(await harbor.store.head(secretId)).toBe(head);
  });

  it('anyone in the space may invite; someone outside may not; a DM, an archived space and an unknown one refuse; one target exactly', async () => {
    expect((await prakhar().post('/v1/invites', { spaceId: secretId })).body).toMatchObject({ code: 'forbidden' });
    const dm = (await gagan().post('/v1/direct', { memberId: 'prakhar' })).body.space.id;
    expect((await gagan().post('/v1/invites', { spaceId: dm })).body.code).toBe('invalid_request');
    const archivedId = (await admin().post('/v1/spaces', { name: 'Old' })).body.space.id;
    await admin().post(`/v1/spaces/${archivedId}/archive`, { actingMode: 'direct' });
    expect((await admin().post('/v1/invites', { spaceId: archivedId })).status).toBe(403);
    expect((await admin().post('/v1/invites', { spaceId: '01JZZZZZZZZZZZZZZZZZZZZZZZ' })).status).toBe(404);
    expect((await admin().post('/v1/invites', {})).body.code).toBe('invalid_request');
    expect((await admin().post('/v1/invites', { spaceId: secretId, direct: true })).body.code).toBe('invalid_request');
  });

  it('a space the inviter has left, or one archived since, joins nothing', async () => {
    const tempId = (await gagan().post('/v1/spaces', { name: 'Temp' })).body.space.id;
    const left = (await gagan().post('/v1/invites', { spaceId: tempId })).body;
    await gagan().post(`/v1/spaces/${tempId}/members`, { memberIds: ['ramnique'], actingMode: 'direct' });
    await gagan().post(`/v1/spaces/${tempId}/leave`);
    expect((await restClient(harbor, '').post('/v1/invites/resolve', { token: left.token })).body).toEqual({ state: 'ok', invitedBy: 'Gagan' });
    const { id, client } = newcomer();
    expect((await client.post('/v1/invites/accept', { token: left.token })).body).toEqual({});
    expect(await harbor.store.getMembership(tempId, id)).toBeUndefined();

    const archivingId = (await admin().post('/v1/spaces', { name: 'Winding down' })).body.space.id;
    const archived = (await admin().post('/v1/invites', { spaceId: archivingId })).body;
    await admin().post(`/v1/spaces/${archivingId}/archive`, { actingMode: 'direct' });
    expect((await client.post('/v1/invites/accept', { token: archived.token })).body).toEqual({});
  });

  it('a member accepting joins too, and the join reaches their other connections', async () => {
    const live = await liveClient(harbor, 'dev-prakhar');
    try {
      const invite = (await admin().post('/v1/invites', { spaceId: launchId })).body;
      expect((await prakhar().post('/v1/invites/accept', { token: invite.token })).status).toBe(200);
      await live.until((fs) => fs.some((f) => f.kind === 'space_added'));
      expect(live.frames.filter((f) => f.kind === 'space_added').map((f) => (f as { spaceId: string }).spaceId)).toEqual([launchId]);
      expect(await joinedIds('prakhar')).toEqual(expect.arrayContaining([launchId]));
    } finally {
      live.close();
    }
  });

  it('the /join page names the space', async () => {
    const invite = (await gagan().post('/v1/invites', { spaceId: secretId })).body;
    const html = await (await fetch(`${harbor.url}/join/${invite.token}`)).text();
    expect(html).toContain("You're invited to Secret");
    expect(html).toContain('Invited by Gagan');
  });
});

describe('a personal link, and the reach rule for DMs', () => {
  it('a stranger cannot DM you; your link opens the DM, get-or-create; afterwards either side reaches the other', async () => {
    const { id, client } = newcomer();
    expect((await client.get('/v1/me')).status).toBe(200); // bound, in no space
    const refused = await client.post('/v1/direct', { memberId: 'gagan' });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain('share a space');
    expect((await gagan().post('/v1/direct', { memberId: id })).status).toBe(403);

    const link = (await gagan().post('/v1/invites', { direct: true })).body;
    const resolved = (await restClient(harbor, '').post('/v1/invites/resolve', { token: link.token })).body;
    expect(routes.resolveInvite.response.parse(resolved)).toEqual({ state: 'ok', direct: { id: 'gagan', displayName: 'Gagan' }, invitedBy: 'Gagan' });

    const live = await liveClient(harbor, 'dev-gagan');
    try {
      const accepted = routes.acceptInvite.response.parse((await client.post('/v1/invites/accept', { token: link.token })).body);
      expect(accepted.space).toMatchObject({ kind: 'direct', participants: [id, 'gagan'].sort() });
      expect(accepted.membership).toMatchObject({ spaceId: accepted.space!.id, memberId: id });
      await live.until((fs) => fs.some((f) => f.kind === 'space_added' && f.spaceKind === 'direct'));
      expect((await client.post('/v1/invites/accept', { token: link.token })).body.space.id).toBe(accepted.space!.id);
      expect((await gagan().post('/v1/direct', { memberId: id })).body.space.id).toBe(accepted.space!.id);
      expect((await client.post('/v1/direct', { memberId: 'gagan' })).body.space.id).toBe(accepted.space!.id);
    } finally {
      live.close();
    }
  });

  it('sharing a space is enough to DM; the maker’s own click opens nothing; the page names the person', async () => {
    const { id, client } = newcomer();
    const invite = (await admin().post('/v1/invites', { spaceId: launchId })).body;
    await client.post('/v1/invites/accept', { token: invite.token });
    expect((await client.post('/v1/direct', { memberId: 'ramnique' })).status).toBe(200);
    expect((await client.post('/v1/direct', { memberId: id })).status).toBe(200); // notes to self, always

    const link = (await admin().post('/v1/invites', { direct: true })).body;
    expect((await admin().post('/v1/invites/accept', { token: link.token })).body).toEqual({});
    const html = await (await fetch(`${harbor.url}/join/${link.token}`)).text();
    expect(html).toContain('Ramnique invited you to message them');
  });
});

describe('the agent face', () => {
  it('create_invite makes a space link or a personal link, and refuses both or neither', async () => {
    const space = await call<{ token: string }>(gaganAgent, 'create_invite', { spaceId: secretId });
    expect((await restClient(harbor, '').post('/v1/invites/resolve', { token: space.token })).body.space.id).toBe(secretId);
    const personal = await call<{ token: string }>(gaganAgent, 'create_invite', { direct: true });
    expect((await restClient(harbor, '').post('/v1/invites/resolve', { token: personal.token })).body.direct.id).toBe('gagan');
    expect((await refused(gaganAgent, 'create_invite', { spaceId: lobbyId })).code).toBe('forbidden');
    expect((await refused(gaganAgent, 'create_invite', {})).code).toBe('invalid_request');
  });
});
