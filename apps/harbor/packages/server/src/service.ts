import { randomBytes } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { monotonicFactory } from 'ulid';
import {
  inviteUrl,
  topicIdFromReason,
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
  type Poll,
  type PresenceState,
  type ProposeChange,
  type ProposeChangeResult,
  type ReactionGroup,
  type ReadAssetResult,
  type ResolveInviteResult,
  type RestoreAssetResult,
  type Routes,
  type Space,
  type SpaceEvent,
  type Topic,
  type TopicListing,
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
import type { AssetRecord, AssetVersionData, Store, StoredEvent, StoredPollVote, StoredReaction } from './store.js';

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

type NewTopicMessage = z.infer<Routes['postMessage']['request']>;
type ManageTopicAction = z.infer<Routes['manageTopic']['request']>;
type ReactInput = z.infer<Routes['reactToMessage']['request']>;
type DeleteMessageInput = z.infer<Routes['deleteMessage']['request']>;
type EditMessageInput = z.infer<Routes['editMessage']['request']>;
type VotePollInput = z.infer<Routes['votePoll']['request']>;
type EndPollInput = z.infer<Routes['endPoll']['request']>;

/** Poll duration when the create request names none — Discord's default. */
const DEFAULT_POLL_HOURS = 24;

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
/** The seeded stream topic's title — what legacy clients (pre-kind) look for. */
const GENERAL_TOPIC_TITLE = 'messages';

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
      // Every space is born with its stream (kind 'general', exactly one —
      // migration 004's partial unique index). No seed message needed: the
      // title is set directly, so the topic starts empty.
      const general: Topic = {
        id: this.ulid(),
        spaceId: space.id,
        title: GENERAL_TOPIC_TITLE,
        kind: 'general',
        createdBy: { memberId: ctx.memberId, actingMode: 'direct' },
        createdAt: now,
        archived: false,
        lastActivityAt: now,
        messageCount: 0,
      };
      await this.store.putTopic(general);
      await this.append(space.id, offset + 1, now, { type: 'topic', topic: general });
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
    if (input.topicId && !(await this.store.getTopic(spaceId, input.topicId))) {
      throw new HarborError('invalid_request', 'topicId does not exist in this space');
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
        topicId: input.topicId,
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
    if (input.topicId && !(await this.store.getTopic(spaceId, input.topicId))) {
      throw new HarborError('invalid_request', 'topicId does not exist in this space');
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
        topicId: input.topicId,
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
      topicId?: string;
      at: string;
    },
  ): Promise<ChangeSet> {
    const offset = (await this.store.head(spaceId)) + 1;
    const topicId = input.topicId ?? topicIdFromReason(input.reason);
    const changeSet: ChangeSet = {
      id: this.ulid(),
      spaceId,
      assetPath: input.assetPath,
      baseVersion: input.version,
      resultVersion: input.version,
      attribution: input.attribution,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(topicId ? { topicId } : {}),
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
    if (input.topicId && !(await this.store.getTopic(spaceId, input.topicId))) {
      throw new HarborError('invalid_request', 'topicId does not exist in this space');
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
    // Provenance: an explicit topicId wins; otherwise the "· topic:<id>"
    // reason suffix that prompt-driven agents write (best effort — the suffix
    // is a claim, not validated).
    const topicId = input.topicId ?? topicIdFromReason(input.reason);
    const changeSet: ChangeSet = {
      id: this.ulid(),
      spaceId,
      assetPath: input.assetPath,
      baseVersion: input.baseVersion,
      resultVersion: version,
      attribution,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(topicId ? { topicId } : {}),
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

  async listTopics(ctx: ActorCtx, spaceId: string, includeArchived = false): Promise<TopicListing[]> {
    await this.requireMember(ctx, spaceId);
    const topics = await this.store.listTopics(spaceId, includeArchived);
    // Every consumer needs the first message (derived titles, thread parent
    // cards, seed detection) — always folded in, one query for all topics.
    const firsts = await this.store.getFirstMessages(spaceId);
    return topics.map((t) => ({ ...t, firstMessage: firsts.get(t.id) ?? null }));
  }

  async listMessages(
    ctx: ActorCtx,
    spaceId: string,
    topicId: string,
    opts?: { beforeOffset?: number; limit?: number },
  ): Promise<{ topic: Topic; messages: Message[]; hasMore: boolean }> {
    await this.requireMember(ctx, spaceId);
    const topic = await this.store.getTopic(spaceId, topicId);
    if (!topic) throw new HarborError('not_found', 'no such topic');
    // Newest page by default — never the full history. One extra row answers
    // hasMore without a count query.
    const limit = Math.min(Math.max(opts?.limit ?? MESSAGES_PAGE_DEFAULT, 1), MESSAGES_PAGE_MAX);
    const window = await this.store.listMessages(spaceId, topicId, {
      ...(opts?.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: limit + 1,
    });
    const hasMore = window.length > limit;
    const messages = hasMore ? window.slice(1) : window;
    // Fold live reaction and poll-vote state in — those fields on a stored
    // message event are at-post snapshots (empty); reads carry the current truth.
    const byMessage = new Map<string, StoredReaction[]>();
    for (const r of await this.store.listReactionsByTopic(spaceId, topicId)) {
      byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r]);
    }
    const votesByMessage = new Map<string, StoredPollVote[]>();
    for (const v of await this.store.listPollVotesByTopic(spaceId, topicId)) {
      votesByMessage.set(v.messageId, [...(votesByMessage.get(v.messageId) ?? []), v]);
    }
    return {
      topic,
      messages: messages.map((m) => ({
        ...m,
        reactions: foldReactions(byMessage.get(m.id) ?? []),
        ...(m.poll ? { poll: foldPollVotes(m.poll, votesByMessage.get(m.id) ?? []) } : {}),
      })),
      hasMore,
    };
  }

  /** Live folded state onto one message: reactions always, poll votes when a poll rides it. */
  private async foldLive(spaceId: string, message: Message): Promise<Message> {
    const folded: Message = {
      ...message,
      reactions: foldReactions(await this.store.listReactionsByMessage(spaceId, message.id)),
    };
    if (message.poll) {
      folded.poll = foldPollVotes(message.poll, await this.store.listPollVotesByMessage(spaceId, message.id));
    }
    return folded;
  }

  async postMessage(
    ctx: ActorCtx,
    spaceId: string,
    input: NewTopicMessage,
  ): Promise<{ topic: Topic; message: Message }> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const author: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const at = this.now();
      // The org stamps the poll from its own clock: answer ids 1..n, a
      // duration in becomes an expiry out (the Discord create asymmetry).
      const poll: Poll | undefined = input.poll
        ? {
            question: input.poll.question,
            answers: input.poll.answers.map((a, i) => ({ id: i + 1, text: a.text, ...(a.emoji ? { emoji: a.emoji } : {}) })),
            allowMultiselect: input.poll.allowMultiselect ?? false,
            expiresAt: new Date(Date.parse(at) + (input.poll.durationHours ?? DEFAULT_POLL_HOURS) * 3_600_000).toISOString(),
            votes: [],
          }
        : undefined;

      if (input.topicId) {
        const topic = await this.store.getTopic(spaceId, input.topicId);
        if (!topic) throw new HarborError('not_found', 'no such topic');
        const offset = (await this.store.head(spaceId)) + 1;
        const message: Message = {
          id: this.ulid(),
          topicId: topic.id,
          spaceId,
          author,
          body: input.body,
          postedAt: at,
          offset,
          reactions: [],
          ...(poll ? { poll } : {}),
        };
        await this.store.appendMessage(message);
        // Replying revives an archived topic; counts/lastActivity update without
        // a topic event (clients derive those from message events).
        const updated: Topic = {
          ...topic,
          archived: false,
          lastActivityAt: at,
          messageCount: topic.messageCount + 1,
        };
        await this.store.putTopic(updated);
        await this.append(spaceId, offset, at, { type: 'message', message });
        if (topic.archived) {
          await this.append(spaceId, offset + 1, at, { type: 'topic', topic: updated });
        }
        return { topic: updated, message };
      }

      // First message becomes the title (spec §7); agents recover structure later.
      if (input.anchorChangeSetId) {
        const anchor = await this.store.getChangeSet(spaceId, input.anchorChangeSetId);
        if (!anchor) throw new HarborError('invalid_request', 'anchorChangeSetId does not exist in this space');
      }
      if (input.anchorMessageId) {
        const anchor = await this.store.getMessage(spaceId, input.anchorMessageId);
        if (!anchor) throw new HarborError('invalid_request', 'anchorMessageId does not exist in this space');
        // One topic per message — the space lock makes this check race-free.
        const claimed = await this.store.getTopicByAnchor(spaceId, input.anchorMessageId);
        if (claimed) {
          throw new HarborError('invalid_request', `a topic already grew from this message (${claimed.id})`);
        }
      }
      const topicOffset = (await this.store.head(spaceId)) + 1;
      const topic: Topic = {
        id: this.ulid(),
        spaceId,
        title: deriveTitle(input.body),
        kind: 'discussion',
        createdBy: author,
        createdAt: at,
        archived: false,
        ...(input.anchorChangeSetId ? { anchorChangeSetId: input.anchorChangeSetId } : {}),
        ...(input.anchorMessageId ? { anchorMessageId: input.anchorMessageId } : {}),
        lastActivityAt: at,
        messageCount: 1,
      };
      const message: Message = {
        id: this.ulid(),
        topicId: topic.id,
        spaceId,
        author,
        body: input.body,
        postedAt: at,
        offset: topicOffset + 1,
        reactions: [],
        ...(poll ? { poll } : {}),
      };
      await this.store.putTopic(topic);
      await this.store.appendMessage(message);
      await this.append(spaceId, topicOffset, at, { type: 'topic', topic });
      await this.append(spaceId, topicOffset + 1, at, { type: 'message', message });
      return { topic, message };
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
      if (message.deletedAt) return this.foldLive(spaceId, message);

      const at = this.now();
      await this.store.markMessageDeleted(spaceId, messageId, at);
      // The tombstone stays a row but stops counting; activity is not bumped
      // (deleting must not resurface a quiet topic). No topic event — clients
      // refresh their topic lists off the deletion event like any other.
      const topic = await this.store.getTopic(spaceId, message.topicId);
      if (topic) {
        await this.store.putTopic({ ...topic, messageCount: Math.max(0, topic.messageCount - 1) });
      }
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, at, {
        type: 'message_deleted',
        deletion: { spaceId, topicId: message.topicId, messageId, by, at },
      });
      // A poll is content: redacted with the body (the store already dropped it).
      const { poll: _poll, ...rest } = message;
      return this.foldLive(spaceId, { ...rest, body: '', deletedAt: at });
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
      // The Discord posture: a poll message is immutable once posted — its
      // body is the poll's fallback rendering, and votes were cast on it.
      if (message.poll) throw new HarborError('invalid_request', 'poll messages cannot be edited');
      if (message.body === input.body) return this.foldLive(spaceId, message);

      const at = this.now();
      await this.store.markMessageEdited(spaceId, messageId, input.body, at);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, at, {
        type: 'message_edited',
        edit: { spaceId, topicId: message.topicId, messageId, body: input.body, by, at },
      });
      return this.foldLive(spaceId, { ...message, body: input.body, editedAt: at });
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

      if (input.action === 'add' && !existing) {
        await this.store.putReaction({ spaceId, messageId, emoji: input.emoji, by, at });
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, {
          type: 'reaction',
          reaction: { spaceId, topicId: message.topicId, messageId, emoji: input.emoji, by, at },
          action: 'added',
        });
      } else if (input.action === 'remove' && existing) {
        await this.store.deleteReaction(spaceId, messageId, input.emoji, ctx.memberId);
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, {
          type: 'reaction',
          reaction: { spaceId, topicId: message.topicId, messageId, emoji: input.emoji, by, at },
          action: 'removed',
        });
      }

      return this.foldLive(spaceId, message);
    });
  }

  /**
   * Toggle a vote on a poll answer — reaction semantics (per-(member, answer),
   * idempotent no-ops), plus the single-select rule: adding while another
   * answer holds this member's vote MOVES it (remove-then-add, two events,
   * one lock). Closed polls and tombstones refuse. Agents cannot vote (the
   * Discord posture: apps don't vote — an agent's opinion is a reply).
   */
  async votePoll(ctx: ActorCtx, spaceId: string, messageId: string, input: VotePollInput): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    if (input.actingMode !== 'direct') {
      throw new HarborError('invalid_request', 'agents cannot vote on polls');
    }
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      const poll = message.poll;
      if (!poll || message.deletedAt) throw new HarborError('invalid_request', 'no poll on this message');
      const at = this.now();
      // Lazy expiry: both close states end voting; ISO-8601 UTC compares lexically.
      if (poll.endedAt || poll.expiresAt <= at) throw new HarborError('invalid_request', 'the poll has ended');
      if (!poll.answers.some((a) => a.id === input.answerId)) {
        throw new HarborError('invalid_request', 'no such answer');
      }
      const existing = await this.store.getPollVote(spaceId, messageId, input.answerId, ctx.memberId);

      if (input.action === 'add' && !existing) {
        if (!poll.allowMultiselect) {
          const mine = (await this.store.listPollVotesByMessage(spaceId, messageId)).filter(
            (v) => v.by.memberId === ctx.memberId,
          );
          for (const v of mine) {
            await this.store.deletePollVote(spaceId, messageId, v.answerId, ctx.memberId);
            const offset = (await this.store.head(spaceId)) + 1;
            await this.append(spaceId, offset, at, {
              type: 'poll_vote',
              vote: { spaceId, topicId: message.topicId, messageId, answerId: v.answerId, by, at },
              action: 'removed',
            });
          }
        }
        await this.store.putPollVote({ spaceId, messageId, answerId: input.answerId, by, at });
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, {
          type: 'poll_vote',
          vote: { spaceId, topicId: message.topicId, messageId, answerId: input.answerId, by, at },
          action: 'added',
        });
      } else if (input.action === 'remove' && existing) {
        await this.store.deletePollVote(spaceId, messageId, input.answerId, ctx.memberId);
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, {
          type: 'poll_vote',
          vote: { spaceId, topicId: message.topicId, messageId, answerId: input.answerId, by, at },
          action: 'removed',
        });
      }

      return this.foldLive(spaceId, message);
    });
  }

  /**
   * End a poll early — author-only, deletion's posture. Ending an already-
   * closed poll (early-ended or naturally expired) is an idempotent no-op
   * with no event; natural expiry itself never calls this.
   */
  async endPoll(ctx: ActorCtx, spaceId: string, messageId: string, input: EndPollInput): Promise<Message> {
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
      const poll = message.poll;
      if (!poll || message.deletedAt) throw new HarborError('invalid_request', 'no poll on this message');
      if (message.author.memberId !== ctx.memberId) {
        throw new HarborError('forbidden', 'only the poll author can end it');
      }
      const at = this.now();
      if (poll.endedAt || poll.expiresAt <= at) return this.foldLive(spaceId, message);

      await this.store.markPollEnded(spaceId, messageId, at);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, at, {
        type: 'poll_ended',
        end: { spaceId, topicId: message.topicId, messageId, by, at },
      });
      return this.foldLive(spaceId, { ...message, poll: { ...poll, endedAt: at } });
    });
  }

  async manageTopic(ctx: ActorCtx, spaceId: string, topicId: string, action: ManageTopicAction): Promise<Topic> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();

    return this.store.withSpaceLock(spaceId, async () => {
      const topic = await this.store.getTopic(spaceId, topicId);
      if (!topic) throw new HarborError('not_found', 'no such topic');
      const at = this.now();

      switch (action.action) {
        case 'retitle': {
          const updated: Topic = { ...topic, title: action.title };
          await this.store.putTopic(updated);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: updated });
          return updated;
        }
        case 'archive':
        case 'unarchive': {
          const archived = action.action === 'archive';
          if (topic.archived === archived) return topic; // idempotent, no event
          const updated: Topic = { ...topic, archived };
          await this.store.putTopic(updated);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: updated });
          return updated;
        }
        case 'merge_into': {
          if (action.targetTopicId === topicId) {
            throw new HarborError('invalid_request', 'cannot merge a topic into itself');
          }
          const target = await this.store.getTopic(spaceId, action.targetTopicId);
          if (!target) throw new HarborError('not_found', 'no such target topic');
          const moved = await this.store.reassignMessages(spaceId, topicId, target.id);
          const source: Topic = { ...topic, archived: true };
          const updatedTarget: Topic = {
            ...target,
            messageCount: target.messageCount + moved,
            lastActivityAt: target.lastActivityAt > topic.lastActivityAt ? target.lastActivityAt : topic.lastActivityAt,
            archived: false,
          };
          await this.store.putTopic(source);
          await this.store.putTopic(updatedTarget);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: source });
          await this.append(spaceId, offset + 1, at, { type: 'topic', topic: updatedTarget });
          // The surviving topic is what the caller works with next.
          return updatedTarget;
        }
      }
    });
  }

  async searchFeed(
    ctx: ActorCtx,
    spaceId: string,
    query: string,
    limit = 20,
  ): Promise<Array<{ topicId: string; title: string; snippet: string; lastActivityAt: string }>> {
    await this.requireMember(ctx, spaceId);
    const q = query.toLowerCase();
    const topics = await this.store.listTopics(spaceId, true);
    const messages = await this.store.listMessagesBySpace(spaceId);
    const byTopic = new Map<string, Message[]>();
    for (const m of messages) {
      const list = byTopic.get(m.topicId) ?? [];
      list.push(m);
      byTopic.set(m.topicId, list);
    }

    const results: Array<{ topicId: string; title: string; snippet: string; lastActivityAt: string }> = [];
    for (const topic of topics) {
      if (topic.title.toLowerCase().includes(q)) {
        results.push({ topicId: topic.id, title: topic.title, snippet: topic.title, lastActivityAt: topic.lastActivityAt });
        continue;
      }
      const hit = (byTopic.get(topic.id) ?? []).find((m) => m.body.toLowerCase().includes(q));
      if (hit) {
        results.push({
          topicId: topic.id,
          title: topic.title,
          snippet: excerpt(hit.body, q),
          lastActivityAt: topic.lastActivityAt,
        });
      }
    }
    return results.slice(0, limit); // topics come sorted by lastActivityAt desc
  }

  // --- live ------------------------------------------------------------------

  async publishPresence(
    ctx: ActorCtx,
    spaceId: string,
    state: PresenceState,
    topicId?: string,
  ): Promise<void> {
    await this.requireMember(ctx, spaceId);
    this.hub.publish(spaceId, {
      kind: 'presence',
      spaceId,
      memberId: ctx.memberId,
      state,
      ...(topicId !== undefined ? { topicId } : {}),
      at: this.now(),
    });
  }

  async eventsAfter(spaceId: string, afterOffset: number): Promise<StoredEvent[]> {
    return this.store.listEventsAfter(spaceId, afterOffset);
  }

  async headOffset(spaceId: string): Promise<number> {
    return this.store.head(spaceId);
  }
}

/** Stored rows (oldest first) → groups in ANSWER order (a poll's order is fixed); voteless answers are omitted. */
function foldPollVotes(poll: Poll, votes: StoredPollVote[]): Poll {
  const groups = new Map<number, string[]>();
  for (const v of votes) {
    const members = groups.get(v.answerId) ?? [];
    if (!members.includes(v.by.memberId)) members.push(v.by.memberId);
    groups.set(v.answerId, members);
  }
  return {
    ...poll,
    votes: poll.answers
      .filter((a) => groups.has(a.id))
      .map((a) => ({ answerId: a.id, memberIds: groups.get(a.id)! })),
  };
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

function deriveTitle(body: string): string {
  const firstLine = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return 'Untitled';
  const stripped = firstLine.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').trim();
  const title = stripped.length > 0 ? stripped : firstLine;
  return title.length > 256 ? `${title.slice(0, 255)}…` : title;
}

function excerpt(body: string, lowerQuery: string): string {
  const idx = body.toLowerCase().indexOf(lowerQuery);
  const start = Math.max(0, idx - 60);
  const end = Math.min(body.length, idx + lowerQuery.length + 100);
  const slice = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}${end < body.length ? '…' : ''}`;
}

export type { ActingMode };
