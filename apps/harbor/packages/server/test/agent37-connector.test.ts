import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { routes, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { sessionFor, turnInHistory } from '../src/connectors/agent37/connector.js';
import { agent37Platform } from '../src/connectors/agent37/index.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { FakeAgent37, GOOD_KEY } from './fake-agent37.js';
import { freshStore, restClient } from './helpers.js';

// The Agent37 connector (spec §8 Connectors, 2026-10-01), end to end: a real
// Harbor running the connector against a stand-in Agent37 built from its docs.
// What people see is Harbor's (invocation states, the answer, 👀); what
// Agent37 gets is the fake's record of every call.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const original = PLATFORMS.agent37;
let fake: FakeAgent37;

async function until<T>(check: () => Promise<T | undefined | false>, what: string, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A Harbor on a store that outlives it, with a space, two people, and helpers. */
class Org {
  harbor!: RunningHarbor;
  spaceId = '';
  constructor(private readonly store: Awaited<ReturnType<typeof freshStore>>) {}

  async start(): Promise<this> {
    this.harbor = await startHarbor({
      store: this.store.store,
      orgName: 'Rowboat Labs',
      // A second space: a one-space org is a group chat, where DMs are off (2026-10-07).
      seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'harsh', displayName: 'Harsh' },
      ],
      blobs: new MemoryBlobStore(),
    });
    return this;
  }
  as(token: string) {
    return restClient(this.harbor, token);
  }
  async space(): Promise<string> {
    this.spaceId = (await this.as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
    await this.as('dev-ramnique').post(`/v1/spaces/${this.spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
    return this.spaceId;
  }
  async agent(kind: string, name: string, instance = kind === 'openclaw' ? 'inst2' : 'inst1'): Promise<Member> {
    const created = await this.as('dev-ramnique').post('/v1/agents', { displayName: name, kind, connection: 'agent37', credential: GOOD_KEY, instance });
    expect(created.status).toBe(200);
    await this.as('dev-ramnique').post(`/v1/spaces/${this.spaceId}/members`, { memberIds: [created.body.agent.id], actingMode: 'direct' });
    return created.body.agent;
  }
  async post(body: string, extra: Record<string, unknown> = {}, token = 'dev-harsh') {
    const r = await this.as(token).post(`/v1/spaces/${this.spaceId}/messages`, { body, actingMode: 'direct', ...extra });
    expect(r.status).toBe(200);
    return routes.postMessage.response.parse(r.body);
  }
  async invocation(id: string): Promise<Invocation | undefined> {
    return ((await this.as('dev-ramnique').get(`/v1/spaces/${this.spaceId}/invocations`)).body.invocations as Invocation[]).find((i) => i.id === id);
  }
  async ended(id: string): Promise<Invocation> {
    return until(async () => {
      const i = await this.invocation(id);
      return i && ['done', 'failed', 'cancelled'].includes(i.state) ? i : undefined;
    }, `invocation ${id} to end`);
  }
  async thread(rootId: string): Promise<Message[]> {
    return (await this.as('dev-harsh').get(`/v1/spaces/${this.spaceId}/threads/${rootId}`)).body.messages;
  }
  async replies(rootId: string, agent: Member): Promise<string[]> {
    return (await this.thread(rootId)).filter((m) => m.author.memberId === agent.id).map((m) => m.body);
  }
}

const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;
const sent = () => fake.responses().map((r) => r.body!);

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'c'.repeat(64);
  fake = await new FakeAgent37().start();
  PLATFORMS.agent37 = agent37Platform(fake.url, fake.instanceUrl);
});

afterAll(async () => {
  await fake.close();
  PLATFORMS.agent37 = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('the Agent37 connector', () => {
  let org: Org;
  let hermes: Member;

  beforeAll(async () => {
    org = await new Org(await freshStore()).start();
    await org.space();
    hermes = await org.agent('hermes', 'Hermes');
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('refuses a key Agent37 does not accept, creating nothing', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'hermes', connection: 'agent37', credential: 'sk_live_bad', instance: 'inst1' });
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/Agent37 did not accept this key/) } });
  });

  it('accepts Hermes and OpenClaw, and nothing else, through Agent37', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Claude', kind: 'claude-code', connection: 'agent37', credential: GOOD_KEY, instance: 'inst1' });
    expect(r.status).toBe(400);
  });

  it('is one instance: added with it, which the key must reach and which must run the agent’s kind', async () => {
    const add = (body: Record<string, unknown>) => org.as('dev-ramnique').post('/v1/agents', { displayName: 'H', kind: 'hermes', connection: 'agent37', credential: GOOD_KEY, ...body });
    expect(await add({})).toMatchObject({ status: 400, body: { message: expect.stringMatching(/is one agent37 instance/) } });
    expect(await add({ instance: 'nope' })).toMatchObject({ status: 400, body: { message: expect.stringMatching(/does not reach an instance nope/) } });
    expect(await add({ instance: 'inst2' })).toMatchObject({ status: 400, body: { message: expect.stringMatching(/runs agent37-openclaw, not hermes/) } });
    expect(hermes.agentInstance).toBe('inst1');
    // Only an instance connection takes one.
    const custom = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'C', instance: 'inst1' });
    expect(custom.status).toBe(400);
  });

  it('declares Stop and Reasoning, and no choice of instance', async () => {
    const caps = await until(async () => {
      const r = await org.as('dev-harsh').get(`/v1/agents/${hermes.id}/capabilities`);
      return r.body.capabilities?.options?.length ? r.body.capabilities : undefined;
    }, 'capabilities');
    expect(caps.stop).toBe(true);
    expect(caps.options.map((o: { key: string }) => o.key)).toEqual(['reasoning']);
  });

  it('a first mention opens the thread’s session on the instance, shows progress, and answers in the thread', async () => {
    const reports = vi.spyOn(org.harbor.service, 'updateInvocation');
    fake.next = { tools: ['Reading the ledger'], answer: 'The ledger balances.' };
    const { message, invocations } = await org.post(`${mention(hermes)} does the ledger balance?`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');

    const turn = sent().at(-1)!;
    expect(fake.responses().at(-1)!.path).toBe('/i/inst1/v1/responses');
    expect(turn).toMatchObject({ session_id: sessionFor(hermes.id, org.spaceId, message.id), agent: 'hermes', stream: true });
    expect(turn.metadata).toMatchObject({ rowboat_invocation: invocations[0]!.id });
    const input = String(turn.input);
    expect(input.startsWith(`${mention(hermes)} does the ledger balance?`)).toBe(true); // the person's words first, as written
    expect(input).toContain('Requested by Harsh');
    expect(input.endsWith(`[Spaces request ${message.id}]`)).toBe(true);

    expect(await org.replies(message.id, hermes)).toEqual(['The ledger balances.']);
    expect(reports.mock.calls.some(([, , update]) => update.state === 'working' && update.activity === 'Reading the ledger')).toBe(true);
    const root = (await org.as('dev-harsh').get(`/v1/spaces/${org.spaceId}/threads/${message.id}`)).body.root as Message;
    expect(root.reactions).toEqual([expect.objectContaining({ emoji: '👀', memberIds: [hermes.id] })]);
    reports.mockRestore();
  });

  it('a follow-up goes into the same session, with only what it has not heard', async () => {
    const { message } = await org.post(`${mention(hermes)} start a plan`);
    await until(async () => (await org.replies(message.id, hermes)).length === 1, 'the first answer');
    await org.post('I think we should use Postgres', { threadRoot: message.id }, 'dev-ramnique');
    fake.next = { answer: 'Postgres it is.' };
    const second = await org.post(`${mention(hermes)} what do you think?`, { threadRoot: message.id });
    expect((await org.ended(second.invocations[0]!.id)).state).toBe('done');
    const [a, b] = sent().slice(-2);
    expect(b!.session_id).toBe(a!.session_id);
    expect(String(b!.input)).toContain('Earlier in this thread:\n[@Ramnique](#member:ramnique): I think we should use Postgres');
    expect(String(b!.input)).not.toContain('start a plan');
  });

  it('writes the invoking message’s files onto the instance and attaches their paths', async () => {
    const hash = createHash('sha256').update(PNG).digest('hex');
    await org.harbor.service.uploadBlob({ memberId: 'harsh' }, org.spaceId, PNG, { declaredSha256: hash, declaredMime: 'image/png' });
    const link = `![chart.png](${org.harbor.url}/s/${org.spaceId}/b/${hash}?name=chart.png)`;
    const { invocations } = await org.post(`${mention(hermes)} what is in this chart? ${link}`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const turn = sent().at(-1)!;
    const path = `/home/node/rowboat/files/${hash.slice(0, 12)}-chart.png`;
    expect(turn.files).toEqual([path]);
    expect(fake.files.get(path)?.equals(PNG)).toBe(true);
    expect(String(turn.input)).toContain('[attached: chart.png]');
  });

  it('takes the reasoning picked in the composer', async () => {
    const { invocations } = await org.post(`${mention(hermes)} think hard`, { agentOptions: { [hermes.id]: { reasoning: 'high' } } });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(sent().at(-1)).toMatchObject({ reasoning_effort: 'high' });
  });

  it('fails plainly once its instance is gone, never moving to another', async () => {
    fake.instances.push({ id: 'inst4', name: 'doomed', template: 'agent37-hermes', status: 'running' });
    const gone = await org.agent('hermes', 'Gone', 'inst4');
    fake.instances = fake.instances.filter((i) => i.id !== 'inst4');
    const before = fake.responses().length;
    const { invocations } = await org.post(`${mention(gone)} are you there?`);
    expect(await org.ended(invocations[0]!.id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/My Agent37 instance \(inst4\) is gone/) });
    expect(fake.responses().slice(before).map((r) => r.path)).toEqual(['/i/inst4/v1/responses']);
  });

  it('fails a turn Agent37 reports as failed, with its reason', async () => {
    fake.next = { error: { code: 'agent_error', message: 'the model provider is down' } };
    const { invocations } = await org.post(`${mention(hermes)} try this`);
    expect(await org.ended(invocations[0]!.id)).toMatchObject({ state: 'failed', error: 'Agent37: agent_error: the model provider is down' });
  });

  it('picks a dropped stream back up and answers once', async () => {
    fake.next = { tools: ['Thinking'], answer: 'Still here.', dropAfter: 1 };
    const { message, invocations } = await org.post(`${mention(hermes)} long one`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(await org.replies(message.id, hermes)).toEqual(['Still here.']);
    expect(fake.received.some((r) => r.method === 'GET' && /\/v1\/responses\/[0-9a-f]+\/stream$/.test(r.path))).toBe(true);
  });

  it('Stop cancels the running turn in Agent37 and reports it cancelled', async () => {
    fake.next = { hold: true };
    const { message, invocations } = await org.post(`${mention(hermes)} run forever`);
    const id = invocations[0]!.id;
    await until(async () => (await org.invocation(id))?.state === 'working' && fake.responses().length > 0, 'the turn to run');
    await until(async () => [...fake.turns.values()].some((t) => !t.done), 'the turn in Agent37');
    expect((await org.as('dev-harsh').post(`/v1/invocations/${id}/cancel`, {})).status).toBe(200);
    expect((await org.ended(id)).state).toBe('cancelled');
    expect(fake.received.some((r) => r.method === 'POST' && /\/cancel$/.test(r.path))).toBe(true);
    expect(await org.replies(message.id, hermes)).toEqual([]);
  });

  it('waits out a turn something else started on the session, then sends its own', async () => {
    const { message } = await org.post(`${mention(hermes)} first`);
    await until(async () => (await org.replies(message.id, hermes)).length === 1, 'the first answer');
    const foreign = fake.startForeign('inst1', sessionFor(hermes.id, org.spaceId, message.id), 'typed in the Hermes dashboard');
    const before = fake.responses().length;
    const { invocations } = await org.post(`${mention(hermes)} second`, { threadRoot: message.id });
    await until(async () => fake.responses().length > before, 'a refused send');
    await new Promise((r) => setTimeout(r, 200));
    expect((await org.invocation(invocations[0]!.id))?.state).toBe('working');
    fake.finish(foreign, { answer: 'not for Rowboat' });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(await org.replies(message.id, hermes)).toEqual(['Done.', 'Done.']);
  });

  it('when Agent37 rejects the key, fails fast and tells the owner once', async () => {
    fake.refuse = { status: 401, code: 'invalid_api_key', paths: /\/v1\/responses$/, flat: true };
    const a = await org.post(`${mention(hermes)} new thread one`);
    expect(await org.ended(a.invocations[0]!.id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/Agent37 rejected this agent’s API key/) });
    const b = await org.post(`${mention(hermes)} new thread two`);
    expect((await org.ended(b.invocations[0]!.id)).state).toBe('failed');
    fake.refuse = undefined;

    const listed = (await org.as('dev-ramnique').get('/v1/agents')).body.agents.find((x: { agent: Member }) => x.agent.id === hermes.id);
    expect(listed.credential).toMatchObject({ rejectedAt: expect.any(String) });
    const dm = (await org.as('dev-ramnique').post('/v1/direct', { memberId: hermes.id })).body.space.id;
    const stream = (await org.as('dev-ramnique').get(`/v1/spaces/${dm}/stream`)).body.messages as Message[];
    expect(stream.filter((m) => m.author.memberId === hermes.id && /Agent37 rejected/.test(m.body))).toHaveLength(1);
  });
});

describe('the Agent37 connector after a restart', () => {
  it('finishes a turn that ended while Harbor was down, from the session’s history, without sending again', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const hermes = await org.agent('hermes', 'Hermes');
    fake.next = { hold: true };
    const { message, invocations } = await org.post(`${mention(hermes)} long job`);
    const turn = await until(async () => [...fake.turns.values()].find((t) => !t.done && t.input.includes(message.id)), 'the turn');
    await new Promise((r) => setTimeout(r, 200));
    await org.harbor.close(); // Harbor goes down mid-turn

    fake.finish(turn.id, { answer: 'Done while you were away.' }); // …and Agent37 finishes meanwhile
    fake.forgetTurns = true; // past the replay window: only the session's history has it
    const before = fake.responses().length;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    fake.forgetTurns = false;
    expect(await org.replies(message.id, hermes)).toEqual(['Done while you were away.']);
    expect(fake.responses().length).toBe(before);
    await org.harbor.close();
    await store.db.close();
  });

  it('sends a request that never reached Agent37, once it is back', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const hermes = await org.agent('hermes', 'Hermes');
    fake.refuse = { status: 502, code: 'container_unavailable', paths: /\/v1\/responses$/, flat: true };
    const { message, invocations } = await org.post(`${mention(hermes)} while the instance is down`);
    await until(async () => fake.responses().some((r) => String(r.body?.input).includes(message.id)), 'a refused send');
    await org.harbor.close(); // down while Agent37 is refusing: the invocation stays working
    expect((await store.store.getInvocation(invocations[0]!.id))?.state).toBe('working');

    fake.refuse = undefined;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const session = fake.sessions.get(sessionFor(hermes.id, spaceId, message.id))!;
    expect(session.history.filter((h) => h.role === 'user')).toHaveLength(1);
    await org.harbor.close();
    await store.db.close();
  });
});

describe('reading a session’s history', () => {
  it('finds a request by its marker, and the agent’s last words after it', () => {
    const marker = '[Spaces request M1]';
    expect(turnInHistory([{ role: 'user', content: 'other' }], marker)).toBeUndefined();
    expect(
      turnInHistory(
        [
          { role: 'user', content: `hi\n\n${marker}` },
          { role: 'assistant', content: 'thinking out loud' },
          { role: 'assistant', content: 'the answer' },
          { role: 'user', content: 'next' },
          { role: 'assistant', content: 'not this' },
        ],
        marker,
      ),
    ).toEqual({ answer: 'the answer' });
    expect(turnInHistory([{ role: 'user', content: marker }], marker)).toEqual({ answer: undefined });
  });
});
