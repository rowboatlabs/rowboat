import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { routes, type AgentListing, type Approval, type Invocation, type Member, type Message, type SuperAgentResult } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { maritimePlatform } from '../src/connectors/maritime/index.js';
import { maritimeProvisioner } from '../src/connectors/maritime/provisioning.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { FakeMaritime, GOOD_KEY } from './fake-maritime.js';
import { agentClient, freshStore, restClient } from './helpers.js';

// Super agents (spec §4 Agent members, 2026-11-02), end to end: an admin
// makes Harsh's agent a super agent; it creates a managed agent through the
// agent face, on a card Harsh decides in the thread it was asked in, or at
// once when the admin waived approval; and deletes only what it created,
// only when allowed.

const original = PLATFORMS.maritime;
let fake: FakeMaritime;
let harbor: RunningHarbor;
let spaceId: string;
let boss: Member;
let bossKey: string;
let bossMcp: Client;
const as = (token: string) => restClient(harbor, token);

async function setSuper(superAgent: Record<string, unknown> | null, token = 'dev-ramnique') {
  return as(token).put(`/v1/agents/${boss.id}/super`, { superAgent });
}

/** Harsh asks Boss in a fresh thread, and Boss takes it on: a working turn there. */
async function turn(): Promise<{ invocation: Invocation; rootId: string }> {
  const posted = routes.postMessage.response.parse(
    (await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body: `[@Boss](#member:${boss.id}) get this done`, actingMode: 'direct' })).body,
  );
  const invocation = posted.invocations[0]!;
  expect((await as(bossKey).post(`/v1/agent/invocations/${invocation.id}/ack`)).status).toBe(200);
  return { invocation, rootId: posted.message.id };
}

async function call(name: string, args: Record<string, unknown>): Promise<SuperAgentResult> {
  const result = await bossMcp.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent as SuperAgentResult;
}

async function refused(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await bossMcp.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  return (result.content as Array<{ text: string }>)[0]!.text;
}

const decide = (approval: Approval, decision: string, token = 'dev-harsh') =>
  as(token).post(`/v1/spaces/${spaceId}/approvals/${approval.id}/decide`, { decision, actingMode: 'direct' });

async function listing(agentId: string): Promise<AgentListing | undefined> {
  return ((await as('dev-harsh').get('/v1/agents')).body.agents as AgentListing[]).find((l) => l.agent.id === agentId);
}

async function inSpace(memberId: string): Promise<boolean> {
  return ((await as('dev-harsh').get(`/v1/spaces/${spaceId}/members`)).body.members as Member[]).some((m) => m.id === memberId);
}

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'e'.repeat(64);
  fake = await new FakeMaritime().start();
  PLATFORMS.maritime = maritimePlatform(fake.url, { pollMs: 40 });
  const { store } = await freshStore();
  harbor = await startHarbor({
    store,
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
    blobs: new MemoryBlobStore(),
    hosting: { provider: maritimeProvisioner({ apiKey: GOOD_KEY, base: fake.url, llmCapCents: 500 }), tickMs: 50 },
  });
  await store.putMember({ ...(await store.getMember('ramnique'))!, role: 'admin' });
  const created = await as('dev-harsh').post('/v1/agents', { displayName: 'Boss', kind: 'hermes', connection: 'plugin' });
  boss = created.body.agent;
  bossKey = created.body.key.secret;
  spaceId = (await as('dev-harsh').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['ramnique', boss.id], actingMode: 'direct' });
  bossMcp = await agentClient(harbor, bossKey);
});

afterAll(async () => {
  await bossMcp.close();
  await harbor.close();
  await fake.close();
  PLATFORMS.maritime = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('making a super agent', () => {
  it('has its tools listed to agents, never to a person’s assistant', async () => {
    const names = (await bossMcp.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['create_agent', 'delete_agent']));
    const person = await agentClient(harbor, 'dev-harsh');
    expect((await person.listTools()).tools.map((t) => t.name)).not.toContain('create_agent');
    await person.close();
  });

  it('is an ordinary agent until then, and creates nothing', async () => {
    const { rootId } = await turn();
    expect(await refused('create_agent', { spaceId, threadRootId: rootId, displayName: 'Helper', kind: 'hermes', reason: 'split the work' })).toMatch(/only a super agent can create agents/);
  });

  it('is an admin’s to grant, not the owner’s, and only for an agent', async () => {
    expect((await setSuper({}, 'dev-harsh')).status).toBe(403);
    expect((await as('dev-ramnique').put('/v1/agents/harsh/super', { superAgent: {} })).status).toBe(404);
    const made = await setSuper({});
    expect(made.status).toBe(200);
    expect(made.body.agent.superAgent).toEqual({ approval: 'always', canDelete: false });
    expect((await setSuper({ approval: 'always', canDelete: false })).body.agent.superAgent).toEqual({ approval: 'always', canDelete: false });
  });
});

describe('creating, with its owner’s approval', () => {
  let created: string;

  it('puts a card for its owner in the thread, without holding its turn', async () => {
    const { invocation, rootId } = await turn();
    const result = await call('create_agent', { spaceId, threadRootId: rootId, displayName: 'Helper', kind: 'hermes', reason: 'split the work' });
    expect(result.status).toBe('pending');
    expect(result.approval).toMatchObject({ state: 'open', agentId: boss.id, action: { kind: 'create_agent', displayName: 'Helper', agentKind: 'hermes' }, choices: ['allow_once', 'deny'] });
    const card = ((await as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${rootId}`)).body.messages as Message[]).find((m) => m.approval)!;
    expect(card.mentions).toEqual(['harsh']);
    expect(card.body).toContain('Create a Hermes agent named Helper');
    const after = ((await as('dev-harsh').get(`/v1/spaces/${spaceId}/invocations`)).body.invocations as Invocation[]).find((i) => i.id === invocation.id)!;
    expect(after.state).toBe('working');

    // Only the owner decides it, not an admin; and the connector never hears of it.
    expect((await decide(result.approval!, 'allow_once', 'dev-ramnique')).status).toBe(403);
    const decided = await decide(result.approval!, 'allow_once');
    expect(decided.status).toBe(200);
    const approval = decided.body.approval as Approval;
    expect(approval).toMatchObject({ state: 'allowed', outcome: { agentId: expect.any(String) }, appliedAt: expect.any(String) });
    created = approval.outcome!.agentId!;
    expect((await as(bossKey).get('/v1/agent/invocations')).body.approvals).toEqual([]);
  });

  it('made the agent its owner’s, asked for by the super agent, in the space', async () => {
    const l = (await listing(created))!;
    expect(l.agent).toMatchObject({ displayName: 'Helper', ownerId: 'harsh', agentKind: 'hermes', agentConnection: 'maritime' });
    expect(l.agent.personal).toBeUndefined();
    expect(l.hosting).toMatchObject({ createdBy: 'harsh', requestedBy: boss.id, funding: 'trial' });
    expect(await inSpace(created)).toBe(true);
  });

  it('outlives the turn that asked, and a deny creates nothing', async () => {
    const { invocation, rootId } = await turn();
    const result = await call('create_agent', { spaceId, threadRootId: rootId, displayName: 'Spare', kind: 'codex', reason: 'tests' });
    expect((await as(bossKey).post(`/v1/agent/invocations/${invocation.id}/update`, { state: 'done' })).status).toBe(200);
    const denied = await decide(result.approval!, 'deny');
    expect(denied.body.approval).toMatchObject({ state: 'denied' });
    expect(denied.body.approval.outcome).toBeUndefined();
    expect(((await as('dev-harsh').get('/v1/agents')).body.agents as AgentListing[]).some((l) => l.agent.displayName === 'Spare')).toBe(false);
  });

  it('is asked only in a thread it is working in, and never for Claude Code', async () => {
    const posted = (await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body: 'no agent here', actingMode: 'direct' })).body.message as Message;
    expect(await refused('create_agent', { spaceId, threadRootId: posted.id, displayName: 'X', kind: 'hermes', reason: 'r' })).toMatch(/thread you are working in/);
    expect(await refused('create_agent', { spaceId, threadRootId: posted.id, displayName: 'X', kind: 'claude-code', reason: 'r' })).toMatch(/invalid arguments/);
  });

  describe('deleting', () => {
    it('is refused until the admin allows it, and then only for what it created', async () => {
      const { rootId } = await turn();
      expect(await refused('delete_agent', { spaceId, threadRootId: rootId, agentId: created, reason: 'done' })).toMatch(/isn’t allowed to delete/);
      await setSuper({ approval: 'never', canDelete: true });
      const own = await as('dev-harsh').post('/v1/agents/managed', { displayName: 'Mine', kind: 'hermes' });
      expect(own.status).toBe(200);
      expect(await refused('delete_agent', { spaceId, threadRootId: rootId, agentId: own.body.agent.id, reason: 'tidy' })).toMatch(/only the agents it created/);
      const deleted = await call('delete_agent', { spaceId, threadRootId: rootId, agentId: created, reason: 'done' });
      expect(deleted).toMatchObject({ status: 'done', agent: { id: created }, hosting: { status: 'deleting' } });
    });
  });
});

describe('creating without approval', () => {
  // No card, so no turn is needed: any thread of the space will do.
  let rootId: string;
  beforeAll(async () => {
    rootId = ((await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body: 'kickoff', actingMode: 'direct' })).body.message as Message).id;
  });

  it('acts at once when the admin waived it', async () => {
    await setSuper({ approval: 'never', canDelete: false });
    const result = await call('create_agent', { spaceId, threadRootId: rootId, displayName: 'Quick', kind: 'hermes', reason: 'now' });
    expect(result).toMatchObject({ status: 'done', agent: { displayName: 'Quick', ownerId: 'harsh' }, hosting: { requestedBy: boss.id } });
    expect(await inSpace(result.agent!.id)).toBe(true);
  });

  it('stops when the admin makes it ordinary again', async () => {
    expect((await setSuper(null)).body.agent.superAgent).toBeUndefined();
    expect(await refused('create_agent', { spaceId, threadRootId: rootId, displayName: 'Again', kind: 'hermes', reason: 'r' })).toMatch(/only a super agent/);
  });
});
