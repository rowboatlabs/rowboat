import { randomUUID } from 'node:crypto';
import type { ConnectorCapabilities, Invocation, InvocationOption, InvocationUpdate, Message, ServerFrame } from '@rowboat/spaces-protocol';
import { HarborError } from '../../errors.js';
import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { environmentTag, requestMarker } from '../common/prompt.js';
import { quietly, requestPrompt, sleep } from '../common/request.js';
import { ConductorError, type ConductorApi, type ConductorProject, type TranscriptMessage } from './api.js';
import { endsTurn, isRequest, mentions, transcriptActivity, transcriptAnswer, transcriptFailure, turnOf } from './turns.js';

// The Conductor connector (spec §8 Connectors, 2026-10-06): one per agent
// whose connection is `conductor`, run by Harbor (connectors/host.ts), the
// same shape as the Replicas connector. One Rowboat thread is one Conductor
// cloud workspace and its session: the first mention creates the workspace
// (named `spaces-<threadRootId>`), and every request, the first included, is
// a message sent into its session with a uuid chosen beforehand, which
// Conductor dedupes. So a restart in the middle of a send sends again with the
// same id, and finds the workspace by its name if the create's answer was lost.
//
// Conductor has no event stream: the connector polls the session's status and
// its transcript after what it has already read. Every transcript entry names
// the request it belongs to (its turnId is the id we sent it with), and a turn
// ends with Conductor's own "session idle" entry (both found live 2026-10-07).
// The session's status is the backstop: it reads idle until a queued message
// starts (Conductor's docs), so idle counts only once the turn was seen.
//
// The coding agent calls Spaces as its agent: every workspace gets
// ROWBOAT_URL and ROWBOAT_AGENT_KEY (a key Harbor keeps for the connector),
// and a repo's `.mcp.json` reads them. One Harbor instance only, as for
// Replicas (SPEC.md §4 "Running more than one instance").

const LIST_EVERY_MS = 60_000;
const CAPABILITIES_EVERY_MS = 10 * 60_000;
/** Report working at least this often: Harbor fails a silent turn after 30 minutes. */
const HEARTBEAT_MS = 4 * 60_000;
const ACTIVITY_EVERY_MS = 5_000;
/** How long Conductor trouble is retried before the invocation fails. */
const RETRY_FOR_MS = 5 * 60_000;
/** How long a request may wait to start (a new workspace can build its snapshot first). */
const START_WITHIN_MS = 20 * 60_000;
/** An error status before this request was seen is trusted only once it has lasted this long (it may be the last turn's). */
const ERROR_SETTLES_MS = 60_000;
/**
 * How long an idle session whose turn has no end entry yet is given before it
 * counts as over: Conductor once reported sessions idle while their agent still
 * waited on background work (changelog 0.82), and the end entry is the sure sign.
 */
const IDLE_SETTLES_MS = 30_000;
export interface PollTiming {
  pollMs: number;
}
const DEFAULT_TIMING: PollTiming = { pollMs: 3_000 };

/** Conductor's agent for each kind it runs (CONDUCTOR_CODING_AGENTS). */
const AGENTS: Record<string, string> = { 'claude-code': 'claude' };
/** Claude models Conductor accepts (its OpenAPI, 2026-10-05). Unpicked, Conductor uses the key owner's default. */
const CLAUDE_MODELS = [
  { id: 'fable-5-1', label: 'Fable 5.1' },
  { id: 'opus-5-5-1m', label: 'Opus 5.5 (1M)' },
  { id: 'opus-5-1m', label: 'Opus 5 (1M)' },
  { id: 'sonnet-5-5-1m', label: 'Sonnet 5.5 (1M)' },
  { id: 'sonnet-5-1m', label: 'Sonnet 5 (1M)' },
  { id: 'haiku-4-5', label: 'Haiku 4.5' },
];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, label: id === 'xhigh' ? 'Extra high' : id[0]!.toUpperCase() + id.slice(1) }));

/** The connector's record for one thread (agent_connection_threads.data). */
export interface ThreadRecord {
  workspaceId?: string;
  sessionId?: string;
  projectId?: string;
  /** Conductor's link to the workspace. */
  link?: string;
  /** The offset of the newest thread message the workspace has heard; its context starts after it. */
  deliveredOffset?: number;
  /** The newest transcript entry already read: the next turn's reading starts after it. */
  readTo?: string;
  /** The invocation in flight in this workspace. */
  turn?: {
    invocationId: string;
    triggerMessageId: string;
    /** True from just before the send until it returned: a restart in between sends again with the same id. */
    sending: boolean;
    /** The id Conductor dedupes the send by, chosen before it. */
    conductorMessageId: string;
  };
}

export class ConductorConnector implements RunningConnector {
  private readonly running = new Map<string, Promise<void>>();
  /** What this run took on. A working invocation at boot that it did not take on is from before a restart. */
  private readonly takenOn = new Set<string>();
  /** Stop asked for: the invocation, and the session to cancel once it is known. */
  private readonly stops = new Set<string>();
  private readonly sessions = new Map<string, string>();
  /** Invocations whose session Conductor has confirmed cancelling. */
  private readonly cancelSent = new Set<string>();
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;
  private stopped = false;
  private readonly stopping = new AbortController();
  private declared = '';

  constructor(
    private readonly env: ConnectorEnv,
    private readonly api: () => Promise<ConductorApi>,
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
      if (invocation.answers) return this.answerToQuestion(invocation);
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
        this.sessions.delete(id);
        this.cancelSent.delete(id);
      });
    this.running.set(id, done);
  }

  /** Stop (spec §8 part 2): cancel the session's turn; the poll sees it go idle and reports cancelled. */
  private async stopInvocation(invocationId: string): Promise<void> {
    if (!this.running.has(invocationId)) return;
    this.stops.add(invocationId);
    const sessionId = this.sessions.get(invocationId);
    if (sessionId) await this.cancel(invocationId, sessionId);
  }

  private async cancel(invocationId: string, sessionId: string): Promise<void> {
    const done = await this.safe(async () => ((await (await this.api()).cancel(sessionId)), true), false);
    if (done) this.cancelSent.add(invocationId);
  }

  // --- one invocation --------------------------------------------------------------------

  private async run(invocation: Invocation, chosenProject?: string): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    let record = await this.record(spaceId, threadRootId);
    let projectId = record.projectId;
    if (!record.workspaceId) {
      const resolved = chosenProject ?? (await this.chooseProject(invocation));
      if (!resolved) return; // asked the person; their answer resumes it
      projectId = resolved;
    }
    if (this.stops.has(invocation.id)) return this.cancelled(invocation);
    await this.report(invocation, { state: 'working', activity: record.workspaceId ? 'Sending to Conductor' : 'Starting a workspace' });
    const message = await requestPrompt(this.env, invocation, record.deliveredOffset);
    record = {
      ...record,
      ...(projectId ? { projectId } : {}),
      turn: { invocationId: invocation.id, triggerMessageId: invocation.trigger.messageId, sending: true, conductorMessageId: randomUUID() },
    };
    await this.save(spaceId, threadRootId, record);
    await this.send(invocation, record, message);
  }

  /** Into the thread's workspace (made first if it has none, or found by name after a lost answer), with the turn's id. */
  private async send(invocation: Invocation, start: ThreadRecord, message: string): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    let record = start;
    const sent = await this.withConductor(invocation, async (api) => {
      if (!record.workspaceId) record = await this.workspace(api, invocation, record);
      try {
        await api.send(record.sessionId!, { messageId: record.turn!.conductorMessageId, message });
      } catch (err) {
        if (!(err instanceof ConductorError && err.gone)) throw err;
        // The workspace was archived away: start a new one for the thread.
        this.env.log('workspace gone; replacing it', { workspaceId: record.workspaceId });
        record = await this.workspace(api, invocation, { ...record, workspaceId: undefined, sessionId: undefined, readTo: undefined }, true);
        await api.send(record.sessionId!, { messageId: record.turn!.conductorMessageId, message });
      }
      return true;
    });
    if (!sent) return;
    record = { ...record, deliveredOffset: await this.offsetOf(spaceId, invocation.trigger.messageId), turn: { ...record.turn!, sending: false } };
    await this.save(spaceId, threadRootId, record);
    await this.follow(invocation, record);
  }

  /** The thread's workspace: the one named for it (a create whose answer was lost), or a new one. Saved at once. */
  private async workspace(api: ConductorApi, invocation: Invocation, record: ThreadRecord, fresh = false): Promise<ThreadRecord> {
    const { spaceId, threadRootId } = invocation.conversation;
    const name = `spaces-${threadRootId}`;
    const found = fresh ? undefined : (await api.workspacesNamed(name))[0];
    let next: ThreadRecord;
    if (found) {
      const session = (await api.sessions(found.id))[0];
      if (!session) throw new ConductorError(404, 'the workspace has no session');
      next = { ...record, workspaceId: found.id, sessionId: session.id, link: found.deepLink };
    } else {
      const options = invocation.options ?? {};
      const created = await api.createWorkspace({
        projectId: record.projectId!,
        name,
        agent: AGENTS[this.env.agent.agentKind ?? ''] ?? 'claude',
        ...(typeof options.model === 'string' ? { model: options.model } : {}),
        ...(typeof options.effort === 'string' ? { effort: options.effort } : {}),
        ...(typeof options.fast_mode === 'boolean' ? { fastMode: options.fast_mode } : {}),
        env: { ROWBOAT_URL: this.env.orgUrl, ROWBOAT_AGENT_KEY: await this.env.agentKey() },
      });
      next = { ...record, workspaceId: created.workspaceId, sessionId: created.sessionId, link: created.deepLink };
    }
    await this.save(spaceId, threadRootId, next);
    return next;
  }

  /** The composer's pick, or the one the message names, or the only project, or ask the thread (the invocation then waits). */
  private async chooseProject(invocation: Invocation): Promise<string | undefined> {
    const projects = await this.withConductor(invocation, (api) => api.projects());
    if (!projects) return undefined;
    if (projects.length === 0) {
      await this.fail(invocation, 'This Conductor account has no projects yet: add a repository in Conductor, then mention me again.');
      return undefined;
    }
    const picked = invocation.options?.project;
    if (typeof picked === 'string' && projects.some((p) => p.id === picked)) return picked;
    const named = environmentTag(invocation.trigger.body);
    if (named) {
      const match = projects.find((p) => p.name.toLowerCase() === named.toLowerCase() || p.id === named);
      if (match) return match.id;
      await this.ask(invocation, projects, named);
      return undefined;
    }
    if (projects.length === 1) return projects[0]!.id;
    await this.ask(invocation, projects);
    return undefined;
  }

  private async ask(invocation: Invocation, projects: ConductorProject[], unknown?: string): Promise<void> {
    const names = projects.map((p) => p.name).join(', ');
    const example = projects.reduce((a, b) => (b.name.length < a.name.length ? b : a)).name;
    const lead = unknown ? `I don't see a project called "${unknown}". ` : '';
    const reply = invocation.where.spaceKind === 'direct' ? 'Reply' : `Reply mentioning @${this.env.agent.displayName}`;
    await this.env.service.postMessage(this.env.ctx, invocation.conversation.spaceId, {
      body: `${lead}Which Conductor project should I work in? ${reply} with one of: ${names}. Next time, you can name it in your message: [env:${example}].`,
      threadRoot: invocation.conversation.threadRootId,
      actingMode: 'direct',
    });
    await this.report(invocation, { state: 'waiting', activity: `Which project? ${names}`.slice(0, 200) });
  }

  /** A reply to "which project?": delivered at once as an answer to the waiting invocation. */
  private async answerToQuestion(answer: Invocation): Promise<void> {
    await this.report(answer, { state: 'done' });
    const waiting = (await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])).find((i) => i.id === answer.answers);
    if (!waiting || waiting.state !== 'waiting') return;
    const projects = await this.withConductor(waiting, (api) => api.projects());
    if (!projects) return;
    const text = answer.trigger.body.replace(/\[@[^\]]*\]\(#member:[^)]*\)/g, ' ').trim().toLowerCase();
    const containing = projects.filter((p) => text.includes(p.name.toLowerCase()));
    const chosen = projects.find((p) => p.name.toLowerCase() === text || p.id.toLowerCase() === text) ?? (containing.length === 1 ? containing[0] : undefined);
    if (!chosen) return this.ask(waiting, projects, text.slice(0, 60));
    await this.report(waiting, { state: 'working', activity: 'Starting a workspace' });
    this.takenOn.add(waiting.id);
    await this.run(waiting, chosen.id);
  }

  // --- following the work ------------------------------------------------------------------

  /** Poll the session until its turn for this request ends, then finish. */
  private async follow(invocation: Invocation, record: ThreadRecord): Promise<void> {
    const marker = requestMarker(invocation.trigger.messageId);
    const turnId = record.turn?.conductorMessageId;
    const sessionId = record.sessionId!;
    this.sessions.set(invocation.id, sessionId);
    if (this.stops.has(invocation.id)) await this.cancel(invocation.id, sessionId);
    const link = record.link;
    const working = (activity: string): InvocationUpdate => ({ state: 'working', activity, ...(link ? { link } : {}) });
    await this.report(invocation, working('Working in Conductor'));

    const read: TranscriptMessage[] = [];
    let cursor = record.readTo;
    let markerAt = -1;
    let sawWorking = false;
    let lastReport = Date.now();
    let lastActivity = '';
    let lastActivityAt = 0;
    let giveUpAt = Date.now() + RETRY_FOR_MS;
    const startBy = Date.now() + START_WITHIN_MS;
    let erroringSince: number | undefined;
    let idleSince: number | undefined;
    let backoff = this.timing.pollMs;

    while (!this.stopped) {
      try {
        const api = await this.api();
        const fresh = await api.messages(sessionId, cursor);
        const status = await api.sessionStatus(sessionId);
        giveUpAt = Date.now() + RETRY_FOR_MS;
        backoff = this.timing.pollMs;
        if (fresh.length > 0) {
          read.push(...fresh);
          cursor = fresh[fresh.length - 1]!.id;
        }
        // This request's entries: by its turnId, or (a transcript without turnIds) everything after its marker.
        const tagged = turnId ? read.filter((m) => turnOf(m) === turnId) : [];
        if (markerAt < 0) markerAt = read.findIndex((m) => mentions(m, marker));
        const turn = tagged.length > 0 ? tagged.filter((m) => !isRequest(m)) : markerAt < 0 ? [] : read.slice(markerAt + 1);
        const ended = turn.some(endsTurn);
        if (status.status === 'working') sawWorking = true;

        const activity = [...fresh].reverse().map(transcriptActivity).find(Boolean);
        if (activity && activity !== lastActivity && Date.now() - lastActivityAt >= ACTIVITY_EVERY_MS) {
          lastActivity = activity;
          lastActivityAt = lastReport = Date.now();
          await this.report(invocation, working(activity));
        } else if (Date.now() - lastReport >= HEARTBEAT_MS) {
          lastReport = Date.now();
          await this.report(invocation, working(lastActivity || 'Working in Conductor'));
        }

        const started = sawWorking || turn.length > 0;
        erroringSince = status.status === 'error' ? (erroringSince ?? Date.now()) : undefined;
        const errored = erroringSince !== undefined && (started || markerAt >= 0 || tagged.length > 0 || Date.now() - erroringSince >= ERROR_SETTLES_MS);
        idleSince = status.status === 'idle' ? (idleSince ?? Date.now()) : undefined;
        // An idle session is over once its end entry is in, or (none to wait for) once the turn was seen,
        // or after a grace when entries came but the end entry hasn't.
        const idleOver = idleSince !== undefined && started && (ended || tagged.length === 0 || Date.now() - idleSince >= IDLE_SETTLES_MS);
        // After a cancel (which also drops a queued request), idle is the end even if this poll never saw it start.
        const stopped = this.cancelSent.has(invocation.id);
        if (idleOver || (status.status === 'idle' && stopped) || errored) {
          const readTo = cursor;
          if (this.stops.has(invocation.id)) return this.cancelled(invocation, { ...record, ...(readTo ? { readTo } : {}) });
          const error = status.status === 'error' ? (status.lastError ?? status.errorMessage ?? 'Conductor reported an error') : undefined;
          return this.finish(invocation, { ...record, ...(readTo ? { readTo } : {}) }, turn, error);
        }
        if (!started && Date.now() > startBy) return this.fail(invocation, "Conductor didn't start on this within 20 minutes. Mention me again to retry.");
      } catch (err) {
        if (this.stopped) return;
        const conductor = err instanceof ConductorError ? err : new ConductorError(0, (err as Error).message);
        if (conductor.rejectsKey) return this.keyRejected(invocation, conductor);
        if (conductor.gone) return this.fail(invocation, 'The Conductor workspace for this thread is gone. Mention me again to start a new one.');
        if (!conductor.transient || Date.now() > giveUpAt) return this.fail(invocation, 'Lost touch with Conductor for several minutes. Mention me again to pick it back up.');
        this.env.log('poll failed; retrying', { error: conductor.message });
        backoff = Math.min(backoff * 2, 30_000);
      }
      await sleep(backoff, this.stopping.signal);
    }
  }

  private async finish(invocation: Invocation, record: ThreadRecord, turn: TranscriptMessage[], error: string | undefined): Promise<void> {
    const answer = transcriptAnswer(turn);
    const failure = transcriptFailure(turn) ?? error;
    const { spaceId, threadRootId } = invocation.conversation;
    let posted: Message | undefined;
    if (failure) {
      if (answer) posted = (await this.env.service.postMessage(this.env.ctx, spaceId, { body: answer, threadRoot: threadRootId, actingMode: 'direct' })).message;
      await this.fail(invocation, failure);
    } else {
      const body = answer ?? ['Finished in Conductor.', ...(record.link ? [`Workspace: ${record.link}`] : [])].join('\n\n');
      try {
        posted = (await this.env.service.answerInvocation(this.env.ctx, invocation.id, body)).message;
      } catch (err) {
        if (!(err instanceof HarborError)) throw err; // already finished: a replay posts nothing
      }
    }
    await this.save(spaceId, threadRootId, { ...record, ...(posted ? { deliveredOffset: posted.offset } : {}), turn: undefined });
  }

  private async cancelled(invocation: Invocation, record?: ThreadRecord): Promise<void> {
    await this.report(invocation, { state: 'cancelled' });
    const { spaceId, threadRootId } = invocation.conversation;
    const current = record ?? (await this.record(spaceId, threadRootId));
    await this.save(spaceId, threadRootId, { ...current, turn: undefined });
  }

  // --- recovery -------------------------------------------------------------------------------

  /** A working invocation from before a restart (spec §8): carry on with it, or send it again under the same id. */
  private async recover(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    const record = await this.record(spaceId, threadRootId);
    const turn = record.turn?.invocationId === invocation.id ? record.turn : undefined;
    if (!turn) return this.run(invocation); // acknowledged, but nothing was sent yet
    if (!turn.sending) return this.follow(invocation, record);
    // The send may or may not have arrived: Conductor drops a repeat of the same id.
    const message = await requestPrompt(this.env, invocation, record.deliveredOffset);
    await this.send(invocation, record, message);
  }

  // --- what the connector tells Harbor --------------------------------------------------------

  private async declare(): Promise<void> {
    const options: InvocationOption[] = [];
    const projects = await this.safe(async () => (await this.api()).projects(), undefined as ConductorProject[] | undefined);
    if (projects && projects.length > 1) {
      options.push({ type: 'select', key: 'project', label: 'Project', choices: projects.slice(0, 100).map((p) => ({ id: p.id, label: p.name.slice(0, 128) || p.id })) });
    }
    options.push({ type: 'select', key: 'model', label: 'Model', choices: CLAUDE_MODELS });
    options.push({ type: 'select', key: 'effort', label: 'Effort', choices: CLAUDE_EFFORTS });
    options.push({ type: 'toggle', key: 'fast_mode', label: 'Fast mode' });
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
   * A call to Conductor for this invocation, retried while Conductor has
   * trouble. Undefined when it failed the invocation: a refused key (the
   * owner is told once), a rate limit, or anything else Conductor refused.
   */
  private async withConductor<T>(invocation: Invocation, call: (api: ConductorApi) => Promise<T>): Promise<T | undefined> {
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
        const conductor = err instanceof ConductorError ? err : new ConductorError(0, (err as Error).message);
        if (conductor.rejectsKey) {
          await this.keyRejected(invocation, conductor);
          return undefined;
        }
        if (!(conductor.transient || conductor.atCapacity) || Date.now() > giveUpAt) {
          await this.fail(invocation, `Conductor: ${conductor.message}`);
          return undefined;
        }
        await sleep(backoff, this.stopping.signal);
        if (this.stopped) return undefined;
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  /** 401/402: fail fast with the reason, and tell the owner once, in their DM with the agent. */
  private async keyRejected(invocation: Invocation, err: ConductorError): Promise<void> {
    const reason =
      err.status === 402 ? "The Conductor account's plan doesn't include the API (Pro or higher)." : "Conductor rejected this agent's API key.";
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
