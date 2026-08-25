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
import { ActingMode, Member, Message, ReactionEmoji, Space, Topic } from './core.js';
import { AssetPath, AssetVersion, BlobHash, MessageId, SpaceId, StreamOffset, TopicId } from './ids.js';
import {
  AcceptInvite,
  AcceptInviteResult,
  CreateInvite,
  CreateInviteResult,
  ResolveInvite,
  ResolveInviteResult,
} from './invite.js';

// The render face (spec §9): REST + the live stream in events.ts. Member token
// auth on every route. Shapes here are v0 — Latitude items (pagination, ETags,
// unread counters) may be added without a contract round as long as existing
// fields keep their meaning. The admin surface (/internal/*) is deliberately
// NOT in this package — it is control-plane-facing (spec §4).

const NewTopicMessage = z.object({
  /** Present = reply into this topic; absent = create a topic (first message becomes the title). */
  topicId: TopicId.optional(),
  /** Reply-to-activity-row: anchors the new topic to a change-set (only valid when creating). */
  anchorChangeSetId: z.string().optional(),
  /**
   * Reply-becomes-a-thread: anchors the new topic to an existing message
   * (only valid when creating; at most one topic per message). The org
   * validates the message exists in the space.
   */
  anchorMessageId: MessageId.optional(),
  body: z.string().min(1).max(65_536),
  actingMode: ActingMode,
  agentName: z.string().max(64).optional(),
});

/**
 * A listTopics entry: the topic plus its immutable FIRST message — every
 * consumer needs it (derived titles, thread parent cards, seed detection), so
 * it is always included rather than fetched per topic. Listing decoration
 * only: Topic objects inside events and post responses stay lean. The
 * firstMessage's `reactions` are the at-post snapshot (not folded live) —
 * this field is title/parent material, not a message listing.
 */
export const TopicListing = Topic.extend({ firstMessage: Message.nullable() });
export type TopicListing = z.infer<typeof TopicListing>;

export const routes = {
  // --- identity ------------------------------------------------------------
  /** Who am I on this org — the client's only source of its own memberId under OAuth. */
  me: {
    method: 'GET',
    path: '/v1/me',
    response: z.object({ member: Member }),
  },
  // --- spaces & membership -------------------------------------------------
  listSpaces: {
    method: 'GET',
    path: '/v1/spaces',
    response: z.object({ spaces: z.array(Space) }),
  },
  createSpace: {
    method: 'POST',
    path: '/v1/spaces',
    request: z.object({ name: z.string().min(1).max(128) }),
    response: z.object({ space: Space }),
  },
  listMembers: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/members',
    params: z.object({ spaceId: SpaceId }),
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
      topicId: TopicId.optional(),
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
      topicId: TopicId.optional(),
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
  listTopics: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/topics',
    params: z.object({ spaceId: SpaceId }),
    query: z.object({ includeArchived: z.coerce.boolean().optional() }),
    response: z.object({ topics: z.array(TopicListing) }),
  },
  /**
   * A topic's messages, windowed newest-first (returned oldest-first for
   * rendering): without `beforeOffset` the LATEST `limit` messages — never the
   * full history. Page back by passing the oldest received offset. `hasMore`
   * = older messages exist below the window. Message offsets ride the
   * space's one event sequence, so they are strictly increasing and are the
   * cursor (no timestamp ties).
   */
  listMessages: {
    method: 'GET',
    path: '/v1/spaces/:spaceId/topics/:topicId/messages',
    params: z.object({ spaceId: SpaceId, topicId: TopicId }),
    query: z.object({
      beforeOffset: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }),
    response: z.object({ topic: Topic, messages: z.array(Message), hasMore: z.boolean() }),
  },
  postMessage: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/messages',
    params: z.object({ spaceId: SpaceId }),
    request: NewTopicMessage,
    response: z.object({ topic: Topic, message: Message }),
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
  manageTopic: {
    method: 'POST',
    path: '/v1/spaces/:spaceId/topics/:topicId',
    params: z.object({ spaceId: SpaceId, topicId: TopicId }),
    request: z.discriminatedUnion('action', [
      z.object({ action: z.literal('retitle'), title: z.string().min(1).max(256) }),
      z.object({ action: z.literal('archive') }),
      z.object({ action: z.literal('unarchive') }),
      z.object({ action: z.literal('merge_into'), targetTopicId: TopicId }),
    ]),
    response: z.object({ topic: Topic }),
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
