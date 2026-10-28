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
    expect(execution.script).toContain(`hermes config set mcp_servers.rowboat.url '\${ROWBOAT_URL}/mcp'`);
    expect(execution.script).toContain('hermes config set ROWBOAT_URL "$ROWBOAT_URL"');
    expect(execution.script).toContain('hermes config set ROWBOAT_AGENT_KEY "$ROWBOAT_AGENT_KEY"');
    expect(execution.script).toContain('hermes skills install rowboatlabs/rowboat/skills/rowboat-spaces --yes');
    const key = execution.script.match(/ROWBOAT_AGENT_KEY='(rbk_[^']+)'/)![1]!;
    expect((await org.as(key).get('/v1/me')).status).toBe(200); // the VM acts as the agent

    const reply = (await org.thread(message.id)).find((m) => m.author.memberId === scout.id)!;
    expect(reply.body).toBe('The deploy is green.');
    const trigger = (await org.as('dev-harsh').get(`/v1/spaces/${org.spaceId}/threads/${message.id}`)).body.root as Message;
    expect(trigger.reactions).toEqual([expect.objectContaining({ emoji: '👀', memberIds: [scout.id] })]);
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
    const { invocations } = await org.post(`${mention(scout)} take your time`);
    await until(async () => (await org.invocation(invocations[0]!.id))?.activity === 'Working on Maritime', 'the connector to follow');
    expect((await org.as('dev-harsh').post(`/v1/invocations/${invocations[0]!.id}/cancel`, {})).status).toBe(200);
    expect((await org.ended(invocations[0]!.id)).state).toBe('cancelled');
    const execution = fake.submits().at(-1)!;
    expect(execution.status).toBe('cancelled');
    expect(fake.received.some((r) => r.method === 'DELETE' && r.path === `/api/agents/${AGENT_ID}/exec/${execution.executionId}`)).toBe(true);
  });

  it('fails with the runtime’s error when the turn exits badly', async () => {
    fake.nextTurn = { lines: [JSON.stringify({ type: 'result', session_id: 'local-x', exit_code: 1, text: '', error: 'No API key configured for openai' })], exitCode: 1 };
    const { invocations } = await org.post(`${mention(scout)} break please`);
    expect(await org.ended(invocations[0]!.id)).toMatchObject({ state: 'failed', error: 'No API key configured for openai' });
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
    fake.nextTurn = codexTurn('Tests pass.', { thread: '01a1-thread' });
    const { message, invocations } = await org.post(`${mention(codex)} run the tests`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    const first = fake.submits().at(-1)!.script;
    expect(first).toContain('codex exec  --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox');
    expect(first).toContain(`-c 'mcp_servers.rowboat.url="http://localhost:`);
    expect(first).toContain(`-c 'mcp_servers.rowboat.bearer_token_env_var="ROWBOAT_AGENT_KEY"'`);
    expect(first).toContain('export CODEX_HOME=/data/.codex');
    expect(fake.submits().at(-1)!.files.prompt).toBe(`/data/rowboat/${invocations[0]!.id}.prompt`);
    expect((await org.thread(message.id)).find((m) => m.author.memberId === codex.id)!.body).toBe('Tests pass.');
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
    await org.harbor.close();

    const execution = fake.submits().at(-1)!;
    await fake.play(execution, hermesTurn('Done while you were away.'));
    const submits = fake.submits().length;
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).filter((m) => m.author.memberId === scout.id).map((m) => m.body)).toEqual(['Done while you were away.']);
    expect(fake.submits()).toHaveLength(submits);
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
    await org.harbor.close();

    const execution = fake.submits().at(-1)!;
    await fake.play(execution, hermesTurn('Finished, then forgotten.'));
    fake.forgotten.add(execution.executionId);
    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).filter((m) => m.author.memberId === scout.id).map((m) => m.body)).toEqual(['Finished, then forgotten.']);
    await org.harbor.close();
    await store.db.close();
  });
});
