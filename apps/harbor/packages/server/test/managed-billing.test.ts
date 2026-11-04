import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type AgentListing, type Invocation, type Member } from '@rowboat/spaces-protocol';
import { httpBilling, type BillingAccounts, type RegisterAgentInput } from '../src/billing.js';
import { MemoryBlobStore } from '../src/blobs.js';
import { maritimePlatform } from '../src/connectors/maritime/index.js';
import { maritimeProvisioner, PROXY_TOKEN_DUD } from '../src/connectors/maritime/provisioning.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { NEEDS_OWN_LLM_MESSAGE } from '../src/core/hosting.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { codexTurn, FakeMaritime, GOOD_KEY, hermesTurn } from './fake-maritime.js';
import { freshStore, restClient } from './helpers.js';

// Billing for managed agents (2026-11-04, "billing" in Main), end to end: a
// Harbor that bills, against the stand-in Maritime and a stand-in for
// rowboatx-backend's internal billing routes. The owner's Rowboat account is
// their subject at the issuer; the free plan has one agent; a Hermes runs on
// the gateway with a key minted for its owner; the machine is reported at
// the platform's cost; an owner without credits gets the agent's sentence.

const ISSUER = 'https://auth.rowboat.test/auth/v1';
const RAMNIQUE = '11111111-1111-4111-8111-111111111111';
const HARSH = '22222222-2222-4222-8222-222222222222';
const UPGRADE = 'https://app.rowboat.test?intent=upgrade';

/** rowboatx-backend as Harbor sees it: accounts with a plan limit and credits, and what Harbor reported. */
class FakeBilling implements BillingAccounts {
  readonly gatewayUrl = 'https://api.rowboat.test/v1/llm';
  readonly limits = new Map<string, number>();
  readonly registered = new Map<string, Map<string, RegisterAgentInput>>();
  readonly keys = new Map<string, { customer: string; key: string; revoked: boolean }>();
  readonly reports: Array<{ customer: string; ref: string; periodStart: string; totalCents: number }> = [];
  readonly outOfCredits = new Set<string>();
  readonly unregistered: string[] = [];
  readonly plans = new Map<string, string>();
  private minted = 0;

  async upgradeUrl() {
    return UPGRADE;
  }
  async registerAgent(customer: string, input: RegisterAgentInput) {
    const mine = this.registered.get(customer) ?? new Map<string, RegisterAgentInput>();
    const limit = this.limits.get(customer);
    if (!mine.has(input.ref) && limit !== undefined && mine.size >= limit) return { ok: false as const, limit };
    mine.set(input.ref, input);
    this.registered.set(customer, mine);
    return { ok: true as const };
  }
  async unregisterAgent(customer: string, ref: string) {
    this.registered.get(customer)?.delete(ref);
    this.unregistered.push(ref);
  }
  async mintGatewayKey(customer: string, input: { ref: string; name: string }) {
    for (const k of this.keys.values()) if (k.customer === customer && this.keys.get(input.ref) === k) k.revoked = true;
    const key = `rbg_test_${++this.minted}`;
    this.keys.set(input.ref, { customer, key, revoked: false });
    return { key, hint: key.slice(-4) };
  }
  async revokeGatewayKey(_customer: string, ref: string) {
    const k = this.keys.get(ref);
    if (k) k.revoked = true;
  }
  async authorize(customer: string) {
    return this.outOfCredits.has(customer) ? { ok: false as const, error: 'Not enough credits' } : { ok: true as const };
  }
  async reportHosting(customer: string, input: { ref: string; periodStart: string; totalCents: number }) {
    this.reports.push({ customer, ...input });
  }
  async planOf(customer: string) {
    return this.plans.get(customer) ?? 'free';
  }
  accountFor(identities: Array<{ iss: string; sub: string }>) {
    return identities.find((i) => i.iss === ISSUER)?.sub;
  }
}

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

describe('managed agents on a deployment that bills', () => {
  let harbor: RunningHarbor;
  let billing: FakeBilling;
  let spaceId = '';
  const as = (token: string) => restClient(harbor, token);
  const listing = async (agentId: string) => ((await as('dev-ramnique').get('/v1/agents')).body.agents as AgentListing[]).find((l) => l.agent.id === agentId);
  const ready = (agentId: string) => until(async () => ((await listing(agentId))?.hosting?.status === 'ready' ? true : undefined), `${agentId} to be ready`);
  const ended = (id: string) =>
    until(async () => {
      const i = ((await as('dev-ramnique').get(`/v1/spaces/${spaceId}/invocations`)).body.invocations as Invocation[]).find((x) => x.id === id);
      return i && ['done', 'failed', 'cancelled'].includes(i.state) ? i : undefined;
    }, `invocation ${id} to end`);
  const post = async (body: string) => routes.postMessage.response.parse((await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct' })).body);
  const envOf = (agent: Member) => fake.env.get(agent.agentInstance!)!;
  const refOf = (agent: Member) => [...fake.endUsers].find(([, r]) => r.agentId === agent.agentInstance)![0];
  const create = (body: Record<string, unknown>, token = 'dev-ramnique') => as(token).post('/v1/agents/managed', body);

  beforeAll(async () => {
    billing = new FakeBilling();
    billing.limits.set(HARSH, 1);
    const store = await freshStore();
    harbor = await startHarbor({
      store: store.store,
      orgName: 'Rowboat Labs',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'harsh', displayName: 'Harsh' },
        { id: 'nobody', displayName: 'Nobody' },
      ],
      blobs: new MemoryBlobStore(),
      // The trial's cap is set to show it is not applied: a billed agent has none.
      hosting: { provider: maritimeProvisioner({ apiKey: GOOD_KEY, base: fake.url, llmCapCents: 500 }), tickMs: 50, billing, settleEveryMs: 100 },
    });
    await store.store.putIdentity(ISSUER, RAMNIQUE, 'ramnique');
    await store.store.putIdentity(ISSUER, HARSH, 'harsh');
    spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
    await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
  });
  afterAll(async () => {
    await harbor.close();
  });

  it('says what it creates bills to its creator, and where to upgrade', async () => {
    expect((await as('dev-harsh').get('/v1/agents/managed')).body).toEqual({ kinds: ['hermes', 'claude-code', 'codex'], billed: true, upgradeUrl: UPGRADE });
  });

  it('refuses an owner with no Rowboat account, and creates nothing', async () => {
    const before = fake.created.size;
    const r = await create({ displayName: 'Orphan', kind: 'hermes' }, 'dev-nobody');
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/Rowboat account/) } });
    expect(fake.created.size).toBe(before);
  });

  let hermes: Member;
  it('creates a Hermes on its owner’s credits: registered under them, no trial and no cap, and on the gateway before it is ready', async () => {
    const r = await create({ displayName: 'Scout', kind: 'hermes' });
    expect(r.status).toBe(200);
    hermes = r.body.agent;
    expect(r.body.hosting).toMatchObject({ funding: 'credits', billed: true });
    expect(r.body.hosting.trial).toBeUndefined();
    const ref = refOf(hermes);
    expect(billing.registered.get(RAMNIQUE)?.get(ref)).toEqual({ ref, kind: 'hermes', name: 'Scout' });
    expect(fake.endUsers.get(ref)?.policy).toBeUndefined();

    await ready(hermes.id);
    const env = envOf(hermes);
    const key = billing.keys.get(ref)!;
    expect(key).toMatchObject({ customer: RAMNIQUE, revoked: false });
    expect(env.get('OPENROUTER_API_KEY')).toEqual({ value: key.key, isSecret: true });
    expect(env.get('OPENAI_API_KEY')?.value).toBe(PROXY_TOKEN_DUD);
    expect(env.get('ROWBOAT_LLM_PROVIDER')?.value).toBe('rowboat');
    expect(env.get('ROWBOAT_LLM_BASE_URL')?.value).toBe(billing.gatewayUrl);
    expect(env.get('ROWBOAT_LLM_MODEL')?.value).toBe('Auto');
  });

  it('runs a turn with credits, the turn script taking the gateway as Hermes’s OpenRouter', async () => {
    await harbor.service.addMembers({ memberId: 'ramnique' }, spaceId, { memberIds: [hermes.id], actingMode: 'direct' });
    fake.nextTurn = hermesTurn('On credits.');
    const { invocations } = await post(`${mention(hermes)} hi`);
    expect((await ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.submits().at(-1)!.script).toContain('rowboat) HP=openrouter; LB="$ROWBOAT_LLM_BASE_URL"');
  });

  it('answers with the agent’s sentence, without waking the VM, when the owner has no credits', async () => {
    billing.outOfCredits.add(RAMNIQUE);
    const starts = fake.starts().length + fake.received.filter((x) => x.path === `/api/agents/${hermes.agentInstance}/start`).length;
    const { invocations } = await post(`${mention(hermes)} again`);
    const done = await ended(invocations[0]!.id);
    expect(done.state).toBe('failed');
    expect(done.error).toContain("My owner's Rowboat plan is out of credits");
    expect(done.error).toContain(UPGRADE);
    expect(fake.starts().length + fake.received.filter((x) => x.path === `/api/agents/${hermes.agentInstance}/start`).length).toBe(starts);
    billing.outOfCredits.delete(RAMNIQUE);
  });

  it('says the gateway’s refusal mid-turn the same way', async () => {
    fake.nextTurn = hermesTurn('', { exitCode: 1, stderr: 'Error code: 403 - {"error":"Not enough credits"}\n' });
    const { invocations } = await post(`${mention(hermes)} once more`);
    const done = await ended(invocations[0]!.id);
    expect(done.state).toBe('failed');
    expect(done.error).toContain("My owner's Rowboat plan is out of credits");
  });

  it('reports the machine at the platform’s cost for the month, model spend included', async () => {
    const ref = refOf(hermes);
    fake.usage.set(ref, { hosting: 3, llm: 0.25 });
    const report = await until(async () => billing.reports.filter((x) => x.ref === ref && x.totalCents === 3.25).at(-1), 'a machine report');
    const now = new Date();
    expect(report).toMatchObject({ customer: RAMNIQUE, periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString() });
    expect(fake.usageReads.some((r) => r.externalUserId === ref)).toBe(true);
    const page = await as('dev-ramnique').get(`/v1/agents/${hermes.id}/hosting`);
    expect(page.body.usage).toMatchObject({ machineCents: 3, llmCents: 0.25 });
  });

  it('takes the agent off the gateway when its owner adds a key', async () => {
    const r = await as('dev-ramnique').put(`/v1/agents/${hermes.id}/hosting/llm`, { provider: 'openrouter', apiKey: 'sk-or-owner-key-1234' });
    expect(r.status).toBe(200);
    expect(r.body.hosting).toMatchObject({ funding: 'own', billed: true, llm: { provider: 'openrouter' } });
    expect(billing.keys.get(refOf(hermes))!.revoked).toBe(true);
    expect(envOf(hermes).get('OPENROUTER_API_KEY')?.value).toBe('sk-or-owner-key-1234');
  });

  it('refuses a second agent on the free plan, with where to upgrade, and creates nothing on the platform', async () => {
    const first = await create({ displayName: 'Helper', kind: 'hermes' }, 'dev-harsh');
    expect(first.status).toBe(200);
    const before = fake.created.size;
    const second = await create({ displayName: 'Another', kind: 'hermes' }, 'dev-harsh');
    expect(second).toMatchObject({ status: 400, body: { message: expect.stringContaining(`Your Rowboat plan includes 1 agent Rowboat runs. Upgrade at ${UPGRADE}`) } });
    expect(fake.created.size).toBe(before);
    expect(billing.registered.get(HARSH)?.size).toBe(1);
  });

  let codex: Member;
  it('creates a Codex its owner funds: no platform credit from the start, and a sentence until they sign in', async () => {
    const r = await create({ displayName: 'Coder', kind: 'codex' });
    expect(r.status).toBe(200);
    codex = r.body.agent;
    expect(r.body.hosting).toMatchObject({ funding: 'own', billed: true });
    expect(r.body.hosting.llm).toBeUndefined();
    await ready(codex.id);
    expect(envOf(codex).get('OPENAI_API_KEY')?.value).toBe(PROXY_TOKEN_DUD);
    expect(billing.keys.has(refOf(codex))).toBe(false);

    await harbor.service.addMembers({ memberId: 'ramnique' }, spaceId, { memberIds: [codex.id], actingMode: 'direct' });
    fake.nextTurn = codexTurn('', { exitCode: 1, stderr: 'rowboat-sign-in: none\nError: unauthorized\n' });
    const { invocations } = await post(`${mention(codex)} fix it`);
    const done = await ended(invocations[0]!.id);
    expect(done).toMatchObject({ state: 'failed', error: NEEDS_OWN_LLM_MESSAGE });
  });

  it('reads the machine size from the platform: its range, its rate, and the free plan kept to the smallest (2026-11-04)', async () => {
    const free = (await as('dev-harsh').get('/v1/agents')).body.agents.find((l: AgentListing) => l.agent.displayName === 'Helper').agent as Member;
    await until(async () => (((await as('dev-harsh').get('/v1/agents')).body.agents as AgentListing[]).find((l) => l.agent.id === free.id)?.hosting?.status === 'ready' ? true : undefined), 'Helper to be ready');
    const r = await as('dev-harsh').get(`/v1/agents/${free.id}/hosting/size`);
    expect(r.status).toBe(200);
    // 512 MB to 8 GB, in Maritime's 2 GB blocks, each block at the agent box's list rate for a 730-hour month.
    expect(r.body.size).toMatchObject({ memMb: 2048, diskGb: 5, vcpus: 1, maxDiskGb: 100, resizable: false, upgradeUrl: UPGRADE });
    expect(r.body.size.memOptions).toEqual([
      { memMb: 2048, centsPerMonth: 100 },
      { memMb: 4096, centsPerMonth: 200 },
      { memMb: 6144, centsPerMonth: 300 },
      { memMb: 8192, centsPerMonth: 400 },
    ]);
    expect(r.body.size).toMatchObject({ idleSeconds: 300, maxAwakeMachines: 5 });
    expect(r.body.size.idleOptions).toContain(300);
    const refused = await as('dev-harsh').put(`/v1/agents/${free.id}/hosting/size`, { memMb: 4096, diskGb: 5 });
    expect(refused).toMatchObject({ status: 400, body: { message: expect.stringMatching(/free plan/) } });
    expect(fake.resizes).toHaveLength(0);

    // A new limit and a new rate from Maritime change the options with no change here.
    fake.limits = { ...fake.limits, maxMemMb: 4096 };
    fake.agentBoxCentsPerHour = 0.2;
    const after = await as('dev-harsh').get(`/v1/agents/${free.id}/hosting/size`);
    expect(after.body.size.memOptions).toEqual([{ memMb: 2048, centsPerMonth: 146 }, { memMb: 4096, centsPerMonth: 292 }]);
    fake.limits = { ...fake.limits, maxMemMb: 8192 };
    fake.agentBoxCentsPerHour = 0.136986301369863;
  });

  it('resizes a paid owner’s agent within the platform’s range, and restarts it to apply', async () => {
    billing.plans.set(RAMNIQUE, 'pro_1');
    const powerBefore = fake.power.filter((p) => p.agentId === codex.agentInstance && p.action === 'restart').length;
    const r = await as('dev-ramnique').put(`/v1/agents/${codex.id}/hosting/size`, { memMb: 4096, diskGb: 20 });
    expect(r.status).toBe(200);
    expect(r.body.size).toMatchObject({ memMb: 4096, diskGb: 20, resizable: true });
    expect(fake.resizes.at(-1)).toEqual({ agentId: codex.agentInstance, body: { mem_mb: 4096, disk_gb: 20 } });
    expect(fake.power.filter((p) => p.agentId === codex.agentInstance && p.action === 'restart').length).toBe(powerBefore + 1);
    expect(await as('dev-ramnique').put(`/v1/agents/${codex.id}/hosting/size`, { memMb: 3000, diskGb: 20 })).toMatchObject({ status: 400, body: { message: expect.stringMatching(/memory must be one of/) } });
    expect(await as('dev-ramnique').put(`/v1/agents/${codex.id}/hosting/size`, { memMb: 4096, diskGb: 500 })).toMatchObject({ status: 400, body: { message: expect.stringMatching(/at most 100 GB/) } });
    // Staying awake longer is the end user's policy, at once and with no restart; what else the policy held is kept.
    const ref = [...fake.endUsers].find(([, rec]) => rec.agentId === codex.agentInstance)![0];
    fake.endUsers.set(ref, { ...fake.endUsers.get(ref)!, policy: { wakes_per_hour: 60 } });
    const restarts = fake.power.filter((p) => p.agentId === codex.agentInstance && p.action === 'restart').length;
    const awake = await as('dev-ramnique').put(`/v1/agents/${codex.id}/hosting/size`, { idleSeconds: 3600 });
    expect(awake.status).toBe(200);
    expect(awake.body.size).toMatchObject({ idleSeconds: 3600, memMb: 4096 });
    expect(fake.endUsers.get(ref)!.policy).toEqual({ wakes_per_hour: 60, idle_sleep_seconds: 3600 });
    expect(fake.power.filter((p) => p.agentId === codex.agentInstance && p.action === 'restart').length).toBe(restarts);
    expect(await as('dev-ramnique').put(`/v1/agents/${codex.id}/hosting/size`, { idleSeconds: 7 })).toMatchObject({ status: 400, body: { message: expect.stringMatching(/stay awake for one of/) } });
    // Someone who neither owns it nor administers the org may read nothing of it.
    expect((await as('dev-harsh').put(`/v1/agents/${codex.id}/hosting/size`, { memMb: 2048, diskGb: 20 })).status).toBe(403);
  });

  it('on delete, revokes the gateway key, reports the last cost, leaves the platform and the plan', async () => {
    const ref = refOf(hermes);
    const reads = fake.usageReads.length;
    expect((await as('dev-ramnique').delete(`/v1/agents/${hermes.id}/hosting`)).status).toBe(200);
    await until(async () => ((await listing(hermes.id))?.hosting?.status === 'deleted' ? true : undefined), 'deleted');
    expect(billing.keys.get(ref)!.revoked).toBe(true);
    expect(billing.unregistered).toContain(ref);
    expect(billing.registered.get(RAMNIQUE)?.has(ref)).toBe(false);
    expect(fake.endUsers.has(ref)).toBe(false);
    expect(fake.usageReads.slice(reads).some((r) => r.externalUserId === ref)).toBe(true);
  });
});

describe('the HTTP billing client', () => {
  let server: Server;
  let base = '';
  const seen: Array<{ method: string; url: string; auth: string | undefined; body: unknown }> = [];
  let answer: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body: text ? JSON.parse(text) : undefined });
        const a = answer(req.url ?? '');
        res.writeHead(a.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(a.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('speaks the backend’s internal routes on the operator’s key', async () => {
    const client = httpBilling({ url: `${base}/`, key: 'internal-key', issuer: ISSUER });
    expect(client.gatewayUrl).toBe(`${base}/v1/llm`);

    answer = () => ({ status: 200, body: { registered: true, count: 1, limit: 1 } });
    expect(await client.registerAgent(RAMNIQUE, { ref: 'rowboat-x', kind: 'hermes', name: 'Scout' })).toEqual({ ok: true });
    expect(seen.at(-1)).toEqual({ method: 'POST', url: `/internal/billing/customers/${RAMNIQUE}/managed-agents`, auth: 'Bearer internal-key', body: { ref: 'rowboat-x', kind: 'hermes', name: 'Scout' } });

    answer = () => ({ status: 403, body: { error: 'Managed agent limit reached', limit: 1 } });
    expect(await client.registerAgent(RAMNIQUE, { ref: 'rowboat-y', kind: 'hermes', name: 'Two' })).toEqual({ ok: false, limit: 1 });

    answer = () => ({ status: 200, body: { id: 'k1', key: 'rbg_secret', hint: 'cret' } });
    expect(await client.mintGatewayKey(RAMNIQUE, { ref: 'rowboat-x', name: 'Scout' })).toEqual({ key: 'rbg_secret', hint: 'cret' });
    expect(seen.at(-1)!.url).toBe(`/internal/billing/customers/${RAMNIQUE}/gateway-keys`);

    answer = () => ({ status: 200, body: { success: false, error: 'Not enough credits' } });
    expect(await client.authorize(RAMNIQUE)).toEqual({ ok: false, error: 'Not enough credits' });
    expect(seen.at(-1)).toMatchObject({ url: `/internal/billing/customers/${RAMNIQUE}/authorize`, body: { type: 'use_credits' } });

    answer = () => ({ status: 200, body: { debitedCredits: 0, settledCredits: 0 } });
    await client.reportHosting(RAMNIQUE, { ref: 'rowboat-x', periodStart: '2026-11-01T00:00:00.000Z', totalCents: 1.5 });
    expect(seen.at(-1)).toMatchObject({ url: `/internal/billing/customers/${RAMNIQUE}/hosting-usage`, body: { ref: 'rowboat-x', periodStart: '2026-11-01T00:00:00.000Z', totalCents: 1.5 } });
    await client.revokeGatewayKey(RAMNIQUE, 'rowboat-x');
    expect(seen.at(-1)!.url).toBe(`/internal/billing/customers/${RAMNIQUE}/gateway-keys/revoke`);
    await client.unregisterAgent(RAMNIQUE, 'rowboat-x');
    expect(seen.at(-1)!.url).toBe(`/internal/billing/customers/${RAMNIQUE}/managed-agents/unregister`);

    answer = () => ({ status: 500, body: { error: 'boom' } });
    await expect(client.revokeGatewayKey(RAMNIQUE, 'rowboat-x')).rejects.toThrow('boom');

    answer = (url) => (url === '/v1/config' ? { status: 200, body: { appUrl: 'https://app.rowboat.test/' } } : { status: 404, body: {} });
    expect(await client.upgradeUrl()).toBe('https://app.rowboat.test?intent=upgrade');
  });

  it('finds the Rowboat account among a member’s identities: a uuid subject at the issuer', () => {
    const client = httpBilling({ url: base, key: 'k', issuer: ISSUER });
    expect(client.accountFor([{ iss: 'https://other', sub: RAMNIQUE }, { iss: ISSUER, sub: 'not-a-uuid' }])).toBeUndefined();
    expect(client.accountFor([{ iss: ISSUER, sub: RAMNIQUE }])).toBe(RAMNIQUE);
    expect(httpBilling({ url: base, key: 'k' }).accountFor([{ iss: 'https://any', sub: HARSH }])).toBe(HARSH);
  });
});
