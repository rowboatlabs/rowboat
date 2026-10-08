import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { routes, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { conductorPlatform } from '../src/connectors/conductor/index.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { claudeTurn, FakeConductor, GOOD_KEY } from './fake-conductor.js';
import { freshStore, restClient } from './helpers.js';

// The Conductor connector (spec §8 Connectors, 2026-10-06), end to end: a real
// Harbor running the connector against a stand-in Conductor built from its
// OpenAPI. What people see is Harbor's (invocation states, the answer, 👀);
// what Conductor gets is the fake's record of every call.

const original = PLATFORMS.conductor;
let fake: FakeConductor;

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
  async agent(name: string): Promise<Member> {
    const created = await this.as('dev-ramnique').post('/v1/agents', { displayName: name, kind: 'claude-code', connection: 'conductor', credential: GOOD_KEY });
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
}

const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;
const userEntries = (name: string) => fake.named(name)!.session.transcript.filter((m) => m.type === 'userMessage');

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'c'.repeat(64);
  fake = await new FakeConductor().start();
  PLATFORMS.conductor = conductorPlatform(fake.url, { pollMs: 40 });
});

afterAll(async () => {
  await fake.close();
  PLATFORMS.conductor = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('the Conductor connector', () => {
  let org: Org;
  let claude: Member;

  beforeAll(async () => {
    org = await new Org(await freshStore()).start();
    await org.space();
    claude = await org.agent('Claude');
    // A second space: a one-space server is a group chat, where DMs (the owner's notice) are off (2026-10-07).
    await org.as('dev-ramnique').post('/v1/spaces', { name: 'Design' });
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('refuses a key Conductor does not accept, creating nothing', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'claude-code', connection: 'conductor', credential: 'cnd_bad' });
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/Conductor did not accept this key/) } });
  });

  it('declares Stop, and model, effort and fast mode for the composer', async () => {
    const caps = await until(async () => {
      const r = await org.as('dev-harsh').get(`/v1/agents/${claude.id}/capabilities`);
      return r.body.capabilities?.options?.length ? r.body.capabilities : undefined;
    }, 'capabilities');
    expect(caps.stop).toBe(true);
    expect(caps.options.map((o: { key: string }) => o.key)).toEqual(['model', 'effort', 'fast_mode']); // one project: no choice to offer
  });

  it('a first mention creates the thread’s workspace with Spaces access, shows progress, and answers in the thread', async () => {
    const reports = vi.spyOn(org.harbor.service, 'updateInvocation');
    fake.nextTurn = claudeTurn('Fixed the login bug: https://github.com/acme/web/pull/42');
    const { message, invocations } = await org.post(`${mention(claude)} fix the login bug`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');

    const create = fake.creates().at(-1)!.body!;
    expect(create).toMatchObject({ name: `spaces-${message.id}`, projectId: 'proj-web', agent: 'claude' });
    expect(create).not.toHaveProperty('message'); // sent separately, under an id Conductor dedupes
    const env = create.env as Record<string, string>;
    expect(env.ROWBOAT_URL).toMatch(/^http:\/\/localhost:\d+$/);
    expect(env.ROWBOAT_AGENT_KEY).toMatch(/^rbk_/);
    expect((await org.as(env.ROWBOAT_AGENT_KEY!).get('/v1/me')).status).toBe(200); // the workspace acts as the agent

    const send = fake.sends().at(-1)!.body!;
    expect(send.messageId).toMatch(/^[0-9a-f-]{36}$/);
    const prompt = String(send.message);
    expect(prompt.startsWith(`${mention(claude)} fix the login bug`)).toBe(true);
    expect(prompt.endsWith(`[Spaces request ${message.id}]`)).toBe(true);

    const reply = (await org.thread(message.id)).find((m) => m.author.memberId === claude.id)!;
    expect(reply.body).toBe('Fixed the login bug: https://github.com/acme/web/pull/42');
    const trigger = (await org.as('dev-harsh').get(`/v1/spaces/${org.spaceId}/threads/${message.id}`)).body.root as Message;
    expect(trigger.reactions).toEqual([expect.objectContaining({ emoji: '👀', memberIds: [claude.id] })]);
    const updates = reports.mock.calls.map(([, , update]) => update);
    expect(updates.some((u) => 'link' in u && u.link === fake.named(`spaces-${message.id}`)!.deepLink)).toBe(true);
    expect(updates.map((u) => ('activity' in u ? u.activity : undefined))).toContain('is running `npm test`');
    reports.mockRestore();
  });

  it('a follow-up goes into the same session, with only what it has not heard', async () => {
    const { message, invocations: first } = await org.post(`${mention(claude)} fix checkout`);
    expect((await org.ended(first[0]!.id)).state).toBe('done');
    const creates = fake.creates().length;
    await org.post("it's the session cookie", { threadRoot: message.id });
    fake.nextTurn = claudeTurn('Added the test.');
    const { invocations } = await org.post(`${mention(claude)} also add a test`, { threadRoot: message.id });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.creates()).toHaveLength(creates);
    const prompt = String(fake.sends().at(-1)!.body!.message);
    expect(prompt).toContain("Earlier in this thread:\n[@Harsh](#member:harsh): it's the session cookie");
    expect(prompt).not.toContain('fix checkout');
    const replies = (await org.thread(message.id)).filter((m) => m.author.memberId === claude.id).map((m) => m.body);
    expect(replies).toEqual(['Done.', 'Added the test.']); // each turn answers with its own reply, not the last one's
  });

  it('reuses its workspace key, and mints a new one when the owner revokes it', async () => {
    await org.ended((await org.post(`${mention(claude)} one`)).invocations[0]!.id);
    await org.ended((await org.post(`${mention(claude)} two`)).invocations[0]!.id);
    const keys = fake.creates().slice(-2).map((c) => (c.body!.env as Record<string, string>).ROWBOAT_AGENT_KEY);
    expect(keys[0]).toBe(keys[1]);

    const listed = (await org.as('dev-ramnique').get('/v1/agents')).body.agents.find((a: { agent: Member }) => a.agent.id === claude.id);
    const workspaceKey = listed.keys.find((k: { createdBy: string; revokedAt?: string }) => k.createdBy === claude.id && !k.revokedAt);
    expect(workspaceKey).toBeDefined();
    await org.as('dev-ramnique').post(`/v1/agents/${claude.id}/keys/${workspaceKey.id}/revoke`, {});
    expect((await org.as(keys[0]!).get('/v1/me')).status).toBe(401);
    await org.ended((await org.post(`${mention(claude)} three`)).invocations[0]!.id);
    const next = (fake.creates().at(-1)!.body!.env as Record<string, string>).ROWBOAT_AGENT_KEY!;
    expect(next).not.toBe(keys[0]);
    expect((await org.as(next).get('/v1/me')).status).toBe(200);
  });

  it('passes the model, effort and fast mode picked in the composer', async () => {
    const { invocations } = await org.post(`${mention(claude)} refactor payments`, {
      agentOptions: { [claude.id]: { model: 'opus-5-5-1m', effort: 'max', fast_mode: true } },
    });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.creates().at(-1)!.body).toMatchObject({ model: 'opus-5-5-1m', effort: 'max', fastMode: true });
  });

  it('asks which project when there are several, and the reply picks it; [env:name] picks it at once', async () => {
    fake.projects = [
      { id: 'proj-web', name: 'web-app', gitRemote: 'git@github.com:acme/web.git' },
      { id: 'proj-api', name: 'api', gitRemote: 'git@github.com:acme/api.git' },
    ];
    const { message, invocations } = await org.post(`${mention(claude)} bump the deps`);
    await until(async () => (await org.invocation(invocations[0]!.id))?.state === 'waiting', 'the question');
    const question = (await org.thread(message.id)).find((m) => m.author.memberId === claude.id)!;
    expect(question.body).toMatch(/Which Conductor project should I work in\? Reply mentioning @Claude with one of: web-app, api\./);
    await org.post(`${mention(claude)} api`, { threadRoot: message.id });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.creates().at(-1)!.body).toMatchObject({ projectId: 'proj-api' });

    const tagged = await org.post(`${mention(claude)} [env:API] check the logs`);
    expect((await org.ended(tagged.invocations[0]!.id)).state).toBe('done');
    expect(fake.creates().at(-1)!.body).toMatchObject({ projectId: 'proj-api' });
    expect(String(fake.sends().at(-1)!.body!.message)).not.toContain('[env:');
    fake.projects = fake.projects.slice(0, 1);
  });

  it('stops a running turn when asked', async () => {
    const long = Array.from({ length: 400 }, () => ({ type: 'assistant', content: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } } }));
    fake.nextTurn = { entries: long };
    const { message, invocations } = await org.post(`${mention(claude)} read everything`);
    await until(async () => fake.named(`spaces-${message.id}`)?.session.status === 'working', 'the turn to run');
    await until(async () => (await org.invocation(invocations[0]!.id))?.link, 'the connector to follow');
    expect((await org.as('dev-harsh').post(`/v1/invocations/${invocations[0]!.id}/cancel`, {})).status).toBe(200);
    expect((await org.ended(invocations[0]!.id)).state).toBe('cancelled');
    expect(fake.received.some((r) => r.method === 'POST' && r.path === `/v0/sessions/${fake.named(`spaces-${message.id}`)!.session.id}/cancel`)).toBe(true);
  });

  it('fails with Conductor’s error when the session errors', async () => {
    fake.nextTurn = { entries: [], error: 'Agent credentials are missing' };
    const { invocations } = await org.post(`${mention(claude)} break please`);
    expect(await org.ended(invocations[0]!.id)).toMatchObject({ state: 'failed', error: 'Agent credentials are missing' });
  });

  it('when Conductor rejects the key, fails fast and tells the owner once', async () => {
    fake.refuse = { status: 401, error: 'Invalid API key' };
    const a = await org.post(`${mention(claude)} first try`);
    expect(await org.ended(a.invocations[0]!.id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/Conductor rejected this agent's API key/) });
    const b = await org.post(`${mention(claude)} second try`);
    expect((await org.ended(b.invocations[0]!.id)).state).toBe('failed');
    fake.refuse = undefined;
    const dm = (await org.as('dev-ramnique').post('/v1/direct', { memberId: claude.id })).body.space.id;
    const stream = (await org.as('dev-ramnique').get(`/v1/spaces/${dm}/stream`)).body.messages as Message[];
    expect(stream.filter((m) => m.author.memberId === claude.id && /Conductor rejected/.test(m.body))).toHaveLength(1);
  });
});

describe('the Conductor connector after a restart', () => {
  it('finishes a turn that ended while Harbor was down, without sending anything again', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const claude = await org.agent('Claude');
    fake.nextTurn = { entries: [], hold: true };
    const { message, invocations } = await org.post(`${mention(claude)} long job`);
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working in Conductor', 'the connector to follow');
    await org.harbor.close();

    await fake.play(fake.named(`spaces-${message.id}`)!.session, claudeTurn('Done while you were away.'));
    const calls = fake.received.length;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).filter((m) => m.author.memberId === claude.id).map((m) => m.body)).toEqual(['Done while you were away.']);
    expect(fake.received.slice(calls).filter((r) => r.method === 'POST')).toEqual([]);
    await org.harbor.close();
    await store.db.close();
  });

  it('sends a request whose send it never heard back from once, into the one workspace', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const claude = await org.agent('Claude');
    fake.refuse = { status: 503, error: 'Service unavailable', paths: /^\/v0\/sessions\/[^/]+\/messages$/ };
    const { message, invocations } = await org.post(`${mention(claude)} while conductor is down`);
    await until(async () => fake.sends().some((r) => String(r.body?.message).includes(`[Spaces request ${message.id}]`)), 'a refused send');
    await org.harbor.close();
    expect((await store.store.getInvocation(invocations[0]!.id))?.state).toBe('working');

    fake.refuse = undefined;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect([...fake.workspaces.values()].filter((w) => w.name === `spaces-${message.id}`)).toHaveLength(1);
    expect(userEntries(`spaces-${message.id}`)).toHaveLength(1);
    await org.harbor.close();
    await store.db.close();
  });
});
