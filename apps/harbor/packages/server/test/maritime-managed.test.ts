import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type AgentListing, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { maritimePlatform } from '../src/connectors/maritime/index.js';
import { HERMES_IMAGE, maritimeProvisioner } from '../src/connectors/maritime/provisioning.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { FakeMaritime, GOOD_KEY, hermesTurn } from './fake-maritime.js';
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
      ...(this.hosting ? { hosting: { provider: maritimeProvisioner({ apiKey: GOOD_KEY, base: fake.url, llmCapCents: 500 }), tickMs: 50 } } : {}),
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
