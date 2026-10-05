import { createHash } from 'node:crypto';
import type { ConnectorCapabilities, Invocation, InvocationOption, InvocationUpdate, Message, ServerFrame } from '@rowboat/spaces-protocol';
import { HarborError } from '../../errors.js';
import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { attachmentLinks, requestMarker, type Attachment } from '../thread-prompt.js';
import { Agent37Error, type Agent37Api, type HistoryEntry, type TurnEvent, type TurnRequest } from './api.js';
import { buildPrompt } from './prompt.js';

// The Agent37 connector (spec §8 Connectors, 2026-10-01): one per agent whose
// connection is `agent37`, run by Harbor (connectors/host.ts). A client of the
// agent contract in-process, on its agent's own frames and the one-minute list.
//
// An Agent37 instance is a hosted computer running a harness (Hermes or
// OpenClaw here) with its own memory and files, so a Rowboat agent is one
// instance, named when it was added (2026-10-05), and each Rowboat thread is
// one session on it. The
// connector mints the session id from the thread, which Hermes and OpenClaw
// accept on a first turn ("an id it has not seen simply starts a fresh thread
// under that id", https://www.agent37.com/docs/agents-api/chat), so a thread
// finds its session again without having stored it. Each turn is one
// `POST /v1/responses` streamed over SSE; `response.completed` or
// `response.failed` ends it (https://www.agent37.com/docs/agents-api/streaming).
//
// Agent37 has no idempotency key. Nothing is sent twice because: the per-thread
// record marks a send before it is made; the session runs one turn at a time
// and refuses a second with `409 session_busy`; and after a restart the
// connector reattaches to the turn it recorded, or reads the session's history
// for this request's marker, and sends only when neither shows it arrived.
//
// Agent37 runs its harnesses unattended (Hermes in YOLO mode with no clarify
// tool, https://github.com/agent37-platform/gateway), so this connector raises
// no approvals: an agent that needs a person ends its turn with the question,
// and the next mention answers it (https://www.agent37.com/docs/agents-api/chat).
//
// One Harbor instance only, as for Replicas: the ownership lease that lets two
// run is on the list in SPEC.md §4 "Running more than one instance".

const LIST_EVERY_MS = 60_000;
const CAPABILITIES_EVERY_MS = 10 * 60_000;
/** Report working at least this often: Harbor fails a silent turn after 30 minutes. */
const HEARTBEAT_MS = 4 * 60_000;
const ACTIVITY_EVERY_MS = 5_000;
/** How long Agent37 trouble is retried before the invocation fails. */
const RETRY_FOR_MS = 5 * 60_000;
/** The files of the invoking message are written onto the instance up to this size each. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const FILES_DIR = '~/rowboat/files';

/** `reasoning_effort`, per turn on both harnesses (https://www.agent37.com/docs/agents-api/chat). */
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/** The connector's record for one thread (agent_connection_threads.data). */
export interface ThreadRecord {
  instanceId?: string;
  sessionId?: string;
  /** The offset of the newest thread message the session has heard; its context starts after it. */
  deliveredOffset?: number;
  /** The invocation in flight in this session. */
  turn?: {
    invocationId: string;
    triggerMessageId: string;
    /** True from just before the send until Agent37 named the response: a restart in between must check. */
    sending: boolean;
    /** Agent37's response id, from `response.created`. */
    responseId?: string;
  };
}

/** What to do next for a turn. */
type Step =
  | { kind: 'send' }
  /** Follow a response: ours (its answer is the answer), or one we can't tell is ours (wait it out, then check). */
  | { kind: 'follow'; responseId: string; ours: boolean }
  /** Read the session to tell where this request stands. */
  | { kind: 'settle' };

/** A session id from the thread: 32 hex characters, as Agent37's own are (https://www.agent37.com/docs/agents-api/sessions). */
export function sessionFor(agentId: string, spaceId: string, threadRootId: string): string {
  return createHash('sha256').update(`rowboat:${agentId}:${spaceId}:${threadRootId}`).digest('hex').slice(0, 32);
}

export class Agent37Connector implements RunningConnector {
  private readonly running = new Map<string, Promise<void>>();
  /** What this run took on. A working invocation at boot that it did not take on is from before a restart. */
  private readonly takenOn = new Set<string>();
  /** Invocations someone asked to stop; their responses are cancelled as soon as they have an id. */
  private readonly stopping = new Set<string>();
  private readonly aborts = new Set<AbortController>();
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;
  private stopped = false;
  /** Ends every retry wait at once when the connector stops. */
  private readonly shutdown = new AbortController();
  private declared = '';

  constructor(
    private readonly env: ConnectorEnv,
    private readonly api: () => Promise<Agent37Api>,
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
    this.shutdown.abort();
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    for (const abort of this.aborts) abort.abort();
    await Promise.allSettled([...this.running.values()]);
  }

  // --- intake -------------------------------------------------------------------------

  private async boot(): Promise<void> {
    await this.declare();
    // Settle what a previous run acknowledged (spec §8), then pick up what waits.
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'working' && !this.takenOn.has(invocation.id)) {
        if (invocation.stopRequested) this.stopping.add(invocation.id);
        this.track(invocation.id, () => this.recover(invocation));
      } else if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private onFrame(frame: ServerFrame): void {
    if (frame.kind === 'invocation') this.intake(frame.invocation);
    else if (frame.kind === 'invocation_stop') void this.requestStop(frame.invocationId);
  }

  private async list(): Promise<void> {
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private intake(invocation: Invocation): void {
    if (this.stopped || invocation.state !== 'pending' || this.running.has(invocation.id)) return;
    this.takenOn.add(invocation.id);
    this.track(invocation.id, async () => {
      try {
        await this.env.service.acknowledgeInvocation(this.env.ctx, invocation.id);
      } catch {
        return; // cancelled on its way, or someone else took it: drop it
      }
      await this.react(invocation, '👀');
      await this.run(invocation);
    });
  }

  private track(id: string, work: () => Promise<void>): void {
    const done = work()
      .catch((err) => this.env.log('invocation failed unexpectedly', { id, error: (err as Error).message }))
      .finally(() => {
        this.running.delete(id);
        this.stopping.delete(id);
      });
    this.running.set(id, done);
  }

  /** Stop in Rowboat is Agent37's cancel; the turn then ends and is reported cancelled (spec §8 part 2). */
  private async requestStop(invocationId: string): Promise<void> {
    if (!this.running.has(invocationId)) return;
    this.stopping.add(invocationId);
    const invocation = (await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])).find((i) => i.id === invocationId);
    if (!invocation) return;
    const record = await this.record(invocation.conversation.spaceId, invocation.conversation.threadRootId);
    if (record.turn?.invocationId === invocationId && record.turn.responseId && record.instanceId) {
      await this.cancel(record.instanceId, record.turn.responseId);
    }
  }

  private async cancel(instanceId: string, responseId: string): Promise<void> {
    await this.safe(async () => (await this.api()).cancel(instanceId, responseId), undefined);
  }

  // --- one invocation --------------------------------------------------------------------

  private async run(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    let record = await this.record(spaceId, threadRootId);
    const instanceId = this.env.agent.agentInstance;
    if (!instanceId) return this.fail(invocation, 'This Agent37 agent has no instance. Its owner needs to add it again with one.');
    // The agent is its instance (2026-10-05): every thread runs there, in a session of its own.
    if (record.instanceId !== instanceId) record = { ...record, instanceId, sessionId: sessionFor(this.env.agent.id, spaceId, threadRootId) };
    record = { ...record, turn: { invocationId: invocation.id, triggerMessageId: invocation.trigger.messageId, sending: false } };
    await this.save(spaceId, threadRootId, record);
    await this.drive(invocation, record, { kind: 'send' });
  }

  /**
   * Run one turn to its end: send it, follow its stream, reconnect, and after
   * a restart work out from the session whether it arrived. Each step leads to
   * the next until the turn is answered, failed, or cancelled.
   */
  private async drive(invocation: Invocation, record: ThreadRecord, first: Step): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    const instanceId = record.instanceId!;
    const sessionId = record.sessionId!;
    const kind = this.env.agent.agentKind ?? 'hermes';
    let step = first;
    let request: TurnRequest | undefined;
    let giveUpAt = Date.now() + RETRY_FOR_MS;
    let backoff = 1_000;
    let trouble = '';
    let lastActivity = '';
    let lastActivityAt = 0;
    let lastReport = Date.now();

    await this.report(invocation, { state: 'working', activity: 'Working in Agent37' });
    const heartbeat = setInterval(() => {
      if (Date.now() - lastReport < HEARTBEAT_MS) return;
      lastReport = Date.now();
      void this.report(invocation, { state: 'working', activity: lastActivity || 'Working in Agent37' });
    }, 30_000);
    try {
      while (!this.stopped) {
        const abort = new AbortController();
        this.aborts.add(abort);
        try {
          const api = await this.api();
          if (step.kind === 'settle') {
            const next = await this.settle(invocation, record, api, kind);
            if (!next) return; // answered or failed
            step = next;
            giveUpAt = Date.now() + RETRY_FOR_MS;
            continue;
          }

          let events: AsyncGenerator<TurnEvent>;
          const following = step.kind === 'follow' ? step : undefined;
          if (following) {
            events = api.reattach(instanceId, following.responseId, abort.signal);
          } else {
            request ??= await this.request(invocation, record, api, kind);
            record = { ...record, turn: { ...record.turn!, sending: true } };
            await this.save(spaceId, threadRootId, record);
            events = api.respond(instanceId, request, abort.signal);
          }

          let text = '';
          for await (const { event, data } of events) {
            giveUpAt = Date.now() + RETRY_FOR_MS;
            backoff = 1_000;
            if (event === 'response.created') {
              text = ''; // a replay starts over
              const responseId = typeof data.id === 'string' ? data.id : undefined;
              if (!following && responseId) {
                record = {
                  ...record,
                  deliveredOffset: (await this.offsetOf(spaceId, invocation.trigger.messageId)) ?? record.deliveredOffset,
                  turn: { ...record.turn!, sending: false, responseId },
                };
                await this.save(spaceId, threadRootId, record);
                step = { kind: 'follow', responseId, ours: true };
              }
              if (responseId && this.stopping.has(invocation.id) && (following?.ours ?? true)) await this.cancel(instanceId, responseId);
            } else if (following && !following.ours) {
              if (event === 'response.completed' || event === 'response.failed') break; // not ours, or not known to be: check the session
            } else if (event === 'response.output_text.delta') {
              if (typeof data.text === 'string') text += data.text;
            } else if (event === 'response.tool_call.started' || event === 'response.tool_call.generating') {
              const activity = toolActivity(data);
              if (activity && activity !== lastActivity && Date.now() - lastActivityAt >= ACTIVITY_EVERY_MS) {
                lastActivity = activity;
                lastActivityAt = lastReport = Date.now();
                await this.report(invocation, { state: 'working', activity });
              }
            } else if (event === 'response.completed') {
              const answer = typeof data.output_text === 'string' ? data.output_text : text;
              return await this.finish(invocation, record, answer);
            } else if (event === 'response.failed') {
              return await this.fail(invocation, `Agent37: ${errorText(data.error)}`);
            }
          }
          if (this.stopped) return;
          // The stream ended without its end: reattach to the response, or, if it never had an id, ask the session.
          if (step.kind === 'send' || (step.kind === 'follow' && !step.ours)) step = { kind: 'settle' };
        } catch (err) {
          if (this.stopped) return; // not a failure: the invocation stays working, and the next start settles it (spec §8)
          if (err instanceof HarborError) return await this.fail(invocation, err.message); // e.g. no key stored
          const a37 = err instanceof Agent37Error ? err : new Agent37Error(0, undefined, (err as Error).message);
          if (a37.rejectsKey) return await this.keyRejected(invocation, a37);
          if (a37.gone) return await this.fail(invocation, `My Agent37 instance (${instanceId}) is gone: it was deleted, or this key no longer reaches it. My owner needs to add me again with another instance.`);
          if (a37.busy && step.kind === 'send') {
            // Refused, so not sent: another turn holds the session (one that outlived its invocation). Wait it out.
            step = a37.responseId ? { kind: 'follow', responseId: a37.responseId, ours: false } : { kind: 'settle' };
            continue;
          }
          if (a37.responseGone) {
            step = { kind: 'settle' };
            continue;
          }
          if (step.kind === 'send' && a37.status === 0) {
            step = { kind: 'settle' }; // the send may have arrived: ask the session before sending again
          } else if (!a37.transient) {
            return await this.fail(invocation, `Agent37: ${a37.message}`);
          }
          trouble = a37.message;
          this.env.log('Agent37 trouble; retrying', { error: a37.message });
        } finally {
          this.aborts.delete(abort);
        }
        if (Date.now() > giveUpAt) {
          return await this.fail(invocation, `Lost touch with Agent37 for several minutes${trouble ? ` (${trouble})` : ''}. Mention me again to pick it back up.`);
        }
        await sleep(backoff, this.shutdown.signal);
        backoff = Math.min(backoff * 2, 30_000);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Where this request stands, from the session itself: a turn running on it
   * is followed (as ours only when its id is the one recorded); otherwise the
   * history shows this request's marker, and its answer, or it never arrived.
   * Returns the next step, or undefined once the invocation is finished.
   */
  private async settle(invocation: Invocation, record: ThreadRecord, api: Agent37Api, kind: string): Promise<Step | undefined> {
    const session = await api.session(record.instanceId!, record.sessionId!, kind);
    const turn = record.turn;
    if (session.activeResponseId) return { kind: 'follow', responseId: session.activeResponseId, ours: session.activeResponseId === turn?.responseId };
    const found = turnInHistory(session.history, requestMarker(invocation.trigger.messageId));
    if (found) {
      if (found.answer === undefined) await this.fail(invocation, 'Agent37 ended this turn without an answer.');
      else await this.finish(invocation, record, found.answer);
      return undefined;
    }
    if (turn?.responseId) {
      // Agent37 took it (it named the response) yet kept nothing of it: sending it again could do its work twice.
      await this.fail(invocation, 'Agent37 lost track of this turn. Mention me again to retry it.');
      return undefined;
    }
    return { kind: 'send' }; // confirmed never delivered
  }

  /** The turn to send: the prompt, the invoking message's files written onto the instance, and the picked options. */
  private async request(invocation: Invocation, record: ThreadRecord, api: Agent37Api, kind: string): Promise<TurnRequest> {
    const files: string[] = [];
    for (const file of await this.fileBytes(invocation)) {
      files.push(await api.writeFile(record.instanceId!, `${FILES_DIR}/${file.hash.slice(0, 12)}-${safeName(file.name)}`, file.bytes, file.mime));
    }
    const effort = invocation.options?.reasoning;
    return {
      input: await this.prompt(invocation, record),
      sessionId: record.sessionId!,
      agent: kind,
      files,
      ...(typeof effort === 'string' && EFFORTS.includes(effort) ? { reasoningEffort: effort } : {}),
      metadata: { rowboat_invocation: invocation.id, rowboat_message: invocation.trigger.messageId },
    };
  }

  private async finish(invocation: Invocation, record: ThreadRecord, answer: string): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    let posted: Message | undefined;
    if (this.stopping.has(invocation.id)) {
      await this.report(invocation, { state: 'cancelled' });
    } else {
      const body = answer.trim() || 'Finished in Agent37, with nothing to report.';
      try {
        posted = (await this.env.service.answerInvocation(this.env.ctx, invocation.id, body)).message;
      } catch (err) {
        if (!(err instanceof HarborError)) throw err; // already finished: a replay posts nothing
      }
    }
    await this.save(spaceId, threadRootId, { ...record, ...(posted ? { deliveredOffset: posted.offset } : {}), turn: undefined });
  }

  // --- recovery -------------------------------------------------------------------------------

  /** A working invocation from before a restart (spec §8): carry on with it, or send it only if it never arrived. */
  private async recover(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    const record = await this.record(spaceId, threadRootId);
    const turn = record.turn?.invocationId === invocation.id ? record.turn : undefined;
    if (!turn || !record.instanceId) return this.run(invocation); // acknowledged, but nothing was sent yet
    if (turn.responseId) return this.drive(invocation, record, { kind: 'follow', responseId: turn.responseId, ours: true });
    if (!turn.sending) return this.drive(invocation, record, { kind: 'send' });
    return this.drive(invocation, record, { kind: 'settle' });
  }

  // --- what the connector tells Harbor --------------------------------------------------------

  /**
   * Stop, and how hard to think. The instance is the agent's own, so it is no
   * option (2026-10-05). No Model option (2026-10-01): models are listed per instance on
   * its own URL, and asking would wake a sleeping instance every few minutes,
   * keeping it from ever sleeping. The instance's own default model applies.
   */
  private async declare(): Promise<void> {
    const options: InvocationOption[] = [];
    options.push({ type: 'select', key: 'reasoning', label: 'Reasoning', choices: EFFORTS.map((e) => ({ id: e, label: e === 'xhigh' ? 'Extra high' : e[0]!.toUpperCase() + e.slice(1) })) });
    const capabilities: ConnectorCapabilities = { stop: true, options };
    const signature = JSON.stringify(capabilities);
    if (signature === this.declared) return;
    this.declared = signature;
    await this.safe(() => this.env.service.declareCapabilities(this.env.ctx, capabilities), undefined);
  }

  private async report(invocation: Invocation, update: InvocationUpdate): Promise<void> {
    await this.safe(() => this.env.service.updateInvocation(this.env.ctx, invocation.id, update), undefined);
  }

  private async fail(invocation: Invocation, error: string): Promise<void> {
    await this.report(invocation, this.stopping.has(invocation.id) ? { state: 'cancelled' } : { state: 'failed', error: error.slice(0, 1000) });
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

  /** A call to Agent37's hosting API for this invocation, retried while Agent37 has trouble. Undefined when it failed the invocation. */
  private async withAgent37<T>(invocation: Invocation, call: (api: Agent37Api) => Promise<T>): Promise<T | undefined> {
    const giveUpAt = Date.now() + RETRY_FOR_MS;
    let backoff = 1_000;
    for (;;) {
      try {
        return await call(await this.api());
      } catch (err) {
        if (err instanceof HarborError) {
          await this.fail(invocation, err.message);
          return undefined;
        }
        if (this.stopped) return undefined;
        const a37 = err instanceof Agent37Error ? err : new Agent37Error(0, undefined, (err as Error).message);
        if (a37.rejectsKey) {
          await this.keyRejected(invocation, a37);
          return undefined;
        }
        if (!a37.transient || Date.now() > giveUpAt) {
          await this.fail(invocation, `Agent37: ${a37.message}`);
          return undefined;
        }
        await sleep(backoff, this.shutdown.signal);
        if (this.stopped) return undefined;
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  /** 401/402/403 ip_not_allowed: fail fast with the reason, and tell the owner once, in their DM with the agent. */
  private async keyRejected(invocation: Invocation, err: Agent37Error): Promise<void> {
    const reason =
      err.status === 402
        ? 'The Agent37 workspace is out of balance, or this instance is suspended for non-payment.'
        : err.code === 'ip_not_allowed'
          ? 'Agent37 refused this agent’s API key from Rowboat’s address (the key has an IP allowlist).'
          : 'Agent37 rejected this agent’s API key.';
    await this.fail(invocation, `${reason} Its owner needs to fix this in Agents.`);
    const first = await this.safe(() => this.env.rejectCredential(`${reason} (${err.message})`), false);
    const ownerId = this.env.agent.ownerId;
    if (!first || !ownerId) return;
    await this.safe(async () => {
      const { space } = await this.env.service.openDirect(this.env.ctx, ownerId);
      await this.env.service.postMessage(this.env.ctx, space.id, {
        body: `${reason} Until it is fixed and the key replaced in Agents, I can't take on work. (${err.message})`,
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

  /** The prompt for this invocation: the request, the thread since the session last heard it, earlier files. */
  private async prompt(invocation: Invocation, record: ThreadRecord): Promise<string> {
    const { spaceId, threadRootId } = invocation.conversation;
    const names = new Map((await this.safe(() => this.env.service.listOrgMembers(this.env.ctx), [])).map((m) => [m.id, m.displayName]));
    const trigger = await this.safe(() => this.env.service.getMessage(this.env.ctx, spaceId, invocation.trigger.messageId), undefined);
    const after = record.deliveredOffset ?? 0;
    const context: Message[] = [];
    if (trigger && trigger.id !== threadRootId) {
      const page = await this.safe(() => this.env.service.listThread(this.env.ctx, spaceId, threadRootId, { afterOffset: after, limit: 100 }), undefined);
      if (page) {
        const earlier = [page.root, ...page.messages].filter(
          (m) => m.offset > after && m.offset < trigger.offset && m.author.memberId !== this.env.agent.id && !m.deletedAt,
        );
        context.push(...earlier.slice(-50));
      }
    }
    const earlierAttachments = (await Promise.all(context.map((m) => this.attachments(spaceId, m.body)))).flat();
    return buildPrompt({
      invocation,
      agentId: this.env.agent.id,
      context,
      names,
      orgAddress: this.env.service.org.address,
      orgUrl: this.env.orgUrl,
      earlierAttachments,
    });
  }

  private async attachments(spaceId: string, body: string): Promise<Attachment[]> {
    const found: Attachment[] = [];
    for (const { hash, name } of attachmentLinks(body, spaceId)) {
      const blob = await this.safe(async () => (await this.env.service.downloadBlob(this.env.ctx, spaceId, hash, name)).blob, undefined);
      if (blob) found.push({ name, mime: blob.mime, size: blob.size, hash });
    }
    return found;
  }

  /** The invoking message's files, as bytes for the instance's disk (images included: the harness reads them from there). */
  private async fileBytes(invocation: Invocation): Promise<Array<Attachment & { bytes: Uint8Array }>> {
    const { spaceId } = invocation.conversation;
    const files: Array<Attachment & { bytes: Uint8Array }> = [];
    for (const { hash, name } of attachmentLinks(invocation.trigger.body, spaceId)) {
      const got = await this.safe(() => this.env.service.downloadBlob(this.env.ctx, spaceId, hash, name, { expiresInSeconds: 600 }), undefined);
      if (!got || got.blob.size > MAX_FILE_BYTES) continue;
      const bytes = got.bytes ?? (got.url ? await this.safe(async () => new Uint8Array(await (await fetch(got.url!)).arrayBuffer()), undefined) : undefined);
      if (bytes) files.push({ name, mime: got.blob.mime, size: got.blob.size, hash, bytes });
    }
    return files;
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

/**
 * This request in a session's transcript: the last user message carrying its
 * marker, and the agent's last words after it (before anyone spoke again).
 * Undefined when the request is not there; `answer` undefined when the agent
 * said nothing after it.
 */
export function turnInHistory(history: HistoryEntry[], marker: string): { answer: string | undefined } | undefined {
  let at = -1;
  history.forEach((entry, i) => {
    if (entry.role === 'user' && entry.content.includes(marker)) at = i;
  });
  if (at < 0) return undefined;
  let answer: string | undefined;
  for (const entry of history.slice(at + 1)) {
    if (entry.role === 'user') break;
    if (entry.role === 'assistant' && entry.content.trim()) answer = entry.content;
  }
  return { answer };
}

/** One activity line for a tool call: the harness's own summary, or the tool's name. */
export function toolActivity(data: Record<string, unknown>): string | undefined {
  const label = typeof data.label === 'string' ? data.label.replace(/\s+/g, ' ').trim() : '';
  const tool = typeof data.tool === 'string' ? data.tool : '';
  const line = label || (tool ? `Using ${tool}` : '');
  return line ? (line.length > 200 ? `${line.slice(0, 199)}…` : line) : undefined;
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 100) || 'file';
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return [code, message].filter((v) => typeof v === 'string' && v).join(': ') || 'the turn failed';
  }
  return typeof error === 'string' ? error : 'the turn failed';
}

/** Wait, or stop waiting as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });
}
