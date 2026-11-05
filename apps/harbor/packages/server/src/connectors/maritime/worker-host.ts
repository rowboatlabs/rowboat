import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Invocation, ServerFrame } from '@rowboat/spaces-protocol';
import { trialOverMessage } from '../../core/hosting.js';
import { HarborError } from '../../errors.js';
import { sleep } from '../common/request.js';
import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { MaritimeError, type MaritimeApi } from './api.js';
import type { ThreadRecord } from './connector.js';

// The Maritime connector in worker mode (spec §8 Connectors, the agent
// worker, 2026-11-05): for a kind the worker drives (Codex), Harbor no longer
// runs one execution per turn. It keeps what only Harbor can do, waking the
// box, putting the worker on it and starting it, and the worker does the
// turns as a client of the agent contract on the agent's own key. One
// detached execution is the worker's life: it exits when idle so the box can
// sleep, and the next invocation starts another. Harbor knows a worker is
// there by the agent's live connection; while one is, nothing here runs.

export interface WorkerHostOptions {
  /** The one-file worker to put on the box: HARBOR_WORKER_BUNDLE, else the worker package's build beside this package. */
  bundlePath?: string;
  /** The worker's execution lifetime on Maritime, seconds (default a day): it restarts cleanly when it ends. */
  ttlSeconds?: number;
  /** How long the worker waits with nothing to do before exiting so the box can sleep (default ten minutes). */
  idleSeconds?: number;
  /** A start takes a moment to connect: no second start within this (default 20 s). */
  debounceMs?: number;
}

const LIST_EVERY_MS = 60_000;
/** How long a start may wait for a free machine when the plan's awake limit is reached. */
const WAKE_WITHIN_MS = 10 * 60_000;
/** How long Maritime trouble is retried (by the one-minute list) before the invocation fails. */
const RETRY_FOR_MS = 5 * 60_000;
const DEFAULT_TTL_S = 24 * 3600;
const DEFAULT_IDLE_S = 600;
const DEFAULT_DEBOUNCE_MS = 20_000;

/** Where things live on the box: the coding templates' volume, the `rowboat/` folder the exec-driven turns used. */
const DIR = '/data/rowboat';
export const WORKER_BUNDLE_PATH = `${DIR}/worker.js`;
export const WORKER_VERSION_PATH = `${DIR}/worker.version`;
export const WORKER_STATE_DIR = `${DIR}/worker`;
export const WORKER_SEED_PATH = `${WORKER_STATE_DIR}/seed.json`;
const LOCK = `${DIR}/worker.lock`;
const LOG = `${DIR}/worker.log`;
const WORKSPACE = '/data/workspace';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The worker bundle this Harbor ships: the env's path, else `packages/worker/dist` beside this package. */
export function defaultBundlePath(): string | undefined {
  const fromEnv = process.env.HARBOR_WORKER_BUNDLE;
  if (fromEnv) return fromEnv;
  // packages/server/{src,dist}/connectors/maritime → packages/worker/dist, in a checkout and in the image alike.
  const candidate = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../worker/dist/rowboat-worker.cjs');
  return existsSync(candidate) ? candidate : undefined;
}

export class MaritimeWorkerHost implements RunningConnector {
  private unsubscribe: (() => void) | undefined;
  private readonly timers: NodeJS.Timeout[] = [];
  private stopped = false;
  private readonly stopping = new AbortController();
  private ensuring: Promise<void> | undefined;
  private lastEnsureAt = 0;
  private troubleSince: number | undefined;
  private bundle: { text: string; hash: string } | undefined;
  /** The bundle hash known to be on the box, once checked or written this run. */
  private installed: string | undefined;

  constructor(
    private readonly env: ConnectorEnv,
    private readonly api: () => Promise<MaritimeApi>,
    private readonly options: WorkerHostOptions = {},
  ) {}

  start(): this {
    this.unsubscribe = this.env.subscribe((frame) => this.onFrame(frame));
    void this.list();
    this.timers.push(setInterval(() => void this.list(), LIST_EVERY_MS));
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopping.abort();
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    await this.ensuring?.catch(() => {});
  }

  private get maritimeAgentId(): string {
    return this.env.agent.agentInstance ?? '';
  }

  private onFrame(frame: ServerFrame): void {
    if (frame.kind === 'invocation') void this.ensure(frame.invocation);
  }

  /** The list is the guarantee: anything waiting, or working with no worker to carry it, calls for one. */
  private async list(): Promise<void> {
    if (this.stopped) return;
    const open = await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), []);
    const waiting = open.find((i) => i.state === 'pending') ?? open.find((i) => i.state === 'working');
    if (waiting) await this.ensure(waiting);
  }

  /**
   * A worker for the agent: nothing while one is connected; else wake the
   * box, put the worker there if it is not, start it. One at a time, and not
   * twice in a row: a start takes a moment to connect.
   */
  async ensure(invocation: Invocation): Promise<void> {
    if (this.stopped || this.env.service.agentConnected(this.env.agent.id)) return;
    if (this.ensuring) return this.ensuring;
    if (Date.now() - this.lastEnsureAt < (this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS)) return;
    this.lastEnsureAt = Date.now();
    this.ensuring = this.run(invocation)
      .catch((err) => this.env.log('could not start the worker', { error: (err as Error).message }))
      .finally(() => {
        this.ensuring = undefined;
      });
    return this.ensuring;
  }

  private async run(invocation: Invocation): Promise<void> {
    if (!this.maritimeAgentId) return this.fail(invocation, 'This Maritime agent has no Maritime agent id. Its owner needs to add it again with one.');
    const bundle = this.loadBundle();
    if (!bundle) return this.fail(invocation, 'This Harbor has no worker to put on the agent’s machine (HARBOR_WORKER_BUNDLE).');
    let api: MaritimeApi;
    try {
      api = await this.api();
    } catch (err) {
      return this.fail(invocation, err instanceof HarborError ? err.message : (err as Error).message);
    }
    if (!(await this.funded(invocation, api))) return;
    if (!(await this.wake(invocation, api))) return;
    try {
      await this.install(api, bundle);
      // The seed is a courtesy to old threads: trouble writing it never keeps the worker from starting.
      await this.seed(api).catch((err) => this.env.log('could not write the worker seed', { error: (err as Error).message }));
      const key = await this.env.agentKey();
      await api.exec(this.maritimeAgentId, ['sh', '-c', this.script(key)], { detached: true, timeoutSeconds: this.options.ttlSeconds ?? DEFAULT_TTL_S });
      this.troubleSince = undefined;
      this.env.log('started the worker on the box', { agent: this.maritimeAgentId, bundle: bundle.hash.slice(0, 12) });
    } catch (err) {
      await this.trouble(invocation, err);
    }
  }

  /** The one-file worker, read once, with the hash the box is checked against. */
  private loadBundle(): { text: string; hash: string } | undefined {
    if (this.bundle) return this.bundle;
    const path = this.options.bundlePath ?? defaultBundlePath();
    if (!path || !existsSync(path)) return undefined;
    const text = readFileSync(path, 'utf8');
    this.bundle = { text, hash: createHash('sha256').update(text).digest('hex') };
    return this.bundle;
  }

  /** The box runs this build of the worker: the version file says, and a different one is replaced. */
  private async install(api: MaritimeApi, bundle: { text: string; hash: string }): Promise<void> {
    if (this.installed === bundle.hash) return;
    const there = await api.readFile(this.maritimeAgentId, WORKER_VERSION_PATH);
    if (there?.trim() === bundle.hash) {
      this.installed = bundle.hash;
      return;
    }
    await api.writeFile(this.maritimeAgentId, WORKER_BUNDLE_PATH, bundle.text);
    await api.writeFile(this.maritimeAgentId, WORKER_VERSION_PATH, bundle.hash);
    this.installed = bundle.hash;
    this.env.log('put the worker on the box', { agent: this.maritimeAgentId, bundle: bundle.hash.slice(0, 12) });
  }

  /**
   * The sessions Harbor's own exec-driven turns kept per thread, for the
   * worker to take over (2026-11-05): written before each start, read by the
   * worker once for the conversations its own record does not know yet.
   */
  private async seed(api: MaritimeApi): Promise<void> {
    const threads: Record<string, { session: string; deliveredOffset?: number }> = {};
    for (const { spaceId, threadRootId, data } of await this.env.thread.list()) {
      const record = (data ?? {}) as ThreadRecord;
      if (!record.session) continue;
      threads[`${spaceId}/${threadRootId}`] = { session: record.session, ...(record.deliveredOffset !== undefined ? { deliveredOffset: record.deliveredOffset } : {}) };
    }
    if (Object.keys(threads).length === 0) return;
    await api.writeFile(this.maritimeAgentId, WORKER_SEED_PATH, JSON.stringify({ version: 1, threads }));
  }

  /** The execution that is the worker: the exec-driven turn's environment, then the worker until it is idle. */
  private script(agentKey: string): string {
    const orgUrl = this.env.orgUrl;
    const idle = this.options.idleSeconds ?? DEFAULT_IDLE_S;
    return [
      'set -e',
      `export CODEX_HOME=/data/.codex ROWBOAT_URL=${q(orgUrl)} ROWBOAT_AGENT_KEY=${q(agentKey)}`,
      `mkdir -p ${WORKER_STATE_DIR} ${WORKSPACE}`,
      `cd ${WORKSPACE}`,
      `exec node ${WORKER_BUNDLE_PATH} --url ${q(orgUrl)} --agent ${q(this.env.agent.agentKind ?? 'codex')} --cwd ${WORKSPACE} --state ${WORKER_STATE_DIR} --idle ${idle} --lock ${LOCK} > ${LOG} 2>&1`,
    ].join('\n');
  }

  /** Wake the box, waiting out the plan's awake limit. True once it is up; false when the invocation was failed meanwhile. */
  private async wake(invocation: Invocation, api: MaritimeApi): Promise<boolean> {
    const waitUntil = Date.now() + WAKE_WITHIN_MS;
    for (;;) {
      try {
        await api.start(this.maritimeAgentId);
        return true;
      } catch (err) {
        if (err instanceof MaritimeError && err.alreadyRunning) return true;
        if (!(err instanceof MaritimeError && err.mustWait)) {
          await this.trouble(invocation, err);
          return false;
        }
        if (Date.now() > waitUntil) {
          await this.fail(invocation, "Maritime had no free machine for this agent for 10 minutes (the plan's awake limit). Mention me again to retry.");
          return false;
        }
        await sleep(Math.max(1, Math.min(err.retryAfterSeconds ?? 15, 60)) * 1000, this.stopping.signal);
        if (this.stopped) return false;
      }
    }
  }

  /**
   * A managed agent on Rowboat's trial credit (2026-10-27), or billed to its
   * owner (2026-11-04): the sentence that stops a turn before the box is
   * woken, as the exec-driven connector says it.
   */
  private async funded(invocation: Invocation, api: MaritimeApi): Promise<boolean> {
    const refusal = await this.safe(() => this.env.service.hostingTurnRefusal(this.env.agent.id), undefined);
    if (refusal) {
      await this.fail(invocation, refusal);
      return false;
    }
    const funding = await this.safe(() => this.env.service.hostingFundingOf(this.env.agent.id), undefined);
    if (!funding || funding.funding !== 'trial') return true;
    let over = funding.trialOver;
    if (!over) {
      let spend;
      try {
        spend = await api.spendLimit(this.maritimeAgentId);
      } catch (err) {
        await this.trouble(invocation, err);
        return false;
      }
      if (spend.limitReached) {
        over = 'exhausted';
        await this.safe(() => this.env.service.closeHostingTrial(this.env.agent.id, 'exhausted'), undefined);
      }
    }
    if (!over) return true;
    await this.fail(invocation, trialOverMessage(over));
    return false;
  }

  /**
   * Maritime trouble: a refused key fails at once and tells the owner; an
   * agent that is gone fails; anything else is retried by the one-minute
   * list for five minutes, then fails with Maritime's words.
   */
  private async trouble(invocation: Invocation, err: unknown): Promise<void> {
    const maritime = err instanceof MaritimeError ? err : new MaritimeError(0, undefined, (err as Error).message);
    if (maritime.rejectsKey) return this.keyRejected(invocation, maritime);
    if (maritime.gone) {
      return this.fail(invocation, `My Maritime agent (${this.maritimeAgentId}) is gone: it was deleted, or this key no longer reaches it. My owner needs to add me again.`);
    }
    this.troubleSince ??= Date.now();
    this.env.log('Maritime trouble starting the worker; the list retries', { error: maritime.message });
    if (Date.now() - this.troubleSince > RETRY_FOR_MS) {
      this.troubleSince = undefined;
      await this.fail(invocation, `Maritime: ${maritime.message}`);
    }
  }

  /** 401/403: fail fast with the reason, and tell the owner once, in their DM with the agent. */
  private async keyRejected(invocation: Invocation, err: MaritimeError): Promise<void> {
    const reason = err.status === 403 ? "This agent's Maritime key lacks the scope to run commands." : "Maritime rejected this agent's API key.";
    await this.fail(invocation, `${reason} Its owner needs to replace the key in Agents.`);
    const first = await this.safe(() => this.env.rejectCredential(`${reason} (${err.message})`), false);
    const ownerId = this.env.agent.ownerId;
    if (!first || !ownerId) return;
    await this.safe(async () => {
      const { space } = await this.env.service.openDirect(this.env.ctx, ownerId);
      await this.env.service.postMessage(this.env.ctx, space.id, {
        body: `${reason} Until the key is replaced in Agents, I can't take on work. (${err.message})`,
        actingMode: 'direct',
      });
    }, undefined);
  }

  /** A pending invocation failed with its sentence; one the worker took is left to it. */
  private async fail(invocation: Invocation, error: string): Promise<void> {
    if (invocation.state !== 'pending') return;
    await this.safe(() => this.env.service.updateInvocation(this.env.ctx, invocation.id, { state: 'failed', error: error.slice(0, 1000) }), undefined);
  }

  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.env.log('call failed', { error: (err as Error).message });
      return fallback;
    }
  }
}
