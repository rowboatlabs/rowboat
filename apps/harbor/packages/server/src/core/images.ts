import type { BlobInfo, Member } from '@rowboat/spaces-protocol';
import { blobHash, type BlobStore } from '../blobs.js';
import { HarborError } from '../errors.js';
import { imageDimensions, sniffMime } from '../mime.js';
import { Kernel, type ActorCtx } from './kernel.js';

// Profile images (2026-10-02): a member's avatar. Unlike a space blob these
// are readable by every member of the server, so they get their own registry
// (`images`; `org_images` until orgs were dissolved, 2026-11-09, when the
// org's logo went too) instead of riding space_blobs: the bytes still live
// in the BlobStore under their sha256, and a hash is readable here only
// while the server has registered it. Images only, small, sniffed — a client's
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
    if (!this.blobs) throw new HarborError('internal', 'file uploads are not configured on this server');
    return this.blobs;
  }

  /** Sniff, bound, store the bytes and register the hash on the server. */
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
    await this.k.store.putImage({
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
    if (!member) throw new HarborError('not_a_member', 'you are not a member of this server');
    return member;
  }

  /** Your own avatar. `origin` is the request's public origin: avatarUrl is an absolute URL on this server. */
  async setAvatar(ctx: ActorCtx, bytes: Uint8Array, origin: string): Promise<Member> {
    const member = await this.requireSelf(ctx);
    this.k.guardWrite();
    const hash = await this.register(ctx, bytes);
    const updated: Member = { ...member, avatarUrl: imageUrl(origin, hash) };
    if (member.avatarUrl === updated.avatarUrl) return member;
    await this.k.store.putMember(updated);
    await this.k.publishProfile(updated);
    return updated;
  }

  async clearAvatar(ctx: ActorCtx): Promise<Member> {
    const member = await this.requireSelf(ctx);
    if (member.avatarUrl === undefined) return member; // idempotent no-op: no write
    this.k.guardWrite();
    const { avatarUrl: _dropped, ...rest } = member;
    await this.k.store.putMember(rest);
    await this.k.publishProfile(rest);
    return rest;
  }

  /** The bytes back, to any member of the server: a presigned URL (S3-family) or the bytes (disk, memory). */
  /** `inline`: through Harbor, not a redirect (core/assets.ts downloadBlob). */
  async getImage(ctx: ActorCtx, hash: string, opts: { inline?: boolean } = {}): Promise<{ blob: BlobInfo; url?: string; bytes?: Uint8Array; stream?: ReadableStream<Uint8Array> }> {
    await this.k.requireActiveMember(ctx);
    const blobs = this.requireBlobStore();
    const stored = await this.k.store.getImage(hash);
    if (!stored) throw new HarborError('not_found', 'no such image on this server');
    const blob: BlobInfo = {
      hash: stored.hash,
      size: stored.size,
      mime: stored.mime,
      ...(stored.width !== undefined && stored.height !== undefined ? { width: stored.width, height: stored.height } : {}),
    };
    if (opts.inline && blobs.stream) {
      const stream = await blobs.stream(hash);
      if (!stream) throw new HarborError('internal', 'image registered but bytes are missing from storage');
      return { blob, stream };
    }
    if (blobs.downloadUrl && !opts.inline) {
      return { blob, url: await blobs.downloadUrl(hash, { expiresInSeconds: 300, responseContentType: stored.mime, responseContentDisposition: 'inline' }) };
    }
    const bytes = await blobs.get(hash);
    if (!bytes) throw new HarborError('internal', 'image registered but bytes are missing from storage');
    return { blob, bytes };
  }
}

/** Where an image is served: the server's own origin, by hash. */
export function imageUrl(origin: string, hash: string): string {
  return `${origin}/v1/images/${hash}`;
}
