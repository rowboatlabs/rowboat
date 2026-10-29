import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  LOCAL_CONNECTION,
  attachmentLinks,
  buildPrompt,
  instructionsSection,
  type Approval,
  type ApprovalChoice,
  type Invocation,
  type Member,
  type Message,
} from '@rowboat/spaces-protocol';
import { SpacesClient, SpacesLive, SpacesRequestError } from '@x/spaces-client';
import type { McpServer } from '@agentclientprotocol/sdk';
import type { SpacesLocalAgent } from '@x/shared/dist/spaces.js';
import { WorkDir } from '../config/config.js';
import type { ApprovalPolicy, CodeRunEvent, CodingAgent, PermissionAsk, PermissionDecision } from '../code-mode/acp/types.js';
import type { CodeModeManager } from '../code-mode/acp/manager.js';
import * as orgs from './orgs.js';

// Local agents (Harbor spec §4 Agent members, 2026-10-28): the owner's own
// Claude Code or Codex, run on this computer as a Spaces agent member. This
// module is that agent's connector, the same shape as Harbor's echo example
// (spec §8 Invoking agent members): it holds the agent's key, hears an
// invocation on the agent's live connection (and lists them every minute, the
// guarantee), acknowledges it, runs the turn through code mode's engine
// (code-mode/acp), reports what it is doing, and posts the answer in the
// thread. One engine session per thread, resumed across turns and restarts.
//
// What stays on this computer: the key, the folder the agent works in, and
// how it approves its own tool calls. Harbor knows none of them. The thread
// sees the reply and a one-line activity, never the tool output.

export type LocalAgentKind = 'claude-code' | 'codex';

/** One local agent this computer runs. */
export interface LocalAgentRecord {
  orgId: string;
  agentId: string;
  kind: LocalAgentKind;
  /** The agent's own key: this computer acts as the agent with it. */
  key: string;
  /** Where the agent works. */
  cwd: string;
  /** How it answers its own tool calls (code mode's policies). */
  policy: ApprovalPolicy;
}

/** What the app shows about a local agent: the record without its key, and how its connection is. */
export type LocalAgentState = SpacesLocalAgent;

const ENGINE: Record<LocalAgentKind, CodingAgent> = { 'claude-code': 'claude', codex: 'codex' };
const ENGINE_LABEL: Record<LocalAgentKind, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

export function isLocalAgentKind(kind: string | undefined): kind is LocalAgentKind {
  return kind === 'claude-code' || kind === 'codex';
}

// --- storage -----------------------------------------------------------------
// Beside the org records (orgs.ts keeps its tokens the same way), readable by
// this user only.

interface LocalAgentsConfig {
  version: 1;
  agents: LocalAgentRecord[];
  /** Per agent and thread, the offset of the last message the agent has seen: what the next prompt starts after. */
  seen: Record<string, number>;
}

const CONFIG_FILE = path.join(WorkDir, 'config', 'spaces_local_agents.json');

function readConfig(): LocalAgentsConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { version: 1, agents: [], seen: {} };
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Partial<LocalAgentsConfig>;
    return { version: 1, agents: Array.isArray(raw.agents) ? raw.agents : [], seen: raw.seen ?? {} };
  } catch {
    return { version: 1, agents: [], seen: {} };
  }
}

function writeConfig(config: LocalAgentsConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function sameAgent(a: { orgId: string; agentId: string }, b: { orgId: string; agentId: string }): boolean {
  return a.orgId === b.orgId && a.agentId === b.agentId;
}

function saveRecord(record: LocalAgentRecord): void {
  const config = readConfig();
  config.agents = [...config.agents.filter((r) => !sameAgent(r, record)), record];
  writeConfig(config);
}

function seenKey(agentId: string, threadRootId: string): string {
  return `${agentId}/${threadRootId}`;
}

// --- the reply ----------------------------------------------------------------

/**
 * The answer, from a turn's stream (pure; tested). A coding agent talks
 * between its tool calls ("Let me look at the tests…"); the reply is what it
 * said after its last one, or everything it said when that is empty.
 */
export class ReplyCollector {
  private segments: string[] = [''];

  add(event: CodeRunEvent): void {
    if (event.type === 'message' && event.role === 'agent') this.segments[this.segments.length - 1] += event.text;
    else if (event.type === 'tool_call') this.segments.push('');
  }

  reply(): string {
    const last = this.segments[this.segments.length - 1]!.trim();
    if (last) return last;
    return this.segments.map((s) => s.trim()).filter(Boolean).join('\n\n');
  }
}

/** One line for the thread, from a turn's event (pure; tested): what it is doing now, or nothing new. */
export function activityOf(event: CodeRunEvent): string | undefined {
  if (event.type === 'tool_call' && event.title) return event.title;
  if (event.type === 'plan') return event.entries.find((e) => e.status === 'in_progress')?.content;
  return undefined;
}

/** A person's decision on an approval card, as the engine's broker takes it (pure; tested). */
export function decisionFor(choice: ApprovalChoice): PermissionDecision {
  // A thread is one engine session, and the broker remembers "always" for that session.
  if (choice === 'allow_session' || choice === 'allow_always') return 'allow_always';
  if (choice === 'allow_once') return 'allow_once';
  return 'reject';
}

const MAX_BODY = 65_536;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// --- one agent's connector ---------------------------------------------------

const SWEEP_MS = 60_000;
/** Harbor fails a working invocation after 30 minutes without a report: say something at least this often. */
const HEARTBEAT_MS = 5 * 60_000;
/** Activity lines no faster than this. */
const ACTIVITY_MIN_MS = 2_000;

interface Running {
  abort: AbortController;
}

class LocalAgentRunner {
  private readonly client: SpacesClient;
  private live: SpacesLive | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private readonly running = new Map<string, Running>();
  /** Invocations this run has taken, so a frame and a listing never start one twice. */
  private readonly taken = new Set<string>();
  /** Approvals waiting on a person, by id. */
  private readonly decisions = new Map<string, (approval: Approval) => void>();
  private stopped = false;
  status: LocalAgentState['status'] = 'connecting';
  error: string | undefined;

  constructor(
    readonly agentId: string,
    readonly orgId: string,
    private readonly baseUrl: string,
    private readonly orgAddress: string,
    private readonly key: string,
    private readonly onChange: () => void,
  ) {
    this.client = new SpacesClient({ baseUrl, token: key });
  }

  /** The record as it is now: the folder and policy can change between turns. */
  private record(): LocalAgentRecord | undefined {
    return readConfig().agents.find((r) => sameAgent(r, this));
  }

  start(): void {
    const live = new SpacesLive({ baseUrl: this.baseUrl, token: this.key });
    this.live = live;
    live.onMemberFrame((frame) => {
      if (frame.kind === 'invocation') void this.take(frame.invocation);
      else if (frame.kind === 'invocation_stop') this.running.get(frame.invocationId)?.abort.abort();
      else if (frame.kind === 'approval_decided') this.decided(frame.approval);
    });
    live.onStatus((status) => {
      if (status === 'open') {
        this.setStatus('online');
        void this.sweep();
      } else if (status === 'closed' && this.status !== 'error') this.setStatus('offline');
    });
    // Stop is offered on its invocations; no options of its own yet.
    void this.client.declareCapabilities({ stop: true, options: [] }).catch((err) => this.fail(err));
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.live?.close();
    for (const run of this.running.values()) run.abort.abort();
  }

  private setStatus(status: LocalAgentState['status'], error?: string): void {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    this.onChange();
  }

  /** A refused key means another computer took the agent over, or its owner revoked it: stop, and say so. */
  private fail(err: unknown): void {
    if (err instanceof SpacesRequestError && err.status === 401) {
      this.setStatus('error', 'This computer’s key no longer works: the agent was set up on another computer, or its key was revoked.');
      this.stop();
    }
  }

  /** The listing is the guarantee: what the live frame missed, decisions, and turns a previous run left behind. */
  private async sweep(): Promise<void> {
    if (this.stopped) return;
    let listing: Awaited<ReturnType<SpacesClient['listAgentInvocations']>>;
    try {
      listing = await this.client.listAgentInvocations();
    } catch (err) {
      this.fail(err);
      return;
    }
    for (const approval of listing.approvals) this.decided(approval);
    for (const invocation of listing.invocations) {
      if (invocation.state === 'pending') void this.take(invocation);
      else if ((invocation.state === 'working' || invocation.state === 'waiting') && !this.running.has(invocation.id)) {
        // Acknowledged by a run of the app that is gone: its turn went with it.
        await this.client
          .updateInvocation(invocation.id, { state: 'failed', error: 'The app closed before finishing this. Mention me again to retry.' })
          .catch(() => {});
      }
    }
  }

  private decided(approval: Approval): void {
    const resolve = this.decisions.get(approval.id);
    if (resolve) {
      this.decisions.delete(approval.id);
      resolve(approval);
    }
    // Confirm it reached the engine, or that nothing here waits on it any more.
    void this.client.applyApproval(approval.id).catch(() => {});
  }

  private async take(invocation: Invocation): Promise<void> {
    if (this.stopped || invocation.state !== 'pending' || this.taken.has(invocation.id)) return;
    this.taken.add(invocation.id);
    const abort = new AbortController();
    this.running.set(invocation.id, { abort });
    try {
      await this.client.acknowledgeInvocation(invocation.id);
      // A person's answer to a turn waiting on them: this agent waits only on approvals, which are cards, not answers.
      if (invocation.answers) {
        await this.client.updateInvocation(invocation.id, { state: 'done' });
        return;
      }
      await this.run(invocation, abort.signal);
    } catch (err) {
      this.fail(err);
      const message = err instanceof Error ? err.message : String(err);
      await this.client.updateInvocation(invocation.id, { state: 'failed', error: clip(message, 1000) }).catch(() => {});
    } finally {
      this.running.delete(invocation.id);
    }
  }

  private async run(invocation: Invocation, signal: AbortSignal): Promise<void> {
    const record = this.record();
    if (!record) throw new Error('This agent is no longer set up on this computer.');
    const { spaceId, threadRootId } = invocation.conversation;
    const label = ENGINE_LABEL[record.kind];
    if (!fs.existsSync(record.cwd)) throw new Error(`${label}'s folder is missing on its owner's computer: ${record.cwd}`);

    let activity = 'Reading the thread';
    let lastReport = 0;
    // A line that comes too soon after the last one goes out when the gap has passed, so the latest always lands.
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const report = async (force = false) => {
      const wait = ACTIVITY_MIN_MS - (Date.now() - lastReport);
      if (!force && wait > 0) {
        trailing ??= setTimeout(() => {
          trailing = undefined;
          void report(true);
        }, wait);
        return;
      }
      if (trailing) clearTimeout(trailing);
      trailing = undefined;
      lastReport = Date.now();
      if (signal.aborted) return;
      await this.client.updateInvocation(invocation.id, { state: 'working', activity: clip(activity, 200) }).catch(() => {});
    };
    await report(true);
    const heartbeat = setInterval(() => void report(true), HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      // The owner's instructions (2026-10-29): Claude Code takes them as its system prompt; Codex takes
      // none from us, so they lead its message instead.
      const asSystemPrompt = record.kind === 'claude-code' && Boolean(invocation.instructions);
      const prompt = await this.prompt(invocation, signal, asSystemPrompt);
      activity = `Starting ${label}`;
      await report(true);

      const reply = new ReplyCollector();
      const manager = await resolveManager();
      const result = await manager.runPrompt({
        runId: `spaces-local-${this.agentId}-${threadRootId}`,
        agent: ENGINE[record.kind],
        cwd: record.cwd,
        prompt,
        policy: record.policy,
        ask: (ask) => this.ask(invocation, ask, signal),
        onEvent: (event) => {
          reply.add(event);
          const next = activityOf(event);
          if (next && next !== activity) {
            activity = next;
            void report();
          }
        },
        signal,
        mcpServers: [this.spacesTools()],
        ...(asSystemPrompt ? { systemPromptAppend: instructionsSection(invocation.instructions!) } : {}),
      });

      if (signal.aborted || result.stopReason === 'cancelled') {
        await this.client.updateInvocation(invocation.id, { state: 'cancelled' });
        return;
      }
      const body = reply.reply() || `${label} finished without saying anything.`;
      const posted = await this.client.postMessage(spaceId, { threadRoot: threadRootId, body: clip(body, MAX_BODY), actingMode: 'direct' });
      this.markSeen(threadRootId, posted.message.offset);
      await this.client.updateInvocation(invocation.id, { state: 'done' });
    } finally {
      clearInterval(heartbeat);
      if (trailing) clearTimeout(trailing);
    }
  }

  /** The Spaces tools, on the agent's own key: the agent reads the thread and files as itself. */
  private spacesTools(): McpServer {
    return { type: 'http', name: 'rowboat-spaces', url: `${this.baseUrl}/mcp`, headers: [{ name: 'Authorization', value: `Bearer ${this.key}` }] };
  }

  /**
   * What the engine hears (spec §8 Connectors): the request, the thread since
   * the agent last spoke there, and the standing paragraph, built as Harbor's
   * coding connectors build theirs. Files are saved on this computer and
   * listed by path: the agent is right here.
   */
  private async prompt(invocation: Invocation, signal: AbortSignal, instructionsInSystemPrompt: boolean): Promise<string> {
    const { spaceId, threadRootId } = invocation.conversation;
    const roster = await this.client.orgRoster().catch(() => ({ members: [] as Member[] }));
    const names = new Map(roster.members.map((m) => [m.id, m.displayName]));
    const trigger = await this.client.getMessage(spaceId, invocation.trigger.messageId).catch(() => undefined);
    const after = readConfig().seen[seenKey(this.agentId, threadRootId)] ?? 0;
    const context: Message[] = [];
    if (trigger && trigger.id !== threadRootId) {
      const page = await this.client.listThread(spaceId, threadRootId, { afterOffset: after, limit: 100 }).catch(() => undefined);
      if (page) {
        const earlier = [page.root, ...page.messages].filter(
          (m) => m.offset > after && m.offset < trigger.offset && m.author.memberId !== this.agentId && !m.deletedAt,
        );
        context.push(...earlier.slice(-50));
      }
    }
    if (trigger) this.markSeen(threadRootId, trigger.offset);

    const text = buildPrompt({
      invocation,
      instructionsInSystemPrompt,
      agentId: this.agentId,
      context,
      names,
      orgAddress: this.orgAddress,
      orgUrl: this.baseUrl,
      attachments: [],
      earlierAttachments: [],
    });
    const files = await this.saveAttachments(invocation, [invocation.trigger.body, ...context.map((m) => m.body)], signal);
    if (files.length === 0) return text;
    return `${text}\n\nAttached files, saved on this computer:\n${files.map((f) => `- ${f}`).join('\n')}`;
  }

  /** The thread's attachments, downloaded to a folder of this invocation's own. */
  private async saveAttachments(invocation: Invocation, bodies: string[], signal: AbortSignal): Promise<string[]> {
    const { spaceId } = invocation.conversation;
    const links = new Map<string, string>();
    for (const body of bodies) for (const { hash, name } of attachmentLinks(body, spaceId)) links.set(hash, name);
    if (links.size === 0) return [];
    const dir = path.join(os.tmpdir(), 'rowboat-spaces', invocation.id);
    fs.mkdirSync(dir, { recursive: true });
    const saved: string[] = [];
    for (const [hash, name] of links) {
      if (signal.aborted) break;
      try {
        const blob = await this.client.fetchBlob(spaceId, hash);
        const file = path.join(dir, path.basename(name) || hash.slice(0, 12));
        fs.writeFileSync(file, blob.bytes);
        saved.push(file);
      } catch {
        // A file that can't be fetched is left out; the thread still names it.
      }
    }
    return saved;
  }

  private markSeen(threadRootId: string, offset: number): void {
    const config = readConfig();
    const key = seenKey(this.agentId, threadRootId);
    if ((config.seen[key] ?? 0) >= offset) return;
    config.seen[key] = offset;
    writeConfig(config);
  }

  /** The engine asks before a tool call: a card in the thread, for its owner to decide (spec §8 part 4). */
  private async ask(invocation: Invocation, ask: PermissionAsk, signal: AbortSignal): Promise<PermissionDecision> {
    if (signal.aborted) return 'reject';
    const approval = await this.client.requestApproval(invocation.id, {
      requestKey: clip(ask.toolCallId ?? randomUUID(), 200),
      title: clip(ask.title, 200),
      detail: clip(ask.kind ? `${ask.kind}: ${ask.title}` : ask.title, 8000),
      choices: ['allow_once', 'allow_session', 'deny'],
    });
    const decided = await new Promise<Approval | undefined>((resolve) => {
      if (approval.state !== 'open') return resolve(approval);
      this.decisions.set(approval.id, resolve);
      signal.addEventListener('abort', () => resolve(undefined), { once: true });
    });
    if (!decided?.decision) {
      this.decisions.delete(approval.id);
      await this.client.closeApproval(approval.id, 'cancelled').catch(() => {});
      return 'reject';
    }
    return decisionFor(decided.decision);
  }
}

async function resolveManager(): Promise<CodeModeManager> {
  const { lazyResolve } = await import('../di/lazy-resolve.js');
  return lazyResolve<CodeModeManager>('codeModeManager');
}

// --- the agents this computer runs --------------------------------------------

const runners = new Map<string, LocalAgentRunner>();
const listeners = new Set<(agents: LocalAgentState[]) => void>();
const runnerKey = (orgId: string, agentId: string) => `${orgId}/${agentId}`;

function changed(): void {
  const agents = listLocalAgents();
  for (const fn of listeners) fn(agents);
}

/** Every change in what this computer runs, or how its connections are. */
export function onLocalAgentsChanged(fn: (agents: LocalAgentState[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listLocalAgents(): LocalAgentState[] {
  return readConfig().agents.map((r) => {
    const runner = runners.get(runnerKey(r.orgId, r.agentId));
    const missingOrg = !orgs.getOrg(r.orgId);
    return {
      orgId: r.orgId,
      agentId: r.agentId,
      kind: r.kind,
      cwd: r.cwd,
      policy: r.policy,
      status: missingOrg ? 'error' : (runner?.status ?? 'offline'),
      ...(missingOrg ? { error: 'This computer is no longer signed in to its server.' } : runner?.error ? { error: runner.error } : {}),
    };
  });
}

function startRunner(record: LocalAgentRecord): void {
  const key = runnerKey(record.orgId, record.agentId);
  runners.get(key)?.stop();
  runners.delete(key);
  const org = orgs.getOrg(record.orgId);
  if (!org) return;
  const runner = new LocalAgentRunner(record.agentId, record.orgId, org.baseUrl, org.address, record.key, changed);
  runners.set(key, runner);
  runner.start();
}

/**
 * Where a new local agent works unless its owner picks another folder: code
 * mode's default project (the one set in Settings, or the only one), else the
 * home folder.
 */
export async function defaultLocalAgentFolder(): Promise<string> {
  try {
    const { lazyResolve } = await import('../di/lazy-resolve.js');
    const projects = await (await lazyResolve<{ list(): Promise<Array<{ id: string; path: string }>> }>('codeProjectsRepo')).list();
    const configured = (await (await lazyResolve<{ getConfig(): Promise<{ defaultProjectId?: string }> }>('codeModeConfigRepo')).getConfig()).defaultProjectId;
    const project = projects.find((p) => p.id === configured) ?? (projects.length === 1 ? projects[0] : undefined);
    if (project && fs.existsSync(project.path)) return project.path;
  } catch {
    // No code projects: the home folder.
  }
  return os.homedir();
}

/** At launch: every local agent this computer runs, for each server it is still signed in to. */
export function startLocalAgents(): void {
  for (const record of readConfig().agents) startRunner(record);
  changed();
}

export function stopLocalAgents(): void {
  for (const runner of runners.values()) runner.stop();
  runners.clear();
}

/** Add a local agent: Harbor makes the member (always personal) and its first key, which stays here. */
export async function addLocalAgent(input: {
  orgId: string;
  displayName: string;
  kind: LocalAgentKind;
  cwd: string;
  policy: ApprovalPolicy;
}): Promise<{ agent: Member }> {
  const { agent, key } = await orgs.getClient(input.orgId).addAgent({
    displayName: input.displayName,
    kind: input.kind,
    connection: LOCAL_CONNECTION,
    personal: true,
  });
  const record: LocalAgentRecord = { orgId: input.orgId, agentId: agent.id, kind: input.kind, key: key.secret, cwd: input.cwd, policy: input.policy };
  saveRecord(record);
  startRunner(record);
  changed();
  return { agent };
}

/**
 * Run an existing local agent on this computer: a new key here, and every
 * other key revoked, so one computer answers for it. Also how it comes back
 * after its key stopped working.
 */
export async function connectLocalAgent(input: { orgId: string; agentId: string; cwd: string; policy: ApprovalPolicy }): Promise<void> {
  const client = orgs.getClient(input.orgId);
  const listing = (await client.listAgents()).find((a) => a.agent.id === input.agentId);
  if (!listing) throw new Error('Only the agent’s owner can run it on their computer.');
  if (listing.agent.agentConnection !== LOCAL_CONNECTION || !isLocalAgentKind(listing.agent.agentKind)) {
    throw new Error(`${listing.agent.displayName} doesn’t run on a computer.`);
  }
  const key = await client.createAgentKey(input.agentId);
  for (const old of listing.keys) {
    if (old.id !== key.id && !old.revokedAt) await client.revokeAgentKey(input.agentId, old.id).catch(() => {});
  }
  const record: LocalAgentRecord = { orgId: input.orgId, agentId: input.agentId, kind: listing.agent.agentKind, key: key.secret, cwd: input.cwd, policy: input.policy };
  saveRecord(record);
  startRunner(record);
  changed();
}

/** Change where it works or how it approves: the next turn reads them. */
export function updateLocalAgent(input: { orgId: string; agentId: string; cwd?: string; policy?: ApprovalPolicy }): void {
  const record = readConfig().agents.find((r) => sameAgent(r, input));
  if (!record) throw new Error('This agent doesn’t run on this computer.');
  saveRecord({ ...record, ...(input.cwd ? { cwd: input.cwd } : {}), ...(input.policy ? { policy: input.policy } : {}) });
  changed();
}

/** Stop running it here and forget its key. The member stays on its server. */
export function forgetLocalAgent(input: { orgId: string; agentId: string }): void {
  const key = runnerKey(input.orgId, input.agentId);
  runners.get(key)?.stop();
  runners.delete(key);
  const config = readConfig();
  config.agents = config.agents.filter((r) => !sameAgent(r, input));
  writeConfig(config);
  changed();
}
