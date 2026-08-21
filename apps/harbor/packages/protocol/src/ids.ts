import { z } from 'zod';

// Decision 3 (CONTRACT.md): ULIDs for durable objects; https link grammar on the
// org address. Member ids are org-scoped IdP subjects and stay opaque.

/** Crockford-base32 ULID, 26 chars. */
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'expected a ULID');

export const SpaceId = Ulid;
export type SpaceId = z.infer<typeof SpaceId>;

export const TopicId = Ulid;
export type TopicId = z.infer<typeof TopicId>;

export const MessageId = Ulid;
export type MessageId = z.infer<typeof MessageId>;

export const ChangeSetId = Ulid;
export type ChangeSetId = z.infer<typeof ChangeSetId>;

/** Org-scoped IdP subject. Opaque; never a ULID; unique only within one org. */
export const MemberId = z.string().min(1).max(256);
export type MemberId = z.infer<typeof MemberId>;

/**
 * Asset path: relative, forward slashes, no empty/`.`/`..` segments.
 * V1 assets are text files; the org rejects paths outside its policy.
 */
export const AssetPath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (p) => !p.startsWith('/') && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..'),
    'asset paths are relative with no traversal',
  );
export type AssetPath = z.infer<typeof AssetPath>;

/** Server-assigned, monotonically increasing per asset, starting at 1. 0 = "does not exist yet" (creation base). */
export const AssetVersion = z.number().int().positive();
export type AssetVersion = z.infer<typeof AssetVersion>;

/** Per-space durable log offset. Change-sets, messages, and topic events share one sequence. */
export const StreamOffset = z.number().int().nonnegative();
export type StreamOffset = z.infer<typeof StreamOffset>;

/**
 * Link grammar (v0). Plain https URLs on the org address; the app intercepts them.
 * Anything a member can see has a link; one grammar everywhere (spec §5 Addressability).
 *
 *   space       https://<org>/s/<spaceId>
 *   asset       https://<org>/s/<spaceId>/f/<assetPath>
 *   topic       https://<org>/s/<spaceId>/t/<topicId>
 *   change-set  https://<org>/s/<spaceId>/c/<changeSetId>
 *   invite      https://<org>/join/<inviteToken>
 */
export function spaceUrl(orgAddress: string, spaceId: SpaceId): string {
  return `https://${orgAddress}/s/${spaceId}`;
}
export function assetUrl(orgAddress: string, spaceId: SpaceId, path: AssetPath): string {
  return `${spaceUrl(orgAddress, spaceId)}/f/${path.split('/').map(encodeURIComponent).join('/')}`;
}
export function topicUrl(orgAddress: string, spaceId: SpaceId, topicId: TopicId): string {
  return `${spaceUrl(orgAddress, spaceId)}/t/${topicId}`;
}
export function changeSetUrl(orgAddress: string, spaceId: SpaceId, changeSetId: ChangeSetId): string {
  return `${spaceUrl(orgAddress, spaceId)}/c/${changeSetId}`;
}
export function inviteUrl(orgAddress: string, token: string): string {
  return `https://${orgAddress}/join/${token}`;
}
