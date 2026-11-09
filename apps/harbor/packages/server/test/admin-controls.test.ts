import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// Admin controls (spec §4 Roles, built 2026-10-19; per space since 2026-11-09):
// removing someone from a space, giving and taking the admin bit, and the
// longest-standing human inheriting it when the last admin goes. Membership
// acts, never content; never on a DM. The creator of a space is its admin.

let harbor: RunningHarbor;
let ramAgent: Client;
let gaganAgent: Client;
const admin = () => restClient(harbor, 'dev-ramnique'); // creates every space here, so is its admin
const gagan = () => restClient(harbor, 'dev-gagan');
const prakhar = () => restClient(harbor, 'dev-prakhar');
const direct = { actingMode: 'direct' } as const;
const roleOf = async (spaceId: string, id: string, client = admin()) => ((await client.get(`/v1/spaces/${spaceId}/members`)).body.members as Array<Member & { role: string }>).find((m) => m.id === id)?.role;
const roleEvents = async (spaceId: string) => (await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === 'role_changed');

async function newSpace(name: string, members: string[] = ['gagan', 'prakhar']): Promise<string> {
  const id = (await admin().post('/v1/spaces', { name })).body.space.id as string;
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
    name: 'Rowboat Labs',
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

describe('give and take the admin bit (spec §4 Roles, 2026-11-09)', () => {
  it('the creator is admin; an admin promotes a member; the same role is a no-op; members can’t', async () => {
    const spaceId = await newSpace('Roles', ['gagan', 'arjun']);
    expect(await roleOf(spaceId, 'ramnique')).toBe('admin');
    expect(await roleOf(spaceId, 'gagan')).toBe('member');
    expect((await gagan().post(`/v1/spaces/${spaceId}/members/arjun/role`, { role: 'admin', ...direct })).status).toBe(403);

    const live = await liveClient(harbor, 'dev-arjun');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((f) => f.some((x) => x.kind === 'subscribed'), 'subscribed');
    const res = await admin().post(`/v1/spaces/${spaceId}/members/arjun/role`, { role: 'admin', ...direct });
    expect(res.status).toBe(200);
    expect(res.body.membership).toMatchObject({ spaceId, memberId: 'arjun', role: 'admin' });
    await live.until((f) => f.some((x) => x.kind === 'event' && x.event.type === 'role_changed'), 'role_changed');
    live.close();
    const events = await roleEvents(spaceId);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toMatchObject({ membership: { memberId: 'arjun', role: 'admin' }, by: { memberId: 'ramnique', actingMode: 'direct' } });

    // The same role again: a no-op, no event.
    expect((await admin().post(`/v1/spaces/${spaceId}/members/arjun/role`, { role: 'admin', ...direct })).body.membership.role).toBe('admin');
    expect(await roleEvents(spaceId)).toHaveLength(1);
    // The new admin can act as one, and demote themself while another admin remains.
    const arjun = restClient(harbor, 'dev-arjun');
    expect((await arjun.post(`/v1/spaces/${spaceId}/members/gagan/role`, { role: 'admin', ...direct })).status).toBe(200);
    expect((await arjun.post(`/v1/spaces/${spaceId}/members/arjun/role`, { role: 'member', ...direct })).body.membership.role).toBe('member');
  });

  it('a space keeps at least one admin: the only one can’t step down', async () => {
    const spaceId = await newSpace('Solo admin', ['gagan']);
    const res = await admin().post(`/v1/spaces/${spaceId}/members/ramnique/role`, { role: 'member', ...direct });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('at least one admin');
    expect(await roleOf(spaceId, 'ramnique')).toBe('admin');
  });

  it('two admins demoting each other at once leave one admin', async () => {
    const spaceId = await newSpace('Duel', ['tushar']);
    await admin().post(`/v1/spaces/${spaceId}/members/tushar/role`, { role: 'admin', ...direct });
    const tushar = restClient(harbor, 'dev-tushar');
    const [a, b] = await Promise.all([
      admin().post(`/v1/spaces/${spaceId}/members/tushar/role`, { role: 'member', ...direct }),
      tushar.post(`/v1/spaces/${spaceId}/members/ramnique/role`, { role: 'member', ...direct }),
    ]);
    const members = (await admin().get(`/v1/spaces/${spaceId}/members`)).body.members as Array<{ role: string }>;
    expect(members.filter((m) => m.role === 'admin')).toHaveLength(1);
    expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
  });

  it('refuses an agent, someone not in the space, a DM, and an unknown member', async () => {
    const spaceId = await newSpace('Refusals', ['gagan']);
    const agent = (await gagan().post('/v1/agents', { displayName: 'Helper' })).body.agent as Member;
    await gagan().post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], ...direct });
    expect((await admin().post(`/v1/spaces/${spaceId}/members/${agent.id}/role`, { role: 'admin', ...direct })).status).toBe(400);
    expect((await admin().post(`/v1/spaces/${spaceId}/members/arjun/role`, { role: 'admin', ...direct })).status).toBe(400);
    const dm = (await admin().post('/v1/direct', { memberId: 'gagan' })).body.space.id;
    expect((await admin().post(`/v1/spaces/${dm}/members/gagan/role`, { role: 'admin', ...direct })).status).toBe(400);
    expect((await admin().post(`/v1/spaces/${spaceId}/members/nobody/role`, { role: 'admin', ...direct })).status).toBe(404);
  });

  it('when the last admin leaves, the longest-standing human inherits; agents never do', async () => {
    const spaceId = await newSpace('Inheritance', []);
    const agent = (await gagan().post('/v1/agents', { displayName: 'Early bot' })).body.agent as Member;
    await gagan().post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], ...direct }).catch(() => undefined);
    await admin().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['prakhar'], ...direct });
    await new Promise((r) => setTimeout(r, 5));
    await admin().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['tushar'], ...direct });
    await admin().post(`/v1/spaces/${spaceId}/leave`);
    expect(await roleOf(spaceId, 'prakhar', prakhar())).toBe('admin');
    expect(await roleOf(spaceId, 'tushar', prakhar())).toBe('member');
    const events = await roleEvents(spaceId);
    expect(events.at(-1)!.event).toMatchObject({ membership: { memberId: 'prakhar', role: 'admin' }, by: { memberId: 'ramnique' } });
    // The heir runs the space now.
    expect((await prakhar().post(`/v1/spaces/${spaceId}/members/tushar/role`, { role: 'admin', ...direct })).status).toBe(200);
  });

  it('removal by an admin passes the bit on the same way', async () => {
    const spaceId = await newSpace('Handover', ['gagan']);
    await admin().post(`/v1/spaces/${spaceId}/members/gagan/role`, { role: 'admin', ...direct });
    // Gagan, now admin, removes Ramnique: Gagan stays the admin; nothing to inherit.
    expect((await gagan().post(`/v1/spaces/${spaceId}/members/ramnique/remove`, direct)).body).toEqual({ removed: true });
    expect(await roleOf(spaceId, 'gagan', gagan())).toBe('admin');
  });

  it('the agent face', async () => {
    const spaceId = await newSpace('Tooled roles', ['gagan', 'arjun']);
    const { membership } = await call<{ membership: { role: string } }>(ramAgent, 'set_member_role', { spaceId, memberId: 'arjun', role: 'admin' });
    expect(membership.role).toBe('admin');
    await call(ramAgent, 'set_member_role', { spaceId, memberId: 'arjun', role: 'member' });
    expect((await refused(gaganAgent, 'set_member_role', { spaceId, memberId: 'gagan', role: 'admin' })).code).toBe('forbidden');
  });
});
