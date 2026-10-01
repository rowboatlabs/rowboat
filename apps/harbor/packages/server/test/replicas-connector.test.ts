import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { routes, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { replicasPlatform } from '../src/connectors/replicas/index.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { claudeTurn, codexTurn, FakeReplicas } from './fake-replicas.js';
import { freshStore, restClient } from './helpers.js';

// The Replicas connector (spec §8 Connectors, 2026-09-30), end to end: a real
// Harbor running the connector against a stand-in Replicas built from its
// OpenAPI. What people see is Harbor's (invocation states, the answer, 👀);
// what Replicas gets is the fake's record of every call.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const original = PLATFORMS.replicas;
let fake: FakeReplicas;

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
  async agent(kind: string, name: string): Promise<Member> {
    const created = await this.as('dev-ramnique').post('/v1/agents', { displayName: name, kind, connection: 'replicas', credential: 'rpl_good' });
    expect(created.status).toBe(200);
    await this.as('dev-ramnique').post(`/v1/spaces/${this.spaceId}/members`, { memberIds: [created.body.agent.id], actingMode: 'direct' });
    return created.body.agent;
  }
  async post(body: string, extra: Record<string, unknown> = {}, token = 'dev-harsh', spaceId = this.spaceId) {
    const r = await this.as(token).post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...extra });
    expect(r.status).toBe(200);
    return routes.postMessage.response.parse(r.body);
  }
  async invocation(id: string, spaceId = this.spaceId): Promise<Invocation | undefined> {
    return ((await this.as('dev-ramnique').get(`/v1/spaces/${spaceId}/invocations`)).body.invocations as Invocation[]).find((i) => i.id === id);
  }
  async ended(id: string, spaceId = this.spaceId): Promise<Invocation> {
    return until(async () => {
      const i = await this.invocation(id, spaceId);
      return i && ['done', 'failed', 'cancelled'].includes(i.state) ? i : undefined;
    }, `invocation ${id} to end`);
  }
  async thread(rootId: string, spaceId = this.spaceId): Promise<Message[]> {
    return (await this.as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${rootId}`)).body.messages;
  }
}

const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'b'.repeat(64);
  fake = await new FakeReplicas().start();
  // The chat re-check after silence, shortened from 20 seconds.
  PLATFORMS.replicas = replicasPlatform(fake.url, { quietMs: 300, tickMs: 100 });
});

afterAll(async () => {
  await fake.close();
  PLATFORMS.replicas = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('the Replicas connector', () => {
  let org: Org;
  let claude: Member;

  beforeAll(async () => {
    org = await new Org(await freshStore()).start();
    await org.space();
    claude = await org.agent('claude-code', 'Claude');
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('refuses a key Replicas does not accept, creating nothing', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'codex', connection: 'replicas', credential: 'rpl_bad' });
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/Replicas did not accept this key/) } });
  });

  it('declares what the composer offers: Plan first, and no Stop', async () => {
    const caps = await until(async () => {
      const r = await org.as('dev-harsh').get(`/v1/agents/${claude.id}/capabilities`);
      return r.body.capabilities?.options?.length ? r.body.capabilities : undefined;
    }, 'capabilities');
    expect(caps).toEqual({ stop: false, options: [{ type: 'toggle', key: 'plan_first', label: 'Plan first' }] });
  });

  it('a first mention creates the thread’s workspace, shows progress, and answers in the thread', async () => {
    const reports = vi.spyOn(org.harbor.service, 'updateInvocation');
    fake.nextTurn = claudeTurn('Fixed the login bug.', { prUrls: ['https://github.com/acme/web/pull/42'] });
    const { message, invocations } = await org.post(`${mention(claude)} fix the login bug`);
    const done = await org.ended(invocations[0]!.id);
    expect(done.state).toBe('done');
    expect(reports.mock.calls.some(([, , update]) => 'link' in update && /^https:\/\/app\.replicas\.dev\/workspace\/ws-\d+$/.test(update.link ?? ''))).toBe(true);

    const create = fake.creates().at(-1)!.body!;
    expect(create).toMatchObject({ name: `spaces-${message.id}`, environment_id: 'env-web', coding_agent: 'claude', plan_mode: false });
    const prompt = String(create.message);
    expect(prompt.startsWith(`${mention(claude)} fix the login bug`)).toBe(true); // the person's words first, as written
    expect(prompt.endsWith(`[Spaces request ${message.id}]`)).toBe(true);
    expect(prompt).toContain('Requested by Harsh');

    const reply = (await org.thread(message.id)).find((m) => m.author.memberId === claude.id)!;
    expect(reply.body).toBe('Fixed the login bug.\n\nPull request: https://github.com/acme/web/pull/42');
    const trigger = (await org.as('dev-harsh').get(`/v1/spaces/${org.spaceId}/threads/${message.id}`)).body.root as Message;
    expect(trigger.reactions).toEqual([expect.objectContaining({ emoji: '👀', memberIds: [claude.id] })]);
    const activities = reports.mock.calls.map(([, , update]) => ('activity' in update ? update.activity : undefined));
    expect(activities).toContain('is running `npm test`');
    reports.mockRestore();
  });

  it('a follow-up goes into the same workspace and chat, with only what it has not heard', async () => {
    const { message, invocations: first } = await org.post(`${mention(claude)} fix checkout`);
    const root = message.id;
    expect((await org.ended(first[0]!.id)).state).toBe('done');
    const creates = fake.creates().length;
    await org.post("it's the session cookie", { threadRoot: root });
    const { invocations } = await org.post(`${mention(claude)} also add a test`, { threadRoot: root });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.creates()).toHaveLength(creates);
    const send = fake.sends().at(-1)!;
    expect(send.body).toMatchObject({ chat_id: expect.stringMatching(/^chat-/) });
    const prompt = String(send.body!.message);
    expect(prompt.startsWith(`${mention(claude)} also add a test`)).toBe(true);
    expect(prompt).toContain("Earlier in this thread:\n[@Harsh](#member:harsh): it's the session cookie");
    expect(prompt).not.toContain('fix checkout'); // the workspace heard that already
  });

  it('keeps mentions and writes authors as tokens, so the agent can mention anyone in the thread', async () => {
    const { message, invocations: first } = await org.post(`${mention(claude)} look at the cart`);
    expect((await org.ended(first[0]!.id)).state).toBe('done');
    await org.post('[@Harsh](#member:harsh) can you check the totals?', { threadRoot: message.id }, 'dev-ramnique');
    const { invocations } = await org.post(`${mention(claude)} /plan pair with [@Ramnique](#member:ramnique) on it`, { threadRoot: message.id });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const prompt = String(fake.sends().at(-1)!.body!.message);
    expect(prompt.startsWith('/plan pair with [@Ramnique](#member:ramnique) on it')).toBe(true); // its mention goes only before a command, so Replicas runs it
    expect(prompt).toContain('Earlier in this thread:\n[@Ramnique](#member:ramnique): [@Harsh](#member:harsh) can you check the totals?');
    expect(prompt).toContain(`You are [@Claude](#member:${claude.id}) in Rowboat, and this request comes from [@Harsh](#member:harsh) in the space "Payments"`);
    expect(prompt).toContain('Agents see only messages that mention them');
  });

  it('keeps a mention of the agent in mid-sentence, so the request has no blank in it', async () => {
    const { invocations } = await org.post(`[@Ramnique](#member:ramnique) and ${mention(claude)}, introduce yourselves`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const prompt = String(fake.creates().at(-1)!.body!.message);
    expect(prompt.startsWith(`[@Ramnique](#member:ramnique) and ${mention(claude)}, introduce yourselves`)).toBe(true);
  });

  it('asks which environment when there are several, and the reply picks it', async () => {
    fake.environments = [
      { id: 'env-global', name: 'Global', is_global: true },
      { id: 'env-web', name: 'web-app' },
      { id: 'env-api', name: 'api' },
    ];
    const { message, invocations } = await org.post(`${mention(claude)} bump the deps`);
    await until(async () => (await org.invocation(invocations[0]!.id))?.state === 'waiting', 'the question');
    const question = (await org.thread(message.id)).find((m) => m.author.memberId === claude.id)!;
    expect(question.body).toMatch(/Which Replicas environment should I use\? Reply mentioning @Claude with one of: web-app, api\./);
    await org.post(`${mention(claude)} api`, { threadRoot: message.id });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.creates().at(-1)!.body).toMatchObject({ environment_id: 'env-api' });
  });

  it('takes the environment and plan mode picked in the composer', async () => {
    const { invocations } = await org.post(`${mention(claude)} plan the migration`, {
      agentOptions: { [claude.id]: { environment: 'env-api', plan_first: true } },
    });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.creates().at(-1)!.body).toMatchObject({ environment_id: 'env-api', plan_mode: true });
    fake.environments = [
      { id: 'env-global', name: 'Global', is_global: true },
      { id: 'env-web', name: 'web-app' },
    ];
  });

  it('sends the invoking message’s images, and lists every attachment with its download address', async () => {
    const hash = createHash('sha256').update(PNG).digest('hex');
    await org.harbor.service.uploadBlob({ memberId: 'harsh' }, org.spaceId, PNG, { declaredSha256: hash, declaredMime: 'image/png' });
    const link = `${org.harbor.url}/s/${org.spaceId}/b/${hash}`;
    const { invocations } = await org.post(`${mention(claude)} why does this render wrong? ![shot](${link})`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const create = fake.creates().at(-1)!.body!;
    expect(create.images).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } }]);
    expect(String(create.message)).toContain(`- shot (image/png, 70 B): ${org.harbor.url}/v1/spaces/${org.spaceId}/blobs/${hash}?name=shot`);
    expect(String(create.message).startsWith(`${mention(claude)} why does this render wrong? [attached: shot]`)).toBe(true); // no raw link for Replicas to render broken
  });

  it('reads Codex’s answer too', async () => {
    const codex = await org.agent('codex', 'Codex');
    fake.nextTurn = codexTurn('Tests pass on main.');
    const { message, invocations } = await org.post(`${mention(codex)} run the tests`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.creates().at(-1)!.body).toMatchObject({ coding_agent: 'codex' });
    expect((await org.thread(message.id)).find((m) => m.author.memberId === codex.id)!.body).toBe('Tests pass on main.');
  });

  it('for a coding agent whose events Replicas does not document, posts the links it knows', async () => {
    const cursor = await org.agent('cursor', 'Cursor');
    fake.nextTurn = { events: [{ type: 'cursor-assistant', payload: { text: 'hello' } }], prUrls: ['https://github.com/acme/web/pull/7'] };
    const { message, invocations } = await org.post(`${mention(cursor)} tidy the README`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).find((m) => m.author.memberId === cursor.id)!.body).toEqual(
      expect.stringMatching(/^Finished in Replicas\.\n\nPull request: https:\/\/github\.com\/acme\/web\/pull\/7\n\nWorkspace: https:\/\/app\.replicas\.dev\/workspace\/ws-\d+$/),
    );
  });

  it('fails a turn Replicas reports as failed, with Claude’s own reason', async () => {
    fake.nextTurn = {
      events: [{ type: 'claude-result', payload: { type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['Reached the turn limit'] } }],
    };
    const { invocations } = await org.post(`${mention(claude)} rewrite everything`);
    expect(await org.ended(invocations[0]!.id)).toMatchObject({ state: 'failed', error: 'Reached the turn limit' });
  });

  it('finishes a turn that ended before its stream connected, while Replicas talks about other things', async () => {
    // Live, 2026-10-01: a new workspace refused the stream while it booted, Claude answered in five
    // seconds, and the stream then carried only events about other things. Only this chat's events
    // count as news, so silence about it leads to checking the chat and its history directly.
    fake.refuseStreams = 2;
    fake.chatter = true;
    fake.nextTurn = claudeTurn('Hi Ramnique!', { early: true });
    const { message, invocations } = await org.post(`${mention(claude)} hi`);
    const ended = await org.ended(invocations[0]!.id);
    fake.chatter = false;
    expect(ended.state).toBe('done');
    expect((await org.thread(message.id)).find((m) => m.author.memberId === claude.id)!.body).toBe('Hi Ramnique!');
  });

  it('picks a dropped stream back up', async () => {
    fake.nextTurn = claudeTurn('Recovered.', { dropAfter: 1 });
    const { message, invocations } = await org.post(`${mention(claude)} flaky network please`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).find((m) => m.author.memberId === claude.id)!.body).toBe('Recovered.');
  });

  it('fails at Replicas’s workspace limit with its reason', async () => {
    fake.refuse = { status: 429, error: 'Too many workspaces', paths: /^\/v1\/replica$/ };
    const { invocations } = await org.post(`${mention(claude)} one more thing`);
    const ended = await org.ended(invocations[0]!.id);
    fake.refuse = undefined;
    expect(ended).toMatchObject({ state: 'failed', error: expect.stringMatching(/limit of 100 active workspaces/) });
  });

  it('when Replicas rejects the key, fails fast and tells the owner once', async () => {
    fake.refuse = { status: 401, error: 'Invalid or missing API key' };
    const a = await org.post(`${mention(claude)} first try`);
    expect(await org.ended(a.invocations[0]!.id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/Replicas rejected this agent's API key/) });
    const b = await org.post(`${mention(claude)} second try`);
    expect((await org.ended(b.invocations[0]!.id)).state).toBe('failed');
    fake.refuse = undefined;

    const listed = (await org.as('dev-ramnique').get('/v1/agents')).body.agents.find((a: { agent: Member }) => a.agent.id === claude.id);
    expect(listed.credential).toMatchObject({ rejectedAt: expect.any(String) });
    const dm = (await org.as('dev-ramnique').post('/v1/direct', { memberId: claude.id })).body.space.id;
    const stream = (await org.as('dev-ramnique').get(`/v1/spaces/${dm}/stream`)).body.messages as Message[];
    expect(stream.filter((m) => m.author.memberId === claude.id && /Replicas rejected/.test(m.body))).toHaveLength(1);
  });
});

describe('the Replicas connector after a restart', () => {
  it('finishes a turn that ended while Harbor was down, without sending anything again', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const claude = await org.agent('claude-code', 'Claude');
    fake.nextTurn = { events: [], hold: true };
    const { message, invocations } = await org.post(`${mention(claude)} long job`);
    const workspace = await until(async () => [...fake.workspaces.values()].find((w) => w.name === `spaces-${message.id}`), 'the workspace');
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working in Replicas', 'the connector to follow');
    await org.harbor.close(); // Harbor goes down mid-turn

    await fake.play(workspace, claudeTurn('Done while you were away.')); // …and Replicas finishes meanwhile
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

  it('sends a request that never reached Replicas, once it is back', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const claude = await org.agent('claude-code', 'Claude');
    fake.refuse = { status: 503, error: 'Service unavailable', paths: /^\/v1\/replica$/ };
    const { message, invocations } = await org.post(`${mention(claude)} while replicas is down`);
    await until(async () => fake.received.some((r) => r.method === 'POST' && r.path === '/v1/replica' && String(r.body?.name) === `spaces-${message.id}`), 'a refused create');
    await org.harbor.close(); // down while Replicas is refusing: the invocation stays working
    expect((await store.store.getInvocation(invocations[0]!.id))?.state).toBe('working');

    fake.refuse = undefined;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect([...fake.workspaces.values()].filter((w) => w.name === `spaces-${message.id}`)).toHaveLength(1);
    await org.harbor.close();
    await store.db.close();
  });
});
