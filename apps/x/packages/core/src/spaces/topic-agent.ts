import fs from 'fs';
import path from 'path';
import type { ITurnEventBus } from '../runtime/turns/event-hub.js';
import { type ISessions, RECLAIMED_TURN_REASON } from '../runtime/sessions/api.js';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import { WorkDir } from '../config/config.js';
import { getClient, getLive, spacesMcpServerNameFor } from './orgs.js';

// @rowboat in a space topic (spec §8 grammar, §11 beat 7): an addressed
// message routes into ONE session per topic. The session runtime's queue/steer
// machinery decides what a second mention does (steer the running turn or
// start a new one) — this module deliberately doesn't.
//
// Contracts kept here:
// - The agent's final act is one post_to_topic receipt (spaces skill). A
//   WATCHDOG enforces never-go-dark: any turn that ends without having posted
//   gets a short mechanical receipt posted on its behalf, attributed
//   actingMode 'agent' — the thread never ends in silence.
// - While turns run, an agent_working presence lease (renewed every 10s,
//   topic-scoped) tells the room; viewers prune stale chips themselves.

const REGISTRY_FILE = path.join(WorkDir, 'config', 'spaces_topic_sessions.json');
const PRESENCE_RENEW_MS = 10_000;

export interface InvokeTopicAgentInput {
  orgId: string;
  spaceId: string;
  topicId: string;
  topicTitle: string;
  spaceName: string;
  /** Feed message id of the @rowboat message — the invocation's provenance. */
  messageId: string;
  /** The message body, verbatim (the @rowboat address included). */
  body: string;
  /** Per-turn agent options from the composer's agent strip; absent = assistant defaults. */
  options?: {
    model?: { provider: string; model: string; effort?: 'low' | 'medium' | 'high' };
    permissionMode?: 'auto' | 'manual';
    searchEnabled?: boolean;
    codeMode?: 'claude' | 'codex';
  };
}

export interface InvokeTopicAgentResult {
  sessionId: string;
  /** true = an earlier turn was running; this message was queued to steer it. */
  queued: boolean;
}

// --- topic → session registry ----------------------------------------------

interface Registry {
  version: 1;
  sessions: Record<string, string>;
}

function registryKey(orgId: string, spaceId: string, topicId: string): string {
  return `${orgId}/${spaceId}/${topicId}`;
}

function readRegistry(): Registry {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return { version: 1, sessions: {} };
    const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')) as Partial<Registry>;
    return { version: 1, sessions: raw.sessions ?? {} };
  } catch {
    return { version: 1, sessions: {} };
  }
}

function writeRegistry(registry: Registry): void {
  const dir = path.dirname(REGISTRY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/** The topic's session, if one has been created — the renderer's "open the turn" affordance. */
export function topicSessionId(orgId: string, spaceId: string, topicId: string): string | null {
  return readRegistry().sessions[registryKey(orgId, spaceId, topicId)] ?? null;
}

// --- invocation message (pure; tested) --------------------------------------

export function buildInvocationMessage(input: InvokeTopicAgentInput, mcpServerName: string | null): string {
  // Deliberately carries NO thread content: the agent reads the discussion on
  // demand via read_topic — always fresh, paid for only when the task needs
  // it (read-before-act as procedure, same as the asset tools).
  return [
    '[Invoked from a space topic]',
    `Space: "${input.spaceName}" (spaceId: ${input.spaceId})`,
    `Topic: "${input.topicTitle}" (topicId: ${input.topicId})`,
    ...(mcpServerName ? [`Org MCP server: ${mcpServerName}`] : []),
    `Invoked by feed message: ${input.messageId}`,
    '',
    'Load the "spaces" skill if not loaded and follow its "When invoked from a space topic" procedure. ' +
      `If the task concerns the discussion itself (summarising it, answering questions about it, catching up), ` +
      `call read_topic on this topicId FIRST. ` +
      `Any propose_change you make must end its reason with " · topic:${input.topicId}" (provenance — it lists the change under this topic's artifacts). ` +
      `Do the work, then end with exactly ONE post_to_topic receipt to topicId ${input.topicId}.`,
    '',
    '--- message from your person ---',
    input.body,
  ].join('\n');
}

/**
 * Receipt wording for a failed turn (pure; tested). A dead sign-in is the common
 * case and should say so — a bare HTTP status helps nobody in a team feed.
 */
export function describeTurnError(error: string | undefined): string {
  const raw = (error ?? '').trim();
  if (!raw) return 'unknown error';
  if (/\b401\b|unauthori[sz]ed|unexpected HTTP response status code|not signed in|session expired/i.test(raw)) {
    return "your Rowboat isn't signed in (or the session expired). Sign in again in Settings → Account, then retry.";
  }
  if (/\b(402|payment|credits?|quota)\b/i.test(raw)) {
    return 'your Rowboat account is out of credits or the plan needs attention — check Settings → Account.';
  }
  if (/\b(429|rate limit)/i.test(raw)) return 'the model is rate-limited right now — try again in a minute.';
  return truncate(raw, 200);
}

/** Does this turn event carry the agent's receipt for the given topic? (pure; tested) */
export function isTopicReceiptCall(event: unknown, topicId: string): boolean {
  const e = event as {
    type?: string;
    toolName?: string;
    input?: { toolName?: string; arguments?: { topicId?: string } };
  };
  return (
    e.type === 'tool_invocation_requested' &&
    e.toolName === 'executeMcpTool' &&
    e.input?.toolName === 'post_to_topic' &&
    e.input?.arguments?.topicId === topicId
  );
}

// --- the watchdog ------------------------------------------------------------

interface TurnRecord {
  posted: boolean;
  terminal: boolean;
}

interface TopicWatch {
  orgId: string;
  spaceId: string;
  topicId: string;
  turns: Map<string, TurnRecord>;
  activeTurns: Set<string>;
  presenceTimer: ReturnType<typeof setInterval> | null;
}

const watches = new Map<string, TopicWatch>();

function ensureWatch(bus: ITurnEventBus, sessionId: string, scope: { orgId: string; spaceId: string; topicId: string }): void {
  if (watches.has(sessionId)) return;
  const watch: TopicWatch = {
    ...scope,
    turns: new Map(),
    activeTurns: new Set(),
    presenceTimer: null,
  };
  watches.set(sessionId, watch);
  // Subscription lives for the process (one per topic-session; bounded by
  // topics the user actually invokes in).
  bus.subscribeAll((busEvent) => {
    if (busEvent.sessionId !== sessionId) return;
    handleTurnEvent(watch, busEvent);
  });
}

function handleTurnEvent(watch: TopicWatch, busEvent: TurnBusEvent): void {
  let record = watch.turns.get(busEvent.turnId);
  if (!record) {
    record = { posted: false, terminal: false };
    watch.turns.set(busEvent.turnId, record);
    watch.activeTurns.add(busEvent.turnId);
    startPresence(watch);
  }
  if (record.terminal) return;

  const event = busEvent.event as { type?: string };
  if (isTopicReceiptCall(event, watch.topicId)) {
    record.posted = true;
    return;
  }
  // NOTE: turn_suspended is deliberately NOT terminal — a turn waiting on a
  // permission keeps its presence chip; the invoker resolves it in the session.
  if (event.type === 'turn_completed' || event.type === 'turn_failed' || event.type === 'turn_cancelled') {
    record.terminal = true;
    watch.activeTurns.delete(busEvent.turnId);
    if (watch.activeTurns.size === 0) stopPresence(watch);
    if (!record.posted) {
      void postBackstop(watch, event as never).catch((err) => {
        console.error('[spaces] backstop receipt failed:', err);
      });
    }
  }
}

function startPresence(watch: TopicWatch): void {
  if (watch.presenceTimer) return;
  const send = () => {
    try {
      getLive(watch.orgId).presence(watch.spaceId, 'agent_working', watch.topicId);
    } catch {
      // org removed mid-run; nothing to signal
    }
  };
  send();
  watch.presenceTimer = setInterval(send, PRESENCE_RENEW_MS);
  watch.presenceTimer.unref?.();
}

function stopPresence(watch: TopicWatch): void {
  if (!watch.presenceTimer) return;
  clearInterval(watch.presenceTimer);
  watch.presenceTimer = null;
  try {
    // agent_idle, not idle: both frames carry the member's id, and idle would
    // read as the human lease ending (the agent chip then lingers to its TTL).
    getLive(watch.orgId).presence(watch.spaceId, 'agent_idle', watch.topicId);
  } catch {
    // best effort
  }
}

/** Extract the assistant's final text from a turn_completed output, defensively. */
export function finalAssistantText(output: unknown): string | null {
  if (typeof output === 'string') return output || null;
  if (!Array.isArray(output)) return null;
  for (let i = output.length - 1; i >= 0; i--) {
    const message = output[i] as { role?: string; content?: unknown };
    if (message?.role !== 'assistant') continue;
    if (typeof message.content === 'string') return message.content || null;
    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => (typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
        .join('')
        .trim();
      if (text) return text;
    }
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The backstop receipt's wording (pure; tested). A cancelled turn is usually a
 * person pressing Stop — except a reclaim: sendOrQueueMessage cancelling a
 * crash-orphaned turn because a NEW mention just arrived. That one must not
 * read as the new run failing; the new turn posts its own receipt right after.
 */
export function backstopBody(event: {
  type: string;
  error?: string;
  reason?: string;
  output?: unknown;
}): string {
  if (event.type === 'turn_failed') {
    return `⚠️ Rowboat couldn't complete this — ${describeTurnError(event.error)}`;
  }
  if (event.type === 'turn_cancelled') {
    return event.reason === RECLAIMED_TURN_REASON
      ? '⚠️ An earlier Rowboat run here was interrupted — picking up your latest message now.'
      : `⚠️ Rowboat's run was stopped before it finished.`;
  }
  const text = finalAssistantText(event.output);
  return text
    ? `Rowboat finished without posting a receipt. Its final note: "${truncate(text, 300)}"`
    : 'Rowboat finished without posting a receipt or leaving a note.';
}

/** Never go dark: the turn ended without posting its receipt — post one for it. */
async function postBackstop(
  watch: TopicWatch,
  event: { type: string; error?: string; reason?: string; output?: unknown },
): Promise<void> {
  const body = backstopBody(event);
  await getClient(watch.orgId).postMessage(watch.spaceId, {
    topicId: watch.topicId,
    body,
    actingMode: 'agent',
    agentName: 'Rowboat',
  });
}

// --- the entry point ---------------------------------------------------------

async function resolveDeps(): Promise<{ sessions: ISessions; turnEventBus: ITurnEventBus }> {
  // Lazy DI resolution to avoid module-init cycles (same idiom as todo/runner).
  const { lazyResolve } = await import('../di/lazy-resolve.js');
  return {
    sessions: await lazyResolve<ISessions>('sessions'),
    turnEventBus: await lazyResolve<ITurnEventBus>('turnEventBus'),
  };
}

export async function invokeTopicAgent(input: InvokeTopicAgentInput): Promise<InvokeTopicAgentResult> {
  const { sessions, turnEventBus } = await resolveDeps();

  // The topic's session — verified alive, or recreated (todo-runner idiom).
  const key = registryKey(input.orgId, input.spaceId, input.topicId);
  const registry = readRegistry();
  let sessionId: string | null = registry.sessions[key] ?? null;
  if (sessionId) {
    try {
      await sessions.getSession(sessionId);
    } catch {
      sessionId = null; // deleted — start over
    }
  }
  if (!sessionId) {
    sessionId = await sessions.createSession({
      title: truncate(`${input.spaceName}: ${input.topicTitle}`, 100),
    });
    registry.sessions[key] = sessionId;
    writeRegistry(registry);
  }

  // Watchdog before send — race-free for every event after turn_created.
  ensureWatch(turnEventBus, sessionId, {
    orgId: input.orgId,
    spaceId: input.spaceId,
    topicId: input.topicId,
  });

  const serverName = spacesMcpServerNameFor(input.orgId);
  const content = buildInvocationMessage(input, serverName);

  // Model: the composer's pick for this turn, else the assistant's default.
  const picked = input.options?.model;
  const selection = picked
    ? { provider: picked.provider, model: picked.model, effort: picked.effort }
    : await (await import('../models/defaults.js')).getDefaultModelAndProvider();
  const composition = {
    ...(input.options?.searchEnabled ? { searchEnabled: true } : {}),
    ...(input.options?.codeMode ? { codeMode: input.options.codeMode } : {}),
  };

  const outcome = await sessions.sendOrQueueMessage(
    sessionId,
    { role: 'user', content },
    {
      agent: {
        agentId: 'copilot',
        overrides: {
          model: { provider: selection.provider, model: selection.model },
          ...(Object.keys(composition).length > 0 ? { composition } : {}),
        },
      },
      useCase: 'copilot_chat',
      subUseCase: 'space_topic',
      ...(selection.effort ? { reasoningEffort: selection.effort } : {}),
      // Auto unless the composer asked for manual approval prompts (they
      // surface in the topic's session, reachable from the working chip).
      autoPermission: (input.options?.permissionMode ?? 'auto') === 'auto',
    },
  );

  return { sessionId, queued: outcome.queued };
}
