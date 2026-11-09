import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { routes, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// An agent's seat (spec §4 Agent members, 2026-11-09; personal agents from
// 2026-10-26 until then): you add an agent and it is yours; nobody knows it
// exists until you add it to a space, where its seat says who may ask it —
// everyone there, or you alone. Only its owner adds it, DMs it, or changes
// the seat; a local agent's seats are locked to its owner; your agents leave
// a space when you do.

let harbor: RunningHarbor;
let spaceId: string;
let personal: Member;
let channel: Member;
let channelKey: string;
let harshAgent: Client;
const as = (token: string) => restClient(harbor, token);
const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;

async function post(token: string, body: string) {
  const r = await as(token).post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct' });
  expect(r.status).toBe(200);
  return routes.postMessage.response.parse(r.body);
}

beforeAll(async () => {
  harbor = await startTestHarbor({
    name: 'Rowboat Labs',
    seedSpaces: [{ name: 'Lobby', creator: 'gagan' }],
    seedMembers: [
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
  });
  spaceId = (await as('dev-gagan').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-gagan').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
  const mine = await as('dev-gagan').post('/v1/agents', { displayName: "Gagan's Claude Code" });
  expect(mine.status).toBe(200);
  personal = mine.body.agent;
  const shared = await as('dev-harsh').post('/v1/agents', { displayName: 'Scout' });
  channel = shared.body.agent;
  channelKey = shared.body.key.secret;
  await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [channel.id], actingMode: 'direct' });
  harshAgent = await agentClient(harbor, 'dev-harsh', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await harshAgent.close();
  await harbor.close();
});

const seatOf = async (agent: Member) => (await harbor.store.getMembership(spaceId, agent.id))?.invocableBy;

describe('who may add it and DM it', () => {
  it('refuses anyone but its owner adding it to a space, on both faces', async () => {
    const r = await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [personal.id], actingMode: 'direct' });
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('only its owner can add');
    const tool = await harshAgent.callTool({ name: 'add_members', arguments: { spaceId, memberIds: [personal.id] } });
    expect(tool.isError).toBe(true);
    expect(await harbor.store.getMembership(spaceId, personal.id)).toBeUndefined();
  });

  it('lets its owner add it, choosing the seat: owner-only here', async () => {
    const r = await as('dev-gagan').post(`/v1/spaces/${spaceId}/members`, { memberIds: [personal.id], invocableBy: 'owner', actingMode: 'direct' });
    expect(r.status).toBe(200);
    expect(r.body.memberships[0]).toMatchObject({ memberId: personal.id, role: 'member', invocableBy: 'owner' });
    expect(await seatOf(personal)).toBe('owner');
    // Scout was added with no seat asked: everyone may ask it.
    expect(await seatOf(channel)).toBe('members');
    // Seats show on the space's roster, never on a person's row.
    const members = (await as('dev-harsh').get(`/v1/spaces/${spaceId}/members`)).body.members as Array<Member & { invocableBy?: string }>;
    expect(members.find((m) => m.id === personal.id)?.invocableBy).toBe('owner');
    expect(members.find((m) => m.id === 'harsh')?.invocableBy).toBeUndefined();
  });

  it('refuses anyone but its owner opening a DM with it; a DM seat is owner-only', async () => {
    const r = await as('dev-harsh').post('/v1/direct', { memberId: personal.id });
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('only its owner can message it');
    const dm = (await as('dev-gagan').post('/v1/direct', { memberId: personal.id })).body.space;
    expect(dm.kind).toBe('direct');
    expect((await harbor.store.getMembership(dm.id, personal.id))?.invocableBy).toBe('owner');
    // Someone else's agent, even one everyone may ask in a space, is not yours to DM (2026-11-09).
    expect((await as('dev-gagan').post('/v1/direct', { memberId: channel.id })).status).toBe(403);
    expect((await as('dev-harsh').post('/v1/direct', { memberId: channel.id })).status).toBe(200);
  });
});

describe('who may invoke it', () => {
  it('answers its owner', async () => {
    const { invocations } = await post('dev-gagan', `${mention(personal)} draft the release notes`);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ agentId: personal.id, state: 'pending' });
  });

  it('answers its owner acting through their own Rowboat: the person is the invoker', async () => {
    const r = await as('dev-gagan').post(`/v1/spaces/${spaceId}/messages`, { body: `${mention(personal)} and the changelog`, actingMode: 'agent', agentName: 'Rowboat' });
    const { invocations } = routes.postMessage.response.parse(r.body);
    expect(invocations[0]?.refusal).toBeUndefined();
  });

  it('refuses another person, saying why, and nothing is delivered', async () => {
    const { invocations } = await post('dev-harsh', `${mention(personal)} what is Gagan working on?`);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      agentId: personal.id,
      state: 'refused',
      refusal: { reason: 'not_permitted', message: expect.stringContaining('answers only its owner here') },
    });
  });

  it('refuses another agent’s hand-off', async () => {
    const r = await as(channelKey).post(`/v1/spaces/${spaceId}/messages`, { body: `${mention(personal)} take this one`, actingMode: 'direct' });
    expect(r.status).toBe(200);
    const { invocations } = routes.postMessage.response.parse(r.body);
    expect(invocations[0]).toMatchObject({ agentId: personal.id, state: 'refused', refusal: { reason: 'not_permitted' } });
  });

  it('leaves an agent seated for everyone invocable by anyone in the space', async () => {
    const { invocations } = await post('dev-gagan', `${mention(channel)} summarise`);
    expect(invocations[0]).toMatchObject({ agentId: channel.id, state: 'pending' });
  });
});

describe('changing the seat', () => {
  const setSeat = (token: string, agent: Member, invocableBy: 'owner' | 'members') =>
    as(token).put(`/v1/spaces/${spaceId}/members/${agent.id}/access`, { invocableBy, actingMode: 'direct' });
  const seatEvents = async () => (await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === 'agent_access_changed');

  it('is its owner’s alone', async () => {
    const r = await setSeat('dev-gagan', channel, 'owner');
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('only the agent’s owner');
    expect(await seatOf(channel)).toBe('members');
  });

  it('closes a seat to its owner: from then on only its owner can ask it; the event says who', async () => {
    const r = await setSeat('dev-harsh', channel, 'owner');
    expect(r.status).toBe(200);
    expect(r.body.membership).toMatchObject({ memberId: channel.id, invocableBy: 'owner' });
    expect((await seatEvents()).at(-1)!.event).toMatchObject({ type: 'agent_access_changed', membership: { memberId: channel.id, invocableBy: 'owner' }, by: { memberId: 'harsh' } });
    const { invocations } = await post('dev-gagan', `${mention(channel)} one more`);
    expect(invocations[0]).toMatchObject({ agentId: channel.id, state: 'refused', refusal: { reason: 'not_permitted' } });
  });

  it('opens it again: anyone in the space can ask it; the same value twice is a no-op', async () => {
    expect((await setSeat('dev-harsh', channel, 'members')).body.membership.invocableBy).toBe('members');
    const before = (await seatEvents()).length;
    expect((await setSeat('dev-harsh', channel, 'members')).status).toBe(200);
    expect(await seatEvents()).toHaveLength(before);
    const { invocations } = await post('dev-gagan', `${mention(channel)} and again`);
    expect(invocations[0]?.refusal).toBeUndefined();
  });

  it('refuses a person, an agent not in the space, and the agent face mirrors it', async () => {
    expect((await as('dev-gagan').put(`/v1/spaces/${spaceId}/members/harsh/access`, { invocableBy: 'owner', actingMode: 'direct' })).status).toBe(400);
    const elsewhere = (await as('dev-harsh').post('/v1/agents', { displayName: 'Elsewhere' })).body.agent as Member;
    expect((await setSeat('dev-harsh', elsewhere, 'owner')).status).toBe(400);
    const tool = await harshAgent.callTool({ name: 'set_agent_access', arguments: { spaceId, agentId: channel.id, invocableBy: 'owner' } });
    expect(tool.isError).toBeFalsy();
    expect(await seatOf(channel)).toBe('owner');
    await setSeat('dev-harsh', channel, 'members');
  });
});

describe('agents leave with their owner (2026-11-09)', () => {
  it('leaving takes your agents out of the space, one event each, and their connections are told', async () => {
    const room = (await as('dev-gagan').post('/v1/spaces', { name: 'Room' })).body.space.id as string;
    await as('dev-gagan').post(`/v1/spaces/${room}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
    await as('dev-harsh').post(`/v1/spaces/${room}/members`, { memberIds: [channel.id], actingMode: 'direct' });
    const live = await liveClient(harbor, channelKey);
    live.send({ kind: 'subscribe', spaceId: room });
    await live.until((f) => f.some((x) => x.kind === 'subscribed'), 'subscribed');
    await as('dev-harsh').post(`/v1/spaces/${room}/leave`);
    expect(await harbor.store.getMembership(room, channel.id)).toBeUndefined();
    const left = (await harbor.store.listEventsAfter(room, 0)).filter((e) => e.event.type === 'membership' && e.event.action === 'left');
    expect(left.map((e) => (e.event as { membership: { memberId: string } }).membership.memberId).sort()).toEqual(['harsh', channel.id].sort());
    await live.until((f) => f.some((x) => x.kind === 'space_removed' && x.spaceId === room), 'space_removed for the agent');
    live.close();
  });

  it('removal by an admin does the same, as "removed"', async () => {
    const room = (await as('dev-gagan').post('/v1/spaces', { name: 'Room 2' })).body.space.id as string;
    await as('dev-gagan').post(`/v1/spaces/${room}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
    await as('dev-harsh').post(`/v1/spaces/${room}/members`, { memberIds: [channel.id], actingMode: 'direct' });
    expect((await as('dev-gagan').post(`/v1/spaces/${room}/members/harsh/remove`, { actingMode: 'direct' })).body).toEqual({ removed: true });
    expect(await harbor.store.getMembership(room, channel.id)).toBeUndefined();
    const removed = (await harbor.store.listEventsAfter(room, 0)).filter((e) => e.event.type === 'membership' && e.event.action === 'removed');
    expect(removed).toHaveLength(2);
  });

  it('deleting your account deactivates your agents', async () => {
    const leaver = restClient(harbor, 'dev-leaver');
    const bot = (await leaver.post('/v1/agents', { displayName: 'Leaver bot' })).body.agent as Member;
    expect((await leaver.delete('/v1/me')).status).toBe(200);
    expect((await harbor.store.getMember(bot.id))?.deactivatedAt).toEqual(expect.any(String));
    expect((await harbor.store.getMember('leaver'))?.deactivatedAt).toEqual(expect.any(String));
  });
});
