import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { routes, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, restClient, startTestHarbor } from './helpers.js';

// Personal agents (spec §4 Agent members, 2026-10-26): chosen when the agent
// is added, switched by its owner after (2026-10-27). Everyone sees it on the
// roster and reads its replies; only its owner invokes it, adds it to a
// space, or DMs it.

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
    orgName: 'Rowboat Labs',
    // A second space: a one-space org is a group chat, where DMs are off (2026-10-07).
    seedSpaces: [{ name: 'Lobby', creator: 'gagan' }],
    seedMembers: [
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
  });
  spaceId = (await as('dev-gagan').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-gagan').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
  const mine = await as('dev-gagan').post('/v1/agents', { displayName: "Gagan's Claude Code", personal: true });
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

describe('creating one', () => {
  it('marks the agent personal; an agent added without it is a channel agent, as before', async () => {
    expect(personal).toMatchObject({ kind: 'agent', ownerId: 'gagan', personal: true });
    expect(channel.personal).toBeUndefined();
    expect(await harbor.store.getMember(personal.id)).toMatchObject({ personal: true });
  });

  it('is on everyone’s roster, marked, like any member', async () => {
    const roster = (await as('dev-harsh').get('/v1/members')).body.members as Member[];
    expect(roster.find((m) => m.id === personal.id)).toMatchObject({ personal: true, ownerId: 'gagan' });
  });

  it('never changes after: an upsert keeps it', async () => {
    await harbor.store.putMember({ ...channel, personal: true });
    expect((await harbor.store.getMember(channel.id))?.personal).toBeUndefined();
    const { personal: _p, ...asChannel } = personal;
    await harbor.store.putMember(asChannel);
    expect((await harbor.store.getMember(personal.id))?.personal).toBe(true);
  });
});

describe('who may add it and DM it', () => {
  it('refuses anyone but its owner adding it to a space, on both faces', async () => {
    const r = await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [personal.id], actingMode: 'direct' });
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('only its owner can add it');
    const tool = await harshAgent.callTool({ name: 'add_members', arguments: { spaceId, memberIds: [personal.id] } });
    expect(tool.isError).toBe(true);
    expect(await harbor.store.getMembership(spaceId, personal.id)).toBeUndefined();
  });

  it('lets its owner add it', async () => {
    const r = await as('dev-gagan').post(`/v1/spaces/${spaceId}/members`, { memberIds: [personal.id], actingMode: 'direct' });
    expect(r.status).toBe(200);
    expect(await harbor.store.getMembership(spaceId, personal.id)).toBeDefined();
  });

  it('refuses anyone but its owner opening a DM with it', async () => {
    const r = await as('dev-harsh').post('/v1/direct', { memberId: personal.id });
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('only its owner can message it');
    expect((await as('dev-gagan').post('/v1/direct', { memberId: personal.id })).status).toBe(200);
  });

  it('leaves channel agents open to anyone, as before', async () => {
    expect((await as('dev-gagan').post('/v1/direct', { memberId: channel.id })).status).toBe(200);
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
      refusal: { reason: 'not_permitted', message: expect.stringContaining('only its owner can ask it') },
    });
  });

  it('refuses another agent’s hand-off', async () => {
    const r = await as(channelKey).post(`/v1/spaces/${spaceId}/messages`, { body: `${mention(personal)} take this one`, actingMode: 'direct' });
    expect(r.status).toBe(200);
    const { invocations } = routes.postMessage.response.parse(r.body);
    expect(invocations[0]).toMatchObject({ agentId: personal.id, state: 'refused', refusal: { reason: 'not_permitted' } });
  });

  it('leaves a channel agent invocable by anyone in the space', async () => {
    const { invocations } = await post('dev-gagan', `${mention(channel)} summarise`);
    expect(invocations[0]).toMatchObject({ agentId: channel.id, state: 'pending' });
  });
});

describe('switching it (2026-10-27)', () => {
  const setPersonal = (token: string, agent: Member, value: boolean) => as(token).put(`/v1/agents/${agent.id}/personal`, { personal: value });

  it('is its owner’s alone to switch', async () => {
    const r = await setPersonal('dev-gagan', channel, true);
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('only the agent’s owner');
    expect((await harbor.store.getMember(channel.id))?.personal).toBeUndefined();
  });

  it('turns a channel agent personal: from then on only its owner can ask it', async () => {
    const r = await setPersonal('dev-harsh', channel, true);
    expect(r.status).toBe(200);
    expect(r.body.agent).toMatchObject({ id: channel.id, personal: true });
    const roster = (await as('dev-gagan').get('/v1/members')).body.members as Member[];
    expect(roster.find((m) => m.id === channel.id)).toMatchObject({ personal: true });
    const { invocations } = await post('dev-gagan', `${mention(channel)} one more`);
    expect(invocations[0]).toMatchObject({ agentId: channel.id, state: 'refused', refusal: { reason: 'not_permitted' } });
  });

  it('turns it back: anyone in its spaces can ask it again; the same value twice is a no-op', async () => {
    expect((await setPersonal('dev-harsh', channel, false)).body.agent.personal).toBeUndefined();
    expect((await setPersonal('dev-harsh', channel, false)).status).toBe(200);
    const { invocations } = await post('dev-gagan', `${mention(channel)} and again`);
    expect(invocations[0]).toMatchObject({ agentId: channel.id });
    expect(invocations[0]?.refusal).toBeUndefined();
  });

  it('refuses a person, who is not an agent', async () => {
    expect((await as('dev-gagan').put('/v1/agents/harsh/personal', { personal: true })).status).toBe(404);
  });
});
