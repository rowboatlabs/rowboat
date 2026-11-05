import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PgStore, pgliteDb, startHarbor, type RunningHarbor } from '@rowboat/harbor';
import type { Invocation, Member, Message } from '@rowboat/spaces-protocol';
import { silentLogger } from '../src/log.js';
import { TurnOverError, type Runtime, type TurnInput, type TurnResult } from '../src/runtime.js';
import { ThreadState } from '../src/state.js';
import { Worker } from '../src/worker.js';

// The worker against the REAL stub Harbor on Postgres in-process, driven the
// way a person drives it (a mention in a thread), with a stand-in runtime
// that records what it was asked and plays back a turn when told.

class FakeRuntime implements Runtime {
  readonly name = 'fake';
  readonly label = 'Fake';
  readonly capabilities = { steer: true };
  sessions = 0;
  refuseSteer = false;
  ignoreInterrupt = false;
  readonly turns: Array<{ input: TurnInput; steered: string[]; over: boolean; finish: (r: TurnResult) => void }> = [];
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async openSession({ sessionId }: { sessionId?: string }): Promise<{ sessionId: string }> {
    return { sessionId: sessionId ?? `s${++this.sessions}` };
  }
  async turn(input: TurnInput) {
    let resolve!: (r: TurnResult) => void;
    const done = new Promise<TurnResult>((r) => (resolve = r));
    const t = {
      input,
      steered: [] as string[],
      over: false,
      finish: (r: TurnResult) => {
        if (t.over) return;
        t.over = true;
        resolve(r);
      },
    };
    this.turns.push(t);
    return {
      id: `t${this.turns.length}`,
      done,
      steer: async (text: string) => {
        if (t.over || this.refuseSteer) throw new TurnOverError('no active turn to steer');
        t.steered.push(text);
      },
      interrupt: async () => {
        if (!this.ignoreInterrupt) t.finish({ status: 'interrupted' });
      },
    };
  }
  async models() {
    return [
      { id: 'm1', label: 'Model One' },
      { id: 'm2', label: 'Model Two' },
    ];
  }
  efforts() {
    return [{ id: 'low', label: 'Low' }];
  }
  last() {
    return this.turns.at(-1)!;
  }
}

let harbor: RunningHarbor;
let spaceId: string;
let agent: Member;
let key: string;
const workers: Worker[] = [];

const as = (token: string) => ({
  async get(path: string) {
    const res = await fetch(`${harbor.url}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  },
  async post(path: string, body?: unknown) {
    const res = await fetch(`${harbor.url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  },
});
const mention = () => `[@${agent.displayName}](#member:${agent.id})`;

async function post(token: string, body: string, extra: Record<string, unknown> = {}): Promise<{ message: Message; invocations: Invocation[] }> {
  const r = await as(token).post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return r.body;
}

async function until<T>(fn: () => Promise<T | undefined> | T | undefined, label: string, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await fn();
    if (got !== undefined && got !== false) return got as T;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const invocation = async (id: string) => (await harbor.store.getInvocation(id))!;
const inState = (id: string, state: string) => until(async () => ((await invocation(id)).state === state ? true : undefined), `${id} ${state}`);
const replies = async (root: string): Promise<Message[]> => {
  const page = (await as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${root}`)).body;
  return (page.messages as Message[]).filter((m) => m.author.memberId === agent.id);
};

function startWorker(runtime: FakeRuntime, extra: Partial<ConstructorParameters<typeof Worker>[0]> = {}): Promise<Worker> {
  const worker = new Worker({
    baseUrl: harbor.url,
    key,
    cwd: '/tmp',
    runtime,
    state: new ThreadState(undefined),
    log: silentLogger,
    sweepMs: 300,
    activityMinMs: 10,
    heartbeatMs: 60_000,
    idleCheckMs: 50,
    ...extra,
  });
  workers.push(worker);
  return worker.start().then(() => worker);
}

beforeAll(async () => {
  const db = await pgliteDb();
  const store = new PgStore(db);
  await store.init();
  const started = await startHarbor({
    store,
    orgName: 'Worker Test Org',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
  });
  harbor = { ...started, close: async () => (await started.close(), await db.close()) };
  spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
  const created = await as('dev-ramnique').post('/v1/agents', { displayName: 'Codex' });
  agent = created.body.agent;
  key = created.body.key.secret;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
});

afterEach(async () => {
  for (const w of workers.splice(0)) await w.stop();
});

afterAll(async () => {
  await harbor.close();
});

describe('the worker', () => {
  it('answers a mention: acknowledges, runs the turn with the request in its prompt, posts the reply, reports done', async () => {
    const runtime = new FakeRuntime();
    await startWorker(runtime);
    const asked = await post('dev-harsh', `${mention()} fix the build`);
    const id = asked.invocations[0]!.id;
    await until(() => (runtime.turns.length === 1 ? true : undefined), 'the turn');
    expect(runtime.last().input.prompt).toContain('fix the build');
    expect(runtime.last().input.prompt).toContain(`You are [@Codex](#member:${agent.id}) in Rowboat`);
    expect(runtime.last().input.sessionId).toBe('s1');
    await inState(id, 'working');
    runtime.last().finish({ status: 'completed', answer: 'Done: the build is green.' });
    await inState(id, 'done');
    expect((await replies(asked.message.id)).map((m) => m.body)).toEqual(['Done: the build is green.']);
  });

  it('declares Stop, steer, and the harness’s models and efforts as the composer’s options', async () => {
    await startWorker(new FakeRuntime());
    const caps = await until(async () => {
      const got = (await as('dev-harsh').get(`/v1/agents/${agent.id}/capabilities`)).body.capabilities;
      return got?.options?.length ? got : undefined;
    }, 'capabilities');
    expect(caps).toEqual({
      stop: true,
      steer: true,
      options: [
        { type: 'select', key: 'model', label: 'Model', choices: [{ id: 'm1', label: 'Model One' }, { id: 'm2', label: 'Model Two' }] },
        { type: 'select', key: 'effort', label: 'Effort', choices: [{ id: 'low', label: 'Low' }] },
      ],
    });
  });

  it('folds a steer into the running turn, finishes both with one reply, and resumes the thread’s session next time', async () => {
    const runtime = new FakeRuntime();
    await startWorker(runtime);
    const asked = await post('dev-harsh', `${mention()} refactor the parser`);
    const turnId = asked.invocations[0]!.id;
    await inState(turnId, 'working');
    await until(() => (runtime.turns.length === 1 ? true : undefined), 'the turn');
    const steer = (await post('dev-harsh', 'keep the public API as it is', { threadRoot: asked.message.id })).invocations[0]!;
    expect(steer).toMatchObject({ state: 'pending', steers: turnId });
    await until(() => (runtime.last().steered.length === 1 ? true : undefined), 'the steer');
    expect(runtime.last().steered[0]).toContain('keep the public API as it is');
    expect(runtime.last().steered[0]).toContain('[@Harsh](#member:harsh)');
    await inState(steer.id, 'working');
    runtime.last().finish({ status: 'completed', answer: 'Refactored, API unchanged.' });
    await inState(turnId, 'done');
    await inState(steer.id, 'done');
    expect((await replies(asked.message.id)).map((m) => m.body)).toEqual(['Refactored, API unchanged.']);
    // The next turn in the thread resumes the same session and hears only what came after the answer.
    const again = await post('dev-harsh', 'and the tests?', { threadRoot: asked.message.id });
    await until(() => (runtime.turns.length === 2 ? true : undefined), 'the second turn');
    expect(runtime.last().input.sessionId).toBe('s1');
    expect(runtime.last().input.prompt).not.toContain('Earlier in this thread');
    runtime.last().finish({ status: 'completed', answer: 'Green.' });
    await inState(again.invocations[0]!.id, 'done');
  });

  it('Stop interrupts the harness: the turn and its folded steer report cancelled, and nothing is posted', async () => {
    const runtime = new FakeRuntime();
    await startWorker(runtime);
    const asked = await post('dev-harsh', `${mention()} long job`);
    const turnId = asked.invocations[0]!.id;
    await inState(turnId, 'working');
    await until(() => (runtime.turns.length === 1 ? true : undefined), 'the turn');
    const steer = (await post('dev-harsh', 'also this', { threadRoot: asked.message.id })).invocations[0]!;
    await inState(steer.id, 'working');
    expect((await as('dev-harsh').post(`/v1/invocations/${turnId}/cancel`)).body.invocation).toMatchObject({ stopRequested: true });
    await inState(turnId, 'cancelled');
    await inState(steer.id, 'cancelled');
    expect(runtime.last().over).toBe(true);
    expect(await replies(asked.message.id)).toEqual([]);
  });

  it('runs a steer the harness refuses (the turn was over) as a turn of its own, after the first', async () => {
    const runtime = new FakeRuntime();
    runtime.refuseSteer = true;
    await startWorker(runtime);
    const asked = await post('dev-harsh', `${mention()} first`);
    const turnId = asked.invocations[0]!.id;
    await inState(turnId, 'working');
    await until(() => (runtime.turns.length === 1 ? true : undefined), 'the turn');
    const steer = (await post('dev-harsh', 'second', { threadRoot: asked.message.id })).invocations[0]!;
    expect(steer.steers).toBe(turnId);
    await inState(steer.id, 'working');
    // Queued behind the first: not started until it ends.
    await new Promise((r) => setTimeout(r, 200));
    expect(runtime.turns.length).toBe(1);
    runtime.turns[0]!.finish({ status: 'completed', answer: 'one' });
    await inState(turnId, 'done');
    await until(() => (runtime.turns.length === 2 ? true : undefined), 'the steer’s own turn');
    expect(runtime.last().input.prompt).toContain('second');
    runtime.last().finish({ status: 'completed', answer: 'two' });
    await inState(steer.id, 'done');
    expect((await replies(asked.message.id)).map((m) => m.body)).toEqual(['one', 'two']);
  });

  it('after a restart, resumes a working turn on the session it kept, and fails one whose session it never had', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'worker-state-'));
    const file = join(dir, 'threads.json');
    const first = new FakeRuntime();
    first.ignoreInterrupt = true;
    const gone = await startWorker(first, { state: new ThreadState(file) });
    const asked = await post('dev-harsh', `${mention()} migrate the schema`);
    const id = asked.invocations[0]!.id;
    await inState(id, 'working');
    await until(() => (first.turns.length === 1 ? true : undefined), 'the turn');
    // The worker dies mid-turn: its socket goes, the invocation stays working.
    await gone.stop();
    workers.splice(workers.indexOf(gone), 1);
    // Meanwhile, somewhere this worker has no session for: a turn acknowledged on the bare contract.
    const elsewhere = await post('dev-harsh', `${mention()} unrelated`);
    const orphan = elsewhere.invocations[0]!.id;
    expect((await as(key).post(`/v1/agent/invocations/${orphan}/ack`)).status).toBe(200);

    const second = new FakeRuntime();
    await startWorker(second, { state: new ThreadState(file) });
    await until(() => (second.turns.length === 1 ? true : undefined), 'the resumed turn');
    expect(second.last().input.sessionId).toBe('s1');
    expect(second.last().input.prompt).toMatch(/^This request was interrupted by a restart/);
    expect(second.last().input.prompt).toContain('migrate the schema');
    second.last().finish({ status: 'completed', answer: 'Migrated.' });
    await inState(id, 'done');
    expect((await replies(asked.message.id)).map((m) => m.body)).toEqual(['Migrated.']);
    await inState(orphan, 'failed');
    expect((await invocation(orphan)).error).toMatch(/restarted before finishing this/);
  });

  it('a stop asked for while the worker was away is honoured on the next start', async () => {
    const first = new FakeRuntime();
    first.ignoreInterrupt = true;
    const gone = await startWorker(first);
    const asked = await post('dev-harsh', `${mention()} slow`);
    const id = asked.invocations[0]!.id;
    await inState(id, 'working');
    await gone.stop();
    workers.splice(workers.indexOf(gone), 1);
    await as('dev-harsh').post(`/v1/invocations/${id}/cancel`);
    await startWorker(new FakeRuntime());
    await inState(id, 'cancelled');
  });

  it('exits when it has had nothing to do for the idle time', async () => {
    const runtime = new FakeRuntime();
    let idle = false;
    await startWorker(runtime, { idleMs: 150, onIdle: () => (idle = true) });
    const asked = await post('dev-harsh', `${mention()} quick`);
    await until(() => (runtime.turns.length === 1 ? true : undefined), 'the turn');
    await new Promise((r) => setTimeout(r, 300));
    expect(idle).toBe(false);
    runtime.last().finish({ status: 'completed', answer: 'ok' });
    await inState(asked.invocations[0]!.id, 'done');
    await until(() => (idle ? true : undefined), 'idle exit');
  });
});
