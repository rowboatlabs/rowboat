import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type Invocation, type Member, type ServerFrame } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor, type LiveClient } from './helpers.js';

// Invoking agent members (spec §8, 2026-09-30), end to end against a
// reference connector: the smallest thing that honors the contract — it
// listens on its agent's key, acknowledges what Harbor delivers, reports
// state, and acts through the ordinary routes.

let harbor: RunningHarbor;
let spaceId: string;
const as = (token: string) => restClient(harbor, token);
const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;

/** The reference connector: one agent's key, its live connection, and the connector operations. */
class Connector {
  readonly rest;
  private constructor(
    readonly agent: Member,
    readonly key: string,
    readonly live: LiveClient,
  ) {
    this.rest = restClient(harbor, key);
  }
  static async start(agent: Member, key: string): Promise<Connector> {
    return new Connector(agent, key, await liveClient(harbor, key));
  }
  delivered(): Invocation[] {
    return this.live.frames.flatMap((f) => (f.kind === 'invocation' ? [f.invocation] : []));
  }
  async next(after = 0): Promise<Invocation> {
    await this.live.until(() => this.delivered().length > after, `invocation #${after + 1} for ${this.agent.displayName}`);
    return this.delivered()[after]!;
  }
  ack(id: string) {
    return this.rest.post(`/v1/agent/invocations/${id}/ack`);
  }
  report(id: string, update: Record<string, unknown>) {
    return this.rest.post(`/v1/agent/invocations/${id}/update`, update);
  }
  close() {
    this.live.close();
  }
}

async function addAgent(owner: string, name: string): Promise<{ agent: Member; key: string }> {
  const created = await as(`dev-${owner}`).post('/v1/agents', { displayName: name });
  const agent = created.body.agent as Member;
  await as(`dev-${owner}`).post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
  return { agent, key: created.body.key.secret };
}

async function post(token: string, body: string, extra: Record<string, unknown> = {}) {
  const r = await as(token).post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return routes.postMessage.response.parse(r.body);
}

let hermes: Connector;

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    // A second space: a one-space org is a group chat, where DMs are off (2026-10-07).
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
  });
  const ram = (await harbor.store.getMember('ramnique'))!;
  await harbor.store.putMember({ ...ram, role: 'admin' });
  spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
  const h = await addAgent('ramnique', 'Hermes');
  hermes = await Connector.start(h.agent, h.key);
});

afterAll(async () => {
  hermes.close();
  await harbor.close();
});

describe('the trigger', () => {
  it('a mention invokes: pending, delivered live, listed for a reconnecting connector', async () => {
    const before = hermes.delivered().length;
    const { message, invocations } = await post('dev-harsh', `${mention(hermes.agent)} summarise the thread`);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      agentId: hermes.agent.id,
      state: 'pending',
      depth: 0,
      conversation: { spaceId, threadRootId: message.id },
      trigger: { messageId: message.id, authorId: 'harsh' },
      where: { spaceKind: 'shared', spaceName: 'Payments' },
    });
    expect((await hermes.next(before)).id).toBe(invocations[0]!.id);
    const listed = (await hermes.rest.get('/v1/agent/invocations')).body.invocations as Invocation[];
    expect(listed.map((i) => i.id)).toContain(invocations[0]!.id);
    await hermes.ack(invocations[0]!.id);
    await hermes.report(invocations[0]!.id, { state: 'done' });
  });

  it('no mention, no invocation; an agent’s own post never invokes itself', async () => {
    expect((await post('dev-harsh', 'just chatting')).invocations).toEqual([]);
    expect((await post(hermes.key, `note to ${mention(hermes.agent)}`)).invocations).toEqual([]);
  });
});

describe('progress', () => {
  it('pending → working → done, with an activity line, and the space sees every state', async () => {
    const watcher = await liveClient(harbor, 'dev-ramnique');
    try {
      watcher.send({ kind: 'subscribe', spaceId });
      await watcher.until((fs) => fs.some((f) => f.kind === 'subscribed'), 'subscribed');
      const { invocations } = await post('dev-harsh', `${mention(hermes.agent)} run the tests`);
      const id = invocations[0]!.id;
      expect((await hermes.ack(id)).body.invocation.state).toBe('working');
      expect((await hermes.report(id, { state: 'working', activity: 'Running tests' })).body.invocation.activity).toBe('Running tests');
      expect((await hermes.report(id, { state: 'done' })).body.invocation).toMatchObject({ state: 'done' });
      const states = () =>
        watcher.frames
          .filter((f): f is Extract<ServerFrame, { kind: 'invocation_state' }> => f.kind === 'invocation_state' && f.invocation.id === id)
          .map((f) => [f.invocation.state, f.invocation.activity ?? null]);
      await watcher.until(() => states().length === 4, 'four states');
      expect(states()).toEqual([['pending', null], ['working', null], ['working', 'Running tests'], ['done', null]]);
      // A finished invocation takes no more reports.
      expect((await hermes.report(id, { state: 'working' })).status).toBe(400);
    } finally {
      watcher.close();
    }
  });
});

describe('the queue', () => {
  it('holds a second mention in the same thread until the first finishes; another thread runs at once', async () => {
    const first = await post('dev-harsh', `${mention(hermes.agent)} task one`);
    const root = first.message.id;
    const second = await post('dev-ramnique', `${mention(hermes.agent)} and this too`, { threadRoot: root });
    expect(second.invocations[0]!.state).toBe('queued');
    const elsewhere = await post('dev-ramnique', `${mention(hermes.agent)} unrelated`);
    expect(elsewhere.invocations[0]!.state).toBe('pending');
    const seen = hermes.delivered().length;
    await hermes.ack(first.invocations[0]!.id);
    await hermes.report(first.invocations[0]!.id, { state: 'done' });
    // Done frees the thread: the queued one is delivered.
    const next = await hermes.next(seen);
    expect(next.id).toBe(second.invocations[0]!.id);
    expect(next.state).toBe('pending');
    for (const i of [next.id, elsewhere.invocations[0]!.id]) await hermes.report(i, { state: 'done' });
  });

  it('runs queued turns in the order their messages were posted, whatever the clocks say', async () => {
    const first = await post('dev-harsh', `${mention(hermes.agent)} one`);
    const root = first.message.id;
    const second = (await post('dev-harsh', `${mention(hermes.agent)} two`, { threadRoot: root })).invocations[0]!;
    const third = (await post('dev-harsh', `${mention(hermes.agent)} three`, { threadRoot: root })).invocations[0]!;
    // Another Harbor instance with a clock running behind stamped the later one earlier.
    const skewed = (await harbor.store.getInvocation(third.id))!;
    await harbor.store.putInvocation({ ...skewed, createdAt: new Date(Date.parse(second.createdAt) - 60_000).toISOString() });
    const seen = hermes.delivered().length;
    await hermes.report(first.invocations[0]!.id, { state: 'done' });
    expect((await hermes.next(seen)).id).toBe(second.id);
    await hermes.report(second.id, { state: 'done' });
    expect((await hermes.next(seen + 1)).id).toBe(third.id);
    await hermes.report(third.id, { state: 'done' });
  });

  it('delivers a mention at once as the answer to a turn waiting on a person', async () => {
    const asked = await post('dev-harsh', `${mention(hermes.agent)} deploy it`);
    const id = asked.invocations[0]!.id;
    await hermes.ack(id);
    const waiting = await hermes.report(id, { state: 'waiting', activity: 'Approve the migration?' });
    expect(waiting.body.invocation).toMatchObject({ state: 'waiting', activity: 'Approve the migration?' });
    const answer = await post('dev-harsh', `${mention(hermes.agent)} approved`, { threadRoot: asked.message.id });
    expect(answer.invocations[0]).toMatchObject({ state: 'pending', answers: id });
    await hermes.report(answer.invocations[0]!.id, { state: 'done' });
    await hermes.report(id, { state: 'working' });
    await hermes.report(id, { state: 'done' });
  });

  it('fails a working turn silent for 30 minutes when its thread next needs the turn', async () => {
    const stuck = await post('dev-harsh', `${mention(hermes.agent)} long job`);
    const id = stuck.invocations[0]!.id;
    await hermes.ack(id);
    const current = (await harbor.store.getInvocation(id))!;
    await harbor.store.putInvocation({ ...current, updatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() });
    const again = await post('dev-harsh', `${mention(hermes.agent)} still there?`, { threadRoot: stuck.message.id });
    expect(again.invocations[0]!.state).toBe('pending');
    expect((await harbor.store.getInvocation(id))).toMatchObject({ state: 'failed', error: expect.stringMatching(/30 minutes/) });
    await hermes.report(again.invocations[0]!.id, { state: 'done' });
  });
});

describe('who may invoke', () => {
  it('refuses a DM alone, and allows it once the person shares a space with the agent', async () => {
    const dm = (await as('dev-gagan').post('/v1/direct', { memberId: hermes.agent.id })).body.space.id;
    const inDm = (body: string) => as('dev-gagan').post(`/v1/spaces/${dm}/messages`, { body, actingMode: 'direct' });
    const refused = (await inDm(`${mention(hermes.agent)} hi`)).body.invocations[0];
    expect(refused).toMatchObject({ state: 'refused', refusal: { reason: 'not_permitted' } });
    await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
    const allowed = (await inDm(`${mention(hermes.agent)} hi again`)).body.invocations[0];
    expect(allowed).toMatchObject({ state: 'pending', where: { spaceKind: 'direct' } });
    await hermes.report(allowed.id, { state: 'done' });
  });

  it('lets agents hand work on three hops deep, then refuses the fourth', async () => {
    const chain = await Promise.all(['A', 'B', 'C', 'D', 'E'].map(async (n) => {
      const { agent, key } = await addAgent('harsh', `Agent ${n}`);
      return Connector.start(agent, key);
    }));
    try {
      const start = await post('dev-harsh', `${mention(chain[0]!.agent)} start`);
      const root = start.message.id;
      let invocation = start.invocations[0]!;
      for (let hop = 0; hop < 4; hop += 1) {
        await chain[hop]!.ack(invocation.id);
        const handOff = await post(chain[hop]!.key, `${mention(chain[hop + 1]!.agent)} over to you`, { threadRoot: root });
        invocation = handOff.invocations[0]!;
        expect(invocation.depth).toBe(hop + 1);
      }
      expect(invocation).toMatchObject({ state: 'refused', refusal: { reason: 'hop_limit' } });
    } finally {
      for (const c of chain) c.close();
    }
  });
});

describe('cancel and stop', () => {
  it('lets the invoker cancel a queued invocation, and nobody else', async () => {
    const first = await post('dev-harsh', `${mention(hermes.agent)} one`);
    const queued = (await post('dev-harsh', `${mention(hermes.agent)} two`, { threadRoot: first.message.id })).invocations[0]!;
    expect((await as('dev-ramnique').post(`/v1/invocations/${queued.id}/cancel`)).status).toBe(403);
    expect((await as('dev-harsh').post(`/v1/invocations/${queued.id}/cancel`)).body.invocation.state).toBe('cancelled');
    await hermes.report(first.invocations[0]!.id, { state: 'done' });
  });

  it('stops a running one only when the connector can: it gets invocation_stop and reports cancelled', async () => {
    const running = (await post('dev-harsh', `${mention(hermes.agent)} long`)).invocations[0]!;
    await hermes.ack(running.id);
    const refused = await as('dev-harsh').post(`/v1/invocations/${running.id}/cancel`);
    expect(refused.status).toBe(400);
    await hermes.rest.post('/v1/agent/capabilities', { stop: true });
    expect((await as('dev-gagan').post(`/v1/invocations/${running.id}/cancel`)).status).toBe(403);
    // The admin may stop it, not only the invoker.
    const stopped = await as('dev-ramnique').post(`/v1/invocations/${running.id}/cancel`);
    expect(stopped.body.invocation).toMatchObject({ state: 'working', stopRequested: true });
    await hermes.live.until((fs) => fs.some((f) => f.kind === 'invocation_stop' && f.invocationId === running.id), 'invocation_stop');
    expect((await hermes.report(running.id, { state: 'cancelled' })).body.invocation.state).toBe('cancelled');
    await hermes.rest.post('/v1/agent/capabilities', { stop: false });
  });
});

describe('options and capabilities', () => {
  it('carries the picked options to the invocation, and lets any member read what the connector declared', async () => {
    await hermes.rest.post('/v1/agent/capabilities', {
      options: [{ type: 'select', key: 'environment', label: 'Environment', choices: [{ id: 'env-api', label: 'payments-api' }] }],
    });
    const caps = await as('dev-gagan').get(`/v1/agents/${hermes.agent.id}/capabilities`);
    expect(caps.body.capabilities).toEqual({
      stop: false,
      options: [{ type: 'select', key: 'environment', label: 'Environment', choices: [{ id: 'env-api', label: 'payments-api' }] }],
    });
    const { invocations } = await post('dev-harsh', `${mention(hermes.agent)} fix the bug`, {
      agentOptions: { [hermes.agent.id]: { environment: 'env-api' }, 'not-mentioned': { environment: 'x' } },
    });
    expect(invocations[0]!.options).toEqual({ environment: 'env-api' });
    await hermes.report(invocations[0]!.id, { state: 'done' });
  });
});

describe('the connector’s routes', () => {
  it('refuse a person, and another agent’s invocation', async () => {
    const other = await addAgent('ramnique', 'Other');
    const mine = (await post('dev-harsh', `${mention(hermes.agent)} ping`)).invocations[0]!;
    expect((await as('dev-harsh').get('/v1/agent/invocations')).status).toBe(403);
    expect((await as('dev-harsh').post(`/v1/agent/invocations/${mine.id}/ack`)).status).toBe(403);
    expect((await as(other.key).post(`/v1/agent/invocations/${mine.id}/ack`)).status).toBe(404);
    await hermes.report(mine.id, { state: 'done' });
  });
});

describe('the agent face', () => {
  it('get_invocations lists them, and post_message returns what a mention invoked', async () => {
    const mcp = await agentClient(harbor, 'dev-harsh', { agentName: 'Rowboat' });
    try {
      const posted = await mcp.callTool({ name: 'post_message', arguments: { spaceId, body: `${mention(hermes.agent)} from the agent face` } });
      const out = posted.structuredContent as { invocations: Array<{ agentId: string; state: string }> };
      expect(out.invocations).toEqual([{ agentId: hermes.agent.id, state: 'pending' }]);
      const listed = await mcp.callTool({ name: 'get_invocations', arguments: { spaceId } });
      const invocations = (listed.structuredContent as { invocations: Invocation[] }).invocations;
      expect(invocations[0]!.trigger.authorId).toBe('harsh');
      const stopped = await mcp.callTool({ name: 'stop_invocation', arguments: { invocationId: invocations[0]!.id } });
      expect((stopped.structuredContent as { invocation: Invocation }).invocation.state).toBe('cancelled');
    } finally {
      await mcp.close();
    }
  });
});
