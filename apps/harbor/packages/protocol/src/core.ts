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
  createdBy: Attribution,
  createdAt: z.iso.datetime(),
  archived: z.boolean(),
  /** Set when the topic was born by replying to an activity row (spec §7). */
  anchorChangeSetId: ChangeSetId.optional(),
  lastActivityAt: z.iso.datetime(),
  messageCount: z.number().int().nonnegative(),
});
export type Topic = z.infer<typeof Topic>;

export const Message = z.object({
  id: MessageId,
  topicId: TopicId,
  spaceId: SpaceId,
  author: Attribution,
  /** Markdown. The link grammar (ids.ts) is valid inside message bodies. */
  body: z.string().min(1).max(65_536),
  postedAt: z.iso.datetime(),
  offset: StreamOffset,
});
export type Message = z.infer<typeof Message>;
