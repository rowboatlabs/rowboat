import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { routes, type AgentListing, type Approval, type Invocation, type Member, type Message, type SuperAgentResult } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { agent37Platform } from '../src/connectors/agent37/index.js';
import { maritimePlatform } from '../src/connectors/maritime/index.js';
import { maritimeProvisioner } from '../src/connectors/maritime/provisioning.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { FakeAgent37, GOOD_KEY as AGENT37_KEY } from './fake-agent37.js';
import { FakeMaritime, GOOD_KEY } from './fake-maritime.js';
import { agentClient, freshStore, restClient } from './helpers.js';

// Super agents (spec §4 Agent members, 2026-11-02), end to end: an admin
// makes Harsh's agent a super agent; it creates a managed agent through the
// agent face, on a card Harsh decides in the thread it was asked in, or at
// once when the admin waived approval; and deletes only what it created,
// only when allowed.

const original = PLATFORMS.maritime;
const originalAgent37 = PLATFORMS.agent37;
let fake: FakeMaritime;
let fake37: FakeAgent37;
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
  fake37 = await new FakeAgent37().start();
  PLATFORMS.agent37 = agent37Platform(fake37.url, fake37.instanceUrl);
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
  await fake37.close();
  PLATFORMS.maritime = original!;
  PLATFORMS.agent37 = originalAgent37!;
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
    expect(made.body.agent.superAgent).toEqual({ askBeforeCreate: true, askBeforeDelete: true });
    expect((await setSuper({ askBeforeCreate: true, askBeforeDelete: true })).body.agent.superAgent).toEqual({ askBeforeCreate: true, askBeforeDelete: true });
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

  it('is asked only in a thread it is working in, and never for an agent on its owner’s computer', async () => {
    const posted = (await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body: 'no agent here', actingMode: 'direct' })).body.message as Message;
    expect(await refused('create_agent', { spaceId, threadRootId: posted.id, displayName: 'X', kind: 'hermes', reason: 'r' })).toMatch(/thread you are working in/);
    const { rootId } = await turn();
    expect(await refused('create_agent', { spaceId, threadRootId: rootId, displayName: 'X', kind: 'claude-code', connection: 'local', reason: 'r' })).toMatch(/can’t create claude-code on local/);
    expect(await refused('create_agent', { spaceId, threadRootId: rootId, displayName: 'X', kind: 'jev', connection: 'builtin', reason: 'r' })).toMatch(/can’t create/);
  });

  describe('deleting', () => {
    it('asks its owner first by default, and only ever for what it created', async () => {
      const { rootId } = await turn();
      const own = await as('dev-harsh').post('/v1/agents/managed', { displayName: 'Mine', kind: 'hermes' });
      expect(own.status).toBe(200);
      expect(await refused('delete_agent', { spaceId, threadRootId: rootId, agentId: own.body.agent.id, reason: 'tidy' })).toMatch(/only the agents it created/);
      const asked = await call('delete_agent', { spaceId, threadRootId: rootId, agentId: created, reason: 'done' });
      expect(asked).toMatchObject({ status: 'pending', approval: { action: { kind: 'delete_agent', agentId: created }, choices: ['allow_once', 'deny'] } });
      const decided = await decide(asked.approval!, 'allow_once');
      expect(decided.body.approval).toMatchObject({ state: 'allowed', outcome: { agentId: created } });
      expect(['deleting', 'deleted']).toContain((await listing(created))?.hosting?.status);
    });

    it('deletes at once when the admin turned asking off', async () => {
      await setSuper({ askBeforeCreate: true, askBeforeDelete: false });
      const { rootId } = await turn();
      const asked = await call('create_agent', { spaceId, threadRootId: rootId, displayName: 'Temp', kind: 'hermes', reason: 'short job' });
      const temp = (await decide(asked.approval!, 'allow_once')).body.approval.outcome.agentId as string;
      const deleted = await call('delete_agent', { spaceId, threadRootId: rootId, agentId: temp, reason: 'done' });
      expect(deleted).toMatchObject({ status: 'done', agent: { id: temp }, hosting: { status: 'deleting' } });
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
    await setSuper({ askBeforeCreate: false, askBeforeDelete: true });
    const result = await call('create_agent', { spaceId, threadRootId: rootId, displayName: 'Quick', kind: 'hermes', reason: 'now' });
    expect(result).toMatchObject({ status: 'done', agent: { displayName: 'Quick', ownerId: 'harsh' }, hosting: { requestedBy: boss.id } });
    expect(await inSpace(result.agent!.id)).toBe(true);
  });

  it('stops when the admin makes it ordinary again', async () => {
    expect((await setSuper(null)).body.agent.superAgent).toBeUndefined();
    expect(await refused('create_agent', { spaceId, threadRootId: rootId, displayName: 'Again', kind: 'hermes', reason: 'r' })).toMatch(/only a super agent/);
  });
});

describe('setup cards: agents that need their owner’s details', () => {
  beforeAll(async () => {
    // Approval waived: a setup card is still its owner's to fill in.
    await setSuper({ askBeforeCreate: false, askBeforeDelete: false });
  });

  async function card(kind: string, connection?: string) {
    const { rootId } = await turn();
    const result = await call('create_agent', { spaceId, threadRootId: rootId, displayName: 'Scout', kind, ...(connection ? { connection } : {}), reason: 'research' });
    expect(result.status).toBe('pending');
    return result.approval!;
  }

  it('puts a card for the owner that only setting it up or denying settles', async () => {
    const approval = await card('hermes', 'agent37');
    expect(approval).toMatchObject({ choices: ['deny'], action: { kind: 'create_agent', agentKind: 'hermes', connection: 'agent37' } });
    expect(approval.title).toBe('Set up Scout, a Hermes on Agent37');
    expect((await decide(approval, 'allow_once')).status).toBe(400);
    const message = (await as('dev-harsh').get(`/v1/spaces/${spaceId}/messages/${approval.messageId}`)).body.message as Message;
    expect(message.body).toContain('waiting for this to be set up on its card');
  });

  it('is completed by its owner adding the agent with the card as its request, through Harbor’s setup on the web', async () => {
    const approval = await card('hermes', 'agent37');
    // The setup the Add form runs: the instances the pasted key reaches, and a new one.
    const listed = await as('dev-harsh').post('/v1/setup/agent37/instances', { key: AGENT37_KEY });
    expect(listed.body.instances).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'inst1', kind: 'hermes' })]));
    expect((await as('dev-harsh').post('/v1/setup/agent37/instances', { key: 'nope' })).body.message).toMatch(/did not accept this key/);
    const made = await as('dev-harsh').post('/v1/setup/agent37/instances/new', { key: AGENT37_KEY, kind: 'hermes', name: 'rowboat-scout', monthlyBudgetUsd: 5 });
    expect(made.body.instance).toMatchObject({ name: 'rowboat-scout', kind: 'hermes', status: 'running' });
    expect((await as(bossKey).post('/v1/setup/agent37/instances', { key: AGENT37_KEY })).status).toBe(403);

    const add = { displayName: 'Scout', kind: 'hermes', connection: 'agent37', credential: AGENT37_KEY, instance: made.body.instance.id, request: approval.id };
    expect((await as('dev-ramnique').post('/v1/agents', add)).status).toBe(403);
    expect((await as('dev-harsh').post('/v1/agents', { ...add, connection: 'plugin', credential: undefined, instance: undefined })).status).toBe(400);
    const added = await as('dev-harsh').post('/v1/agents', add);
    expect(added.status).toBe(200);
    const done = ((await as('dev-harsh').get(`/v1/spaces/${spaceId}/messages/${approval.messageId}`)).body.message as Message).approval!;
    expect(done).toMatchObject({ state: 'allowed', decidedBy: 'harsh', outcome: { agentId: added.body.agent.id }, appliedAt: expect.any(String) });
    expect(await inSpace(added.body.agent.id)).toBe(true);
    // Completed once: the card can't make a second agent.
    expect((await as('dev-harsh').post('/v1/agents', { ...add, displayName: 'Again' })).status).toBe(400);
  });

  it('takes Claude Code on Rowboat with its owner’s Anthropic key, and the super agent may delete it later', async () => {
    const approval = await card('claude-code');
    expect(approval.action).toEqual({ kind: 'create_agent', displayName: 'Scout', agentKind: 'claude-code' });
    const created = await as('dev-harsh').post('/v1/agents/managed', { displayName: 'Scout', kind: 'claude-code', anthropicApiKey: 'sk-ant-x', request: approval.id });
    expect(created.status).toBe(200);
    expect(created.body.hosting).toMatchObject({ createdBy: 'harsh', requestedBy: boss.id });
    const { rootId } = await turn();
    expect(await call('delete_agent', { spaceId, threadRootId: rootId, agentId: created.body.agent.id, reason: 'done' })).toMatchObject({ status: 'done' });
  });

  it('is denied like any card, and then completes nothing', async () => {
    const approval = await card('custom', 'contract');
    expect((await decide(approval, 'deny')).body.approval).toMatchObject({ state: 'denied' });
    expect((await as('dev-harsh').post('/v1/agents', { displayName: 'Scout', kind: 'custom', connection: 'contract', request: approval.id })).status).toBe(400);
  });
});
