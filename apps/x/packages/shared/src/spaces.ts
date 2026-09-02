import { z } from 'zod';
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
}

/** One flat thread: the root, its annotation (null = a plain thread), windowed replies. */
export interface SpacesThreadPage {
  root: Message;
  topic: Topic | null;
  messages: Message[];
  hasMore: boolean;
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
  | { action: 'remove' };

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
export interface SpacesBusEvent {
  orgId: string;
  frame: ServerFrame;
}

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
// Mention scanning — one implementation for the renderer (composer highlight,
// @rowboat trigger) and main (mention notifications).
//
// Address vs. cite rules (ported from buzz's mention scanner): text inside
// code fences, inline code, and quoted lines is writing ABOUT someone, not
// addressing them — stripped before scanning. The mention must sit at a word
// boundary ("email@rowboat.com" never triggers).
// ---------------------------------------------------------------------------

export function stripNonAddressRegions(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ') // fenced code blocks (incl. unterminated)
    .replace(/`[^`\n]*`/g, ' ') // inline code
    .replace(/^[ \t]*>.*$/gm, ' '); // markdown-quoted lines (citing someone else's message)
}

/** Does the body genuinely ADDRESS @<handle>? Case-insensitive. */
export function containsMemberAddress(body: string, handle: string): boolean {
  return addressRegExp(handle).test(stripNonAddressRegions(body));
}

function addressRegExp(handle: string): RegExp {
  const escaped = handle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Negative lookahead: not a longer handle ("@arjun.k", "@Arjun Kumaraswamy"
  // when matching "Arjun Kumar") — but trailing punctuation ("ping @arjun.")
  // still counts as addressing.
  return new RegExp(`(^|[\\s([{])@${escaped}(?!\\w|[.-]\\w)`, 'i');
}

/** What a mention can name someone by. Ids are opaque (spec §4), so people type the display name. */
export interface MentionIdentity {
  id: string;
  displayName?: string;
}

/**
 * Does the body address this member? The composer inserts the DISPLAY NAME
 * (an org's member ids are opaque IdP subjects — "@01M0F8S2…" helps nobody
 * reading the log), so that is the primary form; the id still matches so
 * agent-written and older messages keep working.
 */
export function mentionsMember(body: string, member: MentionIdentity): boolean {
  const stripped = stripNonAddressRegions(body);
  const handles = [member.displayName, member.id].filter((h): h is string => !!h && h.trim().length > 0);
  return handles.some((handle) => addressRegExp(handle).test(stripped));
}

/** The @rowboat address — always the speaker's own agent (spec §8). */
export function containsRowboatAddress(body: string): boolean {
  return containsMemberAddress(body, 'rowboat');
}

/**
 * The @here address — everyone in the space whose app is online, Slack-style.
 * There is no server fan-out: every member's client scans incoming messages
 * itself (mention-watch), so "online" is exactly "the app is running to see
 * this arrive"; whoever was away catches it in the missed-replay summary.
 */
export function containsHereAddress(body: string): boolean {
  return containsMemberAddress(body, 'here');
}

/**
 * The one walker that turns wire member addresses ("@<memberId>") into
 * people. Code regions stay literal (same address-vs-cite line the trigger
 * logic draws); unknown ids pass through untouched; @rowboat and @here keep
 * their handles. Every mention-rendering path — renderer surfaces AND main's
 * notification text — goes through here. Fix it once.
 */
function mapMentions(body: string, memberNames: ReadonlyMap<string, string>, wrap: (handle: string) => string): string {
  const parts = body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // a code region — cite, not address
      return part.replace(/(^|[\s([{])@([A-Za-z0-9][\w.-]*)/g, (match, pre: string, id: string) => {
        if (id.toLowerCase() === 'rowboat') return `${pre}${wrap('@rowboat')}`;
        if (id.toLowerCase() === 'here') return `${pre}${wrap('@here')}`;
        const name = memberNames.get(id);
        return name ? `${pre}${wrap(`@${name}`)}` : match;
      });
    })
    .join('');
}

/**
 * For markdown surfaces (message bodies): "@<memberId>" becomes
 * "**@Display Name**" so the pipeline sets it off in bold.
 */
export function decorateMentions(body: string, memberNames: ReadonlyMap<string, string>): string {
  return mapMentions(body, memberNames, (h) => `**${h}**`);
}

/**
 * For plain-text surfaces (topic titles, crumbs, reasons, notification
 * bodies): same resolution, no markup — safe for search haystacks too.
 */
export function resolveMentions(body: string, memberNames: ReadonlyMap<string, string>): string {
  return mapMentions(body, memberNames, (h) => h);
}
