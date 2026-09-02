import { randomBytes } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { monotonicFactory } from 'ulid';
import {
  inviteUrl,
  threadRootFromReason,
  type ActingMode,
  type AcceptInviteResult,
  type Attribution,
  type BlobInfo,
  type ChangeSet,
  type ConflictRegion,
  type CreateInviteResult,
  type DeleteAssetResult,
  type Member,
  type Membership,
  type Message,
  type MoveAssetResult,
  type PresenceState,
  type ProposeChange,
  type ProposeChangeResult,
  type ReactionGroup,
  type ReadAssetResult,
  type ResolveInviteResult,
  type RestoreAssetResult,
  type Routes,
  type SearchKind,
  type SearchResults,
  type Space,
  type SpaceEvent,
  type Topic,
  type TopicListing,
  type TopicRemoval,
} from '@rowboat/spaces-protocol';

/** listMessages window bounds — the default page and the per-request cap. */
const MESSAGES_PAGE_DEFAULT = 100;

/** BlobInfo's optional dimensions from a stored blob record — both or neither. */
function blobDims(stored: { width?: number; height?: number }): { width: number; height: number } | Record<string, never> {
  return stored.width !== undefined && stored.height !== undefined
    ? { width: stored.width, height: stored.height }
    : {};
}
const MESSAGES_PAGE_MAX = 200;
import type { z } from 'zod';
import { blobHash, type BlobStore } from './blobs.js';
import { HarborError } from './errors.js';
import { SpaceHub } from './hub.js';
import { merge3 } from './merge.js';
import { dispositionFor, imageDimensions, resolveMime } from './mime.js';
import { parseSearchQuery } from './search.js';
import type { AssetRecord, AssetVersionData, Store, StoredEvent, StoredReaction } from './store.js';

// The one service core (spec §9: one core, two faces). REST (http.ts) and MCP
// (mcp.ts) are thin projections over this class; neither has a privileged path.

export interface ActorCtx {
  memberId: string;
}

/** What bindInvite needs from an authenticated identity (auth.ts AuthIdentity satisfies this). */
export interface BindIdentity {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
}

function seedDisplayName(identity: BindIdentity): string {
  const name = identity.name?.trim();
  if (name) return name.slice(0, 128);
  const local = identity.email?.split('@')[0];
  if (local) return local.slice(0, 128);
  return identity.sub.slice(0, 24);
}

type NewMessage = z.infer<Routes['postMessage']['request']>;
type CreateTopicInput = z.infer<Routes['createTopic']['request']>;
type ManageTopicAction = z.infer<Routes['manageTopic']['request']>;
type ReactInput = z.infer<Routes['reactToMessage']['request']>;
type DeleteMessageInput = z.infer<Routes['deleteMessage']['request']>;
type EditMessageInput = z.infer<Routes['editMessage']['request']>;

export interface OrgInfo {
  name: string;
  /** host[:port] — the org address links are minted on. Set once the listener knows its port. */
  address: string;
  /**
   * Org policy, v1 (spec §4, amended 2026-08-19): restrict membership to
   * these IdP-verified email domains, checked ONLY at invite bind. Empty or
   * absent = no restriction. Org-side by design — never on the wire.
   */
  allowedEmailDomains?: string[];
}

const RECENT_HISTORY = 10;
const DEFAULT_INVITE_HOURS = 24 * 7;

export class HarborService {
  readonly org: OrgInfo;
  /** Over-limit means read-only, never lockout (spec §4). Flip via the control plane; here a knob for tests. */
  readOnly = false;

  private readonly ulid = monotonicFactory();

  constructor(
    private readonly store: Store,
    private readonly hub: SpaceHub,
    org: OrgInfo,
    /** Absent = uploads unconfigured on this org (routes refuse loudly, everything else works). */
    private readonly blobs?: BlobStore,
  ) {
    this.org = org;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private guardWrite(): void {
    if (this.readOnly) {
      throw new HarborError('read_only_limit', 'org is over its plan limit: writes are paused, reads still work');
    }
  }

  private async requireSpace(spaceId: string): Promise<Space> {
    const space = await this.store.getSpace(spaceId);
    if (!space) throw new HarborError('not_found', `no such space`);
    return space;
  }

  async requireMember(ctx: ActorCtx, spaceId: string): Promise<Space> {
    const space = await this.requireSpace(spaceId);
    const membership = await this.store.getMembership(spaceId, ctx.memberId);
    if (!membership) throw new HarborError('forbidden', 'you are not a member of this space');
    return space;
  }

  /** Append a durable event at `offset` (allocated by the caller inside the space lock) and fan it out. */
  private async append(spaceId: string, offset: number, at: string, event: SpaceEvent): Promise<void> {
    const stored: StoredEvent = { offset, at, event };
    await this.store.appendEvent(spaceId, stored);
    this.hub.publish(spaceId, { kind: 'event', spaceId, offset, at, event });
  }

  // --- spaces & membership ---------------------------------------------------

  async listSpaces(ctx: ActorCtx): Promise<Space[]> {
    return this.store.listSpacesFor(ctx.memberId);
  }

  async createSpace(ctx: ActorCtx, name: string): Promise<Space> {
    this.guardWrite();
    const now = this.now();
    const space: Space = { id: this.ulid(), name, createdAt: now };
    await this.store.putSpace(space);
    return this.store.withSpaceLock(space.id, async () => {
      const membership: Membership = { spaceId: space.id, memberId: ctx.memberId, joinedAt: now };
      await this.store.putMembership(membership);
      const offset = (await this.store.head(space.id)) + 1;
      await this.append(space.id, offset, now, { type: 'membership', membership, action: 'joined' });
      // The stream needs no object (annotation model): it is simply the
      // space's root messages, born empty.
      return space;
    });
  }

  async listMembers(ctx: ActorCtx, spaceId: string): Promise<Member[]> {
    await this.requireMember(ctx, spaceId);
    const memberships = await this.store.listMemberships(spaceId);
    const members: Member[] = [];
    for (const m of memberships) {
      const member = await this.store.getMember(m.memberId);
      if (member) members.push(member);
    }
    return members;
  }

  async leaveSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    await this.requireMember(ctx, spaceId);
    await this.store.withSpaceLock(spaceId, async () => {
      const membership = await this.store.getMembership(spaceId, ctx.memberId);
      if (!membership) return;
      await this.store.deleteMembership(spaceId, ctx.memberId);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, this.now(), { type: 'membership', membership, action: 'left' });
    });
  }

  // --- invites ---------------------------------------------------------------

  async createInvite(ctx: ActorCtx, spaceId: string, expiresInHours?: number): Promise<CreateInviteResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const token = randomBytes(24).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(Date.now() + (expiresInHours ?? DEFAULT_INVITE_HOURS) * 3_600_000).toISOString();
    await this.store.putInvite({ token, spaceId, createdBy: ctx.memberId, createdAt: now, expiresAt, revoked: false });
    return { token, link: inviteUrl(this.org.address, token), expiresAt };
  }

  /** Pre-auth on purpose: the app shows what's being joined before the OAuth dance. */
  async resolveInvite(token: string): Promise<ResolveInviteResult> {
    const invite = await this.store.getInvite(token);
    if (!invite) throw new HarborError('not_found', 'unknown invite');
    if (invite.revoked) return { state: 'revoked' };
    if (invite.expiresAt && invite.expiresAt < this.now()) return { state: 'expired' };
    const space = await this.requireSpace(invite.spaceId);
    const inviter = await this.store.getMember(invite.createdBy);
    return {
      state: 'ok',
      org: { address: this.org.address, name: this.org.name },
      space: { id: space.id, name: space.name },
      invitedBy: inviter?.displayName,
    };
  }

  /**
   * The invite-binding ceremony (spec §4, amended 2026-08-19): an
   * authenticated identity + an open bearer invite → member (created on
   * first bind, displayName seeded from IdP profile claims) + membership.
   * Every bind-time condition is org policy, checked HERE and nowhere else —
   * v1 is the email-domain rule. The (iss, sub) → member row written here is
   * what the oidc auth driver resolves on every later request.
   */
  async bindInvite(identity: BindIdentity, token: string): Promise<AcceptInviteResult> {
    const resolved = await this.resolveInvite(token);
    if (resolved.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${resolved.state}`);
    }
    this.guardWrite();
    this.checkBindPolicy(identity);
    let member = await this.store.getMemberByIdentity(identity.iss, identity.sub);
    if (!member) {
      // Minted id, NOT the raw sub: issuer subjects live only in the mapping
      // table, so an org can change AS someday without rewriting history.
      member = { id: this.ulid(), displayName: seedDisplayName(identity), role: 'member' };
      await this.store.putMember(member);
      await this.store.putIdentity(identity.iss, identity.sub, member.id);
    }
    return this.acceptInvite({ memberId: member.id }, token);
  }

  private checkBindPolicy(identity: BindIdentity): void {
    const domains = this.org.allowedEmailDomains;
    if (!domains || domains.length === 0) return;
    const domain = identity.email?.toLowerCase().split('@')[1];
    if (!domain || !domains.some((d) => d.toLowerCase() === domain)) {
      throw new HarborError(
        'policy_refused',
        `this org admits only ${domains.map((d) => `@${d}`).join(', ')} accounts`,
      );
    }
  }

  async acceptInvite(ctx: ActorCtx, token: string): Promise<AcceptInviteResult> {
    const resolved = await this.resolveInvite(token);
    if (resolved.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${resolved.state}`);
    }
    this.guardWrite();
    const spaceId = resolved.space.id;
    const space = await this.requireSpace(spaceId);
    return this.store.withSpaceLock(spaceId, async () => {
      const existing = await this.store.getMembership(spaceId, ctx.memberId);
      if (existing) return { membership: existing, space }; // idempotent join
      const membership: Membership = { spaceId, memberId: ctx.memberId, joinedAt: this.now() };
      await this.store.putMembership(membership);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, membership.joinedAt, { type: 'membership', membership, action: 'joined' });
      return { membership, space };
    });
  }

  // --- assets ----------------------------------------------------------------
  // The inode model (migration 007): paths are the product identity, the
  // internal asset id is the storage identity. Reads resolve path → asset
  // (following redirects left by moves); history is a lineage filter, never
  // a chain walk; move/delete/restore are property updates that append one
  // op change-set each. Only content edits bump versions.

  async listAssets(ctx: ActorCtx, spaceId: string, includeDeleted = false) {
    await this.requireMember(ctx, spaceId);
    const records = await this.store.listAssets(spaceId, includeDeleted);
    return records.map((a) => ({
      path: a.path,
      version: a.version,
      updatedAt: a.updatedAt,
      ...(a.blob ? { blob: a.blob } : {}),
      ...(a.state === 'deleted' ? { state: 'deleted' as const } : {}),
    }));
  }

  /** Live asset at `path`, or the live target of a redirect there (moved files keep answering to old links). */
  private async resolveAsset(spaceId: string, path: string): Promise<{ asset: AssetRecord; redirected: boolean } | undefined> {
    const live = await this.store.getLiveAssetByPath(spaceId, path);
    if (live) return { asset: live, redirected: false };
    const redirectId = await this.store.getRedirect(spaceId, path);
    if (redirectId) {
      const target = await this.store.getAssetById(spaceId, redirectId);
      if (target && target.state === 'live') return { asset: target, redirected: true };
    }
    return undefined;
  }

  private async recentHistory(spaceId: string, assetId: string, upToVersion?: number): Promise<ChangeSet[]> {
    const all = await this.store.listChangeSets(spaceId, { assetId, limit: 1_000 });
    const filtered = upToVersion === undefined ? all : all.filter((cs) => cs.resultVersion <= upToVersion);
    return filtered.slice(0, RECENT_HISTORY);
  }

  async readAsset(ctx: ActorCtx, spaceId: string, path: string, version?: number): Promise<ReadAssetResult> {
    await this.requireMember(ctx, spaceId);
    const resolved = await this.resolveAsset(spaceId, path);
    if (!resolved) {
      const dead = await this.store.getLatestDeletedByPath(spaceId, path);
      if (dead) throw new HarborError('not_found', `${path} was deleted — it can be restored from Trash`);
      throw new HarborError('not_found', 'no such asset');
    }
    const { asset } = resolved;
    const v = version ?? asset.version;
    const data = await this.store.getAssetVersion(spaceId, asset.id, v);
    if (data === undefined) throw new HarborError('not_found', `no version ${v} of ${path}`);
    return {
      // The asset's CURRENT path — differing from the requested path is the
      // redirect signal (the client re-points its selection).
      path: asset.path,
      content: data.content ?? '',
      ...(data.blob ? { blob: data.blob } : {}),
      version: v,
      recentHistory: await this.recentHistory(spaceId, asset.id, v),
    };
  }

  /** Stale-base retry bundle for namespace ops — the propose conflict, minus merge regions. */
  private async staleAsset(spaceId: string, asset: AssetRecord) {
    const data = await this.store.getAssetVersion(spaceId, asset.id, asset.version);
    return {
      outcome: 'conflict' as const,
      currentVersion: asset.version,
      currentContent: data?.content ?? '',
      ...(data?.blob ? { currentBlob: data.blob } : {}),
      recentHistory: await this.recentHistory(spaceId, asset.id),
    };
  }

  async moveAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['moveAsset']['request']>,
  ): Promise<MoveAssetResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    if (input.threadRootId && !(await this.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };
    return this.store.withSpaceLock(spaceId, async () => {
      if (input.toPath === input.fromPath) {
        throw new HarborError('invalid_request', 'destination is the same path');
      }
      const from = await this.store.getLiveAssetByPath(spaceId, input.fromPath);
      if (!from) {
        const resolved = await this.resolveAsset(spaceId, input.fromPath);
        if (resolved) throw new HarborError('invalid_request', `this file already moved to ${resolved.asset.path}`);
        throw new HarborError('not_found', 'no such asset');
      }
      if (input.baseVersion > from.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${from.version})`);
      }
      if (input.baseVersion !== from.version) return this.staleAsset(spaceId, from);
      if (await this.store.getLiveAssetByPath(spaceId, input.toPath)) {
        throw new HarborError('invalid_request', 'a file already exists at the destination — moves never overwrite, pick another name');
      }
      const at = this.now();
      await this.store.setAssetPath(spaceId, from.id, input.toPath, at);
      // The old path forwards to the file; anything previously forwarding
      // from the destination is shadowed by the new occupant.
      await this.store.putRedirect(spaceId, input.fromPath, from.id, at);
      await this.store.deleteRedirect(spaceId, input.toPath);
      const changeSet = await this.appendOpChangeSet(spaceId, from.id, {
        assetPath: input.toPath,
        version: from.version,
        attribution,
        op: 'move',
        movedFrom: input.fromPath,
        reason: input.reason,
        threadRootId: input.threadRootId,
        at,
      });
      return { outcome: 'moved' as const, changeSet, version: from.version };
    });
  }

  async deleteAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['deleteAsset']['request']>,
  ): Promise<DeleteAssetResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    if (input.threadRootId && !(await this.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };
    return this.store.withSpaceLock(spaceId, async () => {
      const asset = await this.store.getLiveAssetByPath(spaceId, input.path);
      if (!asset) throw new HarborError('not_found', 'no such asset');
      if (input.baseVersion > asset.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${asset.version})`);
      }
      if (input.baseVersion !== asset.version) return this.staleAsset(spaceId, asset);
      const at = this.now();
      // Freeze in place: rows keep their keys, the path frees (live-unique
      // index only binds the living). Restore is the inverse flip.
      await this.store.setAssetState(spaceId, asset.id, 'deleted', at);
      const changeSet = await this.appendOpChangeSet(spaceId, asset.id, {
        assetPath: input.path,
        version: asset.version,
        attribution,
        op: 'delete',
        reason: input.reason,
        threadRootId: input.threadRootId,
        at,
      });
      return { outcome: 'deleted' as const, changeSet };
    });
  }

  async restoreAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['restoreAsset']['request']>,
  ): Promise<RestoreAssetResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };
    return this.store.withSpaceLock(spaceId, async () => {
      const dead = await this.store.getLatestDeletedByPath(spaceId, input.path);
      if (!dead) throw new HarborError('not_found', 'nothing deleted at this path');
      if (await this.store.getLiveAssetByPath(spaceId, input.path)) {
        throw new HarborError('invalid_request', 'a file now exists at this path — move it first, then restore');
      }
      const at = this.now();
      await this.store.deleteRedirect(spaceId, input.path);
      await this.store.setAssetState(spaceId, dead.id, 'live', at);
      const changeSet = await this.appendOpChangeSet(spaceId, dead.id, {
        assetPath: input.path,
        version: dead.version,
        attribution,
        op: 'restore',
        reason: input.reason,
        at,
      });
      return { outcome: 'restored' as const, changeSet, version: dead.version };
    });
  }

  /** Inside the space lock only: one op change-set (no version bump) + its event, as one fact. */
  private async appendOpChangeSet(
    spaceId: string,
    assetId: string,
    input: {
      assetPath: string;
      version: number;
      attribution: Attribution;
      op: 'move' | 'delete' | 'restore';
      movedFrom?: string;
      reason?: string;
      threadRootId?: string;
      at: string;
    },
  ): Promise<ChangeSet> {
    const offset = (await this.store.head(spaceId)) + 1;
    const threadRootId = input.threadRootId ?? threadRootFromReason(input.reason);
    const changeSet: ChangeSet = {
      id: this.ulid(),
      spaceId,
      assetPath: input.assetPath,
      baseVersion: input.version,
      resultVersion: input.version,
      attribution: input.attribution,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(threadRootId ? { threadRootId } : {}),
      op: input.op,
      ...(input.movedFrom ? { movedFrom: input.movedFrom } : {}),
      committedAt: input.at,
      offset,
    };
    await this.store.appendChangeSet(changeSet, assetId);
    await this.append(spaceId, offset, input.at, { type: 'change', changeSet });
    return changeSet;
  }

  // --- uploaded blobs --------------------------------------------------------

  private requireBlobStore(): BlobStore {
    if (!this.blobs) {
      throw new HarborError('internal', 'file uploads are not configured on this org');
    }
    return this.blobs;
  }

  /**
   * Phase 1 of an upload (spec §6): store the bytes, register the hash for
   * this space. Not a space fact — no event, no feed row; the reference
   * (a message's blob link, proposeChange's blob variant) is what narrates.
   */
  async uploadBlob(
    ctx: ActorCtx,
    spaceId: string,
    bytes: Uint8Array,
    opts: { declaredSha256: string; declaredMime?: string },
  ): Promise<BlobInfo> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const blobs = this.requireBlobStore();
    const hash = blobHash(bytes);
    if (opts.declaredSha256 !== hash) {
      throw new HarborError(
        'invalid_request',
        `x-blob-sha256 mismatch: body hashes to ${hash} — upload was corrupted or truncated`,
      );
    }
    const mime = resolveMime(bytes, opts.declaredMime);
    // Sniffed images get their pixel dimensions parsed from the header bytes —
    // clients reserve the exact box before the image loads (no layout shift).
    const dims = imageDimensions(bytes, mime);
    await blobs.put(bytes);
    await this.store.putSpaceBlob({
      spaceId,
      hash,
      size: bytes.byteLength,
      mime,
      ...(dims ?? {}),
      uploadedBy: ctx.memberId,
      uploadedAt: this.now(),
    });
    // First registration wins (idempotent re-uploads keep the original mime).
    const stored = await this.store.getSpaceBlob(spaceId, hash);
    return {
      hash,
      size: stored?.size ?? bytes.byteLength,
      mime: stored?.mime ?? mime,
      ...(stored?.width !== undefined && stored?.height !== undefined
        ? { width: stored.width, height: stored.height }
        : dims ?? {}),
    };
  }

  /**
   * The bytes back: a presigned URL when the driver can mint one (S3-family —
   * bytes never transit Harbor), the bytes themselves otherwise (disk/memory).
   * Which one an org uses is a driver detail, invisible in the route contract.
   */
  async downloadBlob(
    ctx: ActorCtx,
    spaceId: string,
    hash: string,
    name?: string,
  ): Promise<{ blob: BlobInfo; disposition: string; url?: string; bytes?: Uint8Array }> {
    await this.requireMember(ctx, spaceId);
    const blobs = this.requireBlobStore();
    const stored = await this.store.getSpaceBlob(spaceId, hash);
    if (!stored) throw new HarborError('not_found', 'no such blob in this space');
    const blob: BlobInfo = { hash: stored.hash, size: stored.size, mime: stored.mime, ...blobDims(stored) };
    const disposition = dispositionFor(stored.mime, name);
    if (blobs.downloadUrl) {
      const url = await blobs.downloadUrl(hash, {
        expiresInSeconds: 300,
        responseContentType: stored.mime,
        responseContentDisposition: disposition,
      });
      return { blob, disposition, url };
    }
    const bytes = await blobs.get(hash);
    if (!bytes) throw new HarborError('internal', 'blob registered but bytes are missing from storage');
    return { blob, disposition, bytes };
  }

  async proposeChange(ctx: ActorCtx, spaceId: string, input: ProposeChange): Promise<ProposeChangeResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    if (input.threadRootId && !(await this.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    // Binary variant: the hash must be phase-1-uploaded to THIS space — a
    // version row can never point at nothing (and never at another space's
    // upload; the registry is the read gate).
    let proposal: AssetVersionData;
    if (input.blob !== undefined) {
      const stored = await this.store.getSpaceBlob(spaceId, input.blob);
      if (!stored) {
        throw new HarborError('invalid_request', 'blob is not uploaded to this space — call uploadBlob first');
      }
      proposal = { content: null, blob: { hash: stored.hash, size: stored.size, mime: stored.mime, ...blobDims(stored) } };
    } else {
      proposal = { content: input.newContent ?? '', blob: null };
    }
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const asset = await this.store.getLiveAssetByPath(spaceId, input.assetPath);

      if (!asset) {
        if (input.baseVersion !== 0) {
          // A stale propose at a moved-away path gets told where the file went
          // instead of a bare 404 (the version it declares is meaningless here).
          const resolved = await this.resolveAsset(spaceId, input.assetPath);
          if (resolved) {
            throw new HarborError('invalid_request', `this file moved to ${resolved.asset.path} — propose there`);
          }
          throw new HarborError('not_found', 'asset does not exist; propose with baseVersion 0 to create it');
        }
        // Create. A redirect at this path is shadowed by the new occupant
        // (vacant-lot rule); a deleted asset here never blocks — it keeps its
        // own record and the newcomer starts a fresh lineage.
        await this.store.deleteRedirect(spaceId, input.assetPath);
        const id = this.ulid();
        await this.store.createAsset(spaceId, { id, path: input.assetPath, version: 1, updatedAt: this.now(), state: 'live' });
        const changeSet = await this.commit(spaceId, id, input, attribution, 1, proposal);
        return { outcome: 'applied' as const, changeSet, version: 1 };
      }

      if (input.baseVersion > asset.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${asset.version})`);
      }

      if (input.baseVersion === asset.version) {
        const version = asset.version + 1;
        const changeSet = await this.commit(spaceId, asset.id, input, attribution, version, proposal);
        return { outcome: 'applied' as const, changeSet, version };
      }

      // Stale base: three-way merge (CONTRACT.md decision 1) — but only when
      // proposal, base, and current are ALL text. Binary staleness never
      // merges (spec §6): there is nothing to three-way in a JPEG, so any
      // binary side surfaces as conflict-or-replace with empty regions.
      const base = await this.store.getAssetVersion(spaceId, asset.id, input.baseVersion);
      const current = await this.store.getAssetVersion(spaceId, asset.id, asset.version);
      if (base === undefined || current === undefined) {
        throw new HarborError('internal', 'asset version content missing');
      }

      const conflictOf = async (regions: ConflictRegion[]) => ({
        outcome: 'conflict' as const,
        currentVersion: asset.version,
        currentContent: current.content ?? '',
        ...(current.blob ? { currentBlob: current.blob } : {}),
        regions,
        recentHistory: await this.recentHistory(spaceId, asset.id),
      });

      if (proposal.blob !== null || base.blob !== null || current.blob !== null) {
        return conflictOf([]);
      }

      const result = merge3(base.content ?? '', current.content ?? '', proposal.content ?? '');

      if (result.outcome === 'conflict') {
        // Nothing written. Decision 6: everything needed to retry, one round trip.
        return conflictOf(result.regions);
      }

      // Clean merge — stored even when it lands identical content, so the
      // second standup-pusher's change-set exists, attributed, in history
      // (principle 4; fixture 06's product beat).
      const version = asset.version + 1;
      const changeSet = await this.commit(spaceId, asset.id, input, attribution, version, {
        content: result.content,
        blob: null,
      });
      return { outcome: 'merged' as const, changeSet, version, mergedContent: result.content };
    });
  }

  /** Inside the space lock only: writes the version, the change-set, and the event as one fact. */
  private async commit(
    spaceId: string,
    assetId: string,
    input: ProposeChange,
    attribution: Attribution,
    version: number,
    data: AssetVersionData,
  ): Promise<ChangeSet> {
    const at = this.now();
    const offset = (await this.store.head(spaceId)) + 1;
    // Provenance: an explicit threadRootId wins; otherwise the "· thread:<id>"
    // reason suffix that prompt-driven agents write (best effort — the suffix
    // is a claim, not validated).
    const threadRootId = input.threadRootId ?? threadRootFromReason(input.reason);
    const changeSet: ChangeSet = {
      id: this.ulid(),
      spaceId,
      assetPath: input.assetPath,
      baseVersion: input.baseVersion,
      resultVersion: version,
      attribution,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(threadRootId ? { threadRootId } : {}),
      ...(data.blob ? { blob: data.blob } : {}),
      committedAt: at,
      offset,
    };
    await this.store.putAssetVersion(spaceId, assetId, version, data, at);
    await this.store.appendChangeSet(changeSet, assetId);
    await this.append(spaceId, offset, at, { type: 'change', changeSet });
    return changeSet;
  }

  async assetHistory(
    ctx: ActorCtx,
    spaceId: string,
    opts: { path?: string; beforeOffset?: number; limit?: number },
  ): Promise<ChangeSet[]> {
    await this.requireMember(ctx, spaceId);
    // A path filter means "this file's lineage": resolve to the asset (live,
    // redirected, or most recently deleted here) and filter by its id — the
    // record stays queryable across moves and after deletion.
    let assetId: string | undefined;
    if (opts.path !== undefined) {
      const resolved = await this.resolveAsset(spaceId, opts.path);
      const asset = resolved?.asset ?? (await this.store.getLatestDeletedByPath(spaceId, opts.path));
      if (!asset) return [];
      assetId = asset.id;
    }
    return this.store.listChangeSets(spaceId, {
      ...(assetId !== undefined ? { assetId } : {}),
      ...(opts.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: opts.limit ?? 50,
    });
  }

  async diff(ctx: ActorCtx, spaceId: string, path: string, from: number, to: number): Promise<string> {
    await this.requireMember(ctx, spaceId);
    const resolved = await this.resolveAsset(spaceId, path);
    const asset = resolved?.asset ?? (await this.store.getLatestDeletedByPath(spaceId, path));
    if (!asset) throw new HarborError('not_found', 'no such asset');
    const fromData = await this.store.getAssetVersion(spaceId, asset.id, from);
    const toData = await this.store.getAssetVersion(spaceId, asset.id, to);
    if (fromData === undefined || toData === undefined) {
      throw new HarborError('not_found', 'no such version');
    }
    // Binary on either side: no text diff exists — return a readable stub in
    // the same unified-header shape so diff views degrade gracefully.
    if (fromData.blob !== null || toData.blob !== null) {
      const describe = (d: AssetVersionData) =>
        d.blob ? `(${d.blob.mime}, ${d.blob.size} bytes)` : `(text, ${(d.content ?? '').length} chars)`;
      return (
        `--- ${path}@v${from} ${describe(fromData)}\n` +
        `+++ ${path}@v${to} ${describe(toData)}\n` +
        `Binary change — no text diff.\n`
      );
    }
    return createTwoFilesPatch(
      `${path}@v${from}`,
      `${path}@v${to}`,
      fromData.content ?? '',
      toData.content ?? '',
      undefined,
      undefined,
      { context: 3 },
    );
  }

  // --- feed ------------------------------------------------------------------
  // The annotation model (spec §7, 2026-09-01): one stream of root messages,
  // flat threads behind reply chips (threadRoot, write-once), topics as
  // archivable annotation rows on threads. Posting never creates a container.

  /** A root's live reactions folded in — every read path carries current truth. */
  private async foldPage(spaceId: string, messages: Message[]): Promise<Message[]> {
    const byMessage = new Map<string, StoredReaction[]>();
    for (const r of await this.store.listReactionsForMessages(spaceId, messages.map((m) => m.id))) {
      byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r]);
    }
    return messages.map((m) => ({ ...m, reactions: foldReactions(byMessage.get(m.id) ?? []) }));
  }

  private pageLimit(limit?: number): number {
    return Math.min(Math.max(limit ?? MESSAGES_PAGE_DEFAULT, 1), MESSAGES_PAGE_MAX);
  }

  /** A topic listing's activity stamp: the newest reply, else the root's post. */
  private static activityOf(root: Message | undefined, topic: Topic): string {
    return root?.lastReplyAt ?? root?.postedAt ?? topic.createdAt;
  }

  async listTopics(ctx: ActorCtx, spaceId: string, includeArchived = false): Promise<TopicListing[]> {
    await this.requireMember(ctx, spaceId);
    const topics = await this.store.listTopics(spaceId, includeArchived);
    // Every consumer needs the root message (reply chips, parent cards,
    // unread anchors) — always folded in; activity computes from its denorm.
    const listings: TopicListing[] = [];
    for (const t of topics) {
      const root = await this.store.getMessage(spaceId, t.rootMessageId);
      listings.push({ ...t, rootMessage: root ?? null, lastActivityAt: HarborService.activityOf(root, t) });
    }
    return listings.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id));
  }

  async listStream(
    ctx: ActorCtx,
    spaceId: string,
    opts?: { beforeOffset?: number; limit?: number },
  ): Promise<{ messages: Message[]; topics: Topic[]; hasMore: boolean }> {
    await this.requireMember(ctx, spaceId);
    // Newest page by default — never the full history. One extra row answers
    // hasMore without a count query.
    const limit = this.pageLimit(opts?.limit);
    const window = await this.store.listStream(spaceId, {
      ...(opts?.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: limit + 1,
    });
    const hasMore = window.length > limit;
    const roots = hasMore ? window.slice(1) : window;
    // The page's topic badges, one batched decoration.
    const topics: Topic[] = [];
    for (const m of roots) {
      const topic = await this.store.getTopicByRoot(spaceId, m.id);
      if (topic) topics.push(topic);
    }
    return { messages: await this.foldPage(spaceId, roots), topics, hasMore };
  }

  /** A reply's id resolves to its root — callers always land on the thread. */
  private async resolveRoot(spaceId: string, messageId: string): Promise<Message> {
    const message = await this.store.getMessage(spaceId, messageId);
    if (!message) throw new HarborError('not_found', 'no such message');
    if (message.threadRoot === undefined) return message;
    const root = await this.store.getMessage(spaceId, message.threadRoot);
    if (!root) throw new HarborError('internal', 'reply points at a missing root');
    return root;
  }

  async listThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    opts?: { beforeOffset?: number; limit?: number },
  ): Promise<{ root: Message; topic: Topic | null; messages: Message[]; hasMore: boolean }> {
    await this.requireMember(ctx, spaceId);
    const root = await this.resolveRoot(spaceId, rootMessageId);
    const limit = this.pageLimit(opts?.limit);
    const window = await this.store.listThread(spaceId, root.id, {
      ...(opts?.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: limit + 1,
    });
    const hasMore = window.length > limit;
    const replies = hasMore ? window.slice(1) : window;
    const [foldedRoot] = await this.foldPage(spaceId, [root]);
    return {
      root: foldedRoot!,
      topic: (await this.store.getTopicByRoot(spaceId, root.id)) ?? null,
      messages: await this.foldPage(spaceId, replies),
      hasMore,
    };
  }

  async postMessage(ctx: ActorCtx, spaceId: string, input: NewMessage): Promise<{ message: Message }> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const author: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const at = this.now();

      if (input.threadRoot) {
        // A reply. Normalize to the root (Slack-style: replying to a reply is
        // replying to its thread) — threads stay flat by construction.
        const root = await this.resolveRoot(spaceId, input.threadRoot);
        const offset = (await this.store.head(spaceId)) + 1;
        const message: Message = {
          id: this.ulid(),
          spaceId,
          threadRoot: root.id,
          author,
          body: input.body,
          postedAt: at,
          offset,
          replyCount: 0,
          reactions: [],
        };
        await this.store.appendMessage(message);
        await this.store.refreshReplyStats(spaceId, root.id);
        await this.append(spaceId, offset, at, { type: 'message', message });
        // Gmail semantics: activity returns an archived topic to the rail.
        const topic = await this.store.getTopicByRoot(spaceId, root.id);
        if (topic?.archived) {
          const revived: Topic = { ...topic, archived: false };
          await this.store.putTopic(revived);
          await this.append(spaceId, offset + 1, at, { type: 'topic', topic: revived, action: 'unarchived', by: author });
        }
        return { message };
      }

      // A new root in the stream. Never a container — createTopic is the
      // deliberate ceremony.
      if (input.anchorChangeSetId) {
        const anchor = await this.store.getChangeSet(spaceId, input.anchorChangeSetId);
        if (!anchor) throw new HarborError('invalid_request', 'anchorChangeSetId does not exist in this space');
      }
      const offset = (await this.store.head(spaceId)) + 1;
      const message: Message = {
        id: this.ulid(),
        spaceId,
        author,
        body: input.body,
        postedAt: at,
        offset,
        replyCount: 0,
        ...(input.anchorChangeSetId ? { anchorChangeSetId: input.anchorChangeSetId } : {}),
        reactions: [],
      };
      await this.store.appendMessage(message);
      await this.append(spaceId, offset, at, { type: 'message', message });
      return { message };
    });
  }

  /**
   * The deliberate ceremony (spec §7): annotate a thread with a stated goal.
   * Promote (rootMessageId) inserts one row and cannot touch a message; from
   * scratch (body) posts the root first — nothing is born outside the stream.
   */
  async createTopic(
    ctx: ActorCtx,
    spaceId: string,
    input: CreateTopicInput,
  ): Promise<{ topic: Topic; rootMessage: Message }> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const at = this.now();

      let root: Message;
      let offset = (await this.store.head(spaceId)) + 1;
      if (input.rootMessageId) {
        const message = await this.store.getMessage(spaceId, input.rootMessageId);
        if (!message) throw new HarborError('not_found', 'no such message');
        if (message.threadRoot !== undefined) {
          throw new HarborError('invalid_request', `this is a reply — promote the thread's root (${message.threadRoot})`);
        }
        const claimed = await this.store.getTopicByRoot(spaceId, message.id);
        if (claimed) {
          throw new HarborError('invalid_request', `this thread already has a topic (${claimed.id})`);
        }
        root = message;
      } else {
        root = {
          id: this.ulid(),
          spaceId,
          author: by,
          body: input.body!,
          postedAt: at,
          offset,
          replyCount: 0,
          reactions: [],
        };
        await this.store.appendMessage(root);
        await this.append(spaceId, offset, at, { type: 'message', message: root });
        offset += 1;
      }

      const topic: Topic = {
        id: this.ulid(),
        spaceId,
        rootMessageId: root.id,
        title: input.title,
        createdBy: by,
        createdAt: at,
        archived: false,
      };
      await this.store.putTopic(topic);
      await this.append(spaceId, offset, at, { type: 'topic', topic, action: 'created', by });
      return { topic, rootMessage: root };
    });
  }

  /**
   * Author-only tombstone (spec §4: the content plane is role-flat, so
   * deleter == author — admins moderate membership, never content). The body
   * is redacted everywhere it lives, message row and stored message event
   * alike, and a message_deleted event narrates; the row itself stays so
   * threads anchored to the message keep their parent. Re-deleting is an
   * idempotent 200 no-op with no event, like reaction toggles.
   */
  async deleteMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: DeleteMessageInput,
  ): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      if (message.author.memberId !== ctx.memberId) {
        throw new HarborError('forbidden', 'only the author can delete a message');
      }
      const withReactions = async (m: Message): Promise<Message> => ({
        ...m,
        reactions: foldReactions(await this.store.listReactionsByMessage(spaceId, messageId)),
      });
      if (message.deletedAt) return withReactions(message);

      const at = this.now();
      await this.store.markMessageDeleted(spaceId, messageId, at);
      // The tombstone stays a row (threads anchored under it survive) but a
      // deleted reply stops counting toward its root's chip. lastReplyAt is
      // deliberately untouched — deleting must not resurface or reorder.
      if (message.threadRoot !== undefined) {
        await this.store.refreshReplyStats(spaceId, message.threadRoot);
      }
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, at, {
        type: 'message_deleted',
        deletion: {
          spaceId,
          messageId,
          ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}),
          by,
          at,
        },
      });
      return withReactions({ ...message, body: '', deletedAt: at });
    });
  }

  /**
   * Author-only body rewrite (spec §4 posture shared with deletion: the
   * content plane is role-flat, so editor == author). The body is replaced
   * everywhere it lives — message row and stored message event — and a
   * message_edited event narrates. Tombstones refuse; an identical body is
   * an idempotent 200 no-op with no event. Activity is not bumped.
   */
  async editMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: EditMessageInput,
  ): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      if (message.author.memberId !== ctx.memberId) {
        throw new HarborError('forbidden', 'only the author can edit a message');
      }
      if (message.deletedAt) throw new HarborError('invalid_request', 'cannot edit a deleted message');
      const withReactions = async (m: Message): Promise<Message> => ({
        ...m,
        reactions: foldReactions(await this.store.listReactionsByMessage(spaceId, messageId)),
      });
      if (message.body === input.body) return withReactions(message);

      const at = this.now();
      await this.store.markMessageEdited(spaceId, messageId, input.body, at);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, at, {
        type: 'message_edited',
        edit: {
          spaceId,
          messageId,
          ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}),
          body: input.body,
          by,
          at,
        },
      });
      return withReactions({ ...message, body: input.body, editedAt: at });
    });
  }

  /**
   * Toggle a reaction (Slack semantics): any member, any message in the
   * space, one per (member, emoji). Re-adding what exists / removing what
   * doesn't is an idempotent no-op — no write, no event. Returns the message
   * with reactions folded so the caller can render without the live frame.
   */
  async reactToMessage(ctx: ActorCtx, spaceId: string, messageId: string, input: ReactInput): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      if (message.deletedAt && input.action === 'add') {
        // Removes stay legal so people can clean up reactions left on a tombstone.
        throw new HarborError('invalid_request', 'cannot react to a deleted message');
      }
      const existing = await this.store.getReaction(spaceId, messageId, input.emoji, ctx.memberId);
      const at = this.now();

      const reaction = {
        spaceId,
        messageId,
        ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}),
        emoji: input.emoji,
        by,
        at,
      };
      if (input.action === 'add' && !existing) {
        await this.store.putReaction({ spaceId, messageId, emoji: input.emoji, by, at });
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, { type: 'reaction', reaction, action: 'added' });
      } else if (input.action === 'remove' && existing) {
        await this.store.deleteReaction(spaceId, messageId, input.emoji, ctx.memberId);
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, { type: 'reaction', reaction, action: 'removed' });
      }

      return {
        ...message,
        reactions: foldReactions(await this.store.listReactionsByMessage(spaceId, messageId)),
      };
    });
  }

  /**
   * One-row lifecycle ops on the annotation — none can touch a message.
   * Retitle/archive/unarchive update the row; remove deletes it ("convert
   * back to thread") and the conversation never knew. Every act narrates on
   * the log with its actor, so threads can render attributed lifecycle lines.
   */
  async manageTopic(ctx: ActorCtx, spaceId: string, topicId: string, action: ManageTopicAction): Promise<Topic> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: action.actingMode,
      ...(action.agentName ? { agentName: action.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const topic = await this.store.getTopic(spaceId, topicId);
      if (!topic) throw new HarborError('not_found', 'no such topic');
      const at = this.now();

      switch (action.action) {
        case 'retitle': {
          if (topic.title === action.title) return topic; // idempotent, no event
          const updated: Topic = { ...topic, title: action.title };
          await this.store.putTopic(updated);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: updated, action: 'retitled', by });
          return updated;
        }
        case 'archive':
        case 'unarchive': {
          const archived = action.action === 'archive';
          if (topic.archived === archived) return topic; // idempotent, no event
          const updated: Topic = { ...topic, archived };
          await this.store.putTopic(updated);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: updated, action: action.action === 'archive' ? 'archived' : 'unarchived', by });
          return updated;
        }
        case 'remove': {
          await this.store.deleteTopic(spaceId, topicId);
          const removal: TopicRemoval = { spaceId, topicId, rootMessageId: topic.rootMessageId, by, at };
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic_removed', removal });
          return topic;
        }
      }
    });
  }

  /**
   * Space search (protocol search.ts): three categorized top-N lists over one
   * pair of GIN-backed store calls per kind. Member names are resolved here —
   * not in the store — so mention expansion (search.ts) always sees the
   * CURRENT roster: renames are correct on the very next query. Structure
   * (which thread a hit lives in, which topic annotates it) is joined at
   * query time, never copied into any index.
   */
  async search(
    ctx: ActorCtx,
    spaceId: string,
    rawQuery: string,
    opts?: { kinds?: SearchKind[]; limit?: number },
  ): Promise<SearchResults> {
    await this.requireMember(ctx, spaceId);
    const limit = Math.min(opts?.limit ?? 10, 50);
    const kinds = new Set<SearchKind>(opts?.kinds ?? ['messages', 'topics', 'assets']);

    const memberships = await this.store.listMemberships(spaceId);
    const members: Member[] = [];
    for (const m of memberships) {
      const member = await this.store.getMember(m.memberId);
      if (member) members.push(member);
    }
    const query = parseSearchQuery(rawQuery, members);

    const empty: SearchResults = {
      messages: [],
      topics: [],
      assets: [],
      truncated: { messages: false, topics: false, assets: false },
    };
    if (query.terms.length === 0) return empty;
    const results = empty;

    if (kinds.has('messages')) {
      // limit+1 detects truncation without a count query.
      const rows = await this.store.searchMessages(spaceId, query, limit + 1);
      results.truncated.messages = rows.length > limit;
      const titleByRoot = new Map<string, string>();
      for (const { message, snippet } of rows.slice(0, limit)) {
        const rootId = message.threadRoot ?? message.id;
        if (!titleByRoot.has(rootId)) {
          const topic = await this.store.getTopicByRoot(spaceId, rootId);
          if (topic) titleByRoot.set(rootId, topic.title);
        }
        const topicTitle = titleByRoot.get(rootId);
        results.messages.push({
          messageId: message.id,
          threadRootId: rootId,
          ...(topicTitle !== undefined ? { topicTitle } : {}),
          author: message.author,
          snippet,
          postedAt: message.postedAt,
          offset: message.offset,
        });
      }
    }
    if (kinds.has('topics')) {
      const rows = await this.store.searchTopics(spaceId, query, limit + 1);
      results.truncated.topics = rows.length > limit;
      results.topics = rows.slice(0, limit).map((topic) => ({ topic }));
    }
    if (kinds.has('assets')) {
      const rows = await this.store.searchAssets(spaceId, query, limit + 1);
      results.truncated.assets = rows.length > limit;
      results.assets = rows.slice(0, limit).map(({ record, snippet }) => ({
        path: record.path,
        version: record.version,
        updatedAt: record.updatedAt,
        ...(record.blob !== undefined ? { blob: record.blob } : {}),
        ...(snippet !== undefined ? { snippet } : {}),
      }));
    }
    return results;
  }

  // --- live ------------------------------------------------------------------

  async publishPresence(
    ctx: ActorCtx,
    spaceId: string,
    state: PresenceState,
    threadRootId?: string,
  ): Promise<void> {
    await this.requireMember(ctx, spaceId);
    this.hub.publish(spaceId, {
      kind: 'presence',
      spaceId,
      memberId: ctx.memberId,
      state,
      ...(threadRootId !== undefined ? { threadRootId } : {}),
      at: this.now(),
    });
  }

  /**
   * Relay one ephemeral whiteboard frame to the space's subscribers. The
   * payload stays opaque (content-blind, like presence): membership is the
   * only check, nothing is stored, nothing is replayed. Durable board state
   * arrives separately as blob snapshots via proposeChange.
   */
  async publishWhiteboard(ctx: ActorCtx, spaceId: string, boardId: string, payload: unknown): Promise<void> {
    await this.requireMember(ctx, spaceId);
    this.hub.publish(spaceId, {
      kind: 'whiteboard',
      spaceId,
      boardId,
      memberId: ctx.memberId,
      at: this.now(),
      payload,
    });
  }

  async eventsAfter(spaceId: string, afterOffset: number): Promise<StoredEvent[]> {
    return this.store.listEventsAfter(spaceId, afterOffset);
  }

  async headOffset(spaceId: string): Promise<number> {
    return this.store.head(spaceId);
  }
}

/** Stored rows (oldest first) → display groups: emojis in first-reacted order, members likewise. */
function foldReactions(reactions: StoredReaction[]): ReactionGroup[] {
  const groups = new Map<string, string[]>();
  for (const r of reactions) {
    const members = groups.get(r.emoji) ?? [];
    if (!members.includes(r.by.memberId)) members.push(r.by.memberId);
    groups.set(r.emoji, members);
  }
  return [...groups.entries()].map(([emoji, memberIds]) => ({ emoji, memberIds }));
}

export type { ActingMode };
