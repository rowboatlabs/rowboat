import { z } from 'zod';
import { addressesRowboat, mapMentionTokens, mentionsAsText } from '@rowboat/spaces-protocol';
import type {
  AcceptInviteResult,
  BlobInfo,
  ChangeSet,
  DeleteAssetResult,
  MoveAssetResult,
  RestoreAssetResult,
  ConflictRegion,
  CreateInviteResult,
  Member,
  Message,
  Poll,
  PollAnswer,
  PollEnd,
  PollVote,
  PollVoteGroup,
  ProposeChangeResult,
  Reaction,
  ReactionGroup,
  ReadAssetResult,
  ResolveInviteResult,
  SearchKind,
  SearchResults,
  MessageSearchHit,
  TopicSearchHit,
  AssetSearchHit,
  ServerFrame,
  Space,
  Topic,
  TopicListing,
  UnreadSnapshot,
  UnreadSpace,
  ActivityItem,
  ActivityKind,
  ActivityPage,
} from '@rowboat/spaces-protocol';

// Renderer-facing surface for Spaces. The wire contract's single source of
// truth is @rowboat/spaces-protocol (see apps/harbor/CONTRACT.md) — this file
// only re-exports the types the UI needs and defines the app-local envelopes
// (org records, the IPC event wrapper). Protocol-shaped payloads cross IPC via
// z.custom<T>() like the turn spine does: deep validation already happens in
// core's client (responses) and the org's server (requests).

export type {
  AcceptInviteResult,
  BlobInfo,
  ChangeSet,
  DeleteAssetResult,
  MoveAssetResult,
  RestoreAssetResult,
  ConflictRegion,
  CreateInviteResult,
  Member,
  Message,
  Poll,
  PollAnswer,
  PollEnd,
  PollVote,
  PollVoteGroup,
  ProposeChangeResult,
  Reaction,
  ReactionGroup,
  ReadAssetResult,
  ResolveInviteResult,
  SearchKind,
  SearchResults,
  MessageSearchHit,
  TopicSearchHit,
  AssetSearchHit,
  ServerFrame,
  Space,
  Topic,
  TopicListing,
};

/** The unread snapshot (read state, 2026-09-09): org-owned cursors in offsets. */
export type SpacesUnreadSnapshot = UnreadSnapshot;
export type SpacesUnreadSpace = UnreadSpace;

/** Activity (layer 3, 2026-09-10): everything that involves the member, newest first — the org's query, paged. */
export type SpacesActivityPage = ActivityPage;
export type SpacesActivityItem = ActivityItem;
export type SpacesActivityKind = ActivityKind;

/**
 * Poll creation as the renderer sends it (the wire's `NewPoll` block on
 * postMessage): the org assigns answer ids and turns the duration into an
 * expiry. Mirrored here as a plain interface — protocol-shaped payloads
 * cross IPC via z.custom<T>() like everything else in this file.
 */
export interface SpacesNewPollInput {
  question: string;
  answers: Array<{ text: string; emoji?: string }>;
  /** Hours until the poll closes. Default 24, max 768 (32 days). */
  durationHours?: number;
  allowMultiselect?: boolean;
}

/** An org this install is signed into — the renderer's view (auth details stay in core). */
export const SpacesOrgSummary = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  baseUrl: z.string(),
  /** Who we are on this org (org-scoped identity, spec §4). */
  memberId: z.string(),
  authKind: z.enum(['dev', 'oauth']),
  /** Present = the org needs a re-login (refresh dead). Visible and gentle, never silent. */
  authError: z.string().optional(),
});
export type SpacesOrgSummary = z.infer<typeof SpacesOrgSummary>;

export interface SpacesAssetEntry {
  path: string;
  version: number;
  updatedAt: string;
  /** Present when the head version is binary (spec §6). */
  blob?: BlobInfo;
  /** Present only on trash entries (listAssets includeDeleted); absent = live. */
  state?: 'deleted';
}

/** A stream page: roots only, plus the topic rows annotating this page's roots. */
export interface SpacesStreamPage {
  messages: Message[];
  topics: Topic[];
  /** Older roots exist below the returned window (listStream is windowed, newest-first). */
  hasMore: boolean;
  /** The caller's stream mark (0 = never marked) — the New divider's anchor. */
  readOffset: number;
}

/** One flat thread: the root, its annotation (null = a plain thread), windowed replies. */
export interface SpacesThreadPage {
  root: Message;
  topic: Topic | null;
  messages: Message[];
  hasMore: boolean;
  /** The caller's mark in this thread; null = not following (no mark is kept). */
  readOffset: number | null;
  following: boolean;
}

export interface SpacesPostResult {
  message: Message;
}

/** Promote (rootMessageId) or post + annotate (body) — exactly one of the two. */
export interface SpacesCreateTopicInput {
  rootMessageId?: string;
  title: string;
  body?: string;
}

export type SpacesManageTopicAction =
  | { action: 'retitle'; title: string }
  | { action: 'archive' }
  | { action: 'unarchive' }
  | { action: 'remove' }
  /** Link one live space file as what the discussion is about (replaces any earlier link). */
  | { action: 'attach_document'; path: string }
  | { action: 'detach_document' };

/**
 * What the renderer may propose. actingMode is deliberately absent: everything
 * a human does in the app is 'direct'; agent/scheduled writes go through the
 * org's MCP face, never through this IPC surface.
 */
export interface SpacesProposeInput {
  assetPath: string;
  baseVersion: number;
  /** Text variant. Exactly one of newContent / blob (contract decision 1, amended). */
  newContent?: string;
  /** Binary variant: the hash of bytes already uploaded via spaces:uploadBlob. */
  blob?: string;
  reason?: string;
}

/** Envelope for 'spaces:events' pushes: which org the live frame came from. */
/**
 * One thread where this member's Rowboat is working (or waiting to) on a
 * space mention — the agent-activity feed's unit (core/spaces/agent-activity).
 * `running` = a live turn was created from, or steered with, a mention in the
 * thread; `queued` = the mention waits in the session's pending queue.
 */
export interface SpaceAgentActivity {
  spaceId: string;
  threadRootId: string;
  state: 'queued' | 'running';
  /** The thread's agent session — the chip's click target. */
  sessionId: string;
  /** The live turn, when running. */
  turnId?: string;
}

// What rides 'spaces:events': the org's live frames (per-space subscription
// + member-addressed), and the agent-activity feed — the WHOLE list for the
// org on every change, replaced wholesale by the renderer (queue-changed's
// posture: small by nature).
export type SpacesBusEvent =
  | { orgId: string; frame: ServerFrame }
  | { orgId: string; agentActivity: SpaceAgentActivity[] };

// ---------------------------------------------------------------------------
// Whiteboard — the app-side vocabulary inside the org's opaque `payload`
// (contract amendment 2026-08-31: the org relays whiteboard frames without
// inspecting them, so THIS file, not the protocol, owns these shapes and
// Excalidraw upgrades never touch the Harbor contract).
//
// clientId is a random per-pane id: one member can hold the same board open
// in two windows or on two machines, and the relay echoes every frame back to
// the sender's own subscription — receivers drop frames whose clientId is
// their own, and key collaborator presence on clientId, never memberId.
// ---------------------------------------------------------------------------

/** One collaborator's live pointer, Excalidraw-shaped (`Collaborator.pointer` + selection). */
export interface SpacesWhiteboardCursor {
  x: number;
  y: number;
  tool: 'pointer' | 'laser';
  button: 'up' | 'down';
  /** Excalidraw appState.selectedElementIds — renders remote selection highlights. */
  selectedElementIds: Record<string, boolean>;
}

export type SpacesWhiteboardPayload =
  /**
   * Scene traffic. Diff frames carry only elements whose version advanced
   * since the sender's last broadcast; `syncAll` frames carry the full scene
   * including tombstones (the periodic self-heal, and the answer to
   * `scene_request`). Elements are Excalidraw's — opaque to every layer but
   * the whiteboard pane, which restores + reconciles them.
   */
  | { t: 'scene'; clientId: string; syncAll: boolean; elements: unknown[] }
  /** A joiner asking peers for a full scene (Excalidraw's new-user → SCENE_INIT). */
  | { t: 'scene_request'; clientId: string }
  | { t: 'cursor'; clientId: string; cursor: SpacesWhiteboardCursor }
  | { t: 'idle'; clientId: string; state: 'active' | 'idle' | 'away' };

/** Boards live under this asset prefix; the rail and the header button both key on it. */
export const WHITEBOARD_DIR = 'whiteboards';
export const WHITEBOARD_EXT = '.excalidraw';
/** The board the header button opens, created on first use. */
export const DEFAULT_WHITEBOARD_PATH = `${WHITEBOARD_DIR}/board${WHITEBOARD_EXT}`;

/**
 * Snapshots at or below this many UTF-8 bytes store as TEXT assets (the
 * contract caps text at 1MB); above it they fall back to a blob version. One
 * number for every writer — the pane and the agent's whiteboard tools — so a
 * board never flips transport depending on who saved it last.
 */
export const WHITEBOARD_TEXT_SNAPSHOT_MAX_BYTES = 900_000;

/**
 * A just-created board's snapshot — the same single-line shape the pane
 * saves, so creating via the rail's "+" and the pane's first save write
 * byte-identical content for an empty scene (identical proposes merge clean).
 */
export const EMPTY_WHITEBOARD_CONTENT = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'rowboat',
  elements: [],
  appState: {},
  files: {},
});

export function isWhiteboardPath(path: string): boolean {
  return path.startsWith(`${WHITEBOARD_DIR}/`) && path.endsWith(WHITEBOARD_EXT);
}

/** "whiteboards/roadmap.excalidraw" → "roadmap" (display name for rails/tabs). */
export function whiteboardDisplayName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith(WHITEBOARD_EXT) ? base.slice(0, -WHITEBOARD_EXT.length) : base;
}

/** A typed board name → its asset path; null when nothing usable remains. One cleaner for every create surface. */
export function whiteboardPathForName(name: string): string | null {
  const cleaned = name.trim().replace(/\//g, '-').replace(/\.excalidraw$/i, '').trim();
  return cleaned ? `${WHITEBOARD_DIR}/${cleaned}${WHITEBOARD_EXT}` : null;
}

// ---------------------------------------------------------------------------
// Mentions — the protocol's link-token grammar (mentions.ts) is the ONLY
// parser; these are the app's rendering faces of it, shared by the renderer
// and the phone. Nothing here reads a mention out of a name: a token carries
// the member id, the roster supplies the current name.
// ---------------------------------------------------------------------------

export {
  addressesRowboat,
  mapMentionTokens,
  mentionToken,
  mentionsAsText,
  parseMentions,
  relabelMentions,
  MENTION_TOKEN_RE,
} from '@rowboat/spaces-protocol';
export type { MentionRef, MentionStamps } from '@rowboat/spaces-protocol';

/** Does the body deliberately address @rowboat — a token, never the bare word (spec §8)? */
export function containsRowboatAddress(body: string): boolean {
  return addressesRowboat(body);
}

/**
 * For markdown surfaces without the chip renderer (the phone): tokens become
 * "**@Name**". Ids resolve through the roster; an id the roster no longer
 * knows keeps the token's label.
 */
export function decorateMentions(body: string, memberNames: ReadonlyMap<string, string>): string {
  return mapMentionTokens(body, (ref) => `**@${ref.kind === 'member' ? (memberNames.get(ref.id) ?? ref.label) : ref.kind}**`);
}

/**
 * For plain-text surfaces (titles, crumbs, quotes, forwards, copied text,
 * notification bodies): tokens become "@Name", no markup.
 */
export function resolveMentions(body: string, memberNames: ReadonlyMap<string, string>): string {
  return mentionsAsText(body, memberNames);
}
