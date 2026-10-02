import type { BlobInfo, Member } from '@rowboat/spaces-protocol';
import { blobHash, type BlobStore } from '../blobs.js';
import { HarborError } from '../errors.js';
import { imageDimensions, sniffMime } from '../mime.js';
import { canSetOrgLogo, enforce } from '../policy.js';
import { Kernel, type ActorCtx } from './kernel.js';

// Profile images (2026-10-02): a member's avatar and the org's logo. Unlike a
// space blob these are readable by every member of the org, so they get their
// own registry (org_images) instead of riding space_blobs: the bytes still
// live in the BlobStore under their sha256, and a hash is readable here only
// while this org has registered it. Images only, small, sniffed — a client's
// content-type is never trusted, and nothing is resized server-side (clients
// send a square of a few hundred pixels).

/** 1 MiB: a few-hundred-pixel square is tens of kilobytes; this is the abuse ceiling, not the target. */
export const MAX_PROFILE_IMAGE_BYTES = 1024 * 1024;
const PROFILE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export class Images {
  constructor(
    private readonly k: Kernel,
    private readonly blobs?: BlobStore,
  ) {}

  private requireBlobStore(): BlobStore {
    if (!this.blobs) throw new HarborError('internal', 'file uploads are not configured on this org');
    return this.blobs;
  }

  /** Sniff, bound, store the bytes and register the hash on this org. */
  private async register(ctx: ActorCtx, bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength === 0) throw new HarborError('invalid_request', 'the image is empty');
    if (bytes.byteLength > MAX_PROFILE_IMAGE_BYTES) {
      throw new HarborError('payload_too_large', `profile images are limited to ${MAX_PROFILE_IMAGE_BYTES} bytes`);
    }
    const mime = sniffMime(bytes);
    if (!mime || !PROFILE_IMAGE_MIMES.has(mime)) {
      throw new HarborError('invalid_request', 'profile images must be PNG, JPEG, WebP or GIF');
    }
    const blobs = this.requireBlobStore();
    const hash = blobHash(bytes);
    const dims = imageDimensions(bytes, mime);
    await blobs.put(bytes);
    await this.k.store.putOrgImage({
      hash,
      size: bytes.byteLength,
      mime,
      ...(dims ?? {}),
      uploadedBy: ctx.memberId,
      uploadedAt: this.k.now(),
    });
    return hash;
  }

  private async requireSelf(ctx: ActorCtx): Promise<Member> {
    const member = await this.k.store.getMember(ctx.memberId);
    if (!member) throw new HarborError('not_a_member', 'you are not a member of this org');
    return member;
  }

  /** Your own avatar. `origin` is the request's public origin: avatarUrl is an absolute URL on this org. */
  async setAvatar(ctx: ActorCtx, bytes: Uint8Array, origin: string): Promise<Member> {
    const member = await this.requireSelf(ctx);
    this.k.guardWrite();
    const hash = await this.register(ctx, bytes);
    const updated: Member = { ...member, avatarUrl: imageUrl(origin, hash) };
    await this.k.store.putMember(updated);
    return updated;
  }

  async clearAvatar(ctx: ActorCtx): Promise<Member> {
    const member = await this.requireSelf(ctx);
    if (member.avatarUrl === undefined) return member; // idempotent no-op: no write
    this.k.guardWrite();
    const { avatarUrl: _dropped, ...rest } = member;
    await this.k.store.putMember(rest);
    return rest;
  }

  /** The org's logo: an admin's to set (policy.ts). */
  async setOrgLogo(ctx: ActorCtx, bytes: Uint8Array, origin: string): Promise<{ logoUrl: string }> {
    enforce(canSetOrgLogo(await this.requireSelf(ctx)));
    this.k.guardWrite();
    const hash = await this.register(ctx, bytes);
    await this.k.store.setOrgLogo(hash, ctx.memberId, this.k.now());
    return { logoUrl: imageUrl(origin, hash) };
  }

  async clearOrgLogo(ctx: ActorCtx): Promise<Record<string, never>> {
    enforce(canSetOrgLogo(await this.requireSelf(ctx)));
    if ((await this.k.store.getOrgLogo()) === undefined) return {}; // idempotent no-op: no write
    this.k.guardWrite();
    await this.k.store.setOrgLogo(null, ctx.memberId, this.k.now());
    return {};
  }

  /** The org's logo as clients show it, or nothing. */
  async orgLogoUrl(ctx: ActorCtx, origin: string): Promise<string | undefined> {
    await this.k.requireOrgMember(ctx);
    const hash = await this.k.store.getOrgLogo();
    return hash ? imageUrl(origin, hash) : undefined;
  }

  /** The bytes back, to any member of the org: a presigned URL (S3-family) or the bytes (disk, memory). */
  async getImage(ctx: ActorCtx, hash: string): Promise<{ blob: BlobInfo; url?: string; bytes?: Uint8Array }> {
    await this.k.requireOrgMember(ctx);
    const blobs = this.requireBlobStore();
    const stored = await this.k.store.getOrgImage(hash);
    if (!stored) throw new HarborError('not_found', 'no such image on this org');
    const blob: BlobInfo = {
      hash: stored.hash,
      size: stored.size,
      mime: stored.mime,
      ...(stored.width !== undefined && stored.height !== undefined ? { width: stored.width, height: stored.height } : {}),
    };
    if (blobs.downloadUrl) {
      return { blob, url: await blobs.downloadUrl(hash, { expiresInSeconds: 300, responseContentType: stored.mime, responseContentDisposition: 'inline' }) };
    }
    const bytes = await blobs.get(hash);
    if (!bytes) throw new HarborError('internal', 'image registered but bytes are missing from storage');
    return { blob, bytes };
  }
}

/** Where an org image is served: the org's own origin, by hash. */
export function imageUrl(origin: string, hash: string): string {
  return `${origin}/v1/images/${hash}`;
}
