import type { ConnectorCapabilities, Invocation, InvocationOption, InvocationUpdate, Message, ServerFrame } from '@rowboat/spaces-protocol';
import { HarborError } from '../../errors.js';
import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { CODING_AGENTS, ReplicasError, THINKING_LEVELS, type AgentEvent, type EngineEvent, type ReplicasApi, type ReplicasEnvironment, type ReplicasImage } from './api.js';
import { attachmentLinks, environmentTag, requestMarker } from '../common/prompt.js';
import { requestPrompt, sleep } from '../common/request.js';
import { activityOf, answerOf, failureOf, readsAnswers } from '../common/agent-events.js';

// The Replicas connector (spec §8 Connectors, 2026-09-30): one per agent whose
// connection is `replicas`, run by Harbor (connectors/host.ts). A client of the
// agent contract in-process, on its agent's own frames and the one-minute list.
//
// One Rowboat thread is one Replicas workspace and chat: the first mention
// creates the workspace, and later ones send into the same chat. Everything
// after a send is driven by the workspace's event stream (Replicas's SSE),
// with its history as the backstop when the stream drops or Harbor restarts.
// The per-thread record (agent_connection_threads) says what the workspace
// has heard and what is in flight, so a restart settles every working
// invocation without sending anything twice (spec §8 Invocations are durable).
//
// Two limits, on purpose:
// - Spaces tools inside Replicas: the owner adds our MCP server and the
//   agent's key to the Replicas environment by hand (the Agents dialog shows
//   how). MCP servers are per environment, so two Rowboat agents sharing one
//   environment act as whichever key is there, and workspaces started outside
//   Rowboat get the tools too. The fix is Replicas's workspace identity
//   tokens, verified in Harbor and bound to the workspaces this connector
//   created: https://docs.replicas.dev/features/workspaces/workspace-identity
// - One Harbor instance: two would both run this connector and could act on
//   the same invocation. The ownership lease that fixes it is on the list in
//   SPEC.md §4 "Running more than one instance".

const LIST_EVERY_MS = 60_000;
const CAPABILITIES_EVERY_MS = 10 * 60_000;
/** Report working at least this often: Harbor fails a silent turn after 30 minutes. */
const HEARTBEAT_MS = 4 * 60_000;
const ACTIVITY_EVERY_MS = 5_000;
/**
 * How long the connector waits without an event about its own chat before
 * checking the chat and its history directly. A turn can finish before the
 * stream connects (a new workspace refuses the stream while it boots, and a
 * short turn is over in seconds), and Replicas keeps the stream busy with
 * events about other things, so only events about this chat count (found
 * live 2026-10-01). Tests shorten both.
 */
export interface FollowTiming {
  quietMs: number;
  tickMs: number;
}
const DEFAULT_TIMING: FollowTiming = { quietMs: 20_000, tickMs: 5_000 };
/** How long Replicas trouble is retried before the invocation fails. */
const RETRY_FOR_MS = 5 * 60_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Which coding agents Replicas lists models for (GET /v1/agents/{agent}/models); Muse Code's two are documented. */
const LISTS_MODELS = new Set(['claude', 'codex', 'opencode', 'pi']);
const MUSE_MODELS = [{ id: 'muse-spark-1.3', name: 'Muse Spark 1.3' }, { id: 'muse-spark-1.2', name: 'Muse Spark 1.2' }];
const LEVEL_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra', ultracode: 'Ultracode' };
/** Thinking levels a coding agent takes: `ultra` is Codex's and Muse Code's, `ultracode` Claude Code's (Replicas's OpenAPI). */
function levelsFor(codingAgent: string): string[] {
  return THINKING_LEVELS.filter((level) => (level === 'ultra' ? codingAgent === 'codex' || codingAgent === 'muse' : level === 'ultracode' ? codingAgent === 'claude' : true));
}
/** A workspace in Replicas's app: undocumented, confirmed live 2026-09-30 (a direct link opens it for anyone in the Replicas org). */
const workspaceLink = (workspaceId: string) => `https://app.replicas.dev/workspace/${encodeURIComponent(workspaceId)}`;

/** The connector's record for one thread (agent_connection_threads.data). */
export interface ThreadRecord {
  workspaceId?: string;
  chatId?: string;
  environmentId?: string;
  /** The offset of the newest thread message the workspace has heard; its context starts after it. */
  deliveredOffset?: number;
  /** The invocation in flight in this workspace. */
  turn?: {
    invocationId: string;
    triggerMessageId: string;
    /** True from just before the call to Replicas until it returned: a restart in between must check. */
    sending: boolean;
    /** Replicas's id for the message (a send returns it; a create's first turn has none). */
    replicasMessageId?: string;
    prUrls: string[];
  };
}

export class ReplicasConnector implements RunningConnector {
  private readonly running = new Map<string, Promise<void>>();
  /** What this run took on. A working invocation at boot that it did not take on is from before a restart. */
  private readonly takenOn = new Set<string>();
  private readonly aborts = new Set<AbortController>();
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;
  private stopped = false;
  /** Ends every retry wait at once when the connector stops. */
  private readonly stopping = new AbortController();
  private declared = '';

  constructor(
    private readonly env: ConnectorEnv,
    private readonly api: () => Promise<ReplicasApi>,
    private readonly timing: FollowTiming = DEFAULT_TIMING,
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
    for (const abort of this.aborts) abort.abort();
    await Promise.allSettled([...this.running.values()]);
  }

  // --- intake -------------------------------------------------------------------------

  private async boot(): Promise<void> {
    await this.declare();
    // Settle what a previous run acknowledged (spec §8), then pick up what waits.
    // A live frame can deliver one first; by the time this list returns, it is working, but it is
    // this run's own turn, not one to settle (sending it again would answer it twice).
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'working' && !this.takenOn.has(invocation.id)) this.track(invocation.id, () => this.recover(invocation));
      else if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private onFrame(frame: ServerFrame): void {
    if (frame.kind === 'invocation') this.intake(frame.invocation);
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
      if (invocation.answers) return this.answerToQuestion(invocation);
      await this.react(invocation, '👀');
      await this.run(invocation);
    });
  }

  private track(id: string, work: () => Promise<void>): void {
    const done = work()
      .catch((err) => this.env.log('invocation failed unexpectedly', { id, error: (err as Error).message }))
      .finally(() => this.running.delete(id));
    this.running.set(id, done);
  }

  // --- one invocation --------------------------------------------------------------------

  private async run(invocation: Invocation, chosenEnvironment?: string): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    let record = await this.record(spaceId, threadRootId);
    let environmentId = record.environmentId;
    if (!record.workspaceId) {
      const resolved = chosenEnvironment ?? (await this.chooseEnvironment(invocation));
      if (!resolved) return; // asked the person; their answer resumes it
      environmentId = resolved;
    }
    await this.report(invocation, { state: 'working', activity: record.workspaceId ? 'Sending to Replicas' : 'Starting a workspace' });
    const message = await requestPrompt(this.env, invocation, record.deliveredOffset);
    const images = await this.images(invocation);
    const planMode = invocation.options?.plan_first === true;
    // Model and effort, as picked in the composer or the owner's defaults (2026-10-08); unpicked is Replicas's default.
    const picks = {
      ...(typeof invocation.options?.model === 'string' ? { model: invocation.options.model } : {}),
      ...(typeof invocation.options?.effort === 'string' ? { thinkingLevel: invocation.options.effort } : {}),
    };

    record = { ...record, ...(environmentId ? { environmentId } : {}), turn: { invocationId: invocation.id, triggerMessageId: invocation.trigger.messageId, sending: true, prUrls: [] } };
    await this.save(spaceId, threadRootId, record);
    const sent = await this.withReplicas(invocation, async (api) => {
      if (record.workspaceId) {
        try {
          const { messageId, chatId } = await api.send(record.workspaceId, { ...(record.chatId ? { chatId: record.chatId } : {}), message, planMode, ...picks, images });
          return { workspaceId: record.workspaceId, chatId: chatId ?? record.chatId, messageId: messageId ?? undefined };
        } catch (err) {
          if (!(err instanceof ReplicasError && err.gone)) throw err;
          // Replicas deleted the idle workspace (30 days): start a new one for the thread.
          this.env.log('workspace gone; replacing it', { workspaceId: record.workspaceId });
        }
      }
      const workspace = await api.create({ name: `spaces-${threadRootId}`, environmentId: environmentId!, codingAgent: this.codingAgent(), message, planMode, ...picks, images });
      return { workspaceId: workspace.id, chatId: undefined, messageId: undefined };
    });
    if (!sent) return;
    record = {
      ...record,
      workspaceId: sent.workspaceId,
      ...(sent.chatId ? { chatId: sent.chatId } : sent.workspaceId !== record.workspaceId ? { chatId: undefined } : {}),
      deliveredOffset: await this.offsetOf(spaceId, invocation.trigger.messageId),
      turn: { ...record.turn!, sending: false, ...(sent.messageId ? { replicasMessageId: sent.messageId } : {}) },
    };
    await this.save(spaceId, threadRootId, record);
    await this.follow(invocation, record);
  }

  /** The composer's pick, or the one the message names, or the only environment, or ask the thread (the invocation then waits). */
  private async chooseEnvironment(invocation: Invocation): Promise<string | undefined> {
    const environments = await this.withReplicas(invocation, (api) => api.environments());
    if (!environments) return undefined;
    if (environments.length === 0) {
      await this.fail(invocation, 'This Replicas account has no environments yet: add one on replicas.dev, then mention me again.');
      return undefined;
    }
    const picked = invocation.options?.environment;
    if (typeof picked === 'string' && environments.some((e) => e.id === picked)) return picked;
    const named = environmentTag(invocation.trigger.body);
    if (named) {
      const match = environments.find((e) => e.name.toLowerCase() === named.toLowerCase() || e.id === named);
      if (match) return match.id;
      await this.ask(invocation, environments, named);
      return undefined;
    }
    if (environments.length === 1) return environments[0]!.id;
    await this.ask(invocation, environments);
    return undefined;
  }

  private async ask(invocation: Invocation, environments: ReplicasEnvironment[], unknown?: string): Promise<void> {
    const names = environments.map((e) => e.name).join(', ');
    const example = environments.reduce((a, b) => (b.name.length < a.name.length ? b : a)).name;
    const lead = unknown ? `I don't see an environment called "${unknown}". ` : '';
    const reply = invocation.where.spaceKind === 'direct' ? 'Reply' : `Reply mentioning @${this.env.agent.displayName}`;
    await this.env.service.postMessage(this.env.ctx, invocation.conversation.spaceId, {
      body: `${lead}Which Replicas environment should I use? ${reply} with one of: ${names}. Next time, you can name it in your message: [env:${example}].`,
      threadRoot: invocation.conversation.threadRootId,
      actingMode: 'direct',
    });
    await this.report(invocation, { state: 'waiting', activity: `Which environment? ${names}`.slice(0, 200) });
  }

  /** A reply to "which environment?": delivered at once as an answer to the waiting invocation. */
  private async answerToQuestion(answer: Invocation): Promise<void> {
    await this.report(answer, { state: 'done' });
    const waiting = (await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])).find((i) => i.id === answer.answers);
    if (!waiting || waiting.state !== 'waiting') return;
    const environments = await this.withReplicas(waiting, (api) => api.environments());
    if (!environments) return;
    const text = answer.trigger.body.replace(/\[@[^\]]*\]\(#member:[^)]*\)/g, ' ').trim().toLowerCase();
    const chosen =
      environments.find((e) => e.name.toLowerCase() === text || e.id.toLowerCase() === text) ??
      (environments.filter((e) => text.includes(e.name.toLowerCase())).length === 1 ? environments.find((e) => text.includes(e.name.toLowerCase())) : undefined);
    if (!chosen) return this.ask(waiting, environments, text.slice(0, 60));
    await this.report(waiting, { state: 'working', activity: 'Starting a workspace' });
    await this.run(waiting, chosen.id);
  }

  // --- following the work ------------------------------------------------------------------

  /** Follow the thread's chat on the workspace's event stream until its turn ends, then finish. */
  private async follow(invocation: Invocation, record: ThreadRecord): Promise<void> {
    const events: AgentEvent[] = [];
    let started = false;
    let lastReport = Date.now();
    let lastActivity = '';
    let lastActivityAt = 0;
    let backoff = 1_000;
    const deadline = () => Date.now() + RETRY_FOR_MS;
    let giveUpAt = deadline();

    const link = workspaceLink(record.workspaceId!);
    await this.report(invocation, { state: 'working', activity: 'Working in Replicas', link });
    while (!this.stopped) {
      const abort = new AbortController();
      this.aborts.add(abort);
      // The last word about this thread's chat; silence past `quietMs` means check the chat directly.
      let lastOursAt = Date.now();
      let checking = false;
      let finishedMeanwhile = false;
      const tick = setInterval(() => {
        if (Date.now() - lastReport >= HEARTBEAT_MS) {
          lastReport = Date.now();
          void this.report(invocation, { state: 'working', activity: lastActivity || 'Working in Replicas', link });
        }
        if (checking || Date.now() - lastOursAt < this.timing.quietMs) return;
        checking = true;
        void (async () => {
          try {
            const now = await this.meanwhile(await this.api(), invocation, record);
            if (now === 'finished') {
              finishedMeanwhile = true;
              abort.abort();
            } else if (now === 'running') {
              started = true;
            }
          } catch {
            // the stream loop deals with Replicas trouble
          } finally {
            lastOursAt = Date.now();
            checking = false;
          }
        })();
      }, this.timing.tickMs);
      try {
        const api = await this.api();
        // What happened while no stream was open shows in the chat's state and history.
        const meanwhile = await this.meanwhile(api, invocation, record);
        giveUpAt = deadline(); // Replicas answered: trouble so far is over
        if (meanwhile === 'finished') return this.finish(invocation, record, events, false);
        if (meanwhile === 'running') started = true;
        for await (const event of api.events(record.workspaceId!, abort.signal)) {
          backoff = 1_000;
          giveUpAt = deadline();
          const payload = event.payload ?? {};
          const chatId = typeof payload.chatId === 'string' ? payload.chatId : undefined;
          if (event.type === 'repo.status.changed') {
            record = await this.notePullRequests(invocation, record, payload);
            continue;
          }
          if (!chatId) continue;
          if (!record.chatId && (event.type === 'chat.turn.accepted' || event.type === 'chat.turn.started')) {
            // A new workspace's chat for this coding agent is this thread's (Replicas adds others, such as "Relay").
            const ours = await this.chatFor(api, record.workspaceId!);
            if (ours === chatId) {
              record = { ...record, chatId };
              await this.save(invocation.conversation.spaceId, invocation.conversation.threadRootId, record);
            }
          }
          if (chatId !== record.chatId) continue;
          lastOursAt = Date.now();
          if (event.type === 'chat.turn.started') {
            const ours = !record.turn?.replicasMessageId || payload.messageId === record.turn.replicasMessageId;
            if (ours) started = true;
          } else if (event.type === 'chat.turn.delta' && started) {
            const agentEvent = payload.event as AgentEvent | undefined;
            if (!agentEvent) continue;
            events.push(agentEvent);
            const activity = activityOf(this.env.agent.agentKind ?? '', agentEvent);
            if (activity && activity !== lastActivity && Date.now() - lastActivityAt >= ACTIVITY_EVERY_MS) {
              lastActivity = activity;
              lastActivityAt = lastReport = Date.now();
              await this.report(invocation, { state: 'working', activity, link });
            }
          } else if (event.type === 'chat.turn.completed' && started && payload.processing !== true) {
            return this.finish(invocation, record, events, payload.isComplete === false);
          }
        }
      } catch (err) {
        if (this.stopped) return;
        if (err instanceof ReplicasError && err.rejectsKey) return this.keyRejected(invocation, err);
        if (err instanceof ReplicasError && err.gone) return this.fail(invocation, 'The Replicas workspace for this thread is gone. Mention me again to start a new one.');
        this.env.log('event stream dropped; reconnecting', { error: (err as Error).message });
      } finally {
        clearInterval(tick);
        this.aborts.delete(abort);
      }
      if (this.stopped) return;
      if (finishedMeanwhile) return this.finish(invocation, record, events, false);
      if (Date.now() > giveUpAt) return this.fail(invocation, 'Lost touch with Replicas for several minutes. Mention me again to pick it back up.');
      await sleep(backoff, this.stopping.signal);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }

  /**
   * On (re)connecting, where this request stands, from the chat's state and
   * history: `finished` only when the chat is idle AND the agent answered after
   * this request's marker (idle alone can mean it hasn't started: queued, or
   * the workspace waking); `running` when the agent has begun on it.
   */
  private async meanwhile(api: ReplicasApi, invocation: Invocation, record: ThreadRecord): Promise<'finished' | 'running' | 'waiting'> {
    const chats = await api.chats(record.workspaceId!);
    if (!record.chatId) {
      const ours = pickChat(chats, this.codingAgent());
      if (!ours) return 'waiting'; // not created yet: the stream will say
      record.chatId = ours;
      await this.save(invocation.conversation.spaceId, invocation.conversation.threadRootId, record);
    }
    const chat = chats.find((c) => c.id === record.chatId);
    const after = await this.turnFromHistory(api, record, invocation.trigger.messageId);
    if (!chat || !after || after.length === 0) return 'waiting';
    return chat.processing === false ? 'finished' : 'running';
  }

  /** This request's events in the chat's history: everything after its marker. */
  private async turnFromHistory(api: ReplicasApi, record: ThreadRecord, triggerMessageId: string): Promise<AgentEvent[] | undefined> {
    const history = await api.history(record.workspaceId!, record.chatId!, 500);
    const marker = requestMarker(triggerMessageId);
    let at = -1;
    history.forEach((event, i) => {
      if (JSON.stringify(event.payload ?? '').includes(marker)) at = i;
    });
    return at < 0 ? undefined : history.slice(at + 1);
  }

  private async notePullRequests(invocation: Invocation, record: ThreadRecord, payload: Record<string, unknown>): Promise<ThreadRecord> {
    const repos = Array.isArray(payload.repos) ? payload.repos : [];
    const urls = repos.flatMap((r) => (Array.isArray((r as { prUrls?: unknown }).prUrls) ? ((r as { prUrls: unknown[] }).prUrls.filter((u) => typeof u === 'string') as string[]) : []));
    const known = new Set(record.turn?.prUrls ?? []);
    const fresh = urls.filter((u) => !known.has(u));
    if (fresh.length === 0 || !record.turn) return record;
    const next = { ...record, turn: { ...record.turn, prUrls: [...record.turn.prUrls, ...fresh] } };
    await this.save(invocation.conversation.spaceId, invocation.conversation.threadRootId, next);
    return next;
  }

  private async finish(invocation: Invocation, record: ThreadRecord, streamed: AgentEvent[], interrupted: boolean): Promise<void> {
    const kind = this.env.agent.agentKind ?? '';
    // The history is the whole turn; the stream may have gaps from a reconnect.
    const events = (await this.safe(async () => this.turnFromHistory(await this.api(), record, invocation.trigger.messageId), undefined)) ?? streamed;
    const answer = readsAnswers(kind) ? answerOf(kind, events) : undefined;
    const failure = failureOf(kind, events) ?? (interrupted ? 'Replicas stopped before finishing this' : undefined);
    const prs = (record.turn?.prUrls ?? []).filter((url) => !answer?.includes(url));
    const links = prs.map((url) => `Pull request: ${url}`);
    const { spaceId, threadRootId } = invocation.conversation;
    let posted: Message | undefined;
    if (failure) {
      if (answer || links.length > 0) {
        posted = (await this.env.service.postMessage(this.env.ctx, spaceId, { body: [answer, ...links].filter(Boolean).join('\n\n'), threadRoot: threadRootId, actingMode: 'direct' })).message;
      }
      await this.fail(invocation, failure);
    } else {
      const body = answer
        ? [answer, ...links].join('\n\n')
        : ['Finished in Replicas.', ...links, `Workspace: ${workspaceLink(record.workspaceId!)}`].join('\n\n');
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
    let record = await this.record(spaceId, threadRootId);
    const turn = record.turn?.invocationId === invocation.id ? record.turn : undefined;
    if (!turn) return this.run(invocation); // acknowledged, but nothing was sent yet
    if (!turn.sending) return this.follow(invocation, record);
    const arrived = await this.withReplicas(invocation, async (api) => {
      if (!record.workspaceId) {
        const named = (await api.recent(50)).find((w) => w.name === `spaces-${threadRootId}`);
        if (!named) return false;
        record = { ...record, workspaceId: named.id };
      }
      const chats = await api.chats(record.workspaceId!);
      for (const chat of record.chatId ? chats.filter((c) => c.id === record.chatId) : chats) {
        const history = await api.history(record.workspaceId!, chat.id, 500);
        if (history.some((e) => JSON.stringify(e.payload ?? '').includes(requestMarker(invocation.trigger.messageId)))) {
          record = { ...record, chatId: chat.id };
          return true;
        }
      }
      return false;
    });
    if (arrived === undefined) return; // failed already
    if (!arrived) {
      // Confirmed never delivered: send it now (a found-but-empty workspace just gets the message).
      await this.save(spaceId, threadRootId, { ...record, turn: undefined });
      return this.run(invocation);
    }
    record = { ...record, deliveredOffset: await this.offsetOf(spaceId, invocation.trigger.messageId), turn: { ...turn, sending: false } };
    await this.save(spaceId, threadRootId, record);
    await this.follow(invocation, record);
  }

  // --- what the connector tells Harbor --------------------------------------------------------

  private async declare(): Promise<void> {
    const options: InvocationOption[] = [];
    const environments = await this.safe(async () => (await this.api()).environments(), undefined as ReplicasEnvironment[] | undefined);
    if (environments && environments.length > 1) {
      options.push({ type: 'select', key: 'environment', label: 'Environment', choices: environments.slice(0, 100).map((e) => ({ id: e.id, label: e.name.slice(0, 128) || e.id })) });
    }
    // The model picker (2026-10-08): the coding agent's models on the account, and its thinking levels.
    const agent = this.codingAgent();
    const models = agent === 'muse'
      ? MUSE_MODELS
      : LISTS_MODELS.has(agent)
        ? (await this.safe(async () => (await this.api()).models(agent), undefined as { models: Array<{ id: string; name: string }> } | undefined))?.models ?? []
        : [];
    if (models.length > 0) {
      options.push({ type: 'select', key: 'model', label: 'Model', choices: models.slice(0, 100).map((m) => ({ id: m.id, label: m.name.slice(0, 128) || m.id })) });
    }
    options.push({ type: 'select', key: 'effort', label: 'Effort', choices: levelsFor(agent).map((level) => ({ id: level, label: LEVEL_LABELS[level] ?? level })) });
    options.push({ type: 'toggle', key: 'plan_first', label: 'Plan first' });
    const capabilities: ConnectorCapabilities = { stop: false, options };
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
   * A call to Replicas for this invocation, retried while Replicas has trouble.
   * Undefined when it failed the invocation: a refused key (the owner is told
   * once), the workspace limit, or anything else Replicas refused.
   */
  private async withReplicas<T>(invocation: Invocation, call: (api: ReplicasApi) => Promise<T>): Promise<T | undefined> {
    const giveUpAt = Date.now() + RETRY_FOR_MS;
    let backoff = 1_000;
    for (;;) {
      try {
        return await call(await this.api());
      } catch (err) {
        if (err instanceof HarborError) {
          await this.fail(invocation, err.message); // e.g. no key stored
          return undefined;
        }
        // Shutting down is not a failure: the invocation stays working, and the next start settles it (spec §8).
        if (this.stopped) return undefined;
        const replicas = err instanceof ReplicasError ? err : new ReplicasError(0, (err as Error).message);
        if (replicas.rejectsKey) {
          await this.keyRejected(invocation, replicas);
          return undefined;
        }
        if (replicas.atCapacity) {
          await this.fail(invocation, 'Replicas already has its limit of 100 active workspaces for this account. Try again later.');
          return undefined;
        }
        if (!replicas.transient || Date.now() > giveUpAt) {
          await this.fail(invocation, `Replicas: ${replicas.message}`);
          return undefined;
        }
        await sleep(backoff, this.stopping.signal);
        if (this.stopped) return undefined;
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  /** 401/402: fail fast with the reason, and tell the owner once, in their DM with the agent. */
  private async keyRejected(invocation: Invocation, err: ReplicasError): Promise<void> {
    const reason =
      err.status === 402
        ? 'The Replicas account is out of minutes, or its trial has ended.'
        : 'Replicas rejected this agent\'s API key.';
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

  private async chatFor(api: ReplicasApi, workspaceId: string): Promise<string | undefined> {
    return pickChat(await this.safe(() => api.chats(workspaceId), []), this.codingAgent());
  }

  private codingAgent(): string {
    return CODING_AGENTS[this.env.agent.agentKind ?? ''] ?? 'claude';
  }

  private async record(spaceId: string, threadRootId: string): Promise<ThreadRecord> {
    return ((await this.env.thread.get(spaceId, threadRootId)) as ThreadRecord | undefined) ?? {};
  }

  private async save(spaceId: string, threadRootId: string, record: ThreadRecord): Promise<void> {
    await this.env.thread.put(spaceId, threadRootId, record);
  }

  private async offsetOf(spaceId: string, messageId: string): Promise<number | undefined> {
    return this.safe(async () => (await this.env.service.getMessage(this.env.ctx, spaceId, messageId)).offset, undefined);
  }

  /** The invoking message's images, for the model to see: a long-lived link where storage gives one, else the bytes. */
  private async images(invocation: Invocation): Promise<ReplicasImage[]> {
    const { spaceId } = invocation.conversation;
    const images: ReplicasImage[] = [];
    for (const { hash, name } of attachmentLinks(invocation.trigger.body, spaceId)) {
      if (images.length >= MAX_IMAGES) break;
      const got = await this.safe(() => this.env.service.downloadBlob(this.env.ctx, spaceId, hash, name, { expiresInSeconds: 6 * 3600 }), undefined);
      if (!got || !IMAGE_TYPES.has(got.blob.mime) || got.blob.size > MAX_IMAGE_BYTES) continue;
      if (got.url) images.push({ type: 'image', source: { type: 'url', url: got.url } });
      else if (got.bytes)
        images.push({
          type: 'image',
          source: { type: 'base64', media_type: got.blob.mime as 'image/png', data: Buffer.from(got.bytes).toString('base64') },
        });
    }
    return images;
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
 * A workspace's chat for this coding agent: Replicas opens others beside it
 * (a "Relay" chat, found live 2026-09-30), so match the documented `provider`,
 * or take the only chat there is.
 */
function pickChat(chats: Array<{ id: string; provider?: string }>, codingAgent: string): string | undefined {
  return chats.find((c) => c.provider === codingAgent)?.id ?? (chats.length === 1 ? chats[0]!.id : undefined);
}
