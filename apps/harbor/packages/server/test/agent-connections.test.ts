import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type AgentListing, type Invocation, type Member } from '@rowboat/spaces-protocol';
import { HostedConnectors } from '../src/connectors/host.js';
import { PLATFORMS, type ConnectorEnv, type ConnectorPlatform } from '../src/connectors/platforms.js';
import { HarborError } from '../src/errors.js';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// What an agent is and how Harbor reaches it, and the connectors Harbor runs
// (spec §4 Agent members and §8 Connectors, 2026-09-30), against a stand-in
// platform: the Replicas connector's own behavior is tested in its module.

let harbor: RunningHarbor;
let spaceId: string;
const as = (token: string) => restClient(harbor, token);
const TEST_KEY = 'a'.repeat(64);

const verified: string[] = [];
const envs = new Map<string, ConnectorEnv>();
const stopped: string[] = [];
const standIn: ConnectorPlatform = {
  async verify(secret) {
    verified.push(secret);
    if (secret === 'rpl_refused') throw new HarborError('invalid_request', 'Replicas refused this key');
  },
  start(env) {
    envs.set(env.agent.id, env);
    return { stop: async () => void stopped.push(env.agent.id) };
  },
};
const original = PLATFORMS.replicas;

async function agents(token = 'dev-ramnique'): Promise<AgentListing[]> {
  return (await as(token).get('/v1/agents')).body.agents;
}

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = TEST_KEY;
  PLATFORMS.replicas = standIn;
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
  });
  const gagan = (await harbor.store.getMember('gagan'))!;
  await harbor.store.putMember({ ...gagan, role: 'admin' });
  spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh', 'gagan'], actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
  if (original) PLATFORMS.replicas = original;
  else delete PLATFORMS.replicas;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('kind and connection', () => {
  it('defaults to custom/contract, and everyone sees them on the roster', async () => {
    const created = await as('dev-ramnique').post('/v1/agents', { displayName: 'Scout' });
    expect(created.body.agent).toMatchObject({ agentKind: 'custom', agentConnection: 'contract' });
    const roster = (await as('dev-harsh').get('/v1/members')).body.members as Member[];
    expect(roster.find((m) => m.id === created.body.agent.id)).toMatchObject({ agentKind: 'custom', agentConnection: 'contract' });
    expect(roster.find((m) => m.id === 'harsh')?.agentKind).toBeUndefined();
  });

  it('takes a listed pair, and refuses one it does not know', async () => {
    const hermes = await as('dev-ramnique').post('/v1/agents', { displayName: 'Hermes', kind: 'hermes', connection: 'plugin' });
    expect(hermes.body.agent).toMatchObject({ agentKind: 'hermes', agentConnection: 'plugin' });
    const odd = await as('dev-ramnique').post('/v1/agents', { displayName: 'Odd', kind: 'hermes', connection: 'replicas' });
    expect(odd).toMatchObject({ status: 400, body: { code: 'invalid_request' } });
  });

  it('takes a credential only for a platform, and needs one there', async () => {
    const extra = await as('dev-ramnique').post('/v1/agents', { displayName: 'X', kind: 'hermes', connection: 'plugin', credential: 'rpl_x' });
    expect(extra.status).toBe(400);
    const missing = await as('dev-ramnique').post('/v1/agents', { displayName: 'Y', kind: 'claude-code', connection: 'replicas' });
    expect(missing.status).toBe(400);
  });
});

describe('an agent Harbor reaches through a platform', () => {
  let agent: Member;

  it('is created only when the platform accepts its key', async () => {
    const before = (await agents()).length;
    const refused = await as('dev-ramnique').post('/v1/agents', { displayName: 'Claude', kind: 'claude-code', connection: 'replicas', credential: 'rpl_refused' });
    expect(refused).toMatchObject({ status: 400, body: { code: 'invalid_request', message: 'Replicas refused this key' } });
    expect(await agents()).toHaveLength(before);
  });

  it('is refused before the platform is asked when this Harbor cannot seal', async () => {
    delete process.env.HARBOR_INTEGRATION_KEY;
    const asked = verified.length;
    const before = (await agents()).length;
    const r = await as('dev-ramnique').post('/v1/agents', { displayName: 'Claude', kind: 'claude-code', connection: 'replicas', credential: 'rpl_live_1234' });
    process.env.HARBOR_INTEGRATION_KEY = TEST_KEY;
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/HARBOR_INTEGRATION_KEY/) } });
    expect(verified).toHaveLength(asked);
    expect(await agents()).toHaveLength(before);
  });

  it('seals its key, shows only its end, and starts its connector', async () => {
    const created = await as('dev-ramnique').post('/v1/agents', { displayName: 'Claude', kind: 'claude-code', connection: 'replicas', credential: 'rpl_live_ab12' });
    expect(created.status).toBe(200);
    agent = created.body.agent;
    expect(agent).toMatchObject({ agentKind: 'claude-code', agentConnection: 'replicas', ownerId: 'ramnique' });
    expect(created.body.key.secret).toMatch(/^rbk_/);
    expect(verified).toContain('rpl_live_ab12');
    const listed = (await agents()).find((a) => a.agent.id === agent.id)!;
    expect(listed.credential).toEqual({ hint: '…ab12', setBy: 'ramnique', setAt: expect.any(String) });
    const stored = (await harbor.store.getAgentCredential(agent.id))!;
    expect(stored.sealed).not.toContain('rpl_live_ab12');
    const env = envs.get(agent.id)!;
    expect(env.ctx).toEqual({ memberId: agent.id, agent: true });
    expect(await env.credential()).toBe('rpl_live_ab12');
  });

  it('marks a rejected key once, and a replacement from the owner clears it', async () => {
    const env = envs.get(agent.id)!;
    expect(await env.rejectCredential('Replicas says the key is invalid')).toBe(true);
    expect(await env.rejectCredential('again')).toBe(false);
    expect((await agents()).find((a) => a.agent.id === agent.id)!.credential).toMatchObject({
      rejectedAt: expect.any(String),
      rejectedReason: 'Replicas says the key is invalid',
    });
    const replaced = await as('dev-ramnique').put(`/v1/agents/${agent.id}/credential`, { secret: 'rpl_live_cd34' });
    expect(replaced.body.credential).toEqual({ hint: '…cd34', setBy: 'ramnique', setAt: expect.any(String) });
    expect((await agents()).find((a) => a.agent.id === agent.id)!.credential?.rejectedAt).toBeUndefined();
    expect(await env.credential()).toBe('rpl_live_cd34');
  });

  it('lets only the owner replace it, and only for a platform agent', async () => {
    expect((await as('dev-gagan').put(`/v1/agents/${agent.id}/credential`, { secret: 'rpl_admin' })).status).toBe(403);
    const refused = await as('dev-ramnique').put(`/v1/agents/${agent.id}/credential`, { secret: 'rpl_refused' });
    expect(refused.status).toBe(400);
    expect(await envs.get(agent.id)!.credential()).toBe('rpl_live_cd34');
    const scout = (await agents()).find((a) => a.agent.agentConnection === 'contract')!;
    expect((await as('dev-ramnique').put(`/v1/agents/${scout.agent.id}/credential`, { secret: 'rpl_x' })).status).toBe(400);
  });

  it('starts, at boot, a connector for every platform agent already there', async () => {
    envs.clear();
    const { SpaceHub } = await import('../src/hub.js');
    const host = new HostedConnectors({ store: harbor.store, hub: new SpaceHub(), service: harbor.service, orgId: 'org-default' });
    await host.startAll();
    expect([...envs.keys()]).toEqual([agent.id]);
    await host.stopAll();
    expect(stopped).toContain(agent.id);
  });
});

describe('a DM with an agent', () => {
  let hermes: Member;
  let dm: string;

  beforeAll(async () => {
    hermes = (await as('dev-harsh').post('/v1/agents', { displayName: 'Harsh’s Hermes', kind: 'hermes', connection: 'plugin' })).body.agent;
    await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [hermes.id], actingMode: 'direct' });
    dm = (await as('dev-ramnique').post('/v1/direct', { memberId: hermes.id })).body.space.id;
  });

  const postIn = async (space: string, token: string, body: string, extra: Record<string, unknown> = {}) =>
    routes.postMessage.response.parse((await as(token).post(`/v1/spaces/${space}/messages`, { body, actingMode: 'direct', ...extra })).body);

  it('every message the person posts invokes it, mention or not, with its options', async () => {
    const { invocations } = await postIn(dm, 'dev-ramnique', 'what is on my plate today?', { agentOptions: { [hermes.id]: { plan_first: true } } });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ agentId: hermes.id, state: 'pending', where: { spaceKind: 'direct' }, options: { plan_first: true } });
  });

  it('never invokes on the agent’s own post, or in a DM between people', async () => {
    const hermesKey = (await as('dev-harsh').post(`/v1/agents/${hermes.id}/keys`)).body.key.secret as string;
    expect((await postIn(dm, hermesKey, 'here is your plate')).invocations).toEqual([]);
    const people = (await as('dev-ramnique').post('/v1/direct', { memberId: 'harsh' })).body.space.id;
    expect((await postIn(people, 'dev-ramnique', 'lunch?')).invocations).toEqual([]);
  });
});

describe('a connector answering', () => {
  it('posts the answer and finishes the invocation together, once', async () => {
    const claude = (await agents()).find((a) => a.agent.agentKind === 'claude-code')!.agent;
    await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: [claude.id], actingMode: 'direct' });
    const posted = routes.postMessage.response.parse(
      (await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body: `[@Claude](#member:${claude.id}) fix the login bug`, actingMode: 'direct' })).body,
    );
    const invocation = posted.invocations[0]!;
    const ctx = { memberId: claude.id, agent: true };
    await harbor.service.acknowledgeInvocation(ctx, invocation.id);
    const { message } = await harbor.service.answerInvocation(ctx, invocation.id, 'Fixed in #42.');
    expect(message).toMatchObject({ threadRoot: posted.message.id, author: { memberId: claude.id }, body: 'Fixed in #42.' });
    const after = (await harbor.service.listAgentInvocations(ctx)).find((i: Invocation) => i.id === invocation.id);
    expect(after).toBeUndefined(); // done: no longer live
    await expect(harbor.service.answerInvocation(ctx, invocation.id, 'Fixed in #42.')).rejects.toMatchObject({ code: 'invalid_request' });
    const thread = (await as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${posted.message.id}`)).body.messages as Array<{ body: string }>;
    expect(thread.filter((m) => m.body === 'Fixed in #42.')).toHaveLength(1);
  });
});
