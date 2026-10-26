import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { routes, type Approval, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// Approvals (spec §8 part 4, 2026-10-01): an agent's request for a person's
// OK, its own record on an invocation, decided on the agent's card in the
// thread. Driven over REST the way a connector and the app drive it.

let harbor: RunningHarbor;
let spaceId: string;
let agent: Member;
let agentKey: string;
const as = (token: string) => restClient(harbor, token);
const mention = () => `[@Hermes](#member:${agent.id})`;

const RUN = {
  requestKey: 'req-1',
  title: 'Run a command',
  detail: 'rm -rf ./build\n(cwd: /Users/ramnique/project)',
  reason: 'It deletes files',
  choices: ['allow_once', 'allow_session', 'allow_always', 'deny'],
};

/** A person's mention, acknowledged by the agent: a working invocation in a fresh thread. */
async function working(body = `${mention()} clean the build`): Promise<{ invocation: Invocation; rootId: string }> {
  const posted = routes.postMessage.response.parse((await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct' })).body);
  const invocation = posted.invocations[0]!;
  expect((await as(agentKey).post(`/v1/agent/invocations/${invocation.id}/ack`)).status).toBe(200);
  return { invocation, rootId: posted.message.id };
}

async function raise(invocationId: string, request: Record<string, unknown> = RUN) {
  const r = await as(agentKey).post(`/v1/agent/invocations/${invocationId}/approvals`, request);
  expect(r.status).toBe(200);
  return routes.requestApproval.response.parse(r.body);
}

async function invocation(id: string): Promise<Invocation> {
  return ((await as('dev-harsh').get(`/v1/spaces/${spaceId}/invocations`)).body.invocations as Invocation[]).find((i) => i.id === id)!;
}

async function card(rootId: string): Promise<Message | undefined> {
  return ((await as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${rootId}`)).body.messages as Message[]).find((m) => m.approval);
}

const decide = (approval: Approval, body: Record<string, unknown>, token = 'dev-harsh') =>
  as(token).post(`/v1/spaces/${spaceId}/approvals/${approval.id}/decide`, { actingMode: 'direct', ...body });

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
  });
  const created = await as('dev-ramnique').post('/v1/agents', { displayName: 'Hermes', kind: 'hermes', connection: 'plugin' });
  agent = created.body.agent;
  agentKey = created.body.key.secret;
  spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh', agent.id], actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
});

describe('raising an approval', () => {
  it('posts the agent’s card in the thread, with the approval on it, and the invocation waits', async () => {
    const { invocation: inv, rootId } = await working();
    const { approval, message } = await raise(inv.id);
    expect(approval).toMatchObject({ state: 'open', invocationId: inv.id, agentId: agent.id, messageId: message.id, title: 'Run a command' });
    expect(message).toMatchObject({ threadRoot: rootId, author: { memberId: agent.id } });
    expect(message.body).toContain('**Run a command**');
    expect(message.body).toContain('```\nrm -rf ./build');
    expect(message.body).toContain('Allow once, Allow in this thread, Always allow, Deny');
    expect((await card(rootId))?.approval).toMatchObject({ id: approval.id, state: 'open' });
    expect(await invocation(inv.id)).toMatchObject({ state: 'waiting', activity: 'Waiting for approval: Run a command' });
  });

  it('returns the first when the same request is raised again, with no second card', async () => {
    const { invocation: inv, rootId } = await working();
    const first = await raise(inv.id);
    const again = await raise(inv.id);
    expect(again.approval.id).toBe(first.approval.id);
    const cards = ((await as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${rootId}`)).body.messages as Message[]).filter((m) => m.approval);
    expect(cards).toHaveLength(1);
  });

  it('is refused on someone else’s invocation, or one not running', async () => {
    const posted = routes.postMessage.response.parse(
      (await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body: `${mention()} later`, actingMode: 'direct' })).body,
    );
    const pending = posted.invocations[0]!;
    expect((await as(agentKey).post(`/v1/agent/invocations/${pending.id}/approvals`, RUN)).status).toBe(400);
    expect((await as('dev-harsh').post(`/v1/agent/invocations/${pending.id}/approvals`, RUN)).status).toBe(403);
    await as(agentKey).post(`/v1/agent/invocations/${pending.id}/ack`);
    await as(agentKey).post(`/v1/agent/invocations/${pending.id}/update`, { state: 'done' });
  });
});

describe('deciding', () => {
  it('lets a person decide; the agent hears it, and its listing keeps it until applied', async () => {
    const toAgent = vi.spyOn(harbor.hub, 'publishToMember');
    const { invocation: inv, rootId } = await working();
    const { approval } = await raise(inv.id);
    const r = await decide(approval, { decision: 'allow_session' });
    expect(r.status).toBe(200);
    expect(r.body.approval).toMatchObject({ state: 'allowed', decision: 'allow_session', decidedBy: 'harsh', decidedAt: expect.any(String) });
    expect(toAgent).toHaveBeenCalledWith(agent.id, expect.objectContaining({ kind: 'approval_decided', approval: expect.objectContaining({ id: approval.id }) }));
    toAgent.mockRestore();
    expect((await card(rootId))?.approval).toMatchObject({ state: 'allowed', decidedBy: 'harsh' });
    expect(await invocation(inv.id)).toMatchObject({ state: 'working' });

    const listed = routes.listAgentInvocations.response.parse((await as(agentKey).get('/v1/agent/invocations')).body);
    expect(listed.approvals.map((a) => a.id)).toContain(approval.id);
    expect((await as(agentKey).post(`/v1/agent/approvals/${approval.id}/applied`)).body.approval.appliedAt).toEqual(expect.any(String));
    const after = routes.listAgentInvocations.response.parse((await as(agentKey).get('/v1/agent/invocations')).body);
    expect(after.approvals.map((a) => a.id)).not.toContain(approval.id);
  });

  it('takes the first decision only, and only a choice the agent offers', async () => {
    const { invocation: inv } = await working();
    const { approval } = await raise(inv.id, { ...RUN, requestKey: 'smart-deny', choices: ['allow_once', 'deny'] });
    expect((await decide(approval, { decision: 'allow_always' })).status).toBe(400);
    expect((await decide(approval, { decision: 'allow_once', note: 'go' })).status).toBe(400); // a note goes with a deny
    const denied = await decide(approval, { decision: 'deny', note: 'use the clean script instead' }, 'dev-ramnique');
    expect(denied.body.approval).toMatchObject({ state: 'denied', note: 'use the clean script instead', decidedBy: 'ramnique' });
    const late = await decide(approval, { decision: 'allow_once' });
    expect(late).toMatchObject({ status: 400, body: { message: 'this approval is already denied' } });
  });

  it('is never an agent’s to decide, nor a person’s assistant acting for them', async () => {
    const { invocation: inv } = await working();
    const { approval } = await raise(inv.id);
    expect((await decide(approval, { decision: 'allow_once' }, agentKey)).status).toBe(403);
    expect((await decide(approval, { decision: 'allow_once', actingMode: 'agent' })).status).toBe(403);
    expect((await as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${inv.conversation.threadRootId}`)).body.messages.find((m: Message) => m.approval).approval.state).toBe('open');
  });
});

describe('while an approval is open', () => {
  it('queues a mention of the agent instead of taking it as an answer', async () => {
    const { invocation: inv, rootId } = await working();
    await raise(inv.id);
    const posted = routes.postMessage.response.parse(
      (await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body: `${mention()} also check the logs`, threadRoot: rootId, actingMode: 'direct' })).body,
    );
    expect(posted.invocations[0]).toMatchObject({ state: 'queued' });
    expect(posted.invocations[0]!.answers).toBeUndefined();
  });

  it('stays waiting through the connector’s heartbeat', async () => {
    const { invocation: inv } = await working();
    await raise(inv.id);
    await as(agentKey).post(`/v1/agent/invocations/${inv.id}/update`, { state: 'working', activity: 'still here' });
    expect(await invocation(inv.id)).toMatchObject({ state: 'waiting', activity: 'Waiting for approval: Run a command' });
  });
});

describe('settling without a decision', () => {
  it('closes as expired when the agent gives up, and the invocation goes on', async () => {
    const { invocation: inv, rootId } = await working();
    const { approval } = await raise(inv.id);
    const closed = await as(agentKey).post(`/v1/agent/approvals/${approval.id}/close`, { state: 'expired' });
    expect(closed.body.approval).toMatchObject({ state: 'expired' });
    expect((await card(rootId))?.approval?.state).toBe('expired');
    expect(await invocation(inv.id)).toMatchObject({ state: 'working' });
    expect((await decide(approval, { decision: 'allow_once' })).status).toBe(400);
    expect((await as(agentKey).post(`/v1/agent/approvals/${approval.id}/close`, { state: 'cancelled' })).body.approval.state).toBe('expired');
  });

  it('cancels the open approvals of an invocation that ends', async () => {
    const { invocation: inv, rootId } = await working();
    await raise(inv.id);
    await raise(inv.id, { ...RUN, requestKey: 'req-2', title: 'Edit 3 files' });
    await as(agentKey).post(`/v1/agent/invocations/${inv.id}/update`, { state: 'failed', error: 'restarted' });
    const cards = ((await as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${rootId}`)).body.messages as Message[]).filter((m) => m.approval);
    expect(cards.map((m) => m.approval!.state)).toEqual(['cancelled', 'cancelled']);
  });

  it('logs every change as a space event, for the record', async () => {
    const { invocation: inv } = await working();
    const { approval } = await raise(inv.id);
    await decide(approval, { decision: 'allow_once' });
    const events = await harbor.store.listEventsAfter(spaceId, 0);
    const changes = events.flatMap((e) => (e.event.type === 'approval' && e.event.approval.id === approval.id ? [e.event.approval.state] : []));
    expect(changes).toEqual(['allowed']);
  });
});
