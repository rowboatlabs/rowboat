import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, routes, type Space } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// Invites listing spaces (spec §4 Invites, built 2026-10-19; default spaces
// went with the orgs on 2026-11-09, and commit 4 of that change narrows an
// invite to one space or a person): accepting joins the listed spaces the
// inviter is still in, in the order given, and nothing else.

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

describe('invites listing spaces', () => {
  it('an invite listing nothing binds the newcomer and joins nothing; resolve says so pre-auth', async () => {
    const invite = (await prakhar().post('/v1/invites', {})).body;
    const resolved = await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token });
    expect(resolved.status).toBe(200);
    expect(routes.resolveInvite.response.parse(resolved.body)).toMatchObject({ state: 'ok', spaces: [], invitedBy: 'Prakhar' });
    expect(resolved.body.space).toBeUndefined();

    const { id, client } = newcomer();
    const accepted = await client.post('/v1/invites/accept', { token: invite.token });
    expect(accepted.status).toBe(200);
    expect(routes.acceptInvite.response.parse(accepted.body)).toEqual({ spaces: [] });
    expect(await harbor.store.getMember(id)).toBeDefined();
    expect(await joinedIds(id)).toEqual([]);
  });

  it('listed spaces are joined in the order given, each join one event; accepting again writes nothing', async () => {
    const invite = (await gagan().post('/v1/invites', { spaceIds: [secretId, launchId] })).body;
    const resolved = (await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token })).body;
    expect(resolved.spaces.map((s: { id: string }) => s.id)).toEqual([secretId, launchId]);

    const { id, client } = newcomer();
    const body = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(body.space.id).toBe(secretId);
    expect(body.membership).toMatchObject({ spaceId: secretId, memberId: id, role: 'member' });
    expect(body.spaces.map((s: Space) => s.id)).toEqual([secretId, launchId]);
    for (const spaceId of [secretId, launchId]) {
      const joins = (await harbor.store.listEventsAfter(spaceId, 0))
        .filter((e) => e.event.type === 'membership' && e.event.membership.memberId === id);
      expect(joins, spaceId).toHaveLength(1);
    }

    const head = await harbor.store.head(secretId);
    const again = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(again.spaces.map((s: Space) => s.id)).toEqual([secretId, launchId]);
    expect(await harbor.store.head(secretId)).toBe(head);
  });

  it('a member accepting joins the listed spaces, and the joins reach their other connections', async () => {
    const live = await liveClient(harbor, 'dev-prakhar');
    try {
      const invite = (await admin().post('/v1/invites', { spaceIds: [launchId] })).body;
      expect((await prakhar().post('/v1/invites/accept', { token: invite.token })).status).toBe(200);
      await live.until((fs) => fs.some((f) => f.kind === 'space_added'));
      expect(live.frames.filter((f) => f.kind === 'space_added').map((f) => (f as { spaceId: string }).spaceId)).toEqual([launchId]);
      expect(await joinedIds('prakhar')).toEqual(expect.arrayContaining([launchId]));
    } finally {
      live.close();
    }
  });

  it('a per-space invite, as older clients make it, is the one-space case', async () => {
    const invite = (await gagan().post('/v1/invites', { spaceId: secretId })).body;
    const { id, client } = newcomer();
    const body = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(body.space.id).toBe(secretId);
    expect(await joinedIds(id)).toEqual([secretId]);
  });

  it('listing a space requires being in it; DMs and archived spaces refuse, nothing is written', async () => {
    expect((await prakhar().post('/v1/invites', { spaceIds: [secretId] })).body).toMatchObject({ code: 'forbidden' });
    const dm = (await gagan().post('/v1/direct', { memberId: 'prakhar' })).body.space.id;
    expect((await gagan().post('/v1/invites', { spaceIds: [launchId, dm] })).body.code).toBe('invalid_request');
    const archivedId = (await admin().post('/v1/spaces', { name: 'Old' })).body.space.id;
    await admin().post(`/v1/spaces/${archivedId}/archive`, { actingMode: 'direct' });
    expect((await admin().post('/v1/invites', { spaceIds: [archivedId] })).status).toBe(403);
    expect((await admin().post('/v1/invites', { spaceIds: ['01JZZZZZZZZZZZZZZZZZZZZZZZ'] })).status).toBe(404);
  });

  it('a listed space the inviter has left, or one archived since, is not joined; the rest still are', async () => {
    const tempId = (await gagan().post('/v1/spaces', { name: 'Temp' })).body.space.id;
    const archivingId = (await admin().post('/v1/spaces', { name: 'Winding down' })).body.space.id;
    await admin().post(`/v1/spaces/${archivingId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
    const invite = (await gagan().post('/v1/invites', { spaceIds: [tempId, archivingId, secretId] })).body;
    await gagan().post(`/v1/spaces/${tempId}/members`, { memberIds: ['ramnique'], actingMode: 'direct' });
    await gagan().post(`/v1/spaces/${tempId}/leave`);
    await admin().post(`/v1/spaces/${archivingId}/archive`, { actingMode: 'direct' });

    const resolved = (await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token })).body;
    expect(resolved.spaces.map((s: { id: string }) => s.id)).toEqual([secretId]);
    const { id, client } = newcomer();
    const body = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(body.spaces.map((s: Space) => s.id)).toEqual([secretId]);
    expect(await harbor.store.getMembership(tempId, id)).toBeUndefined();
    expect(await harbor.store.getMembership(archivingId, id)).toBeUndefined();
  });

  it('the /join page names the spaces it joins (2026-11-09: there is no org to name)', async () => {
    const invite = (await gagan().post('/v1/invites', { spaceIds: [secretId] })).body;
    const html = await (await fetch(`${harbor.url}/join/${invite.token}`)).text();
    expect(html).toContain("You're invited to Secret");
  });
});

describe('the agent face', () => {
  it('create_invite lists spaces', async () => {
    const invite = await call<{ token: string }>(gaganAgent, 'create_invite', { spaceIds: [secretId] });
    const resolved = (await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token })).body;
    expect(resolved.spaces.map((s: { id: string }) => s.id)).toEqual([secretId]);
    expect((await refused(gaganAgent, 'create_invite', { spaceIds: [lobbyId] })).code).toBe('forbidden');
  });
});
