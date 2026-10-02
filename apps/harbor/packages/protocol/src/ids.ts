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
/**
 * The asset's identity (2026-09-14): what every file operation addresses —
 * read, propose, move, delete, restore, history, diff, links, topic document
 * links, whiteboard frames. Opaque like MemberId: ULIDs for files born after
 * migration 007, UUIDs for the ones that predate it. The path is a display
 * property of the record (the file tree's label, the name a rename changes),
 * fetched by id, never an address.
 */
export const AssetId = z.string().min(1).max(64);
export type AssetId = z.infer<typeof AssetId>;

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

/** sha256 hex of the bytes — a blob's address (spec §6: content-addressed, immutable). */
export const BlobHash = z.string().regex(/^[0-9a-f]{64}$/, 'expected a sha256 hex blob hash');
export type BlobHash = z.infer<typeof BlobHash>;

/** Per-space durable log offset. Change-sets, messages, and topic events share one sequence. */
export const StreamOffset = z.number().int().nonnegative();
export type StreamOffset = z.infer<typeof StreamOffset>;

/**
 * Link grammar (v0). Plain https URLs on the org address; the app intercepts them.
 * Anything a member can see has a link; one grammar everywhere (spec §5 Addressability).
 *
 *   org         https://<org>/
 *   space       https://<org>/s/<spaceId>
 *   asset       https://<org>/s/<spaceId>/a/<assetId>
 *   message     https://<org>/s/<spaceId>/m/<messageId>   (a reply's link lands in its thread)
 *   change-set  https://<org>/s/<spaceId>/c/<changeSetId>
 *   blob        https://<org>/s/<spaceId>/b/<blobHash>[?name=<filename>]
 *   member      https://<org>/u/<memberId>                 (2026-09-14; opens the DM with them)
 *   invite      https://<org>/join/<inviteToken>
 *
 * Things that belong to a space carry the space (its membership is their read
 * gate, and a reader tells "not mine" from the space alone); a member belongs
 * to the org. Blob links are how message bodies reference uploads
 * (`![shot](…/b/<hash>)`); the app resolves them through the authenticated
 * getBlob route. `name` is display-only — storage is content-addressed and
 * never learns filenames. Every link opened in a browser lands on the org's
 * hand-off page, which sends it into the app (http.ts, the landings).
 */
export function orgUrl(orgAddress: string): string {
  return `https://${orgAddress}/`;
}
export function spaceUrl(orgAddress: string, spaceId: SpaceId): string {
  return `https://${orgAddress}/s/${spaceId}`;
}
export function assetUrl(orgAddress: string, spaceId: SpaceId, assetId: AssetId): string {
  return `${spaceUrl(orgAddress, spaceId)}/a/${encodeURIComponent(assetId)}`;
}
export function messageUrl(orgAddress: string, spaceId: SpaceId, messageId: MessageId): string {
  return `${spaceUrl(orgAddress, spaceId)}/m/${messageId}`;
}
export function changeSetUrl(orgAddress: string, spaceId: SpaceId, changeSetId: ChangeSetId): string {
  return `${spaceUrl(orgAddress, spaceId)}/c/${changeSetId}`;
}
export function blobLinkUrl(orgAddress: string, spaceId: SpaceId, hash: BlobHash, name?: string): string {
  const query = name ? `?name=${encodeURIComponent(name)}` : '';
  return `${spaceUrl(orgAddress, spaceId)}/b/${hash}${query}`;
}
export function memberUrl(orgAddress: string, memberId: MemberId): string {
  return `https://${orgAddress}/u/${encodeURIComponent(memberId)}`;
}
export function inviteUrl(orgAddress: string, token: string): string {
  return `https://${orgAddress}/join/${token}`;
}

/** What an org link points at — the grammar above, read back. */
export type OrgLink =
  | { kind: 'org'; orgAddress: string }
  | { kind: 'space'; orgAddress: string; spaceId: string }
  | { kind: 'asset'; orgAddress: string; spaceId: string; assetId: string }
  | { kind: 'message'; orgAddress: string; spaceId: string; messageId: string }
  | { kind: 'member'; orgAddress: string; memberId: string };

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * The one parser for org links (every client, and the org's own landings).
 * Returns null for anything that is not one of the kinds above — blob
 * and change-set links, invites, other hosts, or a trailing path. Query and
 * fragment are ignored.
 */
export function parseOrgUrl(url: string): OrgLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const orgAddress = u.host;
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.pathname === '/') return { kind: 'org', orgAddress };
  const dec = (s: string): string | null => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };
  if (parts[0] === 'u' && parts.length === 2) {
    const memberId = dec(parts[1]!);
    return memberId ? { kind: 'member', orgAddress, memberId } : null;
  }
  if (parts[0] !== 's' || !parts[1] || !ULID_RE.test(parts[1])) return null;
  const spaceId = parts[1];
  if (parts.length === 2) return { kind: 'space', orgAddress, spaceId };
  if (parts.length !== 4) return null;
  const id = dec(parts[3]!);
  if (!id) return null;
  if (parts[2] === 'a') return { kind: 'asset', orgAddress, spaceId, assetId: id };
  if (parts[2] === 'm') return ULID_RE.test(id) ? { kind: 'message', orgAddress, spaceId, messageId: id } : null;
  return null;
}
