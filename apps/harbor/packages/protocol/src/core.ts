import { z } from 'zod';
import { ChangeSetId, MemberId, MessageId, SpaceId, StreamOffset, TopicId } from './ids.js';

// Core objects shared by both faces. Every act in a space belongs to a member
// (spec §2, principle 4); attribution carries the acting mode, never a separate
// "bot" identity.

export const ActingMode = z.enum(['direct', 'agent', 'scheduled']);
export type ActingMode = z.infer<typeof ActingMode>;

export const Attribution = z.object({
  memberId: MemberId,
  actingMode: ActingMode,
  /** Display-only agent label, e.g. "Rowboat", "Claude Code". Never an identity. */
  agentName: z.string().max(64).optional(),
});
export type Attribution = z.infer<typeof Attribution>;

/**
 * The org-level admin bit (spec §4, amended 2026-08-19): admin powers are
 * membership and policy, never content — the content plane is role-flat.
 */
export const MemberRole = z.enum(['admin', 'member']);
export type MemberRole = z.infer<typeof MemberRole>;

export const Member = z.object({
  id: MemberId,
  /** Display-only, org-scoped, not unique. Attribution keys on `id`, never on names. */
  displayName: z.string().min(1).max(128),
  avatarUrl: z.string().url().optional(),
  role: MemberRole.default('member'),
});
export type Member = z.infer<typeof Member>;

export const Space = z.object({
  id: SpaceId,
  name: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
});
export type Space = z.infer<typeof Space>;

export const Membership = z.object({
  spaceId: SpaceId,
  memberId: MemberId,
  joinedAt: z.iso.datetime(),
});
export type Membership = z.infer<typeof Membership>;

/**
 * The deliberate conversation object (spec §7, annotation model 2026-09-01):
 * one row POINTING AT a thread's root message, carrying the stated goal
 * (title) and the archived flag. It contains no messages — deleting it
 * ("convert back to thread") loses nothing, archiving it hides nothing.
 * At most one topic per root; durable identity (agent sessions, presence,
 * unread) keys on the root message, never on this row. "Topic" is the wire
 * and storage name on purpose — the UI label ("Discussions" today) may drift
 * without a contract round. A plain reply chain with no row is a "thread".
 */
export const Topic = z.object({
  id: TopicId,
  spaceId: SpaceId,
  /** The thread this annotates: a stream root message (never a reply). */
  rootMessageId: MessageId,
  /** The stated goal, required at creation — the one deliberate ceremony. */
  title: z.string().min(1).max(256),
  createdBy: Attribution,
  createdAt: z.iso.datetime(),
  /** Off the rail. Nothing else anywhere changes; a new reply revives (un-archives). */
  archived: z.boolean(),
});
export type Topic = z.infer<typeof Topic>;

/** The payload of `topic_removed`: the row is gone, the thread is untouched. */
export const TopicRemoval = z.object({
  spaceId: SpaceId,
  topicId: TopicId,
  rootMessageId: MessageId,
  by: Attribution,
  at: z.iso.datetime(),
});
export type TopicRemoval = z.infer<typeof TopicRemoval>;

/** The emoji itself ("👍", ZWJ sequences included), rendered verbatim — never a :name:. */
export const ReactionEmoji = z
  .string()
  .min(1)
  .max(32)
  .refine((e) => !/\s/.test(e), 'an emoji has no whitespace');
export type ReactionEmoji = z.infer<typeof ReactionEmoji>;

/**
 * One member's reaction to one message — a per-(member, emoji) toggle, Slack
 * semantics. Attribution follows the contract's one rule (principle 4): the
 * act belongs to a member, `by.actingMode` says how it happened. `threadRoot`
 * mirrors the message's (absent = a stream root) so live clients route the
 * event without a lookup.
 */
export const Reaction = z.object({
  spaceId: SpaceId,
  messageId: MessageId,
  threadRoot: MessageId.optional(),
  emoji: ReactionEmoji,
  by: Attribution,
  at: z.iso.datetime(),
});
export type Reaction = z.infer<typeof Reaction>;

/** Display aggregate: who reacted with one emoji, in first-reacted order. */
export const ReactionGroup = z.object({
  emoji: ReactionEmoji,
  memberIds: z.array(MemberId).min(1),
});
export type ReactionGroup = z.infer<typeof ReactionGroup>;

/**
 * The author tombstoning their own message — the one act the content plane
 * restricts to a single member (deleter == author always; admin powers are
 * membership/policy, never content — spec §4). Like Reaction, `threadRoot`
 * mirrors the message's, for event routing.
 */
export const MessageDeletion = z.object({
  spaceId: SpaceId,
  messageId: MessageId,
  threadRoot: MessageId.optional(),
  by: Attribution,
  at: z.iso.datetime(),
});
export type MessageDeletion = z.infer<typeof MessageDeletion>;

/** An author's in-place rewrite of a message body — the payload of `message_edited`. */
export const MessageEdit = z.object({
  spaceId: SpaceId,
  messageId: MessageId,
  threadRoot: MessageId.optional(),
  body: z.string().min(1).max(65_536),
  by: Attribution,
  at: z.iso.datetime(),
});
export type MessageEdit = z.infer<typeof MessageEdit>;

export const Message = z.object({
  id: MessageId,
  spaceId: SpaceId,
  /**
   * The write-once reply pointer (annotation model): absent = a root message
   * in the space's one stream; present = a reply in the flat thread under
   * that root. Always a ROOT's id — never a reply's (the org normalizes), so
   * threads are flat by shape, not convention. Set at post time, immutable.
   */
  threadRoot: MessageId.optional(),
  author: Attribution,
  /**
   * Markdown. The link grammar (ids.ts) is valid inside message bodies.
   * Empty exactly when the message is deleted (post routes keep min 1 on
   * their request shapes) — a tombstone keeps its id and offset but carries
   * no content, anywhere, ever again.
   */
  body: z.string().max(65_536),
  postedAt: z.iso.datetime(),
  offset: StreamOffset,
  /**
   * Reply denorm on ROOT messages: live (non-tombstoned) replies in this
   * message's thread, so every listing can render the reply chip without a
   * reverse lookup. Maintained by the org; 0 on replies and on stored
   * message events (reads carry the current truth, like reactions).
   */
  replyCount: z.number().int().nonnegative().default(0),
  /** When the newest reply landed (roots with replies only) — chip recency + rail sorting. */
  lastReplyAt: z.iso.datetime().optional(),
  /** Provenance when this root was posted in reply to an activity row (a change-set). */
  anchorChangeSetId: ChangeSetId.optional(),
  /** Set when the author deleted the message (deleter == author, so no separate attribution). */
  deletedAt: z.iso.datetime().optional(),
  /** Set when the author last edited the body (editor == author, like deletion). */
  editedAt: z.iso.datetime().optional(),
  /**
   * Folded reactions, groups in first-reacted order. The default keeps pre-
   * reaction payloads (older servers, stored message events) parseable; reads
   * fold live state in, so the field is current wherever messages are listed.
   */
  reactions: z.array(ReactionGroup).default([]),
});
export type Message = z.infer<typeof Message>;
