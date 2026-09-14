import fs from 'fs';
import path from 'path';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import type { SpaceMentionOrigin } from '@x/shared/dist/origins.js';
import { WorkDir } from '../config/config.js';
import { spacesMcpServerNameFor } from './orgs.js';

// "Which run wrote this reply?" — the per-response half of the space ↔ agent
// linkage. topic-agent.ts's registry answers "which session does this THREAD
// use" (one per thread, recreated when deleted), which is right for the
// working chip and the thread header's Chat link but cannot point at the
// exact turn behind one agent post, and silently re-points old posts at a
// fresh session once the original is gone.
//
// This module watches the turn bus for the agent's post_message calls made
// inside a mention-originated turn, and records feed message id → (session,
// turn, input) locally, next to the registry. The org never sees a session
// id: sessions are local to the machine whose Rowboat ran, so nobody else
// could resolve one anyway (when agents move into Harbor the org will know
// the run itself and can stamp provenance on the message then).
//
// Recognition is structural, not textual: a tool_invocation_requested for
// executeMcpTool whose server is the mention's org and whose inner tool is
// post_message, paired by toolCallId with its tool_result carrying the new
// message's id. The runtime knows nothing of this — same posture as
// agent-activity.ts.

const INDEX_FILE = path.join(WorkDir, 'config', 'spaces_response_sessions.json');
/** Insertion-ordered cap; the oldest links fall off first. */
export const MAX_LINKS = 2000;

export interface SpaceResponseLink {
  sessionId: string;
  turnId: string;
  /**
   * The input inside the turn that carried the mention this post answers:
   * absent = the turn's creating input, N = the Nth input_added (a mention
   * steered into a live turn). The renderer's user-row ids follow the same
   * shape (`${turnId}:user` / `${turnId}:user:${N}`), so this is what the
   * chat view scrolls to.
   */
  inputIndex?: number;
}

interface IndexFile {
  version: 1;
  links: Record<string, SpaceResponseLink>;
}

export interface ResponseLinkStore {
  read(): IndexFile;
  write(index: IndexFile): void;
}

export function linkKey(orgId: string, spaceId: string, messageId: string): string {
  return `${orgId}/${spaceId}/${messageId}`;
}

const fileStore: ResponseLinkStore = {
  read() {
    try {
      if (!fs.existsSync(INDEX_FILE)) return { version: 1, links: {} };
      const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) as Partial<IndexFile>;
      return { version: 1, links: raw.links ?? {} };
    } catch {
      return { version: 1, links: {} };
    }
  },
  write(index) {
    const dir = path.dirname(INDEX_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  },
};

function mentionOrigin(event: unknown): SpaceMentionOrigin | null {
  const origin = (event as { origin?: { kind?: string } }).origin;
  return origin?.kind === 'space_mention' ? (origin as SpaceMentionOrigin) : null;
}

interface TrackedInput {
  origin: SpaceMentionOrigin;
  inputIndex?: number;
}

interface TrackedTurn {
  sessionId: string;
  /** Mention inputs the turn accepted, in arrival order. */
  inputs: TrackedInput[];
}

interface PendingPost {
  turnId: string;
  orgId: string;
  spaceId: string;
  threadRoot: string | null;
}

/**
 * Pull the posted message id out of executeMcpTool's output. The MCP result
 * carries the org's `{ messageId, threadRoot? }` both as structuredContent
 * and as a JSON text block; either is accepted (pure; tested).
 */
export function postedMessageId(output: unknown): string | null {
  const o = output as { success?: boolean; messageId?: unknown; result?: unknown } | null;
  if (!o || o.success === false) return null;
  // The projected builtin (tools/domains/spaces.ts) unwraps the MCP envelope:
  // its output IS the tool's structured result, { messageId, threadRoot? }.
  if (typeof o.messageId === 'string' && o.messageId) return o.messageId;
  // The generic executeMcpTool envelope: { success, result: <MCP CallToolResult> }.
  const result = o.result as
    | { isError?: boolean; structuredContent?: { messageId?: unknown }; content?: Array<{ type?: string; text?: string }> }
    | null
    | undefined;
  if (!result || result.isError) return null;
  const structured = result.structuredContent?.messageId;
  if (typeof structured === 'string' && structured) return structured;
  for (const part of result.content ?? []) {
    if (part.type !== 'text' || typeof part.text !== 'string') continue;
    try {
      const parsed = JSON.parse(part.text) as { messageId?: unknown };
      if (typeof parsed.messageId === 'string' && parsed.messageId) return parsed.messageId;
    } catch {
      // not JSON — keep looking
    }
  }
  return null;
}

/**
 * A post_message call as the turn log records it, in either of its two
 * shapes: the projected builtin `post_message` (input: {org?, spaceId,
 * threadRoot?, body}) — what the spaces skill attaches since 2026-09-09 —
 * or the generic `executeMcpTool` envelope ({serverName, toolName:
 * 'post_message', arguments}) an older session or a foreign agent path uses.
 */
export function postMessageCall(
  toolName: string,
  input: unknown,
): { spaceId: string; threadRoot: string | null; org: { kind: 'server'; name: string } | { kind: 'arg'; value: string | null } } | null {
  const args = (input ?? null) as Record<string, unknown> | null;
  if (!args) return null;
  if (toolName === 'post_message') {
    if (typeof args.spaceId !== 'string') return null;
    return {
      spaceId: args.spaceId,
      threadRoot: typeof args.threadRoot === 'string' ? args.threadRoot : null,
      org: { kind: 'arg', value: typeof args.org === 'string' && args.org ? args.org : null },
    };
  }
  if (toolName === 'executeMcpTool') {
    if (args.toolName !== 'post_message' || typeof args.serverName !== 'string') return null;
    const a = (args.arguments ?? null) as Record<string, unknown> | null;
    if (!a || typeof a.spaceId !== 'string') return null;
    return {
      spaceId: a.spaceId,
      threadRoot: typeof a.threadRoot === 'string' ? a.threadRoot : null,
      org: { kind: 'server', name: args.serverName },
    };
  }
  return null;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The bus consumer. Pure apart from the injected store and server-name
 * lookup (tested); the module-level instance below wires the real ones.
 */
export class SpaceResponseIndexer {
  private readonly running = new Map<string, TrackedTurn>();
  private readonly pendingPosts = new Map<string, PendingPost>();

  constructor(
    private readonly store: ResponseLinkStore,
    private readonly serverNameFor: (orgId: string) => string | null,
  ) {}

  handleTurnEvent(busEvent: TurnBusEvent): void {
    const event = busEvent.event as { type?: string };
    switch (event.type) {
      case 'turn_created':
      case 'input_added': {
        const origin = mentionOrigin(event);
        if (!origin) return;
        let turn = this.running.get(busEvent.turnId);
        if (!turn) {
          turn = { sessionId: busEvent.sessionId ?? '', inputs: [] };
          this.running.set(busEvent.turnId, turn);
        }
        const inputIndex = event.type === 'input_added' ? (event as { inputIndex?: number }).inputIndex : undefined;
        turn.inputs.push({ origin, ...(typeof inputIndex === 'number' ? { inputIndex } : {}) });
        return;
      }
      case 'tool_invocation_requested': {
        const turn = this.running.get(busEvent.turnId);
        if (!turn) return;
        const e = event as { toolCallId: string; toolName: string; input?: unknown };
        const call = postMessageCall(e.toolName, e.input);
        if (!call) return;
        // The org this post targets — one of the mention origins' orgs (a
        // turn steered from two orgs is theoretical, but matching keeps the
        // attribution honest either way). The builtin's `org` argument is
        // omitted when one org is registered, so a lone candidate wins.
        const candidates = [...new Set(turn.inputs.map((i) => i.origin.orgId))];
        const org = call.org;
        let orgId: string | undefined;
        if (org.kind === 'server') {
          orgId = candidates.find((id) => this.serverNameFor(id) === org.name);
        } else if (org.value === null) {
          orgId = candidates.length === 1 ? candidates[0] : undefined;
        } else {
          const wanted = org.value;
          orgId = candidates.find((id) => {
            const server = this.serverNameFor(id);
            return id === wanted || server === wanted || server === `spaces-${slug(wanted)}`;
          });
        }
        if (!orgId) return;
        this.pendingPosts.set(e.toolCallId, { turnId: busEvent.turnId, orgId, spaceId: call.spaceId, threadRoot: call.threadRoot });
        return;
      }
      case 'tool_result': {
        const e = event as { toolCallId: string; result?: { output?: unknown; isError?: boolean } };
        const post = this.pendingPosts.get(e.toolCallId);
        if (!post) return;
        this.pendingPosts.delete(e.toolCallId);
        if (e.result?.isError) return;
        const messageId = postedMessageId(e.result?.output);
        if (!messageId) return;
        const turn = this.running.get(post.turnId);
        if (!turn) return;
        // The input this post answers: the mention in the same thread, else
        // the turn's first mention (a root post, or a thread the agent chose).
        const input =
          turn.inputs.find((i) => i.origin.spaceId === post.spaceId && i.origin.threadRootId === post.threadRoot) ?? turn.inputs[0];
        this.record(linkKey(post.orgId, post.spaceId, messageId), {
          sessionId: turn.sessionId,
          turnId: post.turnId,
          ...(input && typeof input.inputIndex === 'number' ? { inputIndex: input.inputIndex } : {}),
        });
        return;
      }
      case 'turn_completed':
      case 'turn_failed':
      case 'turn_cancelled': {
        this.running.delete(busEvent.turnId);
        for (const [id, post] of this.pendingPosts) {
          if (post.turnId === busEvent.turnId) this.pendingPosts.delete(id);
        }
        return;
      }
      default:
        return;
    }
  }

  link(orgId: string, spaceId: string, messageId: string): SpaceResponseLink | null {
    return this.store.read().links[linkKey(orgId, spaceId, messageId)] ?? null;
  }

  private record(key: string, link: SpaceResponseLink): void {
    const index = this.store.read();
    // Re-insert at the end so a rewrite counts as recent for the cap.
    delete index.links[key];
    index.links[key] = link;
    const keys = Object.keys(index.links);
    if (keys.length > MAX_LINKS) {
      for (const stale of keys.slice(0, keys.length - MAX_LINKS)) delete index.links[stale];
    }
    this.store.write(index);
  }
}

// --- the process-wide instance ----------------------------------------------

const indexer = new SpaceResponseIndexer(fileStore, spacesMcpServerNameFor);

let started: Promise<void> | null = null;

/** Subscribe the indexer to the turn bus. Idempotent; hosts call it at boot next to startSpaceAgentActivity. */
export function startSpaceResponseIndex(): Promise<void> {
  if (started) return started;
  started = (async () => {
    const { lazyResolve } = await import('../di/lazy-resolve.js');
    const turnEventBus = await lazyResolve<{ subscribeAll(listener: (event: TurnBusEvent) => void): () => void }>('turnEventBus');
    turnEventBus.subscribeAll((event) => indexer.handleTurnEvent(event));
  })();
  started.catch(() => {
    started = null; // let a later call retry
  });
  return started;
}

export type ResponseSessionResolution =
  /** The run that posted this message; the renderer opens the session at its input. */
  | { status: 'found'; sessionId: string; turnId: string; inputIndex?: number }
  /** A link exists but its session was deleted since — say so, never fall through to a recreated one. */
  | { status: 'gone' }
  /** Nothing recorded: a post from before this index existed, or not this member's Rowboat. */
  | { status: 'unknown' };

/** The message-row "Open agent chat" resolution. */
export async function resolveResponseSession(input: {
  orgId: string;
  spaceId: string;
  messageId: string;
}): Promise<ResponseSessionResolution> {
  const link = indexer.link(input.orgId, input.spaceId, input.messageId);
  if (!link) return { status: 'unknown' };
  const { lazyResolve } = await import('../di/lazy-resolve.js');
  const sessions = await lazyResolve<{ getSession(sessionId: string): Promise<unknown> }>('sessions');
  try {
    await sessions.getSession(link.sessionId);
  } catch {
    return { status: 'gone' };
  }
  return { status: 'found', ...link };
}
