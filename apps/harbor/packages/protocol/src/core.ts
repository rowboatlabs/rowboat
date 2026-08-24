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

export const Topic = z.object({
  id: TopicId,
  spaceId: SpaceId,
  /** First message becomes the title (spec §7); agents may retitle later. */
  title: z.string().min(1).max(256),
  /**
   * 'general' = the space's open message stream, exactly one per space, seeded
   * at space creation. Everything else is 'discussion'. The default exists only
   * so new clients can parse pre-004 servers (which omit the field); servers
   * always set it explicitly.
   */
  kind: z.enum(['general', 'discussion']).default('discussion'),
  createdBy: Attribution,
  createdAt: z.iso.datetime(),
  archived: z.boolean(),
  /** Set when the topic was born by replying to an activity row (spec §7). */
  anchorChangeSetId: ChangeSetId.optional(),
  /**
   * Set when the topic grew out of a message ("reply becomes a thread").
   * Provenance, not hierarchy: at most one topic per message, the anchored
   * message may live in any topic, and clients render a flat topic list with
   * a breadcrumb — never a tree.
   */
  anchorMessageId: MessageId.optional(),
  lastActivityAt: z.iso.datetime(),
  messageCount: z.number().int().nonnegative(),
});
export type Topic = z.infer<typeof Topic>;

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
 * act belongs to a member, `by.actingMode` says how it happened. `topicId` is
 * where the message lived when the reaction happened (merge_into may repoint
 * the message later; reactions follow it by messageId).
 */
export const Reaction = z.object({
  spaceId: SpaceId,
  topicId: TopicId,
  messageId: MessageId,
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

export const Message = z.object({
  id: MessageId,
  topicId: TopicId,
  spaceId: SpaceId,
  author: Attribution,
  /** Markdown. The link grammar (ids.ts) is valid inside message bodies. */
  body: z.string().min(1).max(65_536),
  postedAt: z.iso.datetime(),
  offset: StreamOffset,
  /**
   * Folded reactions, groups in first-reacted order. The default keeps pre-
   * reaction payloads (older servers, stored message events) parseable; reads
   * fold live state in, so the field is current wherever messages are listed.
   */
  reactions: z.array(ReactionGroup).default([]),
});
export type Message = z.infer<typeof Message>;
