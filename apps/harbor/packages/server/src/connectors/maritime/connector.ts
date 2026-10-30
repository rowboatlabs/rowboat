import type { ConnectorCapabilities, Invocation, InvocationUpdate, Message, ServerFrame } from '@rowboat/spaces-protocol';
import { HarborError } from '../../errors.js';
import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { quietly, requestPrompt, sleep } from '../common/request.js';
import { MaritimeError, type Execution, type MaritimeApi } from './api.js';
import { SIGN_IN_GONE_MESSAGE, trialOverMessage } from '../../core/hosting.js';
import { RUNTIMES, type Runtime, type TurnReading } from './runtimes.js';

// The Maritime connector (spec §8 Connectors, Maritime, 2026-10-26): one per
// agent whose connection is `maritime`, run by Harbor (connectors/host.ts),
// the shape of the Conductor connector. A Rowboat agent is one Maritime agent,
// a VM with a persistent volume, named when it was added. Each Rowboat thread
// is one session of the runtime inside it, and each turn is one detached
// execution of the runtime's CLI (runtimes.ts): the connector wakes the VM,
// writes the request to a file on the volume, submits the command, polls the
// execution and the event file for progress, posts the final message, and
// cancels the execution on Stop.
//
// What survives a restart: the per-thread record names the execution and
// the files, so a restarted connector follows the execution it submitted, or
// reads the files it left, and never runs a turn twice on purpose. An
// execution Maritime no longer retains is read from its files on the volume.
// One Harbor instance only, as for the other connectors Harbor runs (SPEC.md
// §4 "Running more than one instance").

const LIST_EVERY_MS = 60_000;
const CAPABILITIES_EVERY_MS = 10 * 60_000;
/** Report working at least this often: Harbor fails a silent turn after 30 minutes. */
const HEARTBEAT_MS = 4 * 60_000;
const ACTIVITY_EVERY_MS = 5_000;
/** How long Maritime trouble is retried before the invocation fails. */
const RETRY_FOR_MS = 5 * 60_000;
/** How long a turn may wait for a free machine when the plan's awake limit is reached. */
const WAKE_WITHIN_MS = 10 * 60_000;
/** The detached execution's own timeout: an hour, Maritime's detached default. */
const EXEC_TIMEOUT_S = 3600;
export interface PollTiming {
  pollMs: number;
}
/** One execution read a second while a turn runs: an answer lands within a second of the CLI ending (was 3 s; 2026-10-27). */
const DEFAULT_TIMING: PollTiming = { pollMs: 1_000 };

/** The connector's record for one thread (agent_connection_threads.data). */
export interface ThreadRecord {
  /** The runtime's session for this thread: Hermes's session name, Codex's thread id, Claude Code's session id. */
  session?: string;
  /** The offset of the newest thread message the runtime has heard; its context starts after it. */
  deliveredOffset?: number;
  /** The invocation in flight in this thread. */
  turn?: {
    invocationId: string;
    triggerMessageId: string;
    /** The turn's files on the volume, written before the submit. */
    files: { prompt: string; out: string; err: string; last: string };
    /** Maritime's execution id, from the submit; absent until the submit answered. */
    executionId?: string;
    /** True from just before the submit until it answered: a restart in between reads the files before sending again. */
    submitting?: boolean;
  };
}

export class MaritimeConnector implements RunningConnector {
  private readonly running = new Map<string, Promise<void>>();
  /** What this run took on. A working invocation at boot that it did not take on is from before a restart. */
  private readonly takenOn = new Set<string>();
  /** Stop asked for: the invocation, and the execution to cancel once it is known. */
  private readonly stops = new Set<string>();
  private readonly executions = new Map<string, string>();
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;
  private stopped = false;
  private readonly stopping = new AbortController();
  private declared = '';

  constructor(
    private readonly env: ConnectorEnv,
    private readonly api: () => Promise<MaritimeApi>,
    private readonly timing: PollTiming = DEFAULT_TIMING,
  ) {}

  start(): this {
    this.unsubscribe = this.env.subscribe((frame) => this.onFrame(frame));
    void this.boot();
    this.timers.push(setInterval(() => void this.list(), LIST_EVERY_MS));
    this.timers.push(setInterval(() => void this.declare(), CAPABILITIES_EVERY_MS));
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopping.abort();
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    await Promise.allSettled([...this.running.values()]);
  }

  private get runtime(): Runtime {
    return RUNTIMES[this.env.agent.agentKind ?? ''] ?? RUNTIMES.hermes!;
  }

  private get maritimeAgentId(): string {
    return this.env.agent.agentInstance ?? '';
  }

  // --- intake -------------------------------------------------------------------------

  private async boot(): Promise<void> {
    await this.declare();
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'working' && !this.takenOn.has(invocation.id)) {
        this.takenOn.add(invocation.id);
        if (invocation.stopRequested) this.stops.add(invocation.id);
        this.track(invocation, () => this.recover(invocation));
      } else if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private onFrame(frame: ServerFrame): void {
    if (frame.kind === 'invocation') this.intake(frame.invocation);
    else if (frame.kind === 'invocation_stop') void this.stopInvocation(frame.invocationId);
  }

  private async list(): Promise<void> {
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private intake(invocation: Invocation): void {
    if (this.stopped || invocation.state !== 'pending' || this.running.has(invocation.id)) return;
    this.takenOn.add(invocation.id);
    this.track(invocation, async () => {
      try {
        await this.env.service.acknowledgeInvocation(this.env.ctx, invocation.id);
      } catch {
        return; // cancelled on its way, or someone else took it: drop it
      }
      // A person's answer to a question: these runtimes ask none, so it is a plain request on the thread's session.
      await this.react(invocation, '👀');
      await this.run(invocation);
    });
  }

  private track(invocation: Invocation, work: () => Promise<void>): void {
    const id = invocation.id;
    const done = work()
      .catch((err) => this.env.log('invocation failed unexpectedly', { id, error: (err as Error).message }))
      .finally(() => {
        this.running.delete(id);
        this.stops.delete(id);
        this.executions.delete(id);
      });
    this.running.set(id, done);
  }

  /** Stop (spec §8 part 2): cancel the execution; the poll sees it cancelled and reports so. */
  private async stopInvocation(invocationId: string): Promise<void> {
    if (!this.running.has(invocationId)) return;
    this.stops.add(invocationId);
    const executionId = this.executions.get(invocationId);
    if (executionId) await this.safe(async () => (await this.api()).cancelExecution(this.maritimeAgentId, executionId), undefined);
  }

  // --- one invocation --------------------------------------------------------------------

  private async run(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    if (!this.maritimeAgentId) return this.fail(invocation, 'This Maritime agent has no Maritime agent id. Its owner needs to add it again with one.');
    let record = await this.record(spaceId, threadRootId);
    if (this.stops.has(invocation.id)) return this.cancelled(invocation);
    if (!(await this.fundedForTurn(invocation))) return;
    await this.report(invocation, { state: 'working', activity: 'Waking the agent on Maritime' });
    const awake = await this.wake(invocation);
    if (!awake) return;
    const runtime = this.runtime;
    const session = record.session ?? runtime.sessionFor?.(`${spaceId}-${threadRootId}`.toLowerCase());
    const dir = `${runtime.root}/rowboat`;
    const files = { prompt: `${dir}/${invocation.id}.prompt`, out: `${dir}/${invocation.id}.jsonl`, err: `${dir}/${invocation.id}.err`, last: `${dir}/${invocation.id}.last` };
    record = { ...record, ...(session ? { session } : {}), turn: { invocationId: invocation.id, triggerMessageId: invocation.trigger.messageId, files } };
    await this.save(spaceId, threadRootId, record);
    const prompt = await requestPrompt(this.env, invocation, record.deliveredOffset);
    await this.submit(invocation, record, prompt);
  }

  /**
   * A managed agent on Rowboat's trial credit (2026-10-27): before a turn, is
   * the trial over? Harbor's record says so once it is; until then the
   * platform's own count decides, and a cap reached closes the trial for good.
   * The answer goes to the thread as the turn's failure, where the owner reads
   * it. An agent Rowboat does not host, or one on its owner's key, just runs.
   */
  private async fundedForTurn(invocation: Invocation): Promise<boolean> {
    const funding = await this.safe(() => this.env.service.hostingFundingOf(this.env.agent.id), undefined);
    if (!funding || funding.funding !== 'trial') return true;
    let over = funding.trialOver;
    if (!over) {
      const spend = await this.withMaritime(invocation, (api) => api.spendLimit(this.maritimeAgentId), { recover: true });
      if (spend === undefined) return false;
      if (spend.limitReached) {
        over = 'exhausted';
        await this.safe(() => this.env.service.closeHostingTrial(this.env.agent.id, 'exhausted'), undefined);
      }
    }
    if (!over) return true;
    await this.fail(invocation, trialOverMessage(over));
    return false;
  }

  /** Write the request and submit the turn, then follow it. */
  private async submit(invocation: Invocation, start: ThreadRecord, prompt: string): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    const turn = start.turn!;
    const options = invocation.options ?? {};
    const script = this.runtime.command({
      orgUrl: this.env.orgUrl,
      agentKey: await this.env.agentKey(),
      promptPath: turn.files.prompt,
      outPath: turn.files.out,
      errPath: turn.files.err,
      lastPath: turn.files.last,
      ...(start.session ? { session: start.session } : {}),
      ...(typeof options.model === 'string' ? { model: options.model } : {}),
      ...(typeof options.effort === 'string' ? { effort: options.effort } : {}),
    });
    let record = start;
    const execution = await this.withMaritime(invocation, async (api) => {
      await api.writeFile(this.maritimeAgentId, turn.files.prompt, prompt);
      record = { ...record, turn: { ...turn, submitting: true } };
      await this.save(spaceId, threadRootId, record);
      return api.exec(this.maritimeAgentId, ['sh', '-c', script], { detached: true, timeoutSeconds: EXEC_TIMEOUT_S });
    });
    if (!execution) return;
    record = {
      ...record,
      deliveredOffset: (await this.offsetOf(spaceId, invocation.trigger.messageId)) ?? record.deliveredOffset,
      turn: { ...turn, submitting: false, executionId: execution.executionId },
    };
    await this.save(spaceId, threadRootId, record);
    await this.follow(invocation, record, execution);
  }

  /**
   * Wake the VM before the turn, waiting out the plan's awake limit. True once
   * it is up; false when the invocation was failed meanwhile.
   */
  private async wake(invocation: Invocation): Promise<boolean> {
    const waitUntil = Date.now() + WAKE_WITHIN_MS;
    let told = false;
    for (;;) {
      const started = await this.withMaritime(
        invocation,
        async (api) => {
          try {
            await api.start(this.maritimeAgentId);
            return 'ok' as const;
          } catch (err) {
            if (err instanceof MaritimeError && err.alreadyRunning) return 'ok' as const;
            if (err instanceof MaritimeError && err.mustWait) return err;
            throw err;
          }
        },
        { recover: true },
      );
      if (started === undefined) return false;
      if (started === 'ok') return true;
      if (Date.now() > waitUntil) {
        await this.fail(invocation, "Maritime had no free machine for this agent for 10 minutes (the plan's awake limit). Mention me again to retry.");
        return false;
      }
      if (!told) {
        told = true;
        await this.report(invocation, { state: 'working', activity: 'Waiting for a free machine on Maritime' });
      }
      await sleep(Math.max(1, Math.min(started.retryAfterSeconds ?? 15, 60)) * 1000, this.stopping.signal);
      if (this.stopped) return false;
    }
  }

  // --- following the work ------------------------------------------------------------------

  /** Poll the execution until it ends, reading the event file for progress meanwhile, then finish. */
  private async follow(invocation: Invocation, record: ThreadRecord, first?: Execution): Promise<void> {
    const executionId = record.turn!.executionId!;
    this.executions.set(invocation.id, executionId);
    if (this.stops.has(invocation.id)) await this.safe(async () => (await this.api()).cancelExecution(this.maritimeAgentId, executionId), undefined);
    const working = (activity: string): InvocationUpdate => ({ state: 'working', activity });
    await this.report(invocation, working('Working on Maritime'));

    let execution = first;
    let lastReport = Date.now();
    let lastActivity = '';
    let lastActivityAt = 0;
    let giveUpAt = Date.now() + RETRY_FOR_MS;
    let backoff = this.timing.pollMs;
    let gone = false;

    while (!this.stopped) {
      try {
        const api = await this.api();
        if (!execution || execution.status === 'running') {
          try {
            execution = await api.execution(this.maritimeAgentId, executionId);
          } catch (err) {
            // Maritime keeps executions only so long (a restart or replacement forgets them): the files on the volume still tell.
            if (!(err instanceof MaritimeError && err.gone)) throw err;
            gone = true;
          }
        }
        giveUpAt = Date.now() + RETRY_FOR_MS;
        backoff = this.timing.pollMs;
        const ended = gone || (execution !== undefined && execution.status !== 'running');
        if (!ended) {
          // The event file is the only view of the turn while it runs (the execution record carries no output until the end).
          const out = await this.safe(() => api.readFile(this.maritimeAgentId, record.turn!.files.out), undefined);
          const activity = out ? this.runtime.activity(out) : undefined;
          if (activity && activity !== lastActivity && Date.now() - lastActivityAt >= ACTIVITY_EVERY_MS) {
            lastActivity = activity;
            lastActivityAt = lastReport = Date.now();
            await this.report(invocation, working(activity));
          }
          if (Date.now() - lastReport >= HEARTBEAT_MS) {
            lastReport = Date.now();
            await this.report(invocation, working(lastActivity || 'Working on Maritime'));
          }
        } else {
          const out = (await api.readFile(this.maritimeAgentId, record.turn!.files.out)) ?? '';
          const last = await this.safe(() => api.readFile(this.maritimeAgentId, record.turn!.files.last), undefined);
          const err = await this.safe(() => api.readFile(this.maritimeAgentId, record.turn!.files.err), undefined);
          if (execution?.status === 'cancelled' || this.stops.has(invocation.id)) return this.cancelled(invocation, record);
          const reading = this.runtime.read(out, last, err, execution?.exitCode);
          if (gone && !reading.answer && !reading.failure) {
            return this.fail(invocation, 'Maritime no longer has this turn and its files hold no answer. Mention me again to retry.');
          }
          return this.finish(invocation, record, reading);
        }
      } catch (err) {
        if (this.stopped) return;
        const maritime = err instanceof MaritimeError ? err : new MaritimeError(0, undefined, (err as Error).message);
        if (maritime.rejectsKey) return this.keyRejected(invocation, maritime);
        if (!(maritime.transient || maritime.mustWait) || Date.now() > giveUpAt) {
          return this.fail(invocation, `Lost touch with Maritime for several minutes (${maritime.message}). Mention me again to pick it back up.`);
        }
        this.env.log('poll failed; retrying', { error: maritime.message });
        backoff = Math.min(backoff * 2, 30_000);
      }
      await sleep(backoff, this.stopping.signal);
    }
  }

  private async finish(invocation: Invocation, record: ThreadRecord, reading: TurnReading): Promise<void> {
    if (reading.signIn) {
      // The turn script's own answer on a sign-in to a plan (Codex, 2026-10-30): Harbor's record follows it, and a sign-in found gone is the failure's reason.
      const state = reading.signIn;
      const moved = await this.safe(() => this.env.service.noteHostingSignIn(this.env.agent.id, state), undefined);
      if (moved === 'dropped' && reading.failure) reading = { ...reading, failure: SIGN_IN_GONE_MESSAGE };
    }
    const { spaceId, threadRootId } = invocation.conversation;
    const next: ThreadRecord = { ...record, ...(reading.session ? { session: reading.session } : {}) };
    let posted: Message | undefined;
    if (reading.failure) {
      if (reading.answer) posted = (await this.env.service.postMessage(this.env.ctx, spaceId, { body: reading.answer, threadRoot: threadRootId, actingMode: 'direct' })).message;
      await this.report(invocation, { state: 'failed', error: reading.failure.slice(0, 1000) });
    } else {
      const body = reading.answer ?? 'Finished on Maritime.';
      try {
        posted = (await this.env.service.answerInvocation(this.env.ctx, invocation.id, body)).message;
      } catch (err) {
        if (!(err instanceof HarborError)) throw err; // already finished: a replay posts nothing
      }
    }
    await this.save(spaceId, threadRootId, { ...next, ...(posted ? { deliveredOffset: posted.offset } : {}), turn: undefined });
  }

  private async cancelled(invocation: Invocation, record?: ThreadRecord): Promise<void> {
    await this.report(invocation, { state: 'cancelled' });
    const { spaceId, threadRootId } = invocation.conversation;
    const current = record ?? (await this.record(spaceId, threadRootId));
    await this.save(spaceId, threadRootId, { ...current, turn: undefined });
  }

  // --- recovery -------------------------------------------------------------------------------

  /** A working invocation from before a restart (spec §8): follow its execution, or send it again. */
  private async recover(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    const record = await this.record(spaceId, threadRootId);
    const turn = record.turn?.invocationId === invocation.id ? record.turn : undefined;
    if (!turn) return this.run(invocation); // acknowledged, but nothing was prepared yet
    if (turn.executionId) return this.follow(invocation, record);
    // The submit may or may not have arrived. Its files say: an event file means the turn ran.
    const out = await this.safe(async () => (await this.api()).readFile(this.maritimeAgentId, turn.files.out), undefined);
    if (turn.submitting && out !== undefined) {
      // Submitted, answer lost: follow by the files alone (no execution id to poll).
      await this.report(invocation, { state: 'working', activity: 'Working on Maritime' });
      return this.followFiles(invocation, record);
    }
    const prompt = await requestPrompt(this.env, invocation, record.deliveredOffset);
    await this.submit(invocation, record, prompt);
  }

  /** Without an execution id, a turn ends when its runtime writes a result; give it the execution's own timeout. */
  private async followFiles(invocation: Invocation, record: ThreadRecord): Promise<void> {
    const deadline = Date.now() + EXEC_TIMEOUT_S * 1000;
    while (!this.stopped && Date.now() < deadline) {
      const api = await this.api();
      const out = (await this.safe(() => api.readFile(this.maritimeAgentId, record.turn!.files.out), undefined)) ?? '';
      const last = await this.safe(() => api.readFile(this.maritimeAgentId, record.turn!.files.last), undefined);
      const err = await this.safe(() => api.readFile(this.maritimeAgentId, record.turn!.files.err), undefined);
      const reading = this.runtime.read(out, last, err, undefined);
      if (reading.answer || reading.failure) return this.finish(invocation, record, reading);
      if (this.stops.has(invocation.id)) return this.cancelled(invocation, record);
      await sleep(Math.max(this.timing.pollMs, 2_000), this.stopping.signal);
    }
    if (!this.stopped) await this.fail(invocation, 'The turn left no result on Maritime. Mention me again to retry.');
  }

  // --- what the connector tells Harbor --------------------------------------------------------

  private async declare(): Promise<void> {
    const capabilities: ConnectorCapabilities = { stop: true, options: this.runtime.options };
    const signature = JSON.stringify(capabilities);
    if (signature === this.declared) return;
    this.declared = signature;
    await this.safe(() => this.env.service.declareCapabilities(this.env.ctx, capabilities), undefined);
  }

  private async report(invocation: Invocation, update: InvocationUpdate): Promise<void> {
    await this.safe(() => this.env.service.updateInvocation(this.env.ctx, invocation.id, update), undefined);
  }

  private async fail(invocation: Invocation, error: string): Promise<void> {
    await this.report(invocation, { state: 'failed', error: error.slice(0, 1000) });
    const { spaceId, threadRootId } = invocation.conversation;
    const record = await this.record(spaceId, threadRootId);
    if (record.turn?.invocationId === invocation.id) await this.save(spaceId, threadRootId, { ...record, turn: undefined });
  }

  private async react(invocation: Invocation, emoji: string): Promise<void> {
    await this.safe(
      () => this.env.service.reactToMessage(this.env.ctx, invocation.conversation.spaceId, invocation.trigger.messageId, { emoji, action: 'add', actingMode: 'direct' }),
      undefined,
    );
  }

  /**
   * A call to Maritime for this invocation, retried while Maritime has
   * trouble. Undefined when it failed the invocation: a refused key (the
   * owner is told once), an agent in an error state, or anything else
   * Maritime refused. With `recover`, an agent in an error state is started
   * once before giving up.
   */
  private async withMaritime<T>(invocation: Invocation, call: (api: MaritimeApi) => Promise<T>, opts: { recover?: boolean } = {}): Promise<T | undefined> {
    const giveUpAt = Date.now() + RETRY_FOR_MS;
    let backoff = 1_000;
    let recovered = false;
    for (;;) {
      try {
        return await call(await this.api());
      } catch (err) {
        if (err instanceof HarborError) {
          await this.fail(invocation, err.message); // e.g. no key stored
          return undefined;
        }
        if (this.stopped) return undefined; // shutting down: the invocation stays working, the next start settles it
        const maritime = err instanceof MaritimeError ? err : new MaritimeError(0, undefined, (err as Error).message);
        if (maritime.rejectsKey) {
          await this.keyRejected(invocation, maritime);
          return undefined;
        }
        if (maritime.gone) {
          await this.fail(invocation, `My Maritime agent (${this.maritimeAgentId}) is gone: it was deleted, or this key no longer reaches it. My owner needs to add me again.`);
          return undefined;
        }
        if (maritime.errored && opts.recover && !recovered) {
          recovered = true;
          this.env.log('agent in error state; starting it', { agent: this.maritimeAgentId });
          await this.safe(async () => (await this.api()).start(this.maritimeAgentId), undefined);
        } else if (maritime.errored) {
          await this.fail(invocation, 'Maritime says this agent is in an error state. Its owner needs to start it from Maritime, then mention me again.');
          return undefined;
        } else if (!(maritime.transient || maritime.mustWait) || Date.now() > giveUpAt) {
          await this.fail(invocation, `Maritime: ${maritime.message}`);
          return undefined;
        }
        await sleep(maritime.mustWait ? Math.max(1, Math.min(maritime.retryAfterSeconds ?? 15, 60)) * 1000 : backoff, this.stopping.signal);
        if (this.stopped) return undefined;
        backoff = Math.min(backoff * 2, 30_000);
      }
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

  // --- helpers --------------------------------------------------------------------------------

  private async record(spaceId: string, threadRootId: string): Promise<ThreadRecord> {
    return ((await this.env.thread.get(spaceId, threadRootId)) as ThreadRecord | undefined) ?? {};
  }

  private async save(spaceId: string, threadRootId: string, record: ThreadRecord): Promise<void> {
    await this.env.thread.put(spaceId, threadRootId, record);
  }

  private async offsetOf(spaceId: string, messageId: string): Promise<number | undefined> {
    return this.safe(async () => (await this.env.service.getMessage(this.env.ctx, spaceId, messageId)).offset, undefined);
  }

  private safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    return quietly(this.env, fn, fallback);
  }
}
