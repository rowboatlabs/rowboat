import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type AgentHosting, type AgentListing, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { maritimePlatform } from '../src/connectors/maritime/index.js';
import { HERMES_IMAGE, maritimeProvisioner } from '../src/connectors/maritime/provisioning.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { AGENT_ID, FakeMaritime, GOOD_KEY, hermesTurn } from './fake-maritime.js';
import { freshStore, restClient } from './helpers.js';

// Managed Maritime agents (spec §8 Maritime, 2026-10-26), end to end: a real
// Harbor with the deployment's own Maritime key, creating agents on the
// stand-in Maritime through its end-user routes, following them to ready
// with the hosting worker, running a turn on one, and deleting it.

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
  constructor(
    private readonly store: Awaited<ReturnType<typeof freshStore>>,
    private readonly hosting: boolean = true,
    /** How long a trial lasts on this Harbor; the default is thirty days. */
    private readonly trialMs?: number,
  ) {}

  async start(): Promise<this> {
    this.harbor = await startHarbor({
      store: this.store.store,
      orgName: 'Rowboat Labs',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'harsh', displayName: 'Harsh' },
      ],
      blobs: new MemoryBlobStore(),
      ...(this.hosting ? { hosting: { provider: maritimeProvisioner({ apiKey: GOOD_KEY, base: fake.url, llmCapCents: 500 }), tickMs: 50, ...(this.trialMs !== undefined ? { trialMs: this.trialMs } : {}) } } : {}),
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
  async listing(agentId: string, token = 'dev-ramnique'): Promise<AgentListing | undefined> {
    return ((await this.as(token).get('/v1/agents')).body.agents as AgentListing[]).find((l) => l.agent.id === agentId);
  }
  async hostingStatus(agentId: string, status: string): Promise<AgentListing> {
    return until(async () => {
      const l = await this.listing(agentId);
      return l?.hosting?.status === status ? l : undefined;
    }, `hosting of ${agentId} to be ${status}`);
  }
  async post(body: string, extra: Record<string, unknown> = {}, token = 'dev-harsh') {
    const r = await this.as(token).post(`/v1/spaces/${this.spaceId}/messages`, { body, actingMode: 'direct', ...extra });
    expect(r.status).toBe(200);
    return routes.postMessage.response.parse(r.body);
  }
  async ended(id: string): Promise<Invocation> {
    return until(async () => {
      const i = ((await this.as('dev-ramnique').get(`/v1/spaces/${this.spaceId}/invocations`)).body.invocations as Invocation[]).find((x) => x.id === id);
      return i && ['done', 'failed', 'cancelled'].includes(i.state) ? i : undefined;
    }, `invocation ${id} to end`);
  }
  async thread(rootId: string): Promise<Message[]> {
    return (await this.as('dev-harsh').get(`/v1/spaces/${this.spaceId}/threads/${rootId}`)).body.messages;
  }
}

const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'e'.repeat(64);
  fake = await new FakeMaritime().start();
  PLATFORMS.maritime = maritimePlatform(fake.url, { pollMs: 40 });
});

afterAll(async () => {
  await fake.close();
  PLATFORMS.maritime = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('managed Maritime agents', () => {
  let org: Org;

  beforeAll(async () => {
    org = await new Org(await freshStore()).start();
    await org.space();
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('offers the three kinds Rowboat creates', async () => {
    expect((await org.as('dev-harsh').get('/v1/agents/managed')).body).toEqual({ kinds: ['hermes', 'claude-code', 'codex'] });
  });

  it('refuses a kind Rowboat does not create, and Claude Code without an Anthropic key', async () => {
    const kind = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Nope', kind: 'openclaw' });
    expect(kind).toMatchObject({ status: 400, body: { message: expect.stringMatching(/not a kind of agent Rowboat can create/) } });
    const claude = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Claude', kind: 'claude-code' });
    expect(claude).toMatchObject({ status: 400, body: { message: expect.stringMatching(/Anthropic API key/) } });
  });

  it('creates a Hermes agent on Rowboat’s account: an end user with a cap, the pinned image with its PATH, the member with the platform id, and the first key', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Scout', kind: 'hermes' });
    expect(r.status).toBe(200);
    const { agent, key, hosting } = r.body as { agent: Member; key: { secret: string }; hosting: { status: string; externalId: string } };
    expect(agent).toMatchObject({ kind: 'agent', ownerId: 'ramnique', agentKind: 'hermes', agentConnection: 'maritime' });
    expect(agent.agentInstance).toMatch(/^agt-m\d+$/);
    expect(key.secret).toMatch(/^rbk_/);
    expect(hosting).toMatchObject({ status: 'deploying', externalId: agent.agentInstance });

    const creation = fake.lastCreation()!;
    expect(creation).toMatchObject({ framework: 'hermes', imageName: HERMES_IMAGE, useMaritimeLlm: true });
    expect(creation.name).toMatch(/^scout-[a-z0-9]{8}$/);
    const vars = creation.initialEnvVars as Array<{ key: string; value: string; isSecret: boolean }>;
    expect(vars.find((v) => v.key === 'PATH')).toMatchObject({ value: expect.stringMatching(/^\/opt\/hermes\/bin:/), isSecret: false });
    const created = fake.created.get(agent.agentInstance!)!;
    const endUser = fake.endUsers.get(created.endUser)!;
    expect(created.endUser).toMatch(/^rowboat-[0-9a-z]{26}$/);
    expect(endUser.body).toMatchObject({ displayName: 'Scout', tags: ['rowboat'] });
    expect(endUser.policy).toEqual({ llm_spend_cap_cents_per_month: 500 });

    const listed = await org.listing(agent.id);
    expect(listed?.hosting).toMatchObject({ status: 'deploying', createdBy: 'ramnique' });
    expect(listed?.credential?.hint).toBeDefined(); // the deployment's key, sealed for this agent
  });

  it('creates a personal agent when asked, as Add does; a channel one otherwise', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Ramnique’s Hermes', kind: 'hermes', personal: true });
    expect(r.status).toBe(200);
    expect(r.body.agent).toMatchObject({ ownerId: 'ramnique', personal: true });
    expect(await org.harbor.store.getMember(r.body.agent.id)).toMatchObject({ personal: true });
  });

  it('follows the deploy to ready and then runs a turn on it', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Scout Two', kind: 'hermes' });
    const agent = r.body.agent as Member;
    const ready = await org.hostingStatus(agent.id, 'ready');
    expect(ready.hosting?.error).toBeUndefined();
    expect(fake.received.some((x) => x.method === 'POST' && x.path === `/api/agents/${agent.agentInstance}/exec` && /rowboat-ready/.test(String((x.body?.command as string[])?.[2])))).toBe(true);

    await org.as('dev-ramnique').post(`/v1/spaces/${org.spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
    fake.nextTurn = hermesTurn('Hello from a managed VM.');
    const { message, invocations } = await org.post(`${mention(agent)} say hello`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect((await org.thread(message.id)).find((m) => m.author.memberId === agent.id)!.body).toBe('Hello from a managed VM.');
    expect(fake.submits().at(-1)!.script).toContain('hermes chat --query-file');
  });

  it('creates Codex from Maritime’s template, and Claude Code with the person’s Anthropic key in its environment', async () => {
    const codex = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Coder', kind: 'codex', env: [{ key: 'GH_TOKEN', value: 'ghp_x' }] });
    expect(codex.status).toBe(200);
    expect(fake.lastCreation()).toMatchObject({ templateId: 'codex', initialEnvVars: [{ key: 'GH_TOKEN', value: 'ghp_x', isSecret: true }] });

    const claude = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Claude', kind: 'claude-code', anthropicApiKey: 'sk-ant-test' });
    expect(claude.status).toBe(200);
    const creation = fake.lastCreation()!;
    expect(creation).toMatchObject({ templateId: 'claude_code' });
    expect(creation.initialEnvVars).toEqual([
      { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-test', isSecret: true },
      { key: 'IS_SANDBOX', value: '1', isSecret: false },
    ]);
  });

  it('answers with Maritime’s own sentence when it refuses, creating no member', async () => {
    fake.refuse = { status: 402, body: { detail: 'You are on the free plan, which includes 3 agents (you have 3). Upgrade to a paid plan to create more.' }, paths: /\/agents$/ };
    const before = ((await org.as('dev-ramnique').get('/v1/agents')).body.agents as AgentListing[]).length;
    const r = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Over', kind: 'hermes' });
    fake.refuse = undefined;
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/^Maritime: You are on the free plan/) } });
    expect(((await org.as('dev-ramnique').get('/v1/agents')).body.agents as AgentListing[]).length).toBe(before);
  });

  // The management area (2026-10-27): the owner or an admin manages the VM through Harbor, on the deployment's key.
  it('manages the VM: the page’s read, the environment with secrets withheld, power, and only the owner or an admin', async () => {
    const { agent } = (await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Ops', kind: 'hermes', env: [{ key: 'REPO', value: 'rowboat', secret: false }] })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    const me = org.as('dev-ramnique');

    const page = await me.get(`/v1/agents/${agent.id}/hosting`);
    expect(page.status).toBe(200);
    expect(page.body.hosting.status).toBe('ready');
    // The readiness check ran a command, which woke the VM: the page shows the platform's word as it is.
    expect(page.body.machine).toEqual({ status: 'active' });
    expect(page.body.env).toEqual([
      { key: 'PATH', secret: false, value: expect.stringMatching(/^\/opt\/hermes\/bin:/) },
      { key: 'REPO', secret: false, value: 'rowboat' },
    ]);

    // A secret is kept by the platform and never read back; a plain value is; a second put replaces.
    expect((await me.put(`/v1/agents/${agent.id}/hosting/env/GH_TOKEN`, { value: 'ghp_x', secret: true })).body.env).toContainEqual({ key: 'GH_TOKEN', secret: true });
    expect((await me.put(`/v1/agents/${agent.id}/hosting/env/REPO`, { value: 'spaces' })).body.env).toContainEqual({ key: 'REPO', secret: false, value: 'spaces' });
    expect((await me.put(`/v1/agents/${agent.id}/hosting/env/bad-key`, { value: 'x' })).status).toBe(400);
    const afterDelete = await me.delete(`/v1/agents/${agent.id}/hosting/env/REPO`);
    expect(afterDelete.body.env.map((v: { key: string }) => v.key)).toEqual(['PATH', 'GH_TOKEN']);

    // Power: the platform's word for the machine comes back each time.
    expect((await me.post(`/v1/agents/${agent.id}/hosting/power`, { action: 'sleep' })).body.machine.status).toBe('sleeping');
    expect((await me.post(`/v1/agents/${agent.id}/hosting/power`, { action: 'wake' })).body.machine.status).toBe('active');
    expect((await me.post(`/v1/agents/${agent.id}/hosting/power`, { action: 'restart' })).body.machine.status).toBe('active');
    expect((await me.post(`/v1/agents/${agent.id}/hosting/power`, { action: 'reload' })).status).toBe(200);
    expect(fake.power.filter((p) => p.agentId === agent.agentInstance).map((p) => p.action)).toEqual(['sleep', 'start', 'restart', 'reload-env']);

    // Harsh is a member, not the owner: nothing of this is his.
    expect((await org.as('dev-harsh').get(`/v1/agents/${agent.id}/hosting`)).status).toBe(403);
    expect((await org.as('dev-harsh').post(`/v1/agents/${agent.id}/hosting/power`, { action: 'sleep' })).status).toBe(403);
    // An agent on the person's own Maritime account is not one Rowboat hosts.
    const own = (await me.post('/v1/agents', { displayName: 'Own', kind: 'hermes', connection: 'maritime', credential: GOOD_KEY, instance: AGENT_ID })).body.agent as Member;
    expect((await me.get(`/v1/agents/${own.id}/hosting`)).status).toBe(404);
  });

  it('runs a command on the VM, reads it until it ends, and cancels one', async () => {
    const { agent } = (await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Shell', kind: 'codex' })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    const me = org.as('dev-ramnique');
    const run = await me.post(`/v1/agents/${agent.id}/hosting/commands`, { command: 'echo hello' });
    expect(run.status).toBe(200);
    expect(run.body.execution.status).toBe('running');
    const done = await me.get(`/v1/agents/${agent.id}/hosting/commands/${run.body.execution.id}`);
    expect(done.body.execution).toMatchObject({ id: run.body.execution.id, status: 'completed', exitCode: 0, stdout: 'hello\n' });
    expect(fake.submits().at(-1)!.script).toBe('echo hello');
    const cancelled = await me.delete(`/v1/agents/${agent.id}/hosting/commands/${run.body.execution.id}`);
    expect(cancelled.body.execution.status).toBe('cancelled');
    expect((await me.get(`/v1/agents/${agent.id}/hosting/commands/nope`)).status).toBe(404);
  });

  it('reads the VM’s logs, newest first, paged by the platform’s cursor', async () => {
    const { agent } = (await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Logger', kind: 'hermes' })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    const me = org.as('dev-ramnique');
    const first = await me.get(`/v1/agents/${agent.id}/hosting/logs?limit=2`);
    expect(first.body.logs.map((l: { id: string }) => l.id)).toEqual(['log-5', 'log-4']);
    expect(first.body.logs[0]).toMatchObject({ level: 'warning', message: 'line 5', source: 'agent' });
    expect(first.body.nextBefore).toBe('log-4');
    const next = await me.get(`/v1/agents/${agent.id}/hosting/logs?limit=2&before=log-4`);
    expect(next.body.logs.map((l: { id: string }) => l.id)).toEqual(['log-3', 'log-2']);
  });

  it('browses the VM’s files: write, list, read, a new directory, move, delete', async () => {
    const { agent } = (await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Files', kind: 'hermes' })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    const me = org.as('dev-ramnique');
    expect((await me.put(`/v1/agents/${agent.id}/hosting/files/content`, { path: '/data/notes/a.txt', content: 'hi' })).body).toEqual({ ok: true });
    expect((await me.get(`/v1/agents/${agent.id}/hosting/files?path=/data/notes`)).body).toEqual({ path: '/data/notes', entries: [{ name: 'a.txt', path: '/data/notes/a.txt', kind: 'file', size: 2 }] });
    expect((await me.get(`/v1/agents/${agent.id}/hosting/files/content?path=/data/notes/a.txt`)).body).toEqual({ path: '/data/notes/a.txt', content: 'hi', truncated: false });
    await me.post(`/v1/agents/${agent.id}/hosting/files/mkdir`, { path: '/data/notes/sub' });
    await me.post(`/v1/agents/${agent.id}/hosting/files/move`, { from: '/data/notes/a.txt', to: '/data/notes/b.txt' });
    const listed = (await me.get(`/v1/agents/${agent.id}/hosting/files?path=/data/notes`)).body.entries as Array<{ name: string; kind: string }>;
    expect(listed.map((e) => `${e.kind}:${e.name}`).sort()).toEqual(['dir:sub', 'file:b.txt']);
    expect((await me.delete(`/v1/agents/${agent.id}/hosting/files?path=/data/notes/b.txt`)).body).toEqual({ ok: true });
    expect((await me.get(`/v1/agents/${agent.id}/hosting/files/content?path=/data/notes/b.txt`)).status).toBe(404);
  });

  it('skills on a Hermes agent: the VM’s, the catalog’s matches, install and remove; a coding agent has none', async () => {
    const { agent } = (await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Skilled', kind: 'hermes' })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    const me = org.as('dev-ramnique');
    expect((await me.get(`/v1/agents/${agent.id}/hosting/skills`)).body.skills).toEqual([{ name: 'rowboat-spaces', installed: true, version: '1.0.0', description: 'The rowboat-spaces skill' }]);
    expect((await me.get(`/v1/agents/${agent.id}/hosting/skills?q=git`)).body.skills).toEqual([{ name: 'github', installed: false, description: 'github from the catalog' }]);
    expect((await me.post(`/v1/agents/${agent.id}/hosting/skills`, { name: 'github' })).body.skills.map((s: { name: string }) => s.name)).toEqual(['rowboat-spaces', 'github']);
    expect((await me.delete(`/v1/agents/${agent.id}/hosting/skills/github`)).body.skills.map((s: { name: string }) => s.name)).toEqual(['rowboat-spaces']);
    const coder = (await me.post('/v1/agents/managed', { displayName: 'Coder Two', kind: 'codex' })).body.agent as Member;
    await org.hostingStatus(coder.id, 'ready');
    expect(await me.get(`/v1/agents/${coder.id}/hosting/skills`)).toMatchObject({ status: 400, body: { message: expect.stringMatching(/codex agents have none/) } });
  });

  it('triggers on a Hermes agent: a schedule with its prompt, switched off, deleted', async () => {
    const { agent } = (await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Timer', kind: 'hermes' })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    const me = org.as('dev-ramnique');
    const config = { schedule: '0 9 * * 1-5', prompt: 'Summarize #main and post it there.' };
    const made = await me.post(`/v1/agents/${agent.id}/hosting/triggers`, { type: 'cron', config });
    expect(made.body.triggers).toEqual([{ id: expect.stringMatching(/^trg-/), type: 'cron', enabled: true, config }]);
    const id = made.body.triggers[0].id;
    expect((await me.put(`/v1/agents/${agent.id}/hosting/triggers/${id}`, { enabled: false })).body.triggers[0].enabled).toBe(false);
    expect((await me.delete(`/v1/agents/${agent.id}/hosting/triggers/${id}`)).body.triggers).toEqual([]);
  });

  // Trial credit, then the owner's key (2026-10-27).
  it('starts Hermes on Rowboat’s trial credit and Claude Code on its owner’s key, and shows the trial’s spend', async () => {
    const me = org.as('dev-ramnique');
    const { agent } = (await me.post('/v1/agents/managed', { displayName: 'Trial', kind: 'hermes' })).body as { agent: Member };
    const ready = await org.hostingStatus(agent.id, 'ready');
    expect(ready.hosting?.funding).toBe('trial');
    const endsIn = Date.parse(ready.hosting!.trial!.endsAt) - Date.parse(ready.hosting!.createdAt);
    expect(endsIn).toBeGreaterThan(29 * 24 * 3600_000);
    expect(endsIn).toBeLessThan(31 * 24 * 3600_000);
    expect(ready.hosting?.llm).toBeUndefined();
    const page = await me.get(`/v1/agents/${agent.id}/hosting`);
    expect(page.body.spend).toEqual({ spentCents: 120, limitCents: 500, limitReached: false, periodEnd: '2026-11-01T00:00:00Z' });

    const claude = (await me.post('/v1/agents/managed', { displayName: 'Own', kind: 'claude-code', anthropicApiKey: 'sk-ant-api03-ownkey-abcd' })).body as { hosting: AgentHosting };
    expect(claude.hosting.funding).toBe('own');
    expect(claude.hosting.llm).toMatchObject({ provider: 'anthropic', keyHint: expect.stringMatching(/abcd$/), setBy: 'ramnique' });
    expect(claude.hosting.trial).toBeUndefined();
  });

  it('the owner’s key goes to the VM with what the runtime needs, the trial closes on the platform and in the record; the kind decides the providers', async () => {
    const me = org.as('dev-ramnique');
    const { agent } = (await me.post('/v1/agents/managed', { displayName: 'Keyed', kind: 'hermes' })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    expect((await me.put(`/v1/agents/${agent.id}/hosting/llm`, { provider: 'openai', apiKey: 'short' })).status).toBe(400);
    const set = await me.put(`/v1/agents/${agent.id}/hosting/llm`, { provider: 'anthropic', apiKey: 'sk-ant-api03-mine-wxyz', model: 'claude-sonnet-4-5' });
    expect(set.status).toBe(200);
    expect(set.body.hosting).toMatchObject({ funding: 'own', llm: { provider: 'anthropic', keyHint: expect.stringMatching(/wxyz$/), model: 'claude-sonnet-4-5', setBy: 'ramnique' }, trial: { closedReason: 'own_key' } });
    expect(set.body.hosting.trial.closedAt).toBeDefined();
    const vars = fake.env.get(agent.agentInstance!)!;
    expect(vars.get('ANTHROPIC_API_KEY')).toEqual({ value: 'sk-ant-api03-mine-wxyz', isSecret: true });
    expect(vars.get('ROWBOAT_LLM_PROVIDER')?.value).toBe('anthropic');
    expect(vars.get('ROWBOAT_LLM_MODEL')?.value).toBe('claude-sonnet-4-5');
    // The platform's proxy token is gone (a dud the proxy refuses, the key being Anthropic's), and the agent's own cap is
    // lifted: the platform puts a capped agent to sleep and gates its wakes, which must not hold an agent on its owner's key.
    expect(vars.get('OPENAI_API_KEY')).toEqual({ value: 'disabled-by-rowboat-owner-key', isSecret: true });
    expect(fake.spend.get(agent.agentInstance!)?.limit).toBeNull();
    expect(fake.power.filter((p) => p.agentId === agent.agentInstance).map((p) => p.action)).toContain('reload-env');
    // The page: on the owner's key there is no spend to show, and the key's value is never read back.
    const page = await me.get(`/v1/agents/${agent.id}/hosting`);
    expect(page.body.hosting.funding).toBe('own');
    expect(page.body.spend).toBeUndefined();
    expect(page.body.env).toContainEqual({ key: 'ANTHROPIC_API_KEY', secret: true });
    // A turn now carries the owner's provider into Hermes's config.
    await me.post(`/v1/spaces/${org.spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
    fake.nextTurn = hermesTurn('On my own key.');
    const { invocations } = await org.post(`${mention(agent)} hi`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.submits().at(-1)!.script).toContain('hermes config set model.provider "$ROWBOAT_LLM_PROVIDER"');

    // Codex takes OpenAI only, and gets OpenAI's address where the template had the platform's proxy.
    const codex = (await me.post('/v1/agents/managed', { displayName: 'Cx', kind: 'codex' })).body as { agent: Member };
    await org.hostingStatus(codex.agent.id, 'ready');
    expect((await me.put(`/v1/agents/${codex.agent.id}/hosting/llm`, { provider: 'anthropic', apiKey: 'sk-ant-api03-no-no-no' })).status).toBe(400);
    expect((await me.put(`/v1/agents/${codex.agent.id}/hosting/llm`, { provider: 'openai', apiKey: 'sk-proj-openai-key-1234' })).status).toBe(200);
    expect(fake.env.get(codex.agent.agentInstance!)!.get('OPENAI_BASE_URL')?.value).toBe('https://api.openai.com/v1');
    expect(fake.env.get(codex.agent.agentInstance!)!.get('OPENAI_API_KEY')).toEqual({ value: 'sk-proj-openai-key-1234', isSecret: true });
    // Harsh is a member, not the owner.
    expect((await org.as('dev-harsh').put(`/v1/agents/${agent.id}/hosting/llm`, { provider: 'openai', apiKey: 'sk-proj-harsh-key-0000' })).status).toBe(403);
  });

  it('a turn on a trial at its cap fails with the agent’s own word and closes the trial for good', async () => {
    const me = org.as('dev-ramnique');
    const { agent } = (await me.post('/v1/agents/managed', { displayName: 'Spent', kind: 'hermes' })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    await me.post(`/v1/spaces/${org.spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
    fake.spend.set(agent.agentInstance!, { limit: 500, spent: 512, reached: true });
    const execs = () => fake.received.filter((x) => x.method === 'POST' && x.path === `/api/agents/${agent.agentInstance}/exec`).length;
    const before = execs();
    const { invocations } = await org.post(`${mention(agent)} anything`);
    const ended = await org.ended(invocations[0]!.id);
    expect(ended.state).toBe('failed');
    expect(ended.error).toBe("I've used up my Rowboat trial credit. My owner needs to add an API key on my page for me to keep going.");
    expect(execs()).toBe(before); // nothing submitted
    expect((await org.listing(agent.id))?.hosting?.trial).toMatchObject({ closedReason: 'exhausted' });
    expect(fake.spend.get(agent.agentInstance!)?.limit).toBe(0);
    // Closed in the record: the next mention is answered without asking the platform.
    const asks = () => fake.received.filter((x) => x.method === 'GET' && x.path === `/api/agents/${agent.agentInstance}/llm-spend-limit`).length;
    const asked = asks();
    const again = await org.post(`${mention(agent)} again`);
    expect((await org.ended(again.invocations[0]!.id)).error).toMatch(/used up my Rowboat trial credit/);
    expect(asks()).toBe(asked);
    // The owner's key reopens nothing; the agent simply runs on it, with the cap that held it asleep lifted.
    expect((await me.put(`/v1/agents/${agent.id}/hosting/llm`, { provider: 'openai', apiKey: 'sk-proj-openai-key-5678' })).body.hosting).toMatchObject({ funding: 'own', trial: { closedReason: 'exhausted' } });
    expect(fake.spend.get(agent.agentInstance!)?.limit).toBeNull();
    fake.nextTurn = hermesTurn('Back.');
    const back = await org.post(`${mention(agent)} back?`);
    expect((await org.ended(back.invocations[0]!.id)).state).toBe('done');
  });

  it('deletes: keys go at once, the platform’s end user goes in the background, and only the owner or an admin may', async () => {
    const r = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Gone Soon', kind: 'hermes' });
    const { agent, key } = r.body as { agent: Member; key: { secret: string } };
    await org.hostingStatus(agent.id, 'ready');
    expect((await org.as(key.secret).get('/v1/me')).status).toBe(200);

    expect((await org.as('dev-harsh').delete(`/v1/agents/${agent.id}/hosting`)).status).toBe(403);
    const deleted = await org.as('dev-ramnique').delete(`/v1/agents/${agent.id}/hosting`);
    expect(deleted).toMatchObject({ status: 200, body: { hosting: { status: 'deleting' } } });
    expect((await org.as(key.secret).get('/v1/me')).status).toBe(401);
    await org.hostingStatus(agent.id, 'deleted');
    const endUser = fake.created.get(agent.agentInstance!)?.endUser;
    expect(endUser).toBeUndefined(); // gone from the platform
    expect(fake.received.some((x) => x.method === 'DELETE' && /^\/api\/v1\/end-users\/rowboat-/.test(x.path))).toBe(true);
    // Deleting again is a no-op.
    expect((await org.as('dev-ramnique').delete(`/v1/agents/${agent.id}/hosting`)).body.hosting.status).toBe('deleted');
  });

  it('is refused on a Harbor that runs no managed hosting', async () => {
    const bare = await new Org(await freshStore(), false).start();
    try {
      expect((await bare.as('dev-ramnique').get('/v1/agents/managed')).body).toEqual({ kinds: [] });
      const r = await bare.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Scout', kind: 'hermes' });
      expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/runs no managed hosting/) } });
    } finally {
      await bare.harbor.close();
    }
  });
});

describe('the hosting worker after a restart', () => {
  it('carries a deploying agent to ready', async () => {
    const store = await freshStore();
    let org = await new Org(store).start();
    const spaceId = await org.space();
    const r = await org.as('dev-ramnique').post('/v1/agents/managed', { displayName: 'Scout', kind: 'hermes' });
    const agent = r.body.agent as Member;
    await org.harbor.close();

    org = new Org(store);
    org.spaceId = spaceId;
    await org.start();
    await org.hostingStatus(agent.id, 'ready');
    await org.harbor.close();
    await store.db.close();
  });
});

describe('a trial that runs out of time', () => {
  let org: Org;
  beforeAll(async () => {
    org = await new Org(await freshStore(), true, 150).start();
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('is closed by the worker, with the platform’s cap for the agent set to nothing', async () => {
    const me = org.as('dev-ramnique');
    const { agent } = (await me.post('/v1/agents/managed', { displayName: 'Old', kind: 'hermes' })).body as { agent: Member };
    await org.hostingStatus(agent.id, 'ready');
    const closed = await until(async () => {
      const l = await org.listing(agent.id);
      return l?.hosting?.trial?.closedReason === 'expired' ? l : undefined;
    }, 'the trial to expire');
    expect(closed.hosting?.funding).toBe('trial');
    expect(fake.spend.get(agent.agentInstance!)?.limit).toBe(0);
  });
});
