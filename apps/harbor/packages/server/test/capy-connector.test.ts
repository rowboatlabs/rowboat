import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { requestIdFor, requestInTranscript } from '../src/connectors/capy/connector.js';
import { capyPlatform } from '../src/connectors/capy/index.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { FakeCapy, GOOD_KEY } from './fake-capy.js';
import { freshStore, restClient } from './helpers.js';

// The Capy connector (spec §8 Connectors, 2026-10-02), end to end: a real
// Harbor running the connector against a stand-in Capy built from its OpenAPI.

const original = PLATFORMS.capy;
let fake: FakeCapy;

async function until<T>(check: () => Promise<T | undefined | false>, what: string, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

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
    const created = await this.as('dev-ramnique').post('/v1/agents', { displayName: name, kind: 'capy', connection: 'capy', credential: GOOD_KEY });
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
  async replies(rootId: string, agent: Member): Promise<string[]> {
    const messages = (await this.as('dev-harsh').get(`/v1/spaces/${this.spaceId}/threads/${rootId}`)).body.messages as Message[];
    return messages.filter((m) => m.author.memberId === agent.id).map((m) => m.body);
  }
}

const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'd'.repeat(64);
  fake = await new FakeCapy().start();
  PLATFORMS.capy = capyPlatform(fake.url, { tickMs: 100, graceMs: 500 });
});

afterAll(async () => {
  await fake.close();
  PLATFORMS.capy = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('the Capy connector', () => {
  let org: Org;
  let capy: Member;

  beforeAll(async () => {
    org = await new Org(await freshStore()).start();
    await org.space();
    capy = await org.agent('Capy');
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('refuses a key Capy does not accept, creating nothing', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'capy', connection: 'capy', credential: 'capy_bad' });
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/Capy did not accept this key/) } });
  });

  it('declares Stop, and no Project while the key reaches one', async () => {
    const caps = await until(async () => {
      const r = await org.as('dev-harsh').get(`/v1/agents/${capy.id}/capabilities`);
      return r.body.capabilities?.stop ? r.body.capabilities : undefined;
    }, 'capabilities');
    expect(caps).toEqual({ stop: true, options: [] });
  });

  it('a first mention creates the thread in the project, shows progress, and answers with the PR link', async () => {
    fake.next = { tools: ['bash'], answer: 'Fixed it: https://github.com/acme/web/pull/7' };
    const { message, invocations } = await org.post(`${mention(capy)} fix the flaky retry test`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const create = fake.calls('POST', /^\/api\/v1\/threads$/).at(-1)!.body!;
    expect(create).toMatchObject({ requestId: requestIdFor(capy.id, message.id), projectId: 'project_web' });
    const text = String(create.message);
    expect(text.startsWith(`${mention(capy)} fix the flaky retry test`)).toBe(true);
    expect(text).toContain('Requested by Harsh');
    expect(text.endsWith(`[Spaces request ${message.id}]`)).toBe(true);
    expect(await org.replies(message.id, capy)).toEqual(['Fixed it: https://github.com/acme/web/pull/7']);
  });

  it('a follow-up goes into the same Capy thread, keyed so a retry cannot repeat it', async () => {
    const first = await org.post(`${mention(capy)} start`);
    await until(async () => (await org.replies(first.message.id, capy)).length === 1, 'the first answer');
    await org.post('I think it is the timeout', { threadRoot: first.message.id }, 'dev-ramnique');
    fake.next = { answer: 'Agreed, raised it.' };
    const second = await org.post(`${mention(capy)} what do you think?`, { threadRoot: first.message.id });
    expect((await org.ended(second.invocations[0]!.id)).state).toBe('done');
    const send = fake.calls('POST', /\/message$/).at(-1)!;
    const capyThread = [...fake.threads.values()].find((t) => t.requestId === requestIdFor(capy.id, first.message.id))!;
    expect(send.path).toBe(`/api/v1/threads/${capyThread.id}/message`);
    expect(send.body).toMatchObject({ clientKey: second.message.id, delivery: 'queue' });
    expect(String(send.body!.text)).toContain('Earlier in this thread:\n[@Ramnique](#member:ramnique): I think it is the timeout');
    expect(await org.replies(first.message.id, capy)).toEqual(['Done.', 'Agreed, raised it.']);
  });

  it('with several projects, uses the one picked, and says what to pick when none is', async () => {
    fake.projects.push({ id: 'project_api', name: 'api' });
    const unpicked = await org.post(`${mention(capy)} which one?`);
    expect(await org.ended(unpicked.invocations[0]!.id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/several projects \(web \(project_web\), api \(project_api\)\)/) });
    const picked = await org.post(`${mention(capy)} in the api`, { agentOptions: { [capy.id]: { project: 'project_api' } } });
    expect((await org.ended(picked.invocations[0]!.id)).state).toBe('done');
    expect(fake.calls('POST', /^\/api\/v1\/threads$/).at(-1)!.body).toMatchObject({ projectId: 'project_api' });
    fake.projects.pop();
  });

  it('fails a run Capy reports failed, posting what it said', async () => {
    fake.next = { answer: 'The build is broken upstream.', fail: true };
    const { message, invocations } = await org.post(`${mention(capy)} try this`);
    expect(await org.ended(invocations[0]!.id)).toMatchObject({ state: 'failed', error: 'Capy reported the run failed.' });
    expect(await org.replies(message.id, capy)).toEqual(['The build is broken upstream.']);
  });

  it('Stop interrupts the run in Capy and reports it cancelled', async () => {
    fake.next = { hold: true };
    const { message, invocations } = await org.post(`${mention(capy)} run forever`);
    const id = invocations[0]!.id;
    await until(async () => [...fake.threads.values()].some((t) => t.requestId === requestIdFor(capy.id, message.id) && t.status === 'working'), 'the run');
    await until(async () => (await org.invocation(id))?.activity === 'Working in Capy', 'the connector to follow');
    expect((await org.as('dev-harsh').post(`/v1/invocations/${id}/cancel`, {})).status).toBe(200);
    expect((await org.ended(id)).state).toBe('cancelled');
    expect(fake.calls('POST', /\/interrupt$/)).toHaveLength(1);
    expect(await org.replies(message.id, capy)).toEqual([]);
  });

  it('when Capy rejects the key, fails fast and tells the owner once', async () => {
    fake.refuse = { status: 401, tag: 'capy/Unauthorized', paths: /^\/api\/v1\/projects$/ };
    const a = await org.post(`${mention(capy)} new thread one`);
    expect(await org.ended(a.invocations[0]!.id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/Capy rejected this agent’s API key/) });
    const b = await org.post(`${mention(capy)} new thread two`);
    expect((await org.ended(b.invocations[0]!.id)).state).toBe('failed');
    fake.refuse = undefined;
    const dm = (await org.as('dev-ramnique').post('/v1/direct', { memberId: capy.id })).body.space.id;
    const stream = (await org.as('dev-ramnique').get(`/v1/spaces/${dm}/stream`)).body.messages as Message[];
    expect(stream.filter((m) => m.author.memberId === capy.id && /Capy rejected/.test(m.body))).toHaveLength(1);
  });
});

describe('the Capy connector after a restart', () => {
  it('finishes a run that ended while Harbor was down, without sending anything again', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const capy = await org.agent('Capy');
    fake.next = { hold: true };
    const { message, invocations } = await org.post(`${mention(capy)} long job`);
    const thread = await until(async () => [...fake.threads.values()].find((t) => t.requestId === requestIdFor(capy.id, message.id)), 'the thread');
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working in Capy', 'the connector to follow');
    await org.harbor.close();

    fake.finish(thread.id, { answer: 'Done while you were away.' });
    const creates = fake.calls('POST', /^\/api\/v1\/threads$/).length;
    const sends = fake.calls('POST', /\/message$/).length;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(await org.replies(message.id, capy)).toEqual(['Done while you were away.']);
    expect(fake.calls('POST', /^\/api\/v1\/threads$/)).toHaveLength(creates);
    expect(fake.calls('POST', /\/message$/)).toHaveLength(sends);
    expect(thread.transcript.filter((m) => m.source === 'user')).toHaveLength(1);
    await org.harbor.close();
    await store.db.close();
  });

  it('sends a request that never reached Capy, once it is back, exactly once', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const capy = await org.agent('Capy');
    fake.refuse = { status: 503, tag: 'capy/Unavailable', paths: /^\/api\/v1\/threads$/ };
    const { message, invocations } = await org.post(`${mention(capy)} while Capy is down`);
    await until(async () => fake.calls('POST', /^\/api\/v1\/threads$/).some((r) => r.body?.requestId === requestIdFor(capy.id, message.id)), 'a refused create');
    await org.harbor.close();
    expect((await store.store.getInvocation(invocations[0]!.id))?.state).toBe('working');

    fake.refuse = undefined;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect([...fake.threads.values()].filter((t) => t.requestId === requestIdFor(capy.id, message.id))).toHaveLength(1);
    await org.harbor.close();
    await store.db.close();
  });
});

describe('reading a Capy transcript', () => {
  it('finds a request by its client key or marker, and Capy’s last reply after it', () => {
    const marker = '[Spaces request M1]';
    expect(requestInTranscript([{ id: '1', source: 'user', text: 'other' }], 'M1', marker)).toBeUndefined();
    expect(
      requestInTranscript(
        [
          { id: '1', source: 'user', text: `hi\n\n${marker}` },
          { id: '2', source: 'tool', tool: 'bash' },
          { id: '3', source: 'assistant', text: 'working on it' },
          { id: '4', source: 'assistant', text: 'the answer' },
          { id: '5', source: 'user', text: 'next', clientKey: 'M2' },
          { id: '6', source: 'assistant', text: 'not this' },
        ],
        'M1',
        marker,
      ),
    ).toEqual({ answer: 'the answer' });
    expect(requestInTranscript([{ id: '1', source: 'user', text: 'x', clientKey: 'M1' }], 'M1', marker)).toEqual({ answer: undefined });
  });
});
