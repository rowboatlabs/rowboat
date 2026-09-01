import { z } from 'zod';
import { ChangeSet } from './changeset.js';
import { Attribution, Membership, Message, MessageDeletion, MessageEdit, Reaction, Topic, TopicRemoval } from './core.js';
import { AssetPath, MemberId, MessageId, SpaceId, StreamOffset } from './ids.js';

// Decision 2 (CONTRACT.md): one WebSocket per org, per-space subscriptions,
// offset-based catch-up. Subscribing with `afterOffset` replays durable events
// after that offset, then goes live — the same resume pattern as the app's
// turn-event spine. Presence is ephemeral and carries no offset.

/** Durable, offsetted facts. The feed's activity strand renders these (spec §7). */
export const SpaceEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('change'), changeSet: ChangeSet }),
  z.object({ type: z.literal('message'), message: Message }),
  /**
   * A topic's lifecycle: created (promote or from-scratch), retitled,
   * archived, unarchived — the full row plus who did it, so clients can
   * render attributed lifecycle lines in the thread. Idempotent re-archives
   * emit nothing; a reply reviving an archived topic emits 'unarchived'
   * attributed to the replier.
   */
  z.object({
    type: z.literal('topic'),
    topic: Topic,
    action: z.enum(['created', 'retitled', 'archived', 'unarchived']),
    by: Attribution,
  }),
  /** The row deleted ("convert back to thread") — the thread itself is untouched. */
  z.object({ type: z.literal('topic_removed'), removal: TopicRemoval }),
  z.object({
    type: z.literal('membership'),
    membership: Membership,
    action: z.enum(['joined', 'left', 'removed']),
  }),
  /** A reaction toggled on or off a message. Idempotent re-adds/re-removes emit nothing. */
  z.object({
    type: z.literal('reaction'),
    reaction: Reaction,
    action: z.enum(['added', 'removed']),
  }),
  /**
   * A message tombstoned by its author. The stored `message` event is
   * redacted in place (body '', deletedAt set) — the one mutation the log
   * allows, because deletion's whole point is that the content is gone,
   * replay included. This event is what live/folding clients apply.
   * Re-deleting is an idempotent no-op and emits nothing.
   */
  z.object({
    type: z.literal('message_deleted'),
    deletion: MessageDeletion,
  }),
  /**
   * A message body rewritten by its author. The stored `message` event is
   * rewritten in place (body + editedAt) — same posture as deletion: the old
   * text must be unrecoverable, replay included. Live/folding clients apply
   * this event; an identical-body edit emits nothing.
   */
  z.object({
    type: z.literal('message_edited'),
    edit: MessageEdit,
  }),
]);
export type SpaceEvent = z.infer<typeof SpaceEvent>;

/**
 * A member holds two independent leases per conversation: a human one
 * (viewing / typing, ended by `idle`) and an agent one (`agent_working`,
 * ended by `agent_idle`). Both frames carry the same memberId — the agent
 * acts as the member — so the end states must be distinct for receivers to
 * know which lease an `idle` closes.
 */
export const PresenceState = z.enum(['viewing', 'typing', 'agent_working', 'agent_idle', 'idle']);
export type PresenceState = z.infer<typeof PresenceState>;

/** Server → client frames. */
export const ServerFrame = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    spaceId: SpaceId,
    offset: StreamOffset,
    at: z.iso.datetime(),
    event: SpaceEvent,
  }),
  /** Ephemeral; never replayed; no offset. */
  z.object({
    kind: z.literal('presence'),
    spaceId: SpaceId,
    memberId: MemberId,
    state: PresenceState,
    /** Scopes the state to one thread (its root message id); absent = the stream / space-wide. */
    threadRootId: MessageId.optional(),
    at: z.iso.datetime(),
  }),
  /** Acknowledges a subscription; replay (if any) starts immediately after this frame. */
  z.object({
    kind: z.literal('subscribed'),
    spaceId: SpaceId,
    /** The offset replay starts after — echo of `afterOffset`, or the current head when omitted. */
    fromOffset: StreamOffset,
  }),
  z.object({
    kind: z.literal('error'),
    spaceId: SpaceId.optional(),
    code: z.string(),
    message: z.string(),
  }),
  /**
   * Liveness beacon, sent to every connection every ~25s regardless of
   * subscriptions. Carries no state — its arrival IS the signal: clients
   * treat prolonged silence as a half-open socket (laptop sleep, network
   * change, a proxy vanishing without FIN) and bounce the connection, which
   * replays from the last seen offset. Pre-ping clients ignore unknown frame
   * kinds by contract, so this is a v0-legal addition.
   */
  z.object({ kind: z.literal('ping'), at: z.iso.datetime() }),
  /**
   * Ephemeral whiteboard collaboration traffic (scene diffs, cursors, idle
   * state), fanned out to the space's subscribers. The payload is opaque to
   * the org on purpose — the same content-blind posture as the relay servers
   * whiteboard tools ship: membership is checked, bytes are relayed, nothing
   * is inspected. Never persisted, never replayed, no offset; durable board
   * state travels the normal asset path as blob snapshots, so a dropped frame
   * costs smoothness, not data. Pre-whiteboard clients ignore unknown frame
   * kinds by contract.
   */
  z.object({
    kind: z.literal('whiteboard'),
    spaceId: SpaceId,
    /** The board's asset path (its identity — a board IS an asset). */
    boardId: AssetPath,
    memberId: MemberId,
    at: z.iso.datetime(),
    payload: z.unknown(),
  }),
]);
export type ServerFrame = z.infer<typeof ServerFrame>;

/** Client → server frames. */
export const ClientFrame = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('subscribe'),
    spaceId: SpaceId,
    /** Omit to skip replay and go live from the current head. */
    afterOffset: StreamOffset.optional(),
  }),
  z.object({ kind: z.literal('unsubscribe'), spaceId: SpaceId }),
  z.object({
    kind: z.literal('presence'),
    spaceId: SpaceId,
    state: PresenceState,
    threadRootId: MessageId.optional(),
  }),
  /** Ephemeral whiteboard traffic; relayed to the space's subscribers with the sender stamped on. */
  z.object({
    kind: z.literal('whiteboard'),
    spaceId: SpaceId,
    boardId: AssetPath,
    payload: z.unknown(),
  }),
]);
export type ClientFrame = z.infer<typeof ClientFrame>;
