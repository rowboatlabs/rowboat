import { HERMES_IMAGE } from '../src/connectors/maritime/runtimes.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { routes, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { maritimePlatform } from '../src/connectors/maritime/index.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { AGENT_ID, claudeTurn, codexTurn, FakeMaritime, GOOD_KEY, hermesTurn } from './fake-maritime.js';
import { freshStore, restClient } from './helpers.js';

// The Maritime connector (spec §8 Connectors, Maritime, 2026-10-26), end to
// end: a real Harbor running the connector against a stand-in Maritime built
// from its OpenAPI and what was measured on the real platform. What people see
// is Harbor's (invocation states, the answer, 👀); what Maritime gets is the
// fake's record of every call, every file written, and every command submitted.

const original = PLATFORMS.maritime;
let fake: FakeMaritime;

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
      name: 'Rowboat Labs',
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
  async agent(name: string, kind: string): Promise<Member> {
    const created = await this.as('dev-ramnique').post('/v1/agents', { displayName: name, kind, connection: 'maritime', credential: GOOD_KEY, instance: AGENT_ID });
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
  async reactions(messageId: string): Promise<Message['reactions']> {
    const { root, messages } = (await this.as('dev-harsh').get(`/v1/spaces/${this.spaceId}/threads/${messageId}`)).body;
    return (root.id === messageId ? root : messages.find((m: Message) => m.id === messageId)).reactions;
  }
  async thread(rootId: string): Promise<Message[]> {
    return (await this.as('dev-harsh').get(`/v1/spaces/${this.spaceId}/threads/${rootId}`)).body.messages;
  }
}

const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'd'.repeat(64);
  fake = await new FakeMaritime().start();
  PLATFORMS.maritime = maritimePlatform(fake.url, { pollMs: 40 });
});

afterAll(async () => {
  await fake.close();
  PLATFORMS.maritime = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('adding a Maritime agent', () => {
  let org: Org;
  beforeAll(async () => {
    org = await new Org(await freshStore()).start();
    await org.space();
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('refuses a key Maritime does not accept, creating nothing', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'hermes', connection: 'maritime', credential: 'mk_bad', instance: AGENT_ID });
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/Maritime did not accept this key/) } });
  });

  it('refuses an agent the key does not reach, and one that runs another kind', async () => {
    const missing = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'hermes', connection: 'maritime', credential: GOOD_KEY, instance: 'agt-other' });
    expect(missing).toMatchObject({ status: 400, body: { message: expect.stringMatching(/does not reach an agent agt-other/) } });
    const wrong = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'codex', connection: 'maritime', credential: GOOD_KEY, instance: AGENT_ID });
    expect(wrong).toMatchObject({ status: 400, body: { message: expect.stringMatching(/runs hermes, not codex/) } });
    const none = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'hermes', connection: 'maritime', credential: GOOD_KEY });
    expect(none).toMatchObject({ status: 400, body: { message: expect.stringMatching(/instance/) } });
  });

  it('takes an agent made from an image at the person’s word, since its record names no runtime', async () => {
    fake.agent = { ...fake.agent, framework: 'custom', templateId: null };
    const r = await org.as('dev-ramnique').post('/v1/agents', { displayName: 'Imaged', kind: 'codex', connection: 'maritime', credential: GOOD_KEY, instance: AGENT_ID });
    expect(r.status).toBe(200);
    fake.agent = { ...fake.agent, framework: 'hermes', templateId: 'hermes' };
  });
});

describe('the Maritime connector with Hermes on Rowboat’s own image', () => {
  // A managed Hermes is a `custom` box on Rowboat's image (2026-11-11): Maritime roots its files API at /data there,
  // where its `hermes` framework roots it at /opt/data, and the connector learns which from the box's record.
  let org: Org;
  let imaged: Member;

  beforeAll(async () => {
    fake.agent = { ...fake.agent, framework: 'custom', templateId: null, imageName: HERMES_IMAGE, status: 'sleeping' };
    org = await new Org(await freshStore()).start();
    await org.space();
    imaged = await org.agent('Imaged', 'hermes');
  });
  afterAll(async () => {
    fake.agent = { ...fake.agent, framework: 'hermes', templateId: 'hermes', imageName: undefined };
    await org.harbor.close();
  });

  it('keeps the turn’s files under /data, where the box’s files API is rooted, and still runs the Hermes script', async () => {
    fake.nextTurn = hermesTurn('On my own image.');
    const { invocations } = await org.post(`${mention(imaged)} hello`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const execution = fake.submits().at(-1)!;
    expect(execution.files.prompt).toBe(`/data/rowboat/${invocations[0]!.id}.prompt`);
    expect(fake.lastPrompt()!.startsWith(`${mention(imaged)} hello`)).toBe(true);
    expect(execution.script).toContain(`hermes chat --query-file '/data/rowboat/${invocations[0]!.id}.prompt'`);
    expect(execution.script).toContain('export HERMES_HOME=/opt/data HOME=/opt/data');
  });
});

describe('the Maritime connector with Hermes', () => {
  let org: Org;
  let scout: Member;

  beforeAll(async () => {
    fake.agent = { ...fake.agent, framework: 'hermes', templateId: 'hermes', status: 'sleeping' };
    org = await new Org(await freshStore()).start();
    await org.space();
    scout = await org.agent('Scout', 'hermes');
    await org.as('dev-ramnique').post('/v1/spaces', { name: 'Design' }); // a second space: DMs are on
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('declares Stop and Effort for the composer', async () => {
    const caps = await until(async () => {
      const r = await org.as('dev-harsh').get(`/v1/agents/${scout.id}/capabilities`);
      return r.body.capabilities?.options?.length ? r.body.capabilities : undefined;
    }, 'capabilities');
    expect(caps.stop).toBe(true);
    expect(caps.options.map((o: { key: string }) => o.key)).toEqual(['effort']);
  });

  it('fails the turn with the exit code when the command stops before Hermes writes anything, instead of saying it finished', async () => {
    // 2026-11-13: an execution that ended with exit code 1 and no output file read as a success, and the thread got
    // "Finished on Maritime." (Piper, super, c3po). The reason must survive even when stderr is empty.
    fake.nextTurn = { lines: [], exitCode: 1 };
    const { invocations } = await org.post(`${mention(scout)} are you there?`);
    const ended = await org.ended(invocations[0]!.id);
    expect(ended.state).toBe('failed');
    expect(ended.error).toMatch(/Hermes did not run: its command stopped with exit code 1 and wrote nothing/);
  });

  it('wakes the VM, writes the request to the volume, runs hermes chat on the thread’s session, and answers in the thread', async () => {
    fake.nextTurn = hermesTurn('The deploy is green.');
    const { message, invocations } = await org.post(`${mention(scout)} is the deploy green?`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');

    expect(fake.starts().length).toBeGreaterThan(0);
    const execution = fake.submits().at(-1)!;
    expect(execution.files.prompt).toBe(`/opt/data/rowboat/${invocations[0]!.id}.prompt`);
    const prompt = fake.lastPrompt()!;
    expect(prompt.startsWith(`${mention(scout)} is the deploy green?`)).toBe(true);
    expect(prompt.endsWith(`[Spaces request ${message.id}]`)).toBe(true);
    expect(execution.script).toContain('hermes chat --query-file');
    expect(execution.script).toContain(`-c 'rb-${org.spaceId.toLowerCase()}-${message.id.toLowerCase()}' --create-if-missing`);
    expect(execution.script).toContain('--format stream-json');
    expect(execution.script).toMatch(/export HERMES_HOME=\/opt\/data HOME=\/opt\/data ROWBOAT_URL='http:\/\/localhost:\d+' ROWBOAT_AGENT_KEY='rbk_/);
    // The Spaces MCP server in Hermes's config, by placeholder, and the two values in its .env, where Hermes's gateway reads them from.
    expect(execution.script).toContain('hermes config set mcp_servers.rowboat ');
    expect(execution.script).toContain('hermes config set ROWBOAT_URL "$ROWBOAT_URL"');
    expect(execution.script).toContain('hermes config set ROWBOAT_AGENT_KEY "$ROWBOAT_AGENT_KEY"');
    expect(execution.script).toContain('hermes skills install rowboatlabs/rowboat/skills/rowboat-spaces --yes');
    const key = execution.script.match(/ROWBOAT_AGENT_KEY='(rbk_[^']+)'/)![1]!;
    expect((await org.as(key).get('/v1/me')).status).toBe(200); // the VM acts as the agent

    const reply = (await org.thread(message.id)).find((m) => m.author.memberId === scout.id)!;
    expect(reply.body).toBe('The deploy is green.');
    await vi.waitFor(async () => expect(await org.reactions(message.id)).toEqual([]));
  });

  it('answers and accepts a follow-up while the catalogue is stalled, then publishes the refreshed choices', async () => {
    // Establish a completed refresh in this test before stalling the next one (2026-11-01).
    fake.files.set('/opt/data/rowboat/models.json', JSON.stringify({ models: ['baseline-a', 'baseline-b'] }));
    fake.nextTurn = hermesTurn('Initial catalogue ready.');
    const initial = await org.post(`${mention(scout)} initialise the catalogue`);
    await org.ended(initial.invocations[0]!.id);
    await until(async () => {
      const { body } = await org.as('dev-harsh').get(`/v1/agents/${scout.id}/capabilities`);
      return body.capabilities.options.find((o: { key: string }) => o.key === 'model')?.choices[0]?.id === 'baseline-a';
    }, 'initial catalogue');
    const before = fake.catalogs().length;
    fake.holdCatalog = true;
    try {
      fake.nextTurn = hermesTurn('Ready before the catalogue.');
      const { message, invocations } = await org.post(`${mention(scout)} check the deploy`);
      const catalog = await until(async () => fake.catalogs().slice(before).find((e) => e.status === 'running'), 'stalled catalogue');
      expect((await org.invocation(invocations[0]!.id))?.state).toBe('done');
      expect(await org.reactions(message.id)).toEqual([]);
      expect((await org.thread(message.id)).map((m) => m.body)).toEqual(['Ready before the catalogue.']);
      const submission = fake.received.find((r) => r.path.endsWith('/exec') && JSON.stringify(r.body?.command).includes('/rowboat/models.json'))!;
      expect(submission.body).toMatchObject({ detached: true, timeout: 45 });

      fake.nextTurn = hermesTurn('The follow-up also finishes.');
      const followup = await org.post(`${mention(scout)} and the tests?`, { threadRoot: message.id });
      expect((await org.ended(followup.invocations[0]!.id)).state).toBe('done');
      expect(catalog.status).toBe('running');
      expect(fake.catalogs()).toHaveLength(before + 1);
      expect(fake.lastPrompt()).not.toContain('Earlier in this thread:');

      fake.files.set('/opt/data/rowboat/models.json', JSON.stringify({ models: ['fast-model', 'deep-model'] }));
      Object.assign(catalog, { status: 'completed', exitCode: 0 });
      await until(async () => {
        const { body } = await org.as('dev-harsh').get(`/v1/agents/${scout.id}/capabilities`);
        return body.capabilities.options.find((o: { key: string }) => o.key === 'model')?.choices[0]?.id === 'fast-model';
      }, 'new model choices');
      expect((await org.thread(message.id)).filter((m) => m.author.memberId === scout.id).map((m) => m.body)).toEqual([
        'Ready before the catalogue.', 'The follow-up also finishes.',
      ]);
    } finally {
      fake.holdCatalog = false;
      for (const e of fake.catalogs()) if (e.status === 'running') Object.assign(e, { status: 'completed', exitCode: 0 });
    }
  });

  it('a failed turn still refreshes the catalogue, and a timed-out refresh preserves the turn error and prior choices', async () => {
    const before = fake.catalogs().length;
    const choices = (await org.as('dev-harsh').get(`/v1/agents/${scout.id}/capabilities`)).body.capabilities.options;
    fake.holdCatalog = true;
    try {
      fake.nextTurn = { lines: [JSON.stringify({ type: 'result', error: 'Model unavailable', exit_code: 1 })], exitCode: 1 };
      const { message, invocations } = await org.post(`${mention(scout)} try an unavailable model`);
      const catalog = await until(async () => fake.catalogs().slice(before).find((e) => e.status === 'running'), 'catalogue after failed turn');
      expect(await org.invocation(invocations[0]!.id)).toMatchObject({ state: 'failed', error: 'Model unavailable' });
      const readsBefore = fake.received.length;
      fake.files.set('/opt/data/rowboat/models.json', JSON.stringify({ models: ['unfinished-a', 'unfinished-b'] }));
      Object.assign(catalog, { status: 'failed', exitCode: 124 });
      await until(async () => fake.received.slice(readsBefore).some((r) => r.method === 'GET' && r.path.endsWith(`/exec/${catalog.executionId}`)), 'refresh timeout read');
      expect((await org.as('dev-harsh').get(`/v1/agents/${scout.id}/capabilities`)).body.capabilities.options).toEqual(choices);
      expect(await org.invocation(invocations[0]!.id)).toMatchObject({ state: 'failed', error: 'Model unavailable' });
      expect(await org.thread(message.id)).toEqual([]);
    } finally {
      fake.holdCatalog = false;
      for (const e of fake.catalogs()) if (e.status === 'running') Object.assign(e, { status: 'failed', exitCode: 124 });
    }
  });

  it.each([false, true])('clears the working reaction and preserves deliberate reactions (agent completion: %s)', async (completed) => {
    const root = await org.post('A job for Scout');
    fake.nextTurn = { lines: [], hold: true };
    const { message, invocations } = await org.post(`${mention(scout)} run it`, { threadRoot: root.message.id });
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working on Maritime', 'the connector to follow');
    await org.as('dev-harsh').post(`/v1/spaces/${org.spaceId}/messages/${message.id}/reactions`, { emoji: '👀', action: 'add', actingMode: 'direct' });
    if (completed) {
      const key = fake.submits().at(-1)!.script.match(/ROWBOAT_AGENT_KEY='(rbk_[^']+)'/)![1]!;
      const result = await org.as(key).post(`/v1/spaces/${org.spaceId}/messages/${message.id}/reactions`, { emoji: '✅', action: 'add', actingMode: 'direct' });
      expect(result.status).toBe(200);
    }
    await fake.play(fake.submits().at(-1)!, hermesTurn('Finished.'));
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    await vi.waitFor(async () => {
      const reactions = await org.reactions(message.id);
      expect(reactions).toHaveLength(completed ? 2 : 1);
      expect(reactions).toEqual(expect.arrayContaining([
        expect.objectContaining({ emoji: '👀', memberIds: ['harsh'] }),
        ...(completed ? [expect.objectContaining({ emoji: '✅', memberIds: [scout.id] })] : []),
      ]));
    });
    expect(await org.reactions(root.message.id)).toEqual([]);
  });

  it('keeps the successful answer and terminal state when reaction cleanup fails', async () => {
    fake.nextTurn = { lines: [], hold: true };
    const { message, invocations } = await org.post(`${mention(scout)} finish even if reactions fail`);
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working on Maritime', 'the connector to follow');
    const reactions = vi.spyOn(org.harbor.service, 'reactToMessage').mockRejectedValue(new Error('Reactions unavailable'));
    try {
      await fake.play(fake.submits().at(-1)!, hermesTurn('The answer still arrives.'));
      expect((await org.ended(invocations[0]!.id)).state).toBe('done');
      await vi.waitFor(() => expect(reactions).toHaveBeenCalledTimes(1));
      expect((await org.thread(message.id)).filter((m) => m.author.memberId === scout.id).map((m) => m.body)).toEqual(['The answer still arrives.']);
    } finally {
      reactions.mockRestore();
    }
  });

  it('a follow-up resumes the same session with only what it has not heard, and passes the effort picked', async () => {
    fake.nextTurn = hermesTurn('Noted.', { session: 'local-first' });
    const { message, invocations: first } = await org.post(`${mention(scout)} watch the checkout job`);
    expect((await org.ended(first[0]!.id)).state).toBe('done');
    // Sent to people only: a reply that mentions nobody would follow up the agent itself (spec §8, 2026-10-27).
    await org.post('it runs at nine', { threadRoot: message.id, peopleOnly: true });
    fake.nextTurn = hermesTurn('Will do.', { session: 'local-first' });
    const { invocations } = await org.post(`${mention(scout)} ping me when it ends`, { threadRoot: message.id, agentOptions: { [scout.id]: { effort: 'high' } } });
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const script = fake.submits().at(-1)!.script;
    expect(script).toContain(`-c 'rb-${org.spaceId.toLowerCase()}-${message.id.toLowerCase()}'`);
    expect(script).toContain("--reasoning 'high'");
    const prompt = fake.lastPrompt()!;
    expect(prompt).toContain('Earlier in this thread:\n[@Harsh](#member:harsh): it runs at nine');
    expect(prompt).not.toContain('watch the checkout job');
    const replies = (await org.thread(message.id)).filter((m) => m.author.memberId === scout.id).map((m) => m.body);
    expect(replies).toEqual(['Noted.', 'Will do.']);
  });

  it('takes Maritime’s "already running" for awake: a turn on an agent that is up runs at once', async () => {
    fake.agent.status = 'active';
    fake.nextTurn = hermesTurn('Still here.');
    const { message, invocations } = await org.post(`${mention(scout)} still there?`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).find((m) => m.author.memberId === scout.id)!.body).toBe('Still here.');
  });

  it('waits out the plan’s awake limit, saying so', async () => {
    const reports = vi.spyOn(org.harbor.service, 'updateInvocation');
    fake.awakeLimit = 2;
    fake.nextTurn = hermesTurn('Awake now.');
    const { invocations } = await org.post(`${mention(scout)} are you there`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.awakeLimit).toBe(0);
    expect(reports.mock.calls.map(([, , u]) => ('activity' in u ? u.activity : undefined))).toContain('Waiting for a free machine on Maritime');
    reports.mockRestore();
  });

  it('stops a running turn when asked, cancelling the execution', async () => {
    fake.nextTurn = { lines: [JSON.stringify({ type: 'system', session_id: 'local-long' })], hold: true };
    const { message, invocations } = await org.post(`${mention(scout)} take your time`);
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working on Maritime', 'the connector to follow');
    expect(await org.reactions(message.id)).toEqual([expect.objectContaining({ emoji: '👀', memberIds: [scout.id] })]);
    expect((await org.as('dev-harsh').post(`/v1/invocations/${invocations[0]!.id}/cancel`, {})).status).toBe(200);
    expect((await org.ended(invocations[0]!.id)).state).toBe('cancelled');
    await vi.waitFor(async () => expect(await org.reactions(message.id)).toEqual([]));
    const execution = fake.submits().at(-1)!;
    expect(execution.status).toBe('cancelled');
    expect(fake.received.some((r) => r.method === 'DELETE' && r.path === `/api/agents/${AGENT_ID}/exec/${execution.executionId}`)).toBe(true);
  });

  it('fails with the runtime’s error when the turn exits badly', async () => {
    fake.nextTurn = { lines: [JSON.stringify({ type: 'result', session_id: 'local-x', exit_code: 1, text: '', error: 'No API key configured for openai' })], exitCode: 1 };
    const { message, invocations } = await org.post(`${mention(scout)} break please`);
    expect(await org.ended(invocations[0]!.id)).toMatchObject({ state: 'failed', error: 'No API key configured for openai' });
    await vi.waitFor(async () => expect(await org.reactions(message.id)).toEqual([expect.objectContaining({ emoji: '⚠️', memberIds: [scout.id] })]));
  });

  it('starts an agent Maritime says is in an error state, once, then runs the turn', async () => {
    fake.agent.status = 'error';
    fake.nextTurn = hermesTurn('Recovered.');
    const { invocations } = await org.post(`${mention(scout)} still there?`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.agent.status).toBe('active');
  });

  it('when Maritime rejects the key, fails fast and tells the owner once', async () => {
    fake.refuse = { status: 401, body: { detail: 'Invalid or expired API key' } };
    const a = await org.post(`${mention(scout)} first try`);
    expect(await org.ended(a.invocations[0]!.id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/Maritime rejected this agent's API key/) });
    const b = await org.post(`${mention(scout)} second try`);
    expect((await org.ended(b.invocations[0]!.id)).state).toBe('failed');
    fake.refuse = undefined;
    await vi.waitFor(async () => {
      expect(await org.reactions(a.message.id)).toEqual([expect.objectContaining({ emoji: '⚠️', memberIds: [scout.id] })]);
      expect(await org.reactions(b.message.id)).toEqual([expect.objectContaining({ emoji: '⚠️', memberIds: [scout.id] })]);
    });
    const dm = (await org.as('dev-ramnique').post('/v1/direct', { memberId: scout.id })).body.space.id;
    const stream = (await org.as('dev-ramnique').get(`/v1/spaces/${dm}/stream`)).body.messages as Message[];
    expect(stream.filter((m) => m.author.memberId === scout.id && /Maritime rejected/.test(m.body))).toHaveLength(1);
  });
});

describe('the Maritime connector with the coding agents', () => {
  let org: Org;

  beforeAll(async () => {
    org = await new Org(await freshStore()).start();
    await org.space();
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('runs Codex with the Spaces MCP server, shows what it runs, resumes its thread, and reads the answer from -o', async () => {
    fake.agent = { ...fake.agent, framework: 'custom', templateId: 'codex', status: 'sleeping' };
    const codex = await org.agent('Codex', 'codex');
    const reports = vi.spyOn(org.harbor.service, 'updateInvocation');
    // Models come from the harness (2026-11-01): Effort only before a turn; separate maintenance reads Codex's own catalog.
    await vi.waitFor(async () => expect((await org.harbor.service.getAgentCapabilities(codex.id)).options.map((o) => o.key)).toEqual(['effort']));
    fake.files.set(
      '/data/rowboat/models.json',
      JSON.stringify({
        fetched_at: 1,
        models: [
          { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list', priority: 4 },
          { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', priority: 1 },
          { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 2 },
        ],
      }),
    );
    fake.nextTurn = codexTurn('Tests pass.', { thread: '01a1-thread' });
    const { message, invocations } = await org.post(`${mention(codex)} run the tests`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const first = fake.submits().at(-1)!.script;
    expect(first).toContain('codex exec  --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox');
    expect(first).toContain(`-c 'mcp_servers.rowboat.url="http://localhost:`);
    expect(first).toContain(`-c 'mcp_servers.rowboat.bearer_token_env_var="ROWBOAT_AGENT_KEY"'`);
    expect(first).toContain('export CODEX_HOME=/data/.codex');
    expect(first).not.toContain('models_cache.json');
    // The refreshed catalog becomes the composer's Model option: listed models by priority, hidden ones out.
    await vi.waitFor(async () =>
      expect((await org.harbor.service.getAgentCapabilities(codex.id)).options).toEqual([
        { type: 'select', key: 'model', label: 'Model', choices: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }, { id: 'gpt-6-sol', label: 'GPT-6-Sol' }] },
        { type: 'select', key: 'effort', label: 'Effort', choices: [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }] },
      ]),
    );
    expect(fake.catalogs().at(-1)!.script).toContain('cp "$CODEX_HOME/models_cache.json" /data/rowboat/models.json');
    expect(fake.submits().at(-1)!.files.prompt).toBe(`/data/rowboat/${invocations[0]!.id}.prompt`);
    expect((await org.thread(message.id)).find((m) => m.author.memberId === codex.id)!.body).toBe('Tests pass.');
    await vi.waitFor(async () => expect(await org.reactions(message.id)).toEqual([]));
    expect(reports.mock.calls.map(([, , u]) => ('activity' in u ? u.activity : undefined))).toContain('is running `npm test`');
    reports.mockRestore();

    fake.nextTurn = codexTurn('Fixed.', { thread: '01a1-thread' });
    const { invocations: second } = await org.post(`${mention(codex)} now fix the flaky one`, { threadRoot: message.id, agentOptions: { [codex.id]: { model: 'gpt-5.5', effort: 'high' } } });
    expect((await org.ended(second[0]!.id)).state).toBe('done');
    const script = fake.submits().at(-1)!.script;
    expect(script).toContain("codex exec resume '01a1-thread'");
    expect(script).toContain("-m 'gpt-5.5'");
    expect(script).toContain(`-c 'model_reasoning_effort="high"'`);
  });

  it('runs Claude Code with its MCP config file and resumes its session', async () => {
    fake.agent = { ...fake.agent, framework: 'custom', templateId: 'claude_code', status: 'sleeping' };
    const claude = await org.agent('Claude', 'claude-code');
    fake.nextTurn = claudeTurn('Here is the diff.', { session: 'ses-1' });
    const { message, invocations } = await org.post(`${mention(claude)} refactor the parser`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const first = fake.submits().at(-1)!.script;
    expect(first).toContain('--output-format stream-json --verbose --dangerously-skip-permissions --mcp-config /data/rowboat/mcp.json');
    expect(first).toContain('export IS_SANDBOX=1 CLAUDE_CONFIG_DIR=/data/.claude');
    expect(first).toContain('"url":"http://localhost:');
    expect((await org.thread(message.id)).find((m) => m.author.memberId === claude.id)!.body).toBe('Here is the diff.');

    fake.nextTurn = claudeTurn('Done.', { session: 'ses-1' });
    const { invocations: second } = await org.post(`${mention(claude)} and the tests`, { threadRoot: message.id });
    expect((await org.ended(second[0]!.id)).state).toBe('done');
    expect(fake.submits().at(-1)!.script).toContain("--resume 'ses-1'");
  });
});

describe('the Maritime connector after a restart', () => {
  it('finishes a turn that ended while Harbor was down, without submitting anything again', async () => {
    fake.agent = { ...fake.agent, framework: 'hermes', templateId: 'hermes', status: 'active' };
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const scout = await org.agent('Scout', 'hermes');
    fake.nextTurn = { lines: [], hold: true };
    const { message, invocations } = await org.post(`${mention(scout)} long job`);
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working on Maritime', 'the connector to follow');
    expect(await org.reactions(message.id)).toEqual([expect.objectContaining({ emoji: '👀', memberIds: [scout.id] })]);
    await org.harbor.close();
    expect(await store.store.listReactionsByMessage(spaceId, message.id)).toEqual([expect.objectContaining({ emoji: '👀', by: expect.objectContaining({ memberId: scout.id }) })]);

    const execution = fake.submits().at(-1)!;
    await fake.play(execution, hermesTurn('Done while you were away.'));
    const submits = fake.submits().length;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).filter((m) => m.author.memberId === scout.id).map((m) => m.body)).toEqual(['Done while you were away.']);
    expect(fake.submits()).toHaveLength(submits);
    await vi.waitFor(async () => expect(await org.reactions(message.id)).toEqual([]));
    await org.harbor.close();
    await store.db.close();
  });

  it('reads the files when Maritime has forgotten the execution', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const scout = await org.agent('Scout', 'hermes');
    fake.nextTurn = { lines: [], hold: true };
    const { message, invocations } = await org.post(`${mention(scout)} another long job`);
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working on Maritime', 'the connector to follow');
    expect(await org.reactions(message.id)).toEqual([expect.objectContaining({ emoji: '👀', memberIds: [scout.id] })]);
    await org.harbor.close();
    expect(await store.store.listReactionsByMessage(spaceId, message.id)).toEqual([expect.objectContaining({ emoji: '👀', by: expect.objectContaining({ memberId: scout.id }) })]);

    const execution = fake.submits().at(-1)!;
    await fake.play(execution, hermesTurn('Finished, then forgotten.'));
    fake.forgotten.add(execution.executionId);
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).filter((m) => m.author.memberId === scout.id).map((m) => m.body)).toEqual(['Finished, then forgotten.']);
    await vi.waitFor(async () => expect(await org.reactions(message.id)).toEqual([]));
    await org.harbor.close();
    await store.db.close();
  });
});
