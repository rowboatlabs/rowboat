import type { ConnectorCapabilities, Invocation, InvocationOption, InvocationUpdate, Message, ServerFrame } from '@rowboat/spaces-protocol';
import { HarborError } from '../../errors.js';
import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { attachmentLinks, requestMarker, type Attachment } from '../thread-prompt.js';
import { CapyError, type CapyApi, type CapyMessage, type CapyProject } from './api.js';
import { buildPrompt } from './prompt.js';

// The Capy connector (spec §8 Connectors, 2026-10-02): one per agent whose
// connection is `capy`, run by Harbor (connectors/host.ts). A client of the
// agent contract in-process, on its agent's own frames and the one-minute list.
//
// Capy is a hosted coding agent: one Rowboat thread is one Capy thread, in one
// Capy project. The first mention creates the thread; later ones send into it.
// Both calls are idempotent on keys the connector derives from the mention
// (`requestId` on create, `clientKey` on send, https://docs.capy.ai/api-reference/quickstart),
// so after a restart the connector simply sends again: Capy returns the same
// thread, or reports the message `deduped`. Nothing is ever sent twice.
//
// A turn is followed on the thread's stream with `until=run`, which closes once
// the run in progress ends (when Capy refuses the stream, the connector polls
// the thread instead); the thread's status and transcript then say where
// the request stands, and the answer is Capy's last reply after it (PR links
// arrive in that text). Capy runs unattended (no approvals); a thread that needs
// a person ends its run with the question, and the next mention answers it.
//
// One Harbor instance only, as for Replicas: the ownership lease that lets two
// run is on the list in SPEC.md §4 "Running more than one instance".

const LIST_EVERY_MS = 60_000;
const CAPABILITIES_EVERY_MS = 10 * 60_000;
/** Report working at least this often: Harbor fails a silent turn after 30 minutes. */
const HEARTBEAT_MS = 4 * 60_000;
const ACTIVITY_EVERY_MS = 5_000;
/** How long Capy trouble is retried before the invocation fails. */
const RETRY_FOR_MS = 5 * 60_000;

export interface FollowTiming {
  /** Between checks when the stream closes at once (Capy is not working yet, or waits on something external). */
  tickMs: number;
  /** How long an idle thread may show no reply to this request before the connector stops waiting for one. */
  graceMs: number;
  /** After the stream refuses, how long the connector polls before trying the stream again. */
  streamRetryMs: number;
}
const DEFAULT_TIMING: FollowTiming = { tickMs: 5_000, graceMs: 2 * 60_000, streamRetryMs: 60_000 };

/**
 * Statuses that mean the run is over. The OpenAPI's set (`idle`, `failed`,
 * `archived`) and the quickstart's (`pending_user`, `ready_for_review`,
 * `error`) are both read; anything else (`working`, `active`, `waiting`) is still going.
 */
const AT_REST = new Set(['idle', 'failed', 'archived', 'pending_user', 'ready_for_review', 'error']);
const FAILED = new Set(['failed', 'error']);

/** The connector's record for one thread (agent_connection_threads.data). */
export interface ThreadRecord {
  projectId?: string;
  capyThreadId?: string;
  /** The mention whose message created the Capy thread: sending it again would repeat it (a create takes no client key). */
  createdFor?: string;
  /** The offset of the newest thread message Capy has heard; its context starts after it. */
  deliveredOffset?: number;
  /** The invocation in flight. */
  turn?: { invocationId: string; triggerMessageId: string };
}

/** The key a thread is created with: the mention that started it, so a retry returns the same thread. */
export function requestIdFor(agentId: string, triggerMessageId: string): string {
  return `rowboat-${agentId}-${triggerMessageId}`;
}

export class CapyConnector implements RunningConnector {
  private readonly running = new Map<string, Promise<void>>();
  /** What this run took on. A working invocation at boot that it did not take on is from before a restart. */
  private readonly takenOn = new Set<string>();
  /** Invocations someone asked to stop. */
  private readonly stopping = new Set<string>();
  private readonly aborts = new Set<AbortController>();
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;
  private stopped = false;
  /** Ends every wait at once when the connector stops. */
  private readonly shutdown = new AbortController();
  private declared = '';

  constructor(
    private readonly env: ConnectorEnv,
    private readonly api: () => Promise<CapyApi>,
    private readonly timing: FollowTiming = DEFAULT_TIMING,
  ) {}

  start(): this {
    this.unsubscribe = this.env.subscribe((frame) => this.onFrame(frame));
    void this.boot();
    this.timers.push(setInterval(() => void this.list(), LIST_EVERY_MS));
    this.timers.push(setInterval(() => void this.declare(), CAPABILITIES_EVERY_MS));
    return this;
  }

  async refresh(): Promise<void> {
    await this.declare();
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
    // A working invocation from before a restart is sent again: Capy deduplicates it (spec §8).
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'working' && !this.takenOn.has(invocation.id)) {
        if (invocation.stopRequested) this.stopping.add(invocation.id);
        this.track(invocation.id, () => this.run(invocation));
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

  /** Stop in Rowboat is Capy's interrupt; the run then ends and is reported cancelled (spec §8 part 2). */
  private async requestStop(invocationId: string): Promise<void> {
    if (!this.running.has(invocationId)) return;
    this.stopping.add(invocationId);
    const invocation = (await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])).find((i) => i.id === invocationId);
    if (!invocation) return;
    const record = await this.record(invocation.conversation.spaceId, invocation.conversation.threadRootId);
    if (record.turn?.invocationId === invocationId && record.capyThreadId) {
      await this.safe(async () => (await this.api()).interrupt(record.capyThreadId!), undefined);
    }
  }

  // --- one invocation --------------------------------------------------------------------

  /** Send the request (again, after a restart: Capy deduplicates it), then follow it to its answer. */
  private async run(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    let record = await this.record(spaceId, threadRootId);
    if (!record.capyThreadId && !record.projectId) {
      const projectId = await this.chooseProject(invocation);
      if (!projectId) return; // failed, saying why
      record = { ...record, projectId };
    }
    await this.report(invocation, { state: 'working', activity: 'Sending to Capy' });
    const text = await this.prompt(invocation, record);
    record = { ...record, turn: { invocationId: invocation.id, triggerMessageId: invocation.trigger.messageId } };
    await this.save(spaceId, threadRootId, record);

    const sent = await this.withCapy(invocation, async (api) => {
      if (record.capyThreadId && record.createdFor === invocation.trigger.messageId) return record.capyThreadId; // created with it, before a restart
      if (record.capyThreadId) {
        try {
          await api.send(record.capyThreadId, { text, clientKey: invocation.trigger.messageId });
          return record.capyThreadId;
        } catch (err) {
          if (!(err instanceof CapyError && err.threadGone)) throw err;
          // The Capy thread was deleted: start a new one for this Rowboat thread.
          this.env.log('Capy thread gone; replacing it', { threadId: record.capyThreadId });
        }
      }
      const created = await api.createThread({ requestId: requestIdFor(this.env.agent.id, invocation.trigger.messageId), projectId: record.projectId!, message: text });
      record = { ...record, createdFor: invocation.trigger.messageId };
      return created.id;
    });
    if (!sent) return;
    if (this.stopping.has(invocation.id)) await this.safe(async () => (await this.api()).interrupt(sent), undefined);
    record = { ...record, capyThreadId: sent, deliveredOffset: (await this.offsetOf(spaceId, invocation.trigger.messageId)) ?? record.deliveredOffset };
    await this.save(spaceId, threadRootId, record);
    await this.follow(invocation, record);
  }

  /** The composer's pick (or the owner's default), else the only project; otherwise say what to pick. */
  private async chooseProject(invocation: Invocation): Promise<string | undefined> {
    const projects = await this.withCapy(invocation, (api) => api.projects());
    if (!projects) return undefined;
    if (projects.length === 0) {
      await this.fail(invocation, 'This Capy key reaches no project. Give its user access to one in Capy, then mention me again.');
      return undefined;
    }
    const picked = invocation.options?.project;
    if (typeof picked === 'string') {
      if (projects.some((p) => p.id === picked)) return picked;
      await this.fail(invocation, `The Capy project picked for this (${picked}) is not reachable. Pick another and mention me again.`);
      return undefined;
    }
    if (projects.length === 1) return projects[0]!.id;
    await this.fail(
      invocation,
      `This Capy key reaches several projects (${projects.map(projectLabel).join(', ')}). Pick one under Project when you mention me, or ask my owner to set a default on my page in Agents.`,
    );
    return undefined;
  }

  /** Follow the run on the thread's stream; when it closes, decide from the thread's status and transcript. */
  private async follow(invocation: Invocation, record: ThreadRecord): Promise<void> {
    const threadId = record.capyThreadId!;
    const marker = requestMarker(invocation.trigger.messageId);
    let giveUpAt = Date.now() + RETRY_FOR_MS;
    let backoff = 1_000;
    let lastActivity = '';
    let lastActivityAt = 0;
    let lastReport = Date.now();
    let restingWithoutReplySince: number | undefined;

    await this.report(invocation, { state: 'working', activity: 'Working in Capy' });
    const heartbeat = setInterval(() => {
      if (Date.now() - lastReport < HEARTBEAT_MS) return;
      lastReport = Date.now();
      void this.report(invocation, { state: 'working', activity: lastActivity || 'Working in Capy' });
    }, 30_000);
    try {
      // The stream is how a run's end is heard at once; when Capy refuses it (`capy/StreamUnavailable`,
      // found live 2026-10-02), the connector polls the thread instead and tries the stream again later.
      let streamDownUntil = 0;
      const showActivity = async (tool: string | undefined) => {
        if (!tool) return;
        const activity = `Using ${tool}`.slice(0, 200);
        if (activity === lastActivity || Date.now() - lastActivityAt < ACTIVITY_EVERY_MS) return;
        lastActivity = activity;
        lastActivityAt = lastReport = Date.now();
        await this.report(invocation, { state: 'working', activity });
      };
      while (!this.stopped) {
        const abort = new AbortController();
        this.aborts.add(abort);
        const openedAt = Date.now();
        try {
          const api = await this.api();
          if (Date.now() >= streamDownUntil) {
            try {
              for await (const { event, data } of api.stream(threadId, abort.signal)) {
                giveUpAt = Date.now() + RETRY_FOR_MS;
                backoff = 1_000;
                if (event === 'done' || event === 'error') break;
                const message = event === 'transcript' ? (data as CapyMessage | undefined) : undefined;
                if (message?.source === 'tool') await showActivity(message.tool);
              }
            } catch (err) {
              if (!(err instanceof CapyError) || !err.transient || this.stopped) throw err;
              this.env.log('Capy stream unavailable; polling the thread instead', { error: err.message });
              streamDownUntil = Date.now() + this.timing.streamRetryMs;
            }
          }
          if (this.stopped) return;

          const [thread, transcript] = await Promise.all([api.thread(threadId), api.messages(threadId)]);
          giveUpAt = Date.now() + RETRY_FOR_MS;
          backoff = 1_000;
          const turn = requestInTranscript(transcript, invocation.trigger.messageId, marker);
          if (turn && AT_REST.has(thread.status)) {
            if (turn.answer !== undefined || FAILED.has(thread.status) || this.stopping.has(invocation.id)) {
              return await this.finish(invocation, record, turn.answer, FAILED.has(thread.status) ? thread.status : undefined);
            }
            // At rest with nothing after this request yet: it may not have been picked up. Wait a while.
            restingWithoutReplySince ??= Date.now();
            if (Date.now() - restingWithoutReplySince > this.timing.graceMs) return await this.finish(invocation, record, undefined, undefined);
          } else {
            restingWithoutReplySince = undefined;
            if (turn) await showActivity(turn.lastTool);
          }
        } catch (err) {
          if (this.stopped) return; // not a failure: the invocation stays working, and the next start sends it again
          if (err instanceof HarborError) return await this.fail(invocation, err.message);
          const capy = err instanceof CapyError ? err : new CapyError(0, undefined, (err as Error).message);
          if (capy.rejectsKey) return await this.keyRejected(invocation, capy);
          if (capy.threadGone) {
            await this.save(invocation.conversation.spaceId, invocation.conversation.threadRootId, { ...record, capyThreadId: undefined, turn: undefined });
            return await this.fail(invocation, 'The Capy thread for this conversation is gone. Mention me again to start a new one.');
          }
          if (!capy.transient) return await this.fail(invocation, `Capy: ${capy.message}`);
          if (Date.now() > giveUpAt) return await this.fail(invocation, `Lost touch with Capy for several minutes (${capy.message}). Mention me again to pick it back up.`);
          this.env.log('Capy trouble; retrying', { error: capy.message });
          await sleep(capy.retryAfterSeconds ? capy.retryAfterSeconds * 1000 : backoff, this.shutdown.signal);
          backoff = Math.min(backoff * 2, 30_000);
          continue;
        } finally {
          this.aborts.delete(abort);
        }
        // The stream closed at once, or is down: Capy is not running this yet, waits on something external, or we poll.
        if (Date.now() - openedAt < this.timing.tickMs) await sleep(this.timing.tickMs, this.shutdown.signal);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async finish(invocation: Invocation, record: ThreadRecord, answer: string | undefined, failedStatus: string | undefined): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    let posted: Message | undefined;
    if (this.stopping.has(invocation.id)) {
      await this.report(invocation, { state: 'cancelled' });
    } else if (failedStatus) {
      if (answer) posted = (await this.env.service.postMessage(this.env.ctx, spaceId, { body: answer, threadRoot: threadRootId, actingMode: 'direct' })).message;
      await this.report(invocation, { state: 'failed', error: 'Capy reported the run failed.' });
    } else {
      try {
        posted = (await this.env.service.answerInvocation(this.env.ctx, invocation.id, answer?.trim() || 'Finished in Capy, with nothing to report.')).message;
      } catch (err) {
        if (!(err instanceof HarborError)) throw err; // already finished: a replay posts nothing
      }
    }
    await this.save(spaceId, threadRootId, { ...record, ...(posted ? { deliveredOffset: posted.offset } : {}), turn: undefined });
  }

  // --- what the connector tells Harbor --------------------------------------------------------

  /** Stop, and the project when the key reaches several. Model choice waits: Capy lists no models. */
  private async declare(): Promise<void> {
    const options: InvocationOption[] = [];
    const projects = await this.safe(async () => (await this.api()).projects(), undefined as CapyProject[] | undefined);
    if (projects && projects.length > 1) {
      options.push({ type: 'select', key: 'project', label: 'Project', choices: projects.slice(0, 100).map((p) => ({ id: p.id, label: projectLabel(p).slice(0, 128) })) });
    }
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

  /** A call to Capy for this invocation, retried while Capy has trouble. Undefined when it failed the invocation. */
  private async withCapy<T>(invocation: Invocation, call: (api: CapyApi) => Promise<T>): Promise<T | undefined> {
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
        const capy = err instanceof CapyError ? err : new CapyError(0, undefined, (err as Error).message);
        if (capy.rejectsKey) {
          await this.keyRejected(invocation, capy);
          return undefined;
        }
        if (!capy.transient || Date.now() > giveUpAt) {
          await this.fail(invocation, capy.status === 402 ? `Capy: this needs a paid Capy plan (${capy.message}).` : `Capy: ${capy.message}`);
          return undefined;
        }
        await sleep(capy.retryAfterSeconds ? capy.retryAfterSeconds * 1000 : backoff, this.shutdown.signal);
        if (this.stopped) return undefined;
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  /** 401: fail fast with the reason, and tell the owner once, in their DM with the agent. */
  private async keyRejected(invocation: Invocation, err: CapyError): Promise<void> {
    const reason = 'Capy rejected this agent’s API key (it is wrong, revoked or expired, or its user was removed).';
    await this.fail(invocation, `${reason} Its owner needs to replace it in Agents.`);
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

  /** The prompt: the request, the thread since Capy last heard it, and every file as a download. */
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
    const attachments = (await Promise.all([invocation.trigger.body, ...context.map((m) => m.body)].map((body) => this.attachments(spaceId, body)))).flat();
    return buildPrompt({
      invocation,
      agentId: this.env.agent.id,
      context,
      names,
      orgAddress: this.env.service.org.address,
      orgUrl: this.env.orgUrl,
      attachments,
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
 * This request in a Capy transcript: the last user message with its client
 * key (a follow-up) or its marker (the thread's first message, which takes no
 * key), Capy's last reply after it (and its last tool, for the activity line), before anyone spoke again. Undefined
 * when the request is not there yet; `answer` undefined when Capy has not replied.
 */
export function requestInTranscript(
  transcript: CapyMessage[],
  triggerMessageId: string,
  marker: string,
): { answer: string | undefined; lastTool?: string } | undefined {
  let at = -1;
  transcript.forEach((m, i) => {
    if (m.source === 'user' && (m.clientKey === triggerMessageId || (m.text ?? '').includes(marker))) at = i;
  });
  if (at < 0) return undefined;
  let answer: string | undefined;
  let lastTool: string | undefined;
  for (const m of transcript.slice(at + 1)) {
    if (m.source === 'user') break;
    if (m.source === 'assistant' && m.text?.trim()) answer = m.text;
    if (m.source === 'tool' && m.tool) lastTool = m.tool;
  }
  return { answer, ...(lastTool ? { lastTool } : {}) };
}

function projectLabel(p: CapyProject): string {
  return p.name && p.name !== p.id ? `${p.name} (${p.id})` : p.id;
}

/** Wait, or stop waiting as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });
}
