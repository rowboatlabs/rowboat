import type { Invocation, ServerFrame } from '@rowboat/spaces-protocol';
import { HarborClient, HarborLive, HarborRequestError } from './harbor.js';
import { clip, errorText, type Logger } from './log.js';
import { continuation, requestPrompt, steerText } from './prompt.js';
import { TurnOverError, type Runtime, type TurnHandle } from './runtime.js';
import { ThreadState } from './state.js';

// The worker (plans/agent-worker-v1.md in Main, 2026-11-05): the connector
// for one agent, running beside its harness, on the agent's own key. It is
// told live when the agent is invoked and lists every minute (the frame is the
// fast path, the list the guarantee), acknowledges, runs each conversation's
// turns one after another through the runtime, reports what the harness is
// doing, posts the answer, and reports done. A message Harbor marks as
// steering a running turn is folded into it; Stop interrupts it; what a
// previous run of the worker acknowledged and never finished is resumed on
// the harness's session, or failed with a sentence when it can't be.

const SWEEP_MS = 60_000;
/** Harbor fails a working turn silent for 30 minutes: say something at least this often. */
const HEARTBEAT_MS = 5 * 60_000;
/** Activity lines no faster than this; the latest always lands. */
const ACTIVITY_MIN_MS = 5_000;
const IDLE_CHECK_MS = 15_000;
const MAX_BODY = 65_536;
const MAX_ACTIVITY = 200;

export interface WorkerOptions {
  baseUrl: string;
  key: string;
  /** The org's address links are minted on: the host of `baseUrl` unless the org says otherwise. */
  orgAddress?: string;
  cwd: string;
  runtime: Runtime;
  state: ThreadState;
  log: Logger;
  /** Exit when nothing has run for this long (a Maritime box that should sleep); unset runs until stopped. */
  idleMs?: number;
  onIdle?: () => void;
  sweepMs?: number;
  heartbeatMs?: number;
  activityMinMs?: number;
  idleCheckMs?: number;
  live?: { staleAfterMs?: number; watchdogMs?: number };
}

interface RunningTurn {
  invocation: Invocation;
  /** Steers folded into this turn, finished with it. */
  folded: Invocation[];
  handle?: TurnHandle;
  stopRequested: boolean;
  activity: string;
  lastReport: number;
  trailing?: ReturnType<typeof setTimeout>;
}

export class Worker {
  readonly harbor: HarborClient;
  private readonly live: HarborLive;
  private readonly running = new Map<string, RunningTurn>();
  private readonly byConversation = new Map<string, RunningTurn>();
  private readonly queues = new Map<string, Promise<void>>();
  /** Invocations this run has taken, so a frame and a listing never start one twice. */
  private readonly taken = new Set<string>();
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];
  private lastBusy = Date.now();
  private stopped = false;
  agentId = '';
  private readonly orgAddress: string;

  constructor(private readonly opts: WorkerOptions) {
    this.harbor = new HarborClient(opts.baseUrl, opts.key);
    this.orgAddress = opts.orgAddress ?? new URL(opts.baseUrl).host;
    this.live = new HarborLive({
      baseUrl: opts.baseUrl,
      key: opts.key,
      log: opts.log,
      onFrame: (frame) => this.onFrame(frame),
      onOpen: () => {
        opts.log('connected to Harbor');
        void this.sweep();
      },
      onClose: () => opts.log('disconnected from Harbor; reconnecting'),
      ...opts.live,
    });
  }

  /** Check the key, connect, declare what the agent can do, and pick up what waits. */
  async start(): Promise<void> {
    const me = await this.harbor.me();
    this.agentId = me.id;
    this.opts.log(`running as ${me.displayName} (${me.id})`);
    await this.harbor.declareCapabilities({ stop: true, steer: this.opts.runtime.capabilities.steer, options: [] });
    this.live.start();
    void this.opts.runtime
      .start()
      .then(() => this.declareOptions())
      .catch((err) => this.opts.log('the harness did not start; the first turn will try again', { error: errorText(err) }));
    await this.sweep();
    this.timers.push(setInterval(() => void this.sweep(), this.opts.sweepMs ?? SWEEP_MS));
    this.timers.push(setInterval(() => this.checkIdle(), this.opts.idleCheckMs ?? IDLE_CHECK_MS));
    for (const t of this.timers) t.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.live.close();
    for (const turn of this.running.values()) {
      if (turn.trailing) clearTimeout(turn.trailing);
      await turn.handle?.interrupt().catch(() => {});
    }
    await this.opts.runtime.stop();
  }

  /** The composer's options, once the harness has listed its models; Stop and steer were declared first. */
  private async declareOptions(): Promise<void> {
    const models = await this.opts.runtime.models().catch((err) => {
      this.opts.log('the harness did not list its models', { error: errorText(err) });
      return [];
    });
    if (this.stopped) return;
    const options = [
      ...(models.length > 1 ? [{ type: 'select' as const, key: 'model', label: 'Model', choices: models.slice(0, 100) }] : []),
      { type: 'select' as const, key: 'effort', label: 'Effort', choices: this.opts.runtime.efforts() },
    ];
    await this.harbor.declareCapabilities({ stop: true, steer: this.opts.runtime.capabilities.steer, options }).catch((err) => this.fatal(err));
  }

  private onFrame(frame: ServerFrame): void {
    if (frame.kind === 'invocation') void this.take(frame.invocation);
    else if (frame.kind === 'invocation_stop') this.stopTurn(frame.invocationId);
  }

  /** The listing: what the frame missed, and what a previous run of the worker left working. */
  private async sweep(): Promise<void> {
    if (this.stopped) return;
    let listing: Awaited<ReturnType<HarborClient['listAgentInvocations']>>;
    try {
      listing = await this.harbor.listAgentInvocations();
    } catch (err) {
      this.fatal(err);
      return;
    }
    for (const invocation of listing.invocations) {
      if (invocation.state === 'pending') void this.take(invocation);
      else if ((invocation.state === 'working' || invocation.state === 'waiting') && !this.running.has(invocation.id) && !this.folded(invocation.id)) {
        void this.recover(invocation);
      }
    }
  }

  private folded(invocationId: string): boolean {
    for (const turn of this.running.values()) if (turn.folded.some((i) => i.id === invocationId)) return true;
    return false;
  }

  /** A refused key means the agent was set up elsewhere, or its key was revoked: nothing more to do here. */
  private fatal(err: unknown): void {
    if (err instanceof HarborRequestError && err.status === 401) {
      this.opts.log('this key no longer works: the agent was set up elsewhere, or the key was revoked; stopping');
      void this.stop();
      return;
    }
    this.opts.log('Harbor call failed', { error: errorText(err) });
  }

  private async take(invocation: Invocation): Promise<void> {
    if (this.stopped || invocation.state !== 'pending' || this.taken.has(invocation.id)) return;
    this.taken.add(invocation.id);
    this.lastBusy = Date.now();
    if (invocation.answers) {
      // This worker's harness waits on no one (approvals are declined): an answer is taken and done.
      await this.harbor.acknowledge(invocation.id).catch(() => {});
      await this.harbor.update(invocation.id, { state: 'done' }).catch(() => {});
      return;
    }
    if (invocation.steers) {
      await this.steer(invocation);
      return;
    }
    this.enqueue(invocation, false);
  }

  /** What a worker that is gone had acknowledged: carried on where the harness's session allows, failed where it does not. */
  private async recover(invocation: Invocation): Promise<void> {
    if (this.taken.has(invocation.id)) return;
    this.taken.add(invocation.id);
    const { spaceId, threadRootId } = invocation.conversation;
    if (invocation.stopRequested) {
      await this.harbor.update(invocation.id, { state: 'cancelled' }).catch(() => {});
      return;
    }
    if (this.opts.state.get(spaceId, threadRootId)?.session) {
      this.opts.log('resuming a turn a previous run left working', { invocation: invocation.id });
      this.enqueue(invocation, true);
      return;
    }
    await this.harbor
      .update(invocation.id, { state: 'failed', error: 'The worker running me restarted before finishing this, and the session was lost. Mention me again to retry.' })
      .catch(() => {});
  }

  /** One turn at a time per conversation, in the order they came; different conversations run side by side. */
  private enqueue(invocation: Invocation, resumed: boolean): void {
    const key = ThreadState.key(invocation.conversation.spaceId, invocation.conversation.threadRootId);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(() => this.runTurn(invocation, resumed)).catch((err) => this.opts.log('turn failed unexpectedly', { error: errorText(err) }));
    this.queues.set(key, next);
    void next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
  }

  private async runTurn(invocation: Invocation, resumed: boolean): Promise<void> {
    if (this.stopped) return;
    const { spaceId, threadRootId } = invocation.conversation;
    const key = ThreadState.key(spaceId, threadRootId);
    const turn: RunningTurn = { invocation, folded: [], stopRequested: Boolean(invocation.stopRequested), activity: 'Reading the thread', lastReport: 0 };
    this.running.set(invocation.id, turn);
    this.byConversation.set(key, turn);
    const heartbeat = setInterval(() => void this.report(turn, true), this.opts.heartbeatMs ?? HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      try {
        await this.harbor.acknowledge(invocation.id);
      } catch (err) {
        // Cancelled while it waited: dropped, as the contract says.
        if (err instanceof HarborRequestError && err.status === 400) return;
        throw err;
      }
      await this.report(turn, true);
      const record = this.opts.state.get(spaceId, threadRootId);
      const built = await requestPrompt(this.harbor, {
        invocation,
        agentId: this.agentId,
        orgAddress: this.orgAddress,
        orgUrl: this.opts.baseUrl,
        deliveredOffset: record?.deliveredOffset,
        log: this.opts.log,
      });
      if (turn.stopRequested) return await this.finish(turn, { state: 'cancelled' });
      turn.activity = `Starting ${this.opts.runtime.label}`;
      await this.report(turn, true);
      const { sessionId } = await this.opts.runtime.openSession({ sessionId: record?.session, cwd: this.opts.cwd });
      this.opts.state.put(spaceId, threadRootId, { session: sessionId });
      const picked = (k: string) => (typeof invocation.options?.[k] === 'string' ? (invocation.options[k] as string) : undefined);
      const model = picked('model');
      const effort = picked('effort');
      const handle = await this.opts.runtime.turn({
        sessionId,
        prompt: resumed ? continuation(built.prompt) : built.prompt,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        onEvent: (event) => {
          if (event.type === 'activity' && event.activity !== turn.activity) {
            turn.activity = event.activity;
            void this.report(turn, false);
          }
        },
      });
      turn.handle = handle;
      if (built.triggerOffset !== undefined) this.opts.state.put(spaceId, threadRootId, { deliveredOffset: built.triggerOffset });
      if (turn.stopRequested) await handle.interrupt();
      const result = await handle.done;
      if (turn.stopRequested || result.status === 'interrupted') return await this.finish(turn, { state: 'cancelled' });
      if (result.status === 'failed') return await this.finish(turn, { state: 'failed', error: clip(result.error ?? `${this.opts.runtime.label} stopped with an error`, 1000) });
      const body = result.answer?.trim() || `${this.opts.runtime.label} finished without saying anything.`;
      const posted = await this.harbor.postMessage(spaceId, { threadRoot: threadRootId, body: clip(body, MAX_BODY), actingMode: 'direct' });
      this.opts.state.put(spaceId, threadRootId, { deliveredOffset: posted.offset });
      await this.finish(turn, { state: 'done' });
    } catch (err) {
      this.fatal(err);
      await this.finish(turn, { state: 'failed', error: clip(errorText(err), 1000) }).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      if (turn.trailing) clearTimeout(turn.trailing);
      this.running.delete(invocation.id);
      if (this.byConversation.get(key) === turn) this.byConversation.delete(key);
      this.lastBusy = Date.now();
    }
  }

  /** The turn's end state, reported on it and on every steer folded into it. */
  private async finish(turn: RunningTurn, update: { state: 'done' } | { state: 'cancelled' } | { state: 'failed'; error: string }): Promise<void> {
    for (const invocation of [turn.invocation, ...turn.folded]) {
      await this.harbor.update(invocation.id, update).catch((err) => this.opts.log('report failed', { invocation: invocation.id, error: errorText(err) }));
    }
  }

  private async report(turn: RunningTurn, force: boolean): Promise<void> {
    const minMs = this.opts.activityMinMs ?? ACTIVITY_MIN_MS;
    const wait = minMs - (Date.now() - turn.lastReport);
    if (!force && wait > 0) {
      turn.trailing ??= setTimeout(() => {
        turn.trailing = undefined;
        void this.report(turn, true);
      }, wait);
      return;
    }
    if (turn.trailing) clearTimeout(turn.trailing);
    turn.trailing = undefined;
    turn.lastReport = Date.now();
    if (turn.stopRequested && turn.handle) return;
    const activity = clip(turn.activity, MAX_ACTIVITY);
    for (const invocation of [turn.invocation, ...turn.folded]) {
      await this.harbor.update(invocation.id, { state: 'working', activity }).catch(() => {});
    }
  }

  /**
   * A message Harbor folded into the running turn: handed to the harness
   * mid-turn and finished with the turn. When the turn ended first (the
   * harness refuses the steer), it runs as a turn of its own, so nothing is
   * lost or answered twice.
   */
  private async steer(invocation: Invocation): Promise<void> {
    const key = ThreadState.key(invocation.conversation.spaceId, invocation.conversation.threadRootId);
    const turn = this.byConversation.get(key);
    try {
      await this.harbor.acknowledge(invocation.id);
    } catch (err) {
      if (err instanceof HarborRequestError && err.status === 400) return;
      this.fatal(err);
      return;
    }
    if (turn?.handle && !turn.stopRequested && turn.invocation.id === invocation.steers) {
      try {
        const names = new Map((await this.harbor.roster().catch(() => [])).map((m) => [m.id, m.displayName] as const));
        await turn.handle.steer(steerText(invocation, names));
        turn.folded.push(invocation);
        await this.harbor.update(invocation.id, { state: 'working', activity: clip(turn.activity, MAX_ACTIVITY) }).catch(() => {});
        this.opts.log('folded a message into the running turn', { invocation: invocation.id, turn: turn.invocation.id });
        return;
      } catch (err) {
        if (!(err instanceof TurnOverError)) {
          this.opts.log('steer failed; running it as its own turn', { error: errorText(err) });
        }
      }
    }
    this.enqueue({ ...invocation, state: 'working' }, false);
  }

  /** Stop: the harness is interrupted, and the turn reports cancelled when it ends. */
  private stopTurn(invocationId: string): void {
    const turn = this.running.get(invocationId);
    if (!turn) return;
    turn.stopRequested = true;
    void turn.handle?.interrupt();
  }

  private checkIdle(): void {
    if (!this.opts.idleMs || this.stopped || this.running.size > 0) return;
    if (Date.now() - this.lastBusy < this.opts.idleMs) return;
    this.opts.log('idle; stopping');
    void this.stop().then(() => this.opts.onIdle?.());
  }
}
