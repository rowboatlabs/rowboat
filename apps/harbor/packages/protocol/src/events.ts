import { z } from 'zod';
import { ChangeSet } from './changeset.js';
import { Membership, Message, Topic } from './core.js';
import { MemberId, SpaceId, StreamOffset, TopicId } from './ids.js';

// Decision 2 (CONTRACT.md): one WebSocket per org, per-space subscriptions,
// offset-based catch-up. Subscribing with `afterOffset` replays durable events
// after that offset, then goes live — the same resume pattern as the app's
// turn-event spine. Presence is ephemeral and carries no offset.

/** Durable, offsetted facts. The feed's activity strand renders these (spec §7). */
export const SpaceEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('change'), changeSet: ChangeSet }),
  z.object({ type: z.literal('message'), message: Message }),
  /** Emitted on create and on any update (retitle, archive, anchor); carries the full topic. */
  z.object({ type: z.literal('topic'), topic: Topic }),
  z.object({
    type: z.literal('membership'),
    membership: Membership,
    action: z.enum(['joined', 'left', 'removed']),
  }),
]);
export type SpaceEvent = z.infer<typeof SpaceEvent>;

/**
 * A member holds two independent leases per topic: a human one (viewing /
 * typing, ended by `idle`) and an agent one (`agent_working`, ended by
 * `agent_idle`). Both frames carry the same memberId — the agent acts as the
 * member — so the end states must be distinct for receivers to know which
 * lease an `idle` closes.
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
    /** Scopes the state to one topic (e.g. agent_working on a thread); absent = space-wide. */
    topicId: TopicId.optional(),
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
    topicId: TopicId.optional(),
  }),
]);
export type ClientFrame = z.infer<typeof ClientFrame>;
