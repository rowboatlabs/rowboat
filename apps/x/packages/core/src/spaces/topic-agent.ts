import fs from 'fs';
import path from 'path';
import type { ISessions } from '../runtime/sessions/api.js';
import type { SpaceMentionOrigin } from '@x/shared/dist/origins.js';
import { deriveTurnStatus, reduceTurn } from '@x/shared/dist/turns.js';
import { WorkDir } from '../config/config.js';
import { spacesMcpServerNameFor } from './orgs.js';

// @rowboat in a space (spec §8 grammar, §11 beat 7): an addressed message
// routes into ONE session per thread — the anchor is the addressed message's
// thread root (the message itself when it was posted to the stream), which is
// permanent, so topic rows can come and go (annotation model) without ever
// orphaning a session. The session runtime's queue/steer machinery decides
// what a second mention does (steer the running turn or start a new one) —
// this module deliberately doesn't.
//
// Contracts kept here:
// - The agent's final act is one post_message reply into the thread (spaces
//   skill). Nothing mechanical posts on its behalf.
// - Every message this module sends carries a space_mention ORIGIN (org,
//   space, thread root, feed message). The runtime stamps it on the turn it
//   starts, or on the input_added when it steers a live one, and the
//   agent-activity feed (agent-activity.ts) turns those events into the
//   room's "Rowboat is working" chip and lease. The session is user-openable
//   (thread pane + chat sidebar), so the person's own chat turns there carry
//   no origin and never light the chip.

const REGISTRY_FILE = path.join(WorkDir, 'config', 'spaces_topic_sessions.json');

export interface InvokeTopicAgentInput {
  orgId: string;
  spaceId: string;
  /** The thread the mention lives in: the message's root (its own id when it IS a root). */
  threadRootId: string;
  /** What to call the conversation: the topic's title when annotated, else the root's first line. */
  threadLabel: string;
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

function registryKey(orgId: string, spaceId: string, threadRootId: string): string {
  return `${orgId}/${spaceId}/${threadRootId}`;
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

/**
 * The thread's session, if one has been created — the renderer's "open the
 * agent session" affordance when no live activity record names it. Thread-
 * level only: the run behind ONE agent post is response-index.ts's job.
 */
export function topicSessionId(orgId: string, spaceId: string, threadRootId: string): string | null {
  return readRegistry().sessions[registryKey(orgId, spaceId, threadRootId)] ?? null;
}

// --- invocation message (pure; tested) --------------------------------------

export function buildInvocationMessage(input: InvokeTopicAgentInput, mcpServerName: string | null): string {
  // Deliberately carries NO thread content: the agent reads the discussion on
  // demand via read_thread — always fresh, paid for only when the task needs
  // it (read-before-act as procedure, same as the asset tools).
  return [
    '[Invoked from a space thread]',
    `Space: "${input.spaceName}" (spaceId: ${input.spaceId})`,
    `Thread: "${input.threadLabel}" (rootMessageId: ${input.threadRootId})`,
    ...(mcpServerName ? [`Org MCP server: ${mcpServerName}`] : []),
    `Invoked by feed message: ${input.messageId}`,
    '',
    'Load the "spaces" skill if not loaded and follow its "When invoked from a space thread" procedure. ' +
      `If the task concerns the conversation itself (summarising it, answering questions about it, catching up), ` +
      `call read_thread on this rootMessageId FIRST. ` +
      `Any propose_change you make must end its reason with " · thread:${input.threadRootId}" (provenance — it lists the change under this thread's artifacts). ` +
      `Do the work, then end with exactly ONE post_message receipt with threadRoot ${input.threadRootId}.`,
    '',
    '--- message from your person ---',
    input.body,
  ].join('\n');
}

/** The origin every mention-sent message carries (pure; tested). */
export function mentionOrigin(input: Pick<InvokeTopicAgentInput, 'orgId' | 'spaceId' | 'threadRootId' | 'messageId'>): SpaceMentionOrigin {
  return {
    kind: 'space_mention',
    orgId: input.orgId,
    spaceId: input.spaceId,
    threadRootId: input.threadRootId,
    messageId: input.messageId,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// --- the entry point ---------------------------------------------------------

async function resolveSessions(): Promise<ISessions> {
  // Lazy DI resolution to avoid module-init cycles (same idiom as todo/runner).
  const { lazyResolve } = await import('../di/lazy-resolve.js');
  return lazyResolve<ISessions>('sessions');
}

export async function invokeTopicAgent(input: InvokeTopicAgentInput): Promise<InvokeTopicAgentResult> {
  const sessions = await resolveSessions();

  // The thread's session — verified alive, or recreated (todo-runner idiom).
  const key = registryKey(input.orgId, input.spaceId, input.threadRootId);
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
      title: truncate(`${input.spaceName}: ${input.threadLabel}`, 100),
    });
    registry.sessions[key] = sessionId;
    writeRegistry(registry);
  }

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
      origin: mentionOrigin(input),
      ...(selection.effort ? { reasoningEffort: selection.effort } : {}),
      // Auto unless the composer asked for manual approval prompts (they
      // surface in the topic's session, reachable from the working chip).
      autoPermission: (input.options?.permissionMode ?? 'auto') === 'auto',
    },
  );

  return { sessionId, queued: outcome.queued };
}

/**
 * The stop square on the space's working chip: cancel the thread session's
 * live turn from where the user is watching, no session hop needed. Returns
 * stopped:false when there is nothing to stop (no session for the thread, or
 * its latest turn already settled) — the chip clears on its own then, when
 * the agent_working lease expires.
 */
export async function stopTopicAgent(input: {
  orgId: string;
  spaceId: string;
  threadRootId: string;
}): Promise<{ stopped: boolean }> {
  const sessionId = topicSessionId(input.orgId, input.spaceId, input.threadRootId);
  if (!sessionId) return { stopped: false };
  const sessions = await resolveSessions();
  let latestTurnId: string | undefined;
  try {
    latestTurnId = (await sessions.getSession(sessionId)).latestTurnId;
  } catch {
    return { stopped: false }; // session deleted since the registry entry
  }
  if (!latestTurnId) return { stopped: false };
  const turn = await sessions.getTurn(latestTurnId);
  const status = deriveTurnStatus(reduceTurn(turn.events));
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    return { stopped: false };
  }
  // idle or suspended = live (running, or parked on a permission/async tool).
  // The agent-activity feed sees the turn_cancelled: the chip clears and the
  // presence lease is released. Nothing is posted into the thread.
  await sessions.stopTurn(latestTurnId, 'stopped from the space');
  return { stopped: true };
}
