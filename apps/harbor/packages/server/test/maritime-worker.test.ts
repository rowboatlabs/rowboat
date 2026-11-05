import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { routes, type Invocation, type Member } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { maritimePlatform } from '../src/connectors/maritime/index.js';
import { WORKER_BUNDLE_PATH, WORKER_SEED_PATH, WORKER_VERSION_PATH } from '../src/connectors/maritime/worker-host.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { AGENT_ID, FakeMaritime, GOOD_KEY } from './fake-maritime.js';
import { freshStore, restClient } from './helpers.js';

// The Maritime connector in worker mode (spec §8 Connectors, the agent
// worker, 2026-11-05), against the stand-in Maritime: for a kind the worker
// drives, a mention makes Harbor wake the box, put the worker on it and start
// it with one detached execution, and leave the turn to the worker; while a
// worker is connected on the agent's key, nothing starts; the exec-driven
// path stays for every other kind.

const BUNDLE = resolve(import.meta.dirname, 'fake-worker-bundle.js');
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
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      agentPresenceGraceMs: 50,
    });
    this.spaceId = (await this.as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
    await this.as('dev-ramnique').post(`/v1/spaces/${this.spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
    return this;
  }
  as(token: string) {
    return restClient(this.harbor, token);
  }
  async agent(name: string, kind: string): Promise<Member> {
    const created = await this.as('dev-ramnique').post('/v1/agents', { displayName: name, kind, connection: 'maritime', credential: GOOD_KEY, instance: AGENT_ID });
    expect(created.status).toBe(200);
    await this.as('dev-ramnique').post(`/v1/spaces/${this.spaceId}/members`, { memberIds: [created.body.agent.id], actingMode: 'direct' });
    return created.body.agent;
  }
  async post(body: string, extra: Record<string, unknown> = {}) {
    const r = await this.as('dev-harsh').post(`/v1/spaces/${this.spaceId}/messages`, { body, actingMode: 'direct', ...extra });
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
}

const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;
const workerStarts = () => [...fake.executions.values()].filter((e) => e.script.includes(WORKER_BUNDLE_PATH));
const bundleWrites = () => fake.received.filter((r) => r.method === 'PUT' && r.path.endsWith('/files/write') && r.body?.path === WORKER_BUNDLE_PATH).length;

/** The worker arrives: a live connection on the key the start script carries, as the worker itself would open. */
async function workerConnects(org: Org): Promise<WebSocket> {
  const key = workerStarts().at(-1)!.script.match(/ROWBOAT_AGENT_KEY='([^']+)'/)![1]!;
  const ws = new WebSocket(`ws://localhost:${org.harbor.port}/v1/live?token=${key}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'd'.repeat(64);
  fake = await new FakeMaritime().start();
  PLATFORMS.maritime = maritimePlatform(fake.url, { pollMs: 40 }, { kinds: ['codex'], bundlePath: BUNDLE, idleSeconds: 5, ttlSeconds: 123, debounceMs: 50 });
});

afterAll(async () => {
  await fake.close();
  PLATFORMS.maritime = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('the Maritime connector in worker mode', () => {
  let org: Org;
  let codex: Member;

  beforeAll(async () => {
    fake.agent = { ...fake.agent, framework: 'custom', templateId: 'codex', status: 'sleeping' };
    org = await new Org(await freshStore()).start();
    codex = await org.agent('Codex', 'codex');
  });
  afterAll(async () => {
    await org.harbor.close();
  });

  it('on a mention: wakes the box, puts the worker on it, starts it once, and leaves the turn to the worker', async () => {
    const { invocations } = await org.post(`${mention(codex)} run the tests`);
    const id = invocations[0]!.id;
    await until(async () => workerStarts().length === 1 || undefined, 'the worker start');
    expect(fake.starts().length).toBe(1);
    const text = readFileSync(BUNDLE, 'utf8');
    expect(fake.files.get(WORKER_BUNDLE_PATH)).toBe(text);
    expect(fake.files.get(WORKER_VERSION_PATH)).toBe(createHash('sha256').update(text).digest('hex'));
    const start = workerStarts()[0]!;
    expect(start.script).toContain('export CODEX_HOME=/data/.codex ROWBOAT_URL=\'http://localhost:');
    expect(start.script).toMatch(/ROWBOAT_AGENT_KEY='rbk_[^']+'/);
    expect(start.script).toContain(`exec node ${WORKER_BUNDLE_PATH} --url 'http://localhost:`);
    expect(start.script).toContain("--agent 'codex' --cwd /data/workspace --state /data/rowboat/worker --idle 5 --lock /data/rowboat/worker.lock");
    const submitted = fake.received.find((r) => r.method === 'POST' && r.path === `/api/agents/${AGENT_ID}/exec` && String(r.body?.command).includes(WORKER_BUNDLE_PATH));
    expect(submitted?.body).toMatchObject({ detached: true, timeout: 123 });
    // The turn is the worker's: Harbor leaves the invocation pending for it to list and take.
    await pause(200);
    expect((await org.invocation(id))!.state).toBe('pending');
    // The worker takes it on the key the script carries, as it would.
    const key = start.script.match(/ROWBOAT_AGENT_KEY='([^']+)'/)![1]!;
    expect((await org.as(key).post(`/v1/agent/invocations/${id}/ack`)).status).toBe(200);
    expect((await org.as(key).post(`/v1/agent/invocations/${id}/update`, { state: 'done' })).status).toBe(200);
  });

  it('starts nothing while a worker is connected, and starts another once it is gone, without putting the bundle again', async () => {
    const ws = await workerConnects(org);
    try {
      const before = workerStarts().length;
      const writes = bundleWrites();
      const { invocations } = await org.post(`${mention(codex)} and again`);
      await pause(300);
      expect(workerStarts().length).toBe(before);
      expect((await org.invocation(invocations[0]!.id))!.state).toBe('pending');
      ws.close();
      await until(async () => (org.harbor.service.agentConnected(codex.id) ? undefined : true), 'the worker to be gone');
      const { invocations: later } = await org.post(`${mention(codex)} once more`);
      await until(async () => workerStarts().length === before + 1 || undefined, 'another worker start');
      expect(bundleWrites()).toBe(writes);
      expect((await org.invocation(later[0]!.id))!.state).toBe('pending');
    } finally {
      ws.close();
    }
  });

  it('seeds the worker with the sessions the exec-driven turns kept', async () => {
    const at = new Date().toISOString();
    await org.harbor.store.putConnectionThread(codex.id, org.spaceId, '01ROOTAAAAAAAAAAAAAAAAAAAA', { session: '01a1-thread', deliveredOffset: 7 }, at);
    await org.harbor.store.putConnectionThread(codex.id, org.spaceId, '01ROOTBBBBBBBBBBBBBBBBBBBB', { deliveredOffset: 3 }, at);
    const before = workerStarts().length;
    // Past the start debounce (50 ms here), so this mention starts a worker of its own.
    await pause(120);
    await org.post(`${mention(codex)} with a past`);
    await until(async () => workerStarts().length === before + 1 || undefined, 'a worker start');
    expect(JSON.parse(fake.files.get(WORKER_SEED_PATH)!)).toEqual({
      version: 1,
      threads: { [`${org.spaceId}/01ROOTAAAAAAAAAAAAAAAAAAAA`]: { session: '01a1-thread', deliveredOffset: 7 } },
    });
  });

  it('keeps the exec-driven path for a kind not in worker mode', async () => {
    fake.agent = { ...fake.agent, framework: 'hermes', templateId: 'hermes', status: 'sleeping' };
    const hermes = await org.agent('Hermes', 'hermes');
    const { invocations } = await org.post(`${mention(hermes)} hello`);
    expect((await org.ended(invocations[0]!.id)).state).toBe('done');
    expect(fake.submits().some((e) => e.script.includes('hermes chat'))).toBe(true);
  });
});

describe('a Harbor without a worker to ship', () => {
  it('fails the invocation and says so', async () => {
    PLATFORMS.maritime = maritimePlatform(fake.url, { pollMs: 40 }, { kinds: ['codex'], bundlePath: '/nowhere/rowboat-worker.cjs', debounceMs: 50 });
    fake.agent = { ...fake.agent, framework: 'custom', templateId: 'codex', status: 'sleeping' };
    const org = await new Org(await freshStore()).start();
    try {
      const codex = await org.agent('Codex', 'codex');
      const { invocations } = await org.post(`${mention(codex)} anything`);
      const ended = await org.ended(invocations[0]!.id);
      expect(ended).toMatchObject({ state: 'failed', error: expect.stringMatching(/no worker to put on the agent/) });
    } finally {
      await org.harbor.close();
      PLATFORMS.maritime = maritimePlatform(fake.url, { pollMs: 40 }, { kinds: ['codex'], bundlePath: BUNDLE, idleSeconds: 5, ttlSeconds: 123, debounceMs: 50 });
    }
  });
});
