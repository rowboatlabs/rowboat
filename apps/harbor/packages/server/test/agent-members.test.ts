import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, restClient, startTestHarbor } from './helpers.js';

// Agent members (spec §4, 2026-09-29): a member of kind 'agent' that acts as
// itself. Created by the integration that owns it (no route of its own yet),
// joined to spaces through ordinary membership, served on the roster with its
// kind, never admin, and never able to change kind.

let harbor: RunningHarbor;
let ramAgent: Client;
let spaceId: string;
let agent: Member;

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
  });
  const ramnique = restClient(harbor, 'dev-ramnique');
  spaceId = (await ramnique.post('/v1/spaces', { name: 'Payments' })).body.space.id;
  agent = await harbor.service.createAgent({ displayName: '  Replicas ' });
  // Ordinary membership: the same invite acceptance, and the same `joined`
  // event, a person's join leaves.
  const invite = await harbor.service.createInvite({ memberId: 'ramnique' }, spaceId);
  await harbor.service.acceptInvite({ memberId: agent.id }, invite.token);
  ramAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await ramAgent.close();
  await harbor.close();
});

describe('createAgent', () => {
  it('mints an id and stores an agent that is never admin', async () => {
    expect(agent).toEqual({ id: expect.any(String), displayName: 'Replicas', role: 'member', kind: 'agent' });
    expect(await harbor.store.getMember(agent.id)).toEqual(agent);
  });

  it('refuses an empty display name', async () => {
    await expect(harbor.service.createAgent({ displayName: '   ' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('keeps kind fixed: an upsert never turns an agent into a person, or back', async () => {
    await harbor.store.putMember({ ...agent, kind: 'human' });
    expect((await harbor.store.getMember(agent.id))?.kind).toBe('agent');
    const ram = (await harbor.store.getMember('ramnique'))!;
    await harbor.store.putMember({ ...ram, kind: 'agent' });
    expect((await harbor.store.getMember('ramnique'))?.kind).toBe('human');
  });

  it('cannot be made admin, even by a direct write', async () => {
    await expect(harbor.store.putMember({ ...agent, role: 'admin' })).rejects.toThrow(/members_agent_not_admin_check/);
    expect((await harbor.store.getMember(agent.id))?.role).toBe('member');
  });
});

describe('on the wire', () => {
  it('joins through ordinary membership, with the joined event', async () => {
    const replay = await harbor.service.replay({ memberId: 'ramnique' }, spaceId, 0);
    const joins = replay.events.filter((e) => e.event.type === 'membership').map((e) => e.event);
    expect(joins).toContainEqual(expect.objectContaining({ action: 'joined', membership: expect.objectContaining({ memberId: agent.id }) }));
  });

  it('serves its kind on both rosters, both faces', async () => {
    const ramnique = restClient(harbor, 'dev-ramnique');
    const space = await ramnique.get(`/v1/spaces/${spaceId}/members`);
    expect(space.body.members.find((m: Member) => m.id === agent.id)?.kind).toBe('agent');
    expect(space.body.members.find((m: Member) => m.id === 'ramnique')?.kind).toBe('human');
    const org = await ramnique.get('/v1/members');
    expect(org.body.members.find((m: Member) => m.id === agent.id)?.kind).toBe('agent');
    const tool = await ramAgent.callTool({ name: 'list_members', arguments: { spaceId } });
    const members = (tool.structuredContent as { members: Member[] }).members;
    expect(members.find((m) => m.id === agent.id)?.kind).toBe('agent');
  });

  it('posts as itself: the author is the agent, not a person via an agent', async () => {
    const { message } = await harbor.service.postMessage({ memberId: agent.id }, spaceId, {
      body: 'PR opened.',
      actingMode: 'direct',
    });
    expect(message.author).toEqual({ memberId: agent.id, actingMode: 'direct' });
  });
});
