import { z } from 'zod';
import { BlobInfo } from './blob.js';
import {
  ChangeSet,
  DeleteAssetResult,
  MoveAssetResult,
  ProposeChange,
  ProposeChangeResult,
  ReadAssetResult,
  RestoreAssetResult,
} from './changeset.js';
import { ActingMode, Attribution, Member, Message, ReactionEmoji, Space, SpaceKind, Topic } from './core.js';
import { AssetPath, AssetVersion, BlobHash, ChangeSetId, MemberId, MessageId, SpaceId, StreamOffset, TopicId } from './ids.js';
import {
  AcceptInvite,
  AcceptInviteResult,
  CreateInvite,
  CreateInviteResult,
  ResolveInvite,
  ResolveInviteResult,
} from './invite.js';
import { SearchKind, SearchResults } from './search.js';

// The render face (spec §9): REST + the live stream in events.ts. Member token
// auth on every route. Shapes here are v0 — Latitude items (pagination, ETags,
// unread counters) may be added without a contract round as long as existing
// fields keep their meaning. The admin surface (/internal/*) is deliberately
// NOT in this package — it is control-plane-facing (spec §4).

/**
 * Poll creation (the Discord create-request asymmetry: a duration in, an
 * expiry out — the org stamps `expiresAt` from its own clock). Answer ids are
 * server-assigned. The message's `body` must carry a plain-markdown fallback
 * rendering of the poll (question + numbered options) so poll-blind clients
 * still show it; poll-aware clients render the card instead.
 */
export const NewPoll = z.object({
  question: z.string().trim().min(1).max(300),
  answers: z
    .array(z.object({ text: z.string().trim().min(1).max(55), emoji: ReactionEmoji.optional() }))
    .min(2)
    .max(10),
  /** Hours until the poll closes. Default 24, max 32 days — Discord's bounds. */
  durationHours: z.number().int().min(1).max(768).optional(),
  allowMultiselect: z.boolean().optional(),
});

const NewMessage = z.object({
  /**
   * Present = a reply into the flat thread under this root (the org
   * normalizes a reply's id to its root, Slack-style); absent = a new root
   * message in the space's one stream. Posting a message never creates a
   * container — a topic exists only via createTopic.
   */
  threadRoot: MessageId.optional(),
  /** Reply-to-activity-row provenance (root posts only): the change-set this message answers. */
  anchorChangeSetId: ChangeSetId.optional(),
  body: z.string().min(1).max(65_536),
  /** Present = this message carries a poll (immutable once posted; editMessage refuses). */
  poll: NewPoll.optional(),
  actingMode: ActingMode,
  agentName: z.string().max(64).optional(),
});

/**
 * A listTopics entry: the row plus its root message (reply chips, parent
 * cards, unread anchors all need it) and the computed activity stamp the rail
 * sorts by (newest reply, else the root's post time). The rootMessage's
 * `reactions` are the at-post snapshot (not folded live) — this field is
 * title/parent material, not a message listing.
 */
export const TopicListing = Topic.extend({
  rootMessage: Message.nullable(),
  lastActivityAt: z.iso.datetime(),
});
export type TopicListing = z.infer<typeof TopicListing>;

/**
 * One space in the unread snapshot (read state, 2026-09-09). Counts exclude
 * the member's own messages and tombstones; `threads` lists only FOLLOWED
 * threads with live replies past the member's mark.
 */
export const UnreadSpace = z.object({
  spaceId: SpaceId,
  /** The space's current head offset. */
  head: StreamOffset,
  /** The member's stream mark (0 = never marked). */
  readOffset: StreamOffset,
  /** Roots after readOffset, not the member's, not deleted. */
  unreadRoots: z.number().int().nonnegative(),
  /**
   * Messages addressed to the member (a mention token naming them, or @here)
   * past the mark: unread roots plus the unread replies in followed threads.
   * The sidebar's number; `unreadRoots` is its bold.
   */
  unreadMentions: z.number().int().nonnegative(),
  threads: z.array(
    z.object({
      rootMessageId: MessageId,
      readOffset: StreamOffset,
      lastReplyOffset: StreamOffset,
      /** Live replies after readOffset, not the member's own. */
      unreadReplies: z.number().int().positive(),
      /** Of those, the ones addressed to the member. */
      unreadMentions: z.number().int().nonnegative(),
    }),
  ),
});
export type UnreadSpace = z.infer<typeof UnreadSpace>;

export const UnreadSnapshot = z.object({ spaces: z.array(UnreadSpace) });
export type UnreadSnapshot = z.infer<typeof UnreadSnapshot>;

/**
 * Activity (2026-09-10, the unread arc's layer 3): everything that involves
 * the member, across every space and DM they are in, newest first. Not a
 * table fanned out on write (Slack, Discord, GitHub) but a query over facts
 * the org already keeps — the stamped mentions, the follow rows, the DM
 * kind, the reactions (Zulip's Mentions/Inbox views work this way) — so
 * edits, deletes and the backfill stay consistent for free and there is no
 * second source of truth beside the read marks. Kinds, in the priority a
 * single message resolves to: `mention` (a token named you) > `here` >
 * `dm` (a message in your DM) > `reply` (in a thread you follow); plus
 * `reaction` (on a message of yours, folded per message and emoji).
 */
export const ActivityKind = z.enum(['mention', 'here', 'dm', 'reply', 'reaction']);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const ActivityItem = z.object({
  /** Stable identity: `m:<messageId>` for message kinds, `r:<messageId>:<emoji>` for a reaction. */
  id: z.string(),
  kind: ActivityKind,
  spaceId: SpaceId,
  spaceKind: SpaceKind,
  spaceName: z.string(),
  /** The thread the message lives in (absent = a stream root). */
  threadRootId: MessageId.optional(),
  /** The message the item is about: theirs for message kinds, yours for a reaction. */
  message: Message,
  /** Who did it: the author for message kinds; every reactor, newest first, for a reaction. */
  actors: z.array(Attribution),
  emoji: z.string().optional(),
  at: z.iso.datetime(),
  /**
   * Message kinds: the message is past your stream mark (a root) or your
   * thread mark (a reply) — reading in place clears it, one read-state
   * truth. Reactions: after your activity-seen mark (`markActivitySeen`).
   */
  unread: z.boolean(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const ActivityPage = z.object({
  items: z.array(ActivityItem),
  /** Present when older items exist: pass it back as `cursor`. */
  nextCursor: z.string().optional(),
  /** Your activity-seen mark (reactions before it are read); null = never marked. */
  seenAt: z.iso.datetime().nullable(),
  /** Display names for every member on the page (actors and mention tokens), from the org roster the caller may see. */
  names: z.record(MemberId, z.string()),
});
export type ActivityPage = z.infer<typeof ActivityPage>;

export const routes = {
  // --- identity ------------------------------------------------------------
  /** Who am I on this org — the client's only source of its own memberId under OAuth. */
  me: {
    method: 'GET',
    path: '/v1/me',
    response: z.object({ member: Member }),
  },
  // --- spaces & membership -------------------------------------------------
  /**
   * The spaces you are a member of. Default = SHARED spaces only (today's
   * shape, unchanged). `includeDirect` adds your direct messages — opt-in so
   * a pre-DM client never renders a DM as a space. Any present value counts
   * as true (coerce semantics, like every flag here).
   */
  listSpaces: {
    method: 'GET',
    path: '/v1/spaces',
    query: z.object({ includeDirect: z.coerce.boolean().optional() }),
    response: z.object({ spaces: z.array(Space) }),
  },
  /**
   * Direct messages (2026-09-07): a DM is a `direct` space between exactly
   * two members — same substrate, fixed membership (see SpaceKind). Get-or-
   * create, idempotent: the org keys DMs on the sorted participant pair, so
   * two members can only ever have one; `created` says whether this call
   * made it. No invite and no acceptance — the org is the trust boundary,
   * as inside one Slack workspace. The other participant learns of the space
   * by a `space_added` live frame (events.ts) and on their next listing.
   * Your own id opens your self-DM (2026-09-08: one participant, one
   * membership, notes to self); unknown members refuse (`not_found`).
   */
  openDirect: {
    method: 'POST',
    path: '/v1/direct',
    request: z.object({ memberId: MemberId }),
    response: z.object({ space: Space, created: z.boolean() }),
  },
  /**
   * Push notifications (2026-09-07, PUSH_PLAN.md): a member's device
   * registers its Expo push token and the member's notify level in one
   * idempotent call — the phone re-registers on every start and on every
   * preference change. Level is per MEMBER (all their devices); tokens are
   * per device. Org-scoped like everything: each org pushes for its own
   * spaces.
   */
  registerPush: {
    method: 'POST',
    path: '/v1/push/register',
    request: z.object({
      token: z.string().min(1).max(200),
      level: z.enum(['off', 'mentions', 'dms', 'all']),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  /** Sign-out: forget one device token (the member's level stays). */
  unregisterPush: {
    method: 'POST',
    path: '/v1/push/unregister',
    request: z.object({ token: z.string().min(1).max(200) }),
    response: z.object({ ok: z.literal(true) }),
  },
  createSpace: {
    method: 'POST',
    path: '/v1/spaces',
    request: z.object({ name: z.string().min(1).max(128) }),
    response: z.object({ space: Space }),
  },
  /**
   * Rename a space. Any member may rename (Slack channel semantics); direct
   * spaces refuse — their label derives from the participants. An identical
   * name is an idempotent no-op (no event). Everyone else learns by the
   * durable `space_renamed` event on the space's log.
   */
  renameSpace: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/rename',
    params: z.object({ spaceId: SpaceId }),
    request: z.object({ name: z.string().min(1).max(128), actingMode: ActingMode, agentName: z.string().max(64).optional() }),
    response: z.object({ space: Space }),
  },
  listMembers: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/members',
    params: z.object({ spaceId: SpaceId }),
    response: z.object({ members: z.array(Member) }),
  },
  /**
   * The org roster as THIS member may see it (2026-09-09): the union of the
   * rosters of every space (DMs included) the caller belongs to, deduped,
   * sorted by display name. Discovery is bounded by shared membership on
   * purpose — you can only find people you already share a space with — so
   * no admin-only directory and no privacy surface beyond what listMembers
   * already exposes per space. Both faces use it: the app's "New message"
   * picker and the agent's `list_members` resolve a name to a memberId here.
   */
  listOrgMembers: {
    method: 'GET',
    path: '/v1/members',
    response: z.object({ members: z.array(Member) }),
  },
  leaveSpace: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/leave',
    params: z.object({ spaceId: SpaceId }),
    response: z.object({ left: z.literal(true) }),
  },

  // --- invites -------------------------------------------------------------
  createInvite: {
    method: 'POST',
    path: '/v1/invites',
    request: CreateInvite,
    response: CreateInviteResult,
  },
  resolveInvite: {
    method: 'POST',
    path: '/v1/invites/resolve', // pre-auth allowed
    request: ResolveInvite,
    response: ResolveInviteResult,
  },
  acceptInvite: {
    method: 'POST',
    path: '/v1/invites/accept',
    request: AcceptInvite,
    response: AcceptInviteResult,
  },

  // --- assets --------------------------------------------------------------
  listAssets: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/assets',
    params: z.object({ spaceId: SpaceId }),
    /** Default = live files only (today's shape, unchanged). includeDeleted adds the trash. */
    query: z.object({ includeDeleted: z.coerce.boolean().optional() }),
    response: z.object({
      entries: z.array(
        z.object({
          path: AssetPath,
          version: AssetVersion,
          updatedAt: z.iso.datetime(),
          /** Present when the head version is binary. Folders are display: clients group paths on `/`. */
          blob: BlobInfo.optional(),
          /** Present only on trash entries (includeDeleted); absent = live. */
          state: z.literal('deleted').optional(),
        }),
      ),
    }),
  },
  /**
   * Namespace ops (2026-08-26): the path is the product's identity, but
   * storage keys on an internal per-asset id (the inode model), so these are
   * property updates — history and bytes never move. Only content edits bump
   * versions; each op appends one attributed change-set (op: move|delete|
   * restore) and its feed event. Old paths keep a redirect: reads follow it
   * (the result's `path` says where the file lives now); proposes refuse with
   * a pointer. Deleted files freeze in place, listable via includeDeleted,
   * restorable while their path is free; a fresh create over a deleted path
   * starts a new lineage and never blocks.
   */
  moveAsset: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/assets/move',
    params: z.object({ spaceId: SpaceId }),
    request: z.object({
      fromPath: AssetPath,
      toPath: AssetPath,
      /** Version of fromPath you last read — stale = conflict, same discipline as propose. */
      baseVersion: z.number().int().positive(),
      reason: z.string().max(1_000).optional(),
      threadRootId: MessageId.optional(),
      actingMode: ActingMode,
      agentName: z.string().max(64).optional(),
    }),
    response: MoveAssetResult, // 200 for both outcomes; occupied destination = invalid_request
  },
  deleteAsset: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/assets/delete',
    params: z.object({ spaceId: SpaceId }),
    request: z.object({
      path: AssetPath,
      baseVersion: z.number().int().positive(),
      reason: z.string().max(1_000).optional(),
      threadRootId: MessageId.optional(),
      actingMode: ActingMode,
      agentName: z.string().max(64).optional(),
    }),
    response: DeleteAssetResult,
  },
  restoreAsset: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/assets/restore',
    params: z.object({ spaceId: SpaceId }),
    request: z.object({
      /** The trash entry's path (most recently deleted wins if several share it). */
      path: AssetPath,
      reason: z.string().max(1_000).optional(),
      actingMode: ActingMode,
      agentName: z.string().max(64).optional(),
    }),
    response: RestoreAssetResult, // occupied path = invalid_request ("move the current file first")
  },
  readAsset: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/asset',
    params: z.object({ spaceId: SpaceId }),
    query: z.object({
      path: AssetPath,
      /** Omit for the current version; set for time-travel reads. */
      version: z.coerce.number().int().positive().optional(),
    }),
    response: ReadAssetResult,
  },
  proposeChange: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/changes',
    params: z.object({ spaceId: SpaceId }),
    request: ProposeChange,
    response: ProposeChangeResult, // 200 for all three outcomes, including conflict
  },
  assetHistory: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/history',
    params: z.object({ spaceId: SpaceId }),
    query: z.object({
      path: AssetPath.optional(), // omit for the whole space's change log
      beforeOffset: z.coerce.number().int().nonnegative().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }),
    response: z.object({ changeSets: z.array(ChangeSet) }),
  },
  diff: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/diff',
    params: z.object({ spaceId: SpaceId }),
    query: z.object({
      path: AssetPath,
      from: z.coerce.number().int().nonnegative(),
      to: z.coerce.number().int().positive(),
    }),
    response: z.object({ unified: z.string() }),
  },

  // --- blobs ---------------------------------------------------------------
  /**
   * Phase 1 of every upload (spec §6): put the bytes, get the address. Body is
   * the RAW BYTES, not JSON. Required header `x-blob-sha256`: the client-
   * computed address — the org recomputes and refuses a mismatch, so a
   * truncated or corrupted body can never be stored under a healthy name.
   * `content-type` is advisory; the org sniffs well-known types and stores its
   * own verdict. Idempotent by construction (same bytes → same hash → no-op).
   * Referencing the hash (a message's blob link, or proposeChange's blob
   * variant) is phase 2 — until then the blob is an orphan awaiting GC (§12).
   */
  uploadBlob: {
    method: 'PUT',
    path: '/v1/spaces/:spaceId/blobs',
    params: z.object({ spaceId: SpaceId }),
    response: z.object({ blob: BlobInfo }),
  },
  /**
   * The bytes back: a stream (disk-driver orgs) or a 302 to a short-lived
   * presigned URL (S3-family orgs) — clients just follow the redirect; which
   * driver an org runs is never observable in client code. Membership-gated;
   * hash-keyed means immutable, so responses are cacheable forever. Sniffed
   * images serve inline; everything else is forced `attachment` + nosniff.
   * `name` only shapes the download filename — never storage.
   */
  getBlob: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/blobs/:hash',
    params: z.object({ spaceId: SpaceId, hash: BlobHash }),
    query: z.object({ name: z.string().max(255).optional() }),
    response: z.never(),
  },

  // --- feed ----------------------------------------------------------------
  /** The rail: topic rows with their root messages, sorted by lastActivityAt desc. */
  listTopics: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/topics',
    params: z.object({ spaceId: SpaceId }),
    query: z.object({ includeArchived: z.coerce.boolean().optional() }),
    response: z.object({ topics: z.array(TopicListing) }),
  },
  /**
   * The space's one stream: ROOT messages only (replies live behind their
   * reply chips), windowed newest-first (returned oldest-first for
   * rendering): without `beforeOffset` the LATEST `limit` messages — never
   * the full history. Page back by passing the oldest received offset.
   * `hasMore` = older roots exist below the window. Message offsets ride the
   * space's one event sequence, so they are strictly increasing and are the
   * cursor (no timestamp ties). `topics` carries the rows annotating this
   * page's roots — the stream's badge decoration, one batched fetch.
   */
  listStream: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/stream',
    params: z.object({ spaceId: SpaceId }),
    query: z.object({
      beforeOffset: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }),
    response: z.object({
      messages: z.array(Message),
      topics: z.array(Topic),
      hasMore: z.boolean(),
      /** The caller's stream mark (0 = never marked) — the New divider's anchor. */
      readOffset: StreamOffset,
    }),
  },
  /**
   * One flat thread: the root, its topic row (null = a plain thread), and the
   * replies — same window semantics as the stream. A reply's id in the path
   * resolves to its root (Slack-style), and the response's `root` says where
   * you landed.
   */
  listThread: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/threads/:rootMessageId',
    params: z.object({ spaceId: SpaceId, rootMessageId: MessageId }),
    query: z.object({
      beforeOffset: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }),
    response: z.object({
      root: Message,
      topic: Topic.nullable(),
      messages: z.array(Message),
      hasMore: z.boolean(),
      /** The caller's mark in this thread, followed or not; null = never read nor followed. */
      readOffset: StreamOffset.nullable(),
      following: z.boolean(),
    }),
  },
  /**
   * Post a message: a stream root (no threadRoot) or a reply (threadRoot).
   * Never creates a topic. A reply to an archived topic's thread revives it —
   * the 'unarchived' topic event narrates (Gmail semantics: activity returns
   * a conversation to the rail).
   */
  postMessage: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/messages',
    params: z.object({ spaceId: SpaceId }),
    request: NewMessage,
    response: z.object({ message: Message }),
  },
  /**
   * Author-only tombstone (the content plane is role-flat, so deleter ==
   * author — spec §4). The body is redacted everywhere it lives (message row
   * AND the stored message event) and a message_deleted event goes on the
   * log. Idempotent — re-deleting is a 200 no-op with no event. Returns the
   * tombstoned message. POST like leaveSpace: the acting mode rides the body.
   */
  deleteMessage: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/messages/:messageId/delete',
    params: z.object({ spaceId: SpaceId, messageId: MessageId }),
    request: z.object({
      actingMode: ActingMode,
      agentName: z.string().max(64).optional(),
    }),
    response: z.object({ message: Message }),
  },
  /**
   * Author-only body rewrite (editor == author, exactly deletion's posture).
   * The body is replaced everywhere it lives (message row AND the stored
   * message event — an edit's point is that the old text is gone, replay
   * included) and a message_edited event goes on the log. Tombstones refuse
   * (invalid_request); an identical body is a 200 no-op with no event.
   * Activity is not bumped — editing must not resurface a quiet topic.
   */
  editMessage: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/messages/:messageId/edit',
    params: z.object({ spaceId: SpaceId, messageId: MessageId }),
    request: z.object({
      body: z.string().min(1).max(65_536),
      actingMode: ActingMode,
      agentName: z.string().max(64).optional(),
    }),
    response: z.object({ message: Message }),
  },
  /**
   * Toggle a reaction (Slack semantics: any member, any message, one per
   * member+emoji). Idempotent — re-adding or re-removing is a 200 no-op with
   * no event. The response carries the message with reactions folded in, so
   * the caller renders without waiting for the live frame. Tombstones take no
   * new reactions (removes still work, so cleanup stays possible).
   */
  reactToMessage: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/messages/:messageId/reactions',
    params: z.object({ spaceId: SpaceId, messageId: MessageId }),
    request: z.object({
      emoji: ReactionEmoji,
      action: z.enum(['add', 'remove']),
      actingMode: ActingMode,
      agentName: z.string().max(64).optional(),
    }),
    response: z.object({ message: Message }),
  },
  /**
   * Toggle a vote on a poll answer (reaction semantics: per-(member, answer),
   * idempotent no-op on re-add/re-remove). Single-select polls MOVE a vote —
   * adding while another answer holds yours removes that one atomically (a
   * `removed` then an `added` event under one lock). Closed polls (`endedAt`
   * set or `expiresAt` passed) and tombstones refuse. Any acting mode may
   * vote (parity, 2026-09-09): a vote cast by a member's agent IS that
   * member's vote — attribution says how it happened, never who else.
   * Returns the message with the poll's votes (and reactions) folded.
   */
  votePoll: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/messages/:messageId/poll/votes',
    params: z.object({ spaceId: SpaceId, messageId: MessageId }),
    request: z.object({
      answerId: z.number().int().min(1),
      action: z.enum(['add', 'remove']),
      actingMode: ActingMode,
      agentName: z.string().max(64).optional(),
    }),
    response: z.object({ message: Message }),
  },
  /**
   * End a poll early — author-only, like deletion (the content plane stays
   * role-flat); the author's agent counts as the author (parity,
   * 2026-09-09). Sets `endedAt` and emits `poll_ended`. Ending a poll that is
   * already closed (early-ended or naturally expired) is a 200 no-op with no
   * event. Natural expiry needs no call — clients compute it from `expiresAt`.
   */
  endPoll: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/messages/:messageId/poll/end',
    params: z.object({ spaceId: SpaceId, messageId: MessageId }),
    request: z.object({
      actingMode: ActingMode,
      agentName: z.string().max(64).optional(),
    }),
    response: z.object({ message: Message }),
  },
  /**
   * The deliberate ceremony: annotate a thread with a stated goal. Two modes,
   * exactly one of rootMessageId | body:
   *   - promote: `rootMessageId` names an existing thread's root (a reply's
   *     id is refused — promote the root); at most one topic per root.
   *   - from scratch: `body` posts a new root into the stream, then annotates
   *     it — nothing is ever born outside the stream.
   */
  createTopic: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/topics',
    params: z.object({ spaceId: SpaceId }),
    request: z
      .object({
        rootMessageId: MessageId.optional(),
        title: z.string().min(1).max(256),
        body: z.string().min(1).max(65_536).optional(),
        /** Attach a space file at birth (a live asset path; moved paths resolve). */
        documentPath: AssetPath.optional(),
        actingMode: ActingMode,
        agentName: z.string().max(64).optional(),
      })
      .superRefine((v, ctx) => {
        if ((v.rootMessageId === undefined) === (v.body === undefined)) {
          ctx.addIssue({ code: 'custom', message: 'exactly one of rootMessageId (promote) or body (from scratch)' });
        }
      }),
    response: z.object({ topic: Topic, rootMessage: Message }),
  },
  /**
   * One-row lifecycle ops on the annotation — none can touch a message.
   * `remove` deletes the row ("convert back to thread"); the conversation
   * stays in the stream untouched, and re-promoting later is lossless.
   * `attach_document` links one live space file (Topic.documentPath) —
   * replacing any earlier link; `detach_document` clears it. Both are
   * idempotent (no event when nothing changes).
   */
  manageTopic: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/topics/:topicId',
    params: z.object({ spaceId: SpaceId, topicId: TopicId }),
    request: z.discriminatedUnion('action', [
      z.object({ action: z.literal('retitle'), title: z.string().min(1).max(256), actingMode: ActingMode, agentName: z.string().max(64).optional() }),
      z.object({ action: z.literal('archive'), actingMode: ActingMode, agentName: z.string().max(64).optional() }),
      z.object({ action: z.literal('unarchive'), actingMode: ActingMode, agentName: z.string().max(64).optional() }),
      z.object({ action: z.literal('remove'), actingMode: ActingMode, agentName: z.string().max(64).optional() }),
      z.object({ action: z.literal('attach_document'), path: AssetPath, actingMode: ActingMode, agentName: z.string().max(64).optional() }),
      z.object({ action: z.literal('detach_document'), actingMode: ActingMode, agentName: z.string().max(64).optional() }),
    ]),
    response: z.object({ topic: Topic }),
  },

  // --- read state ----------------------------------------------------------
  /**
   * Read marks (2026-09-09): per-member cursors the org owns, so every device
   * agrees. Two scopes: the space's STREAM (no threadRootId) and one FOLLOWED
   * thread (threadRootId; a reply's id resolves to its root). The unit is the
   * space's event offset — the same integer that pages and replays — never a
   * timestamp. Marks only advance: a lower offset is a 200 no-op returning
   * the stored mark; an offset past the space's head is refused. Posting
   * directly advances the author's own mark (Slack/Mattermost posture; an
   * agent's post does not). A thread takes a mark whether or not the member
   * follows it (2026-09-11 — until then an unfollowed thread refused marks,
   * which left @here-in-thread, DM-thread and unfollowed-thread Activity rows
   * unread forever): following governs badges, counts and notifications, the
   * mark governs what is read. Every accepted mark is echoed to the member's
   * other connections as a `read_mark` frame (events.ts).
   */
  markRead: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/read',
    params: z.object({ spaceId: SpaceId }),
    request: z.object({
      /** Absent = the stream; present = a thread (a reply's id resolves to its root). */
      threadRootId: MessageId.optional(),
      offset: StreamOffset,
    }),
    /** The stored mark after the call (never lower than before). */
    response: z.object({ readOffset: StreamOffset }),
  },
  /**
   * Follow or unfollow a thread. Only followed threads count toward unread
   * and badge (v1 tracks followed threads only); a mark can sit on any thread. Which acts follow
   * automatically is org behaviour, not client convention — provisional rules
   * today: replying follows, and a root's author follows from the first reply
   * on. Unfollowing keeps the mark, so re-following never floods.
   */
  followThread: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/threads/:rootMessageId/follow',
    params: z.object({ spaceId: SpaceId, rootMessageId: MessageId }),
    request: z.object({ following: z.boolean() }),
    response: z.object({ following: z.boolean(), readOffset: StreamOffset }),
  },
  /**
   * The unread snapshot: one call at boot and on reconnect, every space the
   * member is in (DMs included) with its cursor, unread roots, and the
   * followed threads that currently have unread replies. Clients fold live
   * frames on top between snapshots.
   */
  unread: {
    method: 'GET',
    path: '/v1/unread',
    response: UnreadSnapshot,
  },
  /**
   * Activity: everything that involves the member, newest first, cursor
   * paged (the first time-ordered cross-space pager — `cursor` is opaque,
   * from the previous page's `nextCursor`). `kinds` narrows to a
   * comma-separated subset; `spaceId` to one space; `unread=true` to what
   * the read marks (and the activity-seen mark, for reactions) say is unread.
   */
  activity: {
    method: 'GET',
    path: '/v1/activity',
    query: z.object({
      kinds: z
        .string()
        .transform((s) => s.split(',').filter(Boolean))
        .pipe(z.array(ActivityKind))
        .optional(),
      spaceId: SpaceId.optional(),
      unread: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    response: ActivityPage,
  },
  /**
   * The member has looked at Activity through `at`: reactions at or before
   * it read as seen. Monotone — an older `at` is a no-op returning the mark.
   * Message kinds are never marked here; their read state is the space's.
   */
  markActivitySeen: {
    method: 'POST',
    path: '/v1/activity/seen',
    request: z.object({ at: z.iso.datetime() }),
    response: z.object({ seenAt: z.iso.datetime() }),
  },
  /**
   * Mark everything read (2026-09-11): every space the member is in — or the
   * one named — reads through its head, every thread holding an Activity row
   * for them (a mention, an @here, a reply in a DM, a reply in a thread they
   * follow) reads through its newest reply, and reactions read as seen. The
   * same marks single reads move, all at once, so Activity, the badges and
   * every device agree afterwards. Marks only advance: idempotent, and each
   * mark that moved echoes as a `read_mark` frame. `threads` = marks moved.
   */
  readAll: {
    method: 'POST',
    path: '/v1/activity/read-all',
    request: z.object({ spaceId: SpaceId.optional() }),
    response: z.object({
      spaces: z.array(z.object({ spaceId: SpaceId, readOffset: StreamOffset })),
      threads: z.number().int().nonnegative(),
      seenAt: z.iso.datetime(),
    }),
  },

  // --- search ---------------------------------------------------------------
  /**
   * Space search (search.ts): categorized top-N over messages, topics, and
   * assets. `q` is free text (AND-ed words, last word prefix-matched, member
   * names expand to their mentions); `kinds` narrows the categories searched
   * (default all); `limit` caps each category independently.
   */
  search: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/search',
    params: z.object({ spaceId: SpaceId }),
    query: z.object({
      q: z.string().min(1).max(512),
      kinds: z
        .string()
        .transform((s) => s.split(','))
        .pipe(z.array(SearchKind))
        .optional(),
      limit: z.coerce.number().int().positive().max(50).optional(),
    }),
    response: SearchResults,
  },

  // --- live ----------------------------------------------------------------
  /** WebSocket upgrade. Frames: events.ts ClientFrame / ServerFrame. One socket per org. */
  live: {
    method: 'GET',
    path: '/v1/live',
    response: z.never(),
  },
} as const;

export type Routes = typeof routes;

/** Latest durable offset per space — lets a client decide whether replay is needed. */
export const SpaceHeads = z.record(SpaceId, StreamOffset);
export type SpaceHeads = z.infer<typeof SpaceHeads>;
