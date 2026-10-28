import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, type Member, type Space } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// Admin controls (spec §4 Roles, built 2026-10-19): removing someone from a
// space or from the org, promoting and demoting admins, a space's visibility,
// and the invite policy. Membership and policy, never content; never on a DM.
// Reactivation by a later invite needs a real identity binding, so it is
// pinned in multi-org.test.ts.

let harbor: RunningHarbor;
let ramAgent: Client;
let gaganAgent: Client;
const admin = () => restClient(harbor, 'dev-ramnique'); // the seed space's creator is the org's admin
const gagan = () => restClient(harbor, 'dev-gagan');
const prakhar = () => restClient(harbor, 'dev-prakhar');
const direct = { actingMode: 'direct' } as const;
const roster = async (): Promise<Member[]> => (await admin().get('/v1/members')).body.members;
const memberOf = async (id: string) => (await roster()).find((m) => m.id === id)!;

async function newSpace(name: string, visibility: 'open' | 'private' = 'private', members: string[] = ['gagan', 'prakhar']): Promise<string> {
  const id = (await admin().post('/v1/spaces', { name, visibility })).body.space.id as string;
  await admin().post(`/v1/spaces/${id}/members`, { memberIds: members, ...direct });
  return id;
}

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
      { id: 'arjun', displayName: 'Arjun' },
      { id: 'tushar', displayName: 'Tushar' },
    ],
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
  });
  ramAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
  gaganAgent = await agentClient(harbor, 'dev-gagan', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await ramAgent.close();
  await gaganAgent.close();
  await harbor.close();
});

describe('remove a member from a space', () => {
  it('an admin removes; the log says who, and the removed member’s socket is told', async () => {
    const spaceId = await newSpace('Launch');
    const live = await liveClient(harbor, 'dev-prakhar');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((f) => f.some((x) => x.kind === 'subscribed'), 'subscribed');

    const res = await admin().post(`/v1/spaces/${spaceId}/members/prakhar/remove`, direct);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: true });

    const removed = (await harbor.store.listEventsAfter(spaceId, 0)).filter(
      (e) => e.event.type === 'membership' && e.event.action === 'removed',
    );
    expect(removed).toHaveLength(1);
    expect(removed[0]!.event).toMatchObject({ membership: { memberId: 'prakhar' }, by: { memberId: 'ramnique', actingMode: 'direct' } });
    await live.until((f) => f.some((x) => x.kind === 'space_removed' && x.spaceId === spaceId && x.by === 'ramnique'), 'space_removed');
    live.close();

    expect((await prakhar().get(`/v1/spaces/${spaceId}/stream`)).status).toBe(403);
    // Again: not in the space, a no-op with no event.
    expect((await admin().post(`/v1/spaces/${spaceId}/members/prakhar/remove`, direct)).body).toEqual({ removed: false });
    expect((await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === 'membership' && e.event.action === 'removed')).toHaveLength(1);
  });

  it('refuses a non-admin, yourself, a DM, and a space the admin is not in', async () => {
    const spaceId = await newSpace('Refusals');
    expect((await gagan().post(`/v1/spaces/${spaceId}/members/prakhar/remove`, direct)).status).toBe(403);
    expect((await admin().post(`/v1/spaces/${spaceId}/members/ramnique/remove`, direct)).status).toBe(400);
    const dm = (await admin().post('/v1/direct', { memberId: 'gagan' })).body.space.id;
    expect((await admin().post(`/v1/spaces/${dm}/members/gagan/remove`, direct)).status).toBe(400);
    const theirs = (await gagan().post('/v1/spaces', { name: 'Gagan only' })).body.space.id;
    expect((await admin().post(`/v1/spaces/${theirs}/members/gagan/remove`, direct)).status).toBe(403);
  });

  it('works on an archived space, which only shrinks', async () => {
    const spaceId = await newSpace('Old');
    await admin().post(`/v1/spaces/${spaceId}/archive`, direct);
    expect((await admin().post(`/v1/spaces/${spaceId}/members/gagan/remove`, direct)).body).toEqual({ removed: true });
  });

  it('the agent face: an admin’s agent removes, attributed as the agent', async () => {
    const spaceId = await newSpace('Agentic');
    expect(await call(ramAgent, 'remove_member', { spaceId, memberId: 'gagan' })).toEqual({ removed: true });
    const ev = (await harbor.store.listEventsAfter(spaceId, 0)).find((e) => e.event.type === 'membership' && e.event.action === 'removed');
    expect(ev!.event).toMatchObject({ by: { memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' } });
    expect((await refused(gaganAgent, 'remove_member', { spaceId, memberId: 'prakhar' })).code).toBe('forbidden');
  });
});

describe('change a space’s visibility', () => {
  it('an admin opens and closes a space; the event says who; the same value is a no-op', async () => {
    const spaceId = await newSpace('Plans', 'private', ['gagan']);
    expect((await prakhar().get('/v1/spaces/browse')).body.spaces.map((s: { space: Space }) => s.space.id)).not.toContain(spaceId);

    const opened = await admin().post(`/v1/spaces/${spaceId}/visibility`, { visibility: 'open', ...direct });
    expect(opened.status).toBe(200);
    expect(opened.body.space.visibility).toBe('open');
    expect((await prakhar().get('/v1/spaces/browse')).body.spaces.map((s: { space: Space }) => s.space.id)).toContain(spaceId);

    // A reader who is not a member is cut off when it goes private.
    const live = await liveClient(harbor, 'dev-prakhar');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((f) => f.some((x) => x.kind === 'subscribed' && x.spaceId === spaceId), 'subscribed');
    expect((await admin().post(`/v1/spaces/${spaceId}/visibility`, { visibility: 'private', ...direct })).body.space.visibility).toBe('private');
    await live.until((f) => f.some((x) => x.kind === 'space_removed' && x.spaceId === spaceId), 'space_removed');
    await live.until((f) => f.some((x) => x.kind === 'org_changed'), 'org_changed');
    live.close();
    expect((await prakhar().get(`/v1/spaces/${spaceId}/stream`)).status).toBe(403);

    await admin().post(`/v1/spaces/${spaceId}/visibility`, { visibility: 'private', ...direct });
    const changes = (await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === 'space_visibility_changed');
    expect(changes).toHaveLength(2);
    expect(changes[0]!.event).toMatchObject({ space: { visibility: 'open' }, by: { memberId: 'ramnique' } });
  });

  it('refuses a non-admin, a DM, and an archived space', async () => {
    const spaceId = await newSpace('Closed', 'private', ['gagan']);
    expect((await gagan().post(`/v1/spaces/${spaceId}/visibility`, { visibility: 'open', ...direct })).status).toBe(403);
    const dm = (await admin().post('/v1/direct', { memberId: 'prakhar' })).body.space.id;
    expect((await admin().post(`/v1/spaces/${dm}/visibility`, { visibility: 'open', ...direct })).status).toBe(400);
    await admin().post(`/v1/spaces/${spaceId}/archive`, direct);
    expect((await admin().post(`/v1/spaces/${spaceId}/visibility`, { visibility: 'open', ...direct })).status).toBe(403);
  });

  it('a default space stays open until an admin takes it off the defaults', async () => {
    const spaceId = await newSpace('Welcome', 'open', ['gagan']);
    await admin().post(`/v1/spaces/${spaceId}/default`, { isDefault: true, ...direct });
    const refused = await admin().post(`/v1/spaces/${spaceId}/visibility`, { visibility: 'private', ...direct });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('default space');
    await admin().post(`/v1/spaces/${spaceId}/default`, { isDefault: false, ...direct });
    expect((await admin().post(`/v1/spaces/${spaceId}/visibility`, { visibility: 'private', ...direct })).body.space.visibility).toBe('private');
  });

  it('the agent face', async () => {
    const spaceId = await newSpace('Tooled', 'private', ['gagan']);
    const { space } = await call<{ space: Space }>(ramAgent, 'set_space_visibility', { spaceId, visibility: 'open' });
    expect(space.visibility).toBe('open');
    expect((await refused(gaganAgent, 'set_space_visibility', { spaceId, visibility: 'private' })).code).toBe('forbidden');
  });
});

describe('promote and demote admins', () => {
  it('an admin promotes a person; the same role is a no-op; members can’t', async () => {
    expect((await gagan().post('/v1/members/arjun/role', { role: 'admin', ...direct })).status).toBe(403);
    const live = await liveClient(harbor, 'dev-arjun');
    const res = await admin().post('/v1/members/arjun/role', { role: 'admin', ...direct });
    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe('admin');
    await live.until((f) => f.some((x) => x.kind === 'org_changed'), 'org_changed');
    live.close();
    expect((await admin().post('/v1/members/arjun/role', { role: 'admin', ...direct })).body.member.role).toBe('admin');
    // The new admin can act as one.
    expect((await restClient(harbor, 'dev-arjun').post('/v1/members/arjun/role', { role: 'member', ...direct })).body.member.role).toBe('member');
  });

  it('keeps at least one admin: the last one can’t step down', async () => {
    const res = await admin().post('/v1/members/ramnique/role', { role: 'member', ...direct });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('at least one admin');
    expect((await memberOf('ramnique')).role).toBe('admin');
  });

  it('two admins demoting each other at once leave one admin', async () => {
    await admin().post('/v1/members/tushar/role', { role: 'admin', ...direct });
    const tushar = restClient(harbor, 'dev-tushar');
    const [a, b] = await Promise.all([
      admin().post('/v1/members/tushar/role', { role: 'member', ...direct }),
      tushar.post('/v1/members/ramnique/role', { role: 'member', ...direct }),
    ]);
    const admins = (await roster()).filter((m) => m.role === 'admin');
    expect(admins).toHaveLength(1);
    expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    // Restore: Ramnique stays the admin the rest of the file expects.
    if (admins[0]!.id !== 'ramnique') {
      await tushar.post('/v1/members/ramnique/role', { role: 'admin', ...direct });
      await admin().post('/v1/members/tushar/role', { role: 'member', ...direct });
    }
    expect((await memberOf('ramnique')).role).toBe('admin');
  });

  it('an agent is never an admin', async () => {
    const agent = (await gagan().post('/v1/agents', { displayName: 'Helper' })).body.agent as Member;
    const res = await admin().post(`/v1/members/${agent.id}/role`, { role: 'admin', ...direct });
    expect(res.status).toBe(400);
  });

  it('the agent face', async () => {
    const { member } = await call<{ member: Member }>(ramAgent, 'set_member_role', { memberId: 'arjun', role: 'admin' });
    expect(member.role).toBe('admin');
    await call(ramAgent, 'set_member_role', { memberId: 'arjun', role: 'member' });
    expect((await refused(gaganAgent, 'set_member_role', { memberId: 'gagan', role: 'admin' })).code).toBe('forbidden');
  });
});

describe('the invite policy', () => {
  it('members by default; an admin restricts it to admins, and then members can’t invite', async () => {
    const spaceId = await newSpace('Invites', 'private', ['gagan']);
    expect((await gagan().get('/v1/org/settings')).body.settings).toEqual({ invitePolicy: 'members' });
    expect((await gagan().post('/v1/invites', { spaceId })).status).toBe(200);

    expect((await gagan().patch('/v1/org/settings', { invitePolicy: 'admins' })).status).toBe(403);
    const set = await admin().patch('/v1/org/settings', { invitePolicy: 'admins' });
    expect(set.status).toBe(200);
    expect(set.body.settings).toEqual({ invitePolicy: 'admins' });

    const refusedInvite = await gagan().post('/v1/invites', { spaceId });
    expect(refusedInvite.status).toBe(403);
    expect(refusedInvite.body.message).toContain('only admins');
    expect((await admin().post('/v1/invites', { spaceId })).status).toBe(200);
    // Adding an existing member isn't an invite: the policy doesn't touch it.
    expect((await gagan().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['arjun'], ...direct })).status).toBe(200);

    expect((await refused(gaganAgent, 'create_invite', { spaceId })).code).toBe('forbidden');
    expect(await call(gaganAgent, 'get_org_settings', {})).toEqual({ settings: { invitePolicy: 'admins' } });
    expect(await call(ramAgent, 'set_invite_policy', { invitePolicy: 'members' })).toEqual({ settings: { invitePolicy: 'members' } });
    expect((await gagan().post('/v1/invites', { spaceId })).status).toBe(200);
  });
});

describe('remove a member from the org', () => {
  it('out of every shared space, kept on the roster marked removed, refused at sign-in; DMs stay', async () => {
    const a = await newSpace('Alpha', 'open', ['prakhar']);
    const b = await newSpace('Beta', 'private', ['prakhar']);
    const dm = (await admin().post('/v1/direct', { memberId: 'prakhar' })).body.space.id;
    const posted = await prakhar().post(`/v1/spaces/${a}/messages`, { body: 'hi', ...direct });
    const owned = (await prakhar().post('/v1/agents', { displayName: 'Prakhar’s bot' })).body;
    expect((await restClient(harbor, owned.key.secret).get('/v1/me')).status).toBe(200);
    await prakhar().post('/v1/members/prakhar/role', { role: 'admin', ...direct }); // refused: not an admin
    await admin().post('/v1/members/prakhar/role', { role: 'admin', ...direct });

    const live = await liveClient(harbor, 'dev-prakhar');
    const res = await admin().post('/v1/members/prakhar/remove', direct);
    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ id: 'prakhar', role: 'member', removedAt: expect.any(String) });
    await live.until((f) => f.filter((x) => x.kind === 'space_removed').length >= 2, 'space_removed ×2');
    live.close();

    for (const spaceId of [a, b]) {
      const ev = (await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === 'membership' && e.event.action === 'removed');
      expect(ev).toHaveLength(1);
      expect(ev[0]!.event).toMatchObject({ membership: { memberId: 'prakhar' }, by: { memberId: 'ramnique' } });
    }
    expect(await harbor.store.getMembership(dm, 'prakhar')).toBeDefined();
    expect(posted.body.message.author.memberId).toBe('prakhar');
    expect((await memberOf('prakhar')).removedAt).toEqual(expect.any(String));

    const signIn = await prakhar().get('/v1/spaces');
    expect(signIn.status).toBe(403);
    expect(signIn.body.code).toBe('not_a_member');
    expect((await restClient(harbor, owned.key.secret).get('/v1/me')).status).toBe(401);

    const add = await admin().post(`/v1/spaces/${a}/members`, { memberIds: ['prakhar'], ...direct });
    expect(add.status).toBe(400);
    expect(add.body.message).toContain('no longer in this org');

    // Idempotent: nothing left to remove, no second event.
    expect((await admin().post('/v1/members/prakhar/remove', direct)).status).toBe(200);
    expect((await harbor.store.listEventsAfter(a, 0)).filter((e) => e.event.type === 'membership' && e.event.action === 'removed')).toHaveLength(1);
  });

  it('refuses a non-admin and yourself', async () => {
    expect((await gagan().post('/v1/members/arjun/remove', direct)).status).toBe(403);
    expect((await admin().post('/v1/members/ramnique/remove', direct)).status).toBe(400);
    expect((await admin().post('/v1/members/nobody/remove', direct)).status).toBe(404);
  });

  it('removes an agent too, and the agent face can do it', async () => {
    const agent = (await gagan().post('/v1/agents', { displayName: 'Scratch' })).body;
    const { member } = await call<{ member: Member }>(ramAgent, 'remove_org_member', { memberId: agent.agent.id });
    expect(member.removedAt).toEqual(expect.any(String));
    expect((await restClient(harbor, agent.key.secret).get('/v1/me')).status).toBe(401);
    expect((await refused(gaganAgent, 'remove_org_member', { memberId: 'arjun' })).code).toBe('forbidden');
  });
});
