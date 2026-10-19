import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, routes, type Space } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// Team invites (spec §4 Invites and §5 answer 3, built 2026-10-19): an invite
// is to the org, with an optional list of spaces the inviter is in.
// Accepting joins the listed spaces, then the org's default spaces. A default
// is a flag on a shared open space that only an admin sets; flipping it is one
// `space_default_changed` event, and setting the flag a space has is a no-op.

let harbor: RunningHarbor;
let lobbyId: string; // open, the default
let launchId: string; // open, not a default
let secretId: string; // private, gagan and ramnique
let ramAgent: Client;
let gaganAgent: Client;
const admin = () => restClient(harbor, 'dev-ramnique'); // the seed space's creator is the org's admin
const gagan = () => restClient(harbor, 'dev-gagan');
const prakhar = () => restClient(harbor, 'dev-prakhar');
const setDefault = (id: string, isDefault: boolean, client = admin()) =>
  client.post(`/v1/spaces/${id}/default`, { isDefault, actingMode: 'direct' });
const defaultEvents = async (id: string) =>
  (await harbor.store.listEventsAfter(id, 0)).filter((e) => e.event.type === 'space_default_changed');
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
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
    ],
    seedSpaces: [{ name: 'Seed', creator: 'ramnique' }],
  });
  lobbyId = (await admin().post('/v1/spaces', { name: 'Lobby', visibility: 'open' })).body.space.id;
  launchId = (await admin().post('/v1/spaces', { name: 'Launch', visibility: 'open' })).body.space.id;
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

describe('default spaces', () => {
  it('a new space is not a default; only an admin sets one, and the event says who', async () => {
    const listed = (await admin().get('/v1/spaces')).body.spaces as Space[];
    expect(listed.find((s) => s.id === lobbyId)).toMatchObject({ isDefault: false });

    expect((await setDefault(lobbyId, true, gagan())).status).toBe(403);
    const r = await setDefault(lobbyId, true);
    expect(r.status).toBe(200);
    expect(routes.setDefaultSpace.response.parse(r.body).space).toMatchObject({ id: lobbyId, isDefault: true });
    const events = await defaultEvents(lobbyId);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toMatchObject({ type: 'space_default_changed', space: { isDefault: true }, by: { memberId: 'ramnique' } });

    // Browsing shows it; so does a member's listing.
    const browsed = (await prakhar().get('/v1/spaces/browse')).body.spaces as Array<{ space: Space }>;
    expect(browsed.find((b) => b.space.id === lobbyId)?.space.isDefault).toBe(true);
  });

  it('setting the flag a space already has is a no-op with no event', async () => {
    const before = (await defaultEvents(lobbyId)).length;
    expect((await setDefault(lobbyId, true)).body.space.isDefault).toBe(true);
    expect((await setDefault(launchId, false)).body.space.isDefault).toBe(false);
    expect(await defaultEvents(lobbyId)).toHaveLength(before);
    expect(await defaultEvents(launchId)).toHaveLength(0);
  });

  it('only a shared open space can be one: private spaces and DMs refuse', async () => {
    const privateId = (await admin().post('/v1/spaces', { name: 'Admins' })).body.space.id;
    const r = await setDefault(privateId, true);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'invalid_request', message: 'only an open space can be a default space' });
    const dm = (await admin().post('/v1/direct', { memberId: 'gagan' })).body.space.id;
    expect((await setDefault(dm, true)).body.code).toBe('invalid_request');
    // A private space the admin is not in is not theirs to read.
    expect((await setDefault(secretId, true, restClient(harbor, 'dev-prakhar'))).status).toBe(403);
    // The schema holds the rule too (migration 041).
    await expect(harbor.store.putSpace({ ...(await harbor.store.getSpace(privateId))!, isDefault: true })).rejects.toThrow();
  });

  it('an admin need not be in the space; an archived space cannot become one but can stop being one', async () => {
    const otherId = (await gagan().post('/v1/spaces', { name: 'Elsewhere', visibility: 'open' })).body.space.id;
    expect((await setDefault(otherId, true)).status).toBe(200);
    expect(await harbor.store.getMembership(otherId, 'ramnique')).toBeUndefined();
    await admin().post(`/v1/spaces/${otherId}/join`);
    await admin().post(`/v1/spaces/${otherId}/archive`, { actingMode: 'direct' });
    expect((await setDefault(otherId, false)).body.space.isDefault).toBe(false);
    expect((await setDefault(otherId, true)).status).toBe(403);
  });

  it('members watching the space get the event live', async () => {
    const live = await liveClient(harbor, 'dev-gagan');
    try {
      await gagan().post(`/v1/spaces/${launchId}/join`);
      live.send({ kind: 'subscribe', spaceId: launchId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed' && f.spaceId === launchId));
      await setDefault(launchId, true);
      await live.until((fs) => fs.some((f) => f.kind === 'event' && f.event.type === 'space_default_changed'));
      const frame = live.events().find((f) => f.event.type === 'space_default_changed');
      expect(frame).toMatchObject({ event: { space: { id: launchId, isDefault: true } } });
    } finally {
      live.close();
      await setDefault(launchId, false);
    }
  });
});

describe('invites to the org', () => {
  it('an invite listing nothing joins the defaults, and resolve names them pre-auth', async () => {
    const invite = (await prakhar().post('/v1/invites', {})).body;
    const resolved = await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token });
    expect(resolved.status).toBe(200);
    expect(routes.resolveInvite.response.parse(resolved.body)).toMatchObject({
      state: 'ok',
      org: { name: 'Rowboat Labs' },
      space: { id: lobbyId, name: 'Lobby' },
      spaces: [{ id: lobbyId, name: 'Lobby' }],
      invitedBy: 'Prakhar',
    });

    const { id, client } = newcomer();
    const accepted = await client.post('/v1/invites/accept', { token: invite.token });
    expect(accepted.status).toBe(200);
    const body = routes.acceptInvite.response.parse(accepted.body);
    expect(body.space?.id).toBe(lobbyId);
    expect(body.membership).toMatchObject({ spaceId: lobbyId, memberId: id });
    expect(body.spaces.map((s) => s.id)).toEqual([lobbyId]);
    expect(await joinedIds(id)).toEqual([lobbyId]);
  });

  it('listed spaces come first, in the order given, then the defaults; each join is one event', async () => {
    const invite = (await gagan().post('/v1/invites', { spaceIds: [secretId, launchId] })).body;
    await gagan().post(`/v1/spaces/${launchId}/join`);
    const resolved = (await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token })).body;
    expect(resolved.spaces.map((s: { id: string }) => s.id)).toEqual([secretId, launchId, lobbyId]);

    const { id, client } = newcomer();
    const body = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(body.space.id).toBe(secretId);
    expect(body.spaces.map((s: Space) => s.id)).toEqual([secretId, launchId, lobbyId]);
    for (const spaceId of [secretId, launchId, lobbyId]) {
      const joins = (await harbor.store.listEventsAfter(spaceId, 0))
        .filter((e) => e.event.type === 'membership' && e.event.membership.memberId === id);
      expect(joins, spaceId).toHaveLength(1);
    }

    // Accepting again writes nothing and answers the same.
    const head = await harbor.store.head(secretId);
    const again = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(again.spaces.map((s: Space) => s.id)).toEqual([secretId, launchId, lobbyId]);
    expect(await harbor.store.head(secretId)).toBe(head);
  });

  it('a member accepting joins the defaults too, and the joins reach their other connections', async () => {
    await prakhar().post(`/v1/spaces/${lobbyId}/leave`);
    const live = await liveClient(harbor, 'dev-prakhar');
    try {
      const invite = (await admin().post('/v1/invites', { spaceIds: [launchId] })).body;
      expect((await prakhar().post('/v1/invites/accept', { token: invite.token })).status).toBe(200);
      await live.until((fs) => fs.filter((f) => f.kind === 'space_added').length >= 2);
      expect(live.frames.filter((f) => f.kind === 'space_added').map((f) => (f as { spaceId: string }).spaceId).sort())
        .toEqual([launchId, lobbyId].sort());
      expect(await joinedIds('prakhar')).toEqual(expect.arrayContaining([launchId, lobbyId]));
    } finally {
      live.close();
    }
  });

  it('a per-space invite, as older clients make it, is the one-space case', async () => {
    const invite = (await gagan().post('/v1/invites', { spaceId: secretId })).body;
    const { id, client } = newcomer();
    const body = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(body.space.id).toBe(secretId);
    expect(await joinedIds(id)).toEqual(expect.arrayContaining([secretId, lobbyId]));
  });

  it('listing a space requires being in it; DMs and archived spaces refuse, nothing is written', async () => {
    expect((await prakhar().post('/v1/invites', { spaceIds: [secretId] })).body).toMatchObject({ code: 'forbidden' });
    const dm = (await gagan().post('/v1/direct', { memberId: 'prakhar' })).body.space.id;
    expect((await gagan().post('/v1/invites', { spaceIds: [launchId, dm] })).body.code).toBe('invalid_request');
    const archivedId = (await admin().post('/v1/spaces', { name: 'Old', visibility: 'open' })).body.space.id;
    await admin().post(`/v1/spaces/${archivedId}/archive`, { actingMode: 'direct' });
    expect((await admin().post('/v1/invites', { spaceIds: [archivedId] })).status).toBe(403);
    expect((await admin().post('/v1/invites', { spaceIds: ['01JZZZZZZZZZZZZZZZZZZZZZZZ'] })).status).toBe(404);
  });

  it('a listed space the inviter has left, or one archived since, is not joined; the rest still are', async () => {
    const tempId = (await gagan().post('/v1/spaces', { name: 'Temp' })).body.space.id;
    const archivingId = (await admin().post('/v1/spaces', { name: 'Winding down', visibility: 'open' })).body.space.id;
    await admin().post(`/v1/spaces/${archivingId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
    const invite = (await gagan().post('/v1/invites', { spaceIds: [tempId, archivingId, secretId] })).body;
    await gagan().post(`/v1/spaces/${tempId}/members`, { memberIds: ['ramnique'], actingMode: 'direct' });
    await gagan().post(`/v1/spaces/${tempId}/leave`);
    await admin().post(`/v1/spaces/${archivingId}/archive`, { actingMode: 'direct' });

    const resolved = (await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token })).body;
    expect(resolved.spaces.map((s: { id: string }) => s.id)).toEqual([secretId, lobbyId]);
    const { id, client } = newcomer();
    const body = (await client.post('/v1/invites/accept', { token: invite.token })).body;
    expect(body.spaces.map((s: Space) => s.id)).toEqual([secretId, lobbyId]);
    expect(await harbor.store.getMembership(tempId, id)).toBeUndefined();
    expect(await harbor.store.getMembership(archivingId, id)).toBeUndefined();
  });

  it('with no live default and nothing listed, accepting joins the org and lands nowhere', async () => {
    await setDefault(lobbyId, false);
    try {
      const invite = (await gagan().post('/v1/invites', {})).body;
      const resolved = (await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token })).body;
      expect(resolved).toMatchObject({ state: 'ok', spaces: [] });
      expect(resolved.space).toBeUndefined();
      const { id, client } = newcomer();
      const body = (await client.post('/v1/invites/accept', { token: invite.token })).body;
      expect(body).toEqual({ spaces: [] });
      expect(await harbor.store.getMember(id)).toBeDefined();
      expect(await joinedIds(id)).toEqual([]);
    } finally {
      await setDefault(lobbyId, true);
    }
  });

  it('the /join page names the org and the spaces it joins', async () => {
    const invite = (await gagan().post('/v1/invites', { spaceIds: [secretId] })).body;
    const html = await (await fetch(`${harbor.url}/join/${invite.token}`)).text();
    expect(html).toContain("You're invited to Rowboat Labs");
    expect(html).toContain("You'll join Secret and Lobby");
  });
});

describe('the agent face', () => {
  it('set_default_space is the admin act on both faces; create_invite lists spaces', async () => {
    expect((await refused(gaganAgent, 'set_default_space', { spaceId: launchId, isDefault: true })).code).toBe('forbidden');
    const set = await call<{ space: Space }>(ramAgent, 'set_default_space', { spaceId: launchId, isDefault: true });
    expect(set.space.isDefault).toBe(true);
    const events = await defaultEvents(launchId);
    expect(events.at(-1)!.event).toMatchObject({ by: { memberId: 'ramnique', agentName: 'Rowboat' } });
    await call(ramAgent, 'set_default_space', { spaceId: launchId, isDefault: false });

    const invite = await call<{ token: string }>(gaganAgent, 'create_invite', { spaceIds: [secretId] });
    const resolved = (await restClient(harbor, '').post('/v1/invites/resolve', { token: invite.token })).body;
    expect(resolved.spaces.map((s: { id: string }) => s.id)).toEqual([secretId, lobbyId]);
    const adminsOnly = (await admin().post('/v1/spaces', { name: 'Admins only' })).body.space.id;
    expect((await refused(gaganAgent, 'create_invite', { spaceIds: [lobbyId, adminsOnly] })).code).toBe('forbidden');
  });
});
