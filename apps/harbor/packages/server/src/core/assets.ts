import {
  threadRootFromReason,
  type Asset,
  type Attribution,
  type BlobInfo,
  type ChangeSet,
  type ConflictRegion,
  type CreateAsset,
  type CreateAssetResult,
  type DeleteAssetResult,
  type MoveAssetResult,
  type ProposeChange,
  type ProposeChangeResult,
  type ReadAssetResult,
  type RestoreAssetResult,
  type Routes,
} from '@rowboat/spaces-protocol';
import { createTwoFilesPatch } from 'diff';
import type { z } from 'zod';
import { blobHash, type BlobStore } from '../blobs.js';
import { HarborError } from '../errors.js';
import { merge3 } from '../merge.js';
import { dispositionFor, imageDimensions, resolveMime } from '../mime.js';
import type { AssetRecord, AssetVersionData } from '../store.js';
import { Kernel, type ActorCtx } from './kernel.js';

// Files: assets by id, versions and the change log, uploaded blobs, history
// and diff — the merge-then-correct write path (CONTRACT.md decisions 1 and 6).

/** BlobInfo's optional dimensions from a stored blob record — both or neither. */
function blobDims(stored: { width?: number; height?: number }): { width: number; height: number } | Record<string, never> {
  return stored.width !== undefined && stored.height !== undefined
    ? { width: stored.width, height: stored.height }
    : {};
}

const RECENT_HISTORY = 10;

export class Assets {
  constructor(
    private readonly k: Kernel,
    /** Absent = uploads unconfigured on this org (routes refuse loudly, everything else works). */
    private readonly blobs?: BlobStore,
  ) {}

  // --- assets ----------------------------------------------------------------
  // Files are addressed by id (2026-09-14): every operation takes an assetId;
  // the path is a display property of the record, set at birth (createAsset,
  // the one call that runs before an id exists) and changed by moveAsset.
  // Paths stay unique among the living so the tree reads like a file system
  // and relative links inside documents still resolve. History is a lineage
  // filter on the id; move/delete/restore are property updates that append
  // one op change-set each. Only content edits bump versions.

  toAsset(a: AssetRecord): Asset {
    return {
      id: a.id,
      path: a.path,
      version: a.version,
      updatedAt: a.updatedAt,
      ...(a.blob ? { blob: a.blob } : {}),
      ...(a.state === 'deleted' ? { state: 'deleted' as const } : {}),
    };
  }

  async listAssets(ctx: ActorCtx, spaceId: string, includeDeleted = false): Promise<Asset[]> {
    await this.k.requireMember(ctx, spaceId);
    const records = await this.k.store.listAssets(spaceId, includeDeleted);
    return records.map((a) => this.toAsset(a));
  }

  /** The asset row for `assetId`, live or trashed, else not_found. */
  private async requireAsset(spaceId: string, assetId: string): Promise<AssetRecord> {
    const asset = await this.k.store.getAssetById(spaceId, assetId);
    if (!asset) throw new HarborError('not_found', 'no such asset');
    return asset;
  }

  /** A LIVE asset for `assetId`; a trashed one names itself so the caller can restore it. */
  async requireLiveAsset(spaceId: string, assetId: string): Promise<AssetRecord> {
    const asset = await this.requireAsset(spaceId, assetId);
    if (asset.state !== 'live') {
      throw new HarborError('not_found', `${asset.path} was deleted — it can be restored from Trash`);
    }
    return asset;
  }

  private async recentHistory(spaceId: string, assetId: string, upToVersion?: number): Promise<ChangeSet[]> {
    const all = await this.k.store.listChangeSets(spaceId, { assetId, limit: 1_000 });
    const filtered = upToVersion === undefined ? all : all.filter((cs) => cs.resultVersion <= upToVersion);
    return filtered.slice(0, RECENT_HISTORY);
  }

  async readAsset(ctx: ActorCtx, spaceId: string, assetId: string, version?: number): Promise<ReadAssetResult> {
    await this.k.requireMember(ctx, spaceId);
    const asset = await this.requireLiveAsset(spaceId, assetId);
    const v = version ?? asset.version;
    const data = await this.k.store.getAssetVersion(spaceId, asset.id, v);
    if (data === undefined) throw new HarborError('not_found', `no version ${v} of ${asset.path}`);
    return {
      id: asset.id,
      path: asset.path,
      content: data.content ?? '',
      ...(data.blob ? { blob: data.blob } : {}),
      version: v,
      recentHistory: await this.recentHistory(spaceId, asset.id, v),
    };
  }

  /** Stale-base retry bundle for namespace ops — the propose conflict, minus merge regions. */
  private async staleAsset(spaceId: string, asset: AssetRecord) {
    const data = await this.k.store.getAssetVersion(spaceId, asset.id, asset.version);
    return {
      outcome: 'conflict' as const,
      currentVersion: asset.version,
      currentContent: data?.content ?? '',
      ...(data?.blob ? { currentBlob: data.blob } : {}),
      recentHistory: await this.recentHistory(spaceId, asset.id),
    };
  }

  /** The proposal's stored shape: text inline, or a blob that phase-1 landed in THIS space. */
  private async proposalData(spaceId: string, input: { newContent?: string; blob?: string }): Promise<AssetVersionData> {
    // Binary variant: the hash must be phase-1-uploaded to THIS space — a
    // version row can never point at nothing (and never at another space's
    // upload; the registry is the read gate).
    if (input.blob !== undefined) {
      const stored = await this.k.store.getSpaceBlob(spaceId, input.blob);
      if (!stored) {
        throw new HarborError('invalid_request', 'blob is not uploaded to this space — call uploadBlob first');
      }
      return { content: null, blob: { hash: stored.hash, size: stored.size, mime: stored.mime, ...blobDims(stored) } };
    }
    return { content: input.newContent ?? '', blob: null };
  }

  /**
   * Birth: the one operation that names a file by path, because it has no id
   * yet. The path must be free among the living; a trashed file with the same
   * name never blocks — it keeps its own record and the newcomer starts a
   * fresh lineage. Version 1, one change-set, one event.
   */
  async createAsset(ctx: ActorCtx, spaceId: string, input: CreateAsset): Promise<CreateAssetResult> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    if (input.threadRootId && !(await this.k.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    const data = await this.proposalData(spaceId, input);
    const attribution = this.k.attributionOf(ctx, input);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const occupant = await this.k.store.getLiveAssetByPath(spaceId, input.path);
      if (occupant) {
        throw new HarborError('invalid_request', `a file already exists at ${input.path} (${occupant.id}) — read it and propose a change, or pick another name`);
      }
      const record: AssetRecord = { id: this.k.ulid(), path: input.path, version: 1, updatedAt: this.k.now(), state: 'live' };
      await this.k.store.createAsset(spaceId, record);
      const changeSet = await this.commit(spaceId, record, { baseVersion: 0, ...input }, attribution, 1, data);
      const asset = await this.requireAsset(spaceId, record.id);
      return { asset: this.toAsset(asset), changeSet };
    });
  }

  async moveAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['moveAsset']['request']>,
  ): Promise<MoveAssetResult> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    if (input.threadRootId && !(await this.k.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    const attribution = this.k.attributionOf(ctx, input);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const asset = await this.requireLiveAsset(spaceId, input.assetId);
      if (input.toPath === asset.path) {
        throw new HarborError('invalid_request', 'destination is the same path');
      }
      if (input.baseVersion > asset.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${asset.version})`);
      }
      if (input.baseVersion !== asset.version) return this.staleAsset(spaceId, asset);
      if (await this.k.store.getLiveAssetByPath(spaceId, input.toPath)) {
        throw new HarborError('invalid_request', 'a file already exists at the destination — moves never overwrite, pick another name');
      }
      const at = this.k.now();
      await this.k.store.setAssetPath(spaceId, asset.id, input.toPath, at);
      const changeSet = await this.appendOpChangeSet(spaceId, asset.id, {
        assetPath: input.toPath,
        version: asset.version,
        attribution,
        op: 'move',
        movedFrom: asset.path,
        reason: input.reason,
        threadRootId: input.threadRootId,
        at,
      });
      return { outcome: 'moved' as const, changeSet, version: asset.version };
    });
  }

  async deleteAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['deleteAsset']['request']>,
  ): Promise<DeleteAssetResult> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    if (input.threadRootId && !(await this.k.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    const attribution = this.k.attributionOf(ctx, input);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const asset = await this.requireLiveAsset(spaceId, input.assetId);
      if (input.baseVersion > asset.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${asset.version})`);
      }
      if (input.baseVersion !== asset.version) return this.staleAsset(spaceId, asset);
      const at = this.k.now();
      // Freeze in place: rows keep their keys, the path frees (live-unique
      // index only binds the living). Restore is the inverse flip.
      await this.k.store.setAssetState(spaceId, asset.id, 'deleted', at);
      const changeSet = await this.appendOpChangeSet(spaceId, asset.id, {
        assetPath: asset.path,
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
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const attribution = this.k.attributionOf(ctx, input);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const dead = await this.requireAsset(spaceId, input.assetId);
      if (dead.state !== 'deleted') throw new HarborError('invalid_request', 'this file is not in the trash');
      if (await this.k.store.getLiveAssetByPath(spaceId, dead.path)) {
        throw new HarborError('invalid_request', `a file now exists at ${dead.path} — move it first, then restore`);
      }
      const at = this.k.now();
      await this.k.store.setAssetState(spaceId, dead.id, 'live', at);
      const changeSet = await this.appendOpChangeSet(spaceId, dead.id, {
        assetPath: dead.path,
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
    const offset = await this.k.nextOffset(spaceId);
    const threadRootId = input.threadRootId ?? threadRootFromReason(input.reason);
    const changeSet: ChangeSet = {
      id: this.k.ulid(),
      spaceId,
      assetId,
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
    await this.k.store.appendChangeSet(changeSet);
    await this.k.append(spaceId, offset, input.at, { type: 'change', changeSet });
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
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
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
    await this.k.store.putSpaceBlob({
      spaceId,
      hash,
      size: bytes.byteLength,
      mime,
      ...(dims ?? {}),
      uploadedBy: ctx.memberId,
      uploadedAt: this.k.now(),
    });
    // First registration wins (idempotent re-uploads keep the original mime).
    const stored = await this.k.store.getSpaceBlob(spaceId, hash);
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
    await this.k.requireMember(ctx, spaceId);
    const blobs = this.requireBlobStore();
    const stored = await this.k.store.getSpaceBlob(spaceId, hash);
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
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    if (input.threadRootId && !(await this.k.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    const proposal = await this.proposalData(spaceId, input);
    const attribution = this.k.attributionOf(ctx, input);

    return this.k.lockedAs(ctx, spaceId, async () => {
      const asset = await this.requireLiveAsset(spaceId, input.assetId);

      if (input.baseVersion > asset.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${asset.version})`);
      }

      if (input.baseVersion === asset.version) {
        const version = asset.version + 1;
        const changeSet = await this.commit(spaceId, asset, input, attribution, version, proposal);
        return { outcome: 'applied' as const, changeSet, version };
      }

      // Stale base: three-way merge (CONTRACT.md decision 1) — but only when
      // proposal, base, and current are ALL text. Binary staleness never
      // merges (spec §6): there is nothing to three-way in a JPEG, so any
      // binary side surfaces as conflict-or-replace with empty regions.
      const base = await this.k.store.getAssetVersion(spaceId, asset.id, input.baseVersion);
      const current = await this.k.store.getAssetVersion(spaceId, asset.id, asset.version);
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
      const changeSet = await this.commit(spaceId, asset, input, attribution, version, {
        content: result.content,
        blob: null,
      });
      return { outcome: 'merged' as const, changeSet, version, mergedContent: result.content };
    });
  }

  /** Inside the space lock only: writes the version, the change-set, and the event as one fact. */
  private async commit(
    spaceId: string,
    asset: { id: string; path: string },
    input: { baseVersion: number; reason?: string; threadRootId?: string },
    attribution: Attribution,
    version: number,
    data: AssetVersionData,
  ): Promise<ChangeSet> {
    const at = this.k.now();
    const offset = await this.k.nextOffset(spaceId);
    // Provenance: an explicit threadRootId wins; otherwise the "· thread:<id>"
    // reason suffix that prompt-driven agents write (best effort — the suffix
    // is a claim, not validated).
    const threadRootId = input.threadRootId ?? threadRootFromReason(input.reason);
    const changeSet: ChangeSet = {
      id: this.k.ulid(),
      spaceId,
      assetId: asset.id,
      assetPath: asset.path,
      baseVersion: input.baseVersion,
      resultVersion: version,
      attribution,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(threadRootId ? { threadRootId } : {}),
      ...(data.blob ? { blob: data.blob } : {}),
      committedAt: at,
      offset,
    };
    await this.k.store.putAssetVersion(spaceId, asset.id, version, data, at);
    await this.k.store.appendChangeSet(changeSet);
    await this.k.append(spaceId, offset, at, { type: 'change', changeSet });
    return changeSet;
  }

  async assetHistory(
    ctx: ActorCtx,
    spaceId: string,
    opts: { assetId?: string; beforeOffset?: number; limit?: number },
  ): Promise<ChangeSet[]> {
    await this.k.requireMember(ctx, spaceId);
    // An assetId filter means "this file's lineage" — live or trashed alike,
    // the record stays queryable across moves and after deletion.
    if (opts.assetId !== undefined && !(await this.k.store.getAssetById(spaceId, opts.assetId))) return [];
    return this.k.store.listChangeSets(spaceId, {
      ...(opts.assetId !== undefined ? { assetId: opts.assetId } : {}),
      ...(opts.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: opts.limit ?? 50,
    });
  }

  async diff(ctx: ActorCtx, spaceId: string, assetId: string, from: number, to: number): Promise<string> {
    await this.k.requireMember(ctx, spaceId);
    const asset = await this.requireAsset(spaceId, assetId);
    const fromData = await this.k.store.getAssetVersion(spaceId, asset.id, from);
    const toData = await this.k.store.getAssetVersion(spaceId, asset.id, to);
    if (fromData === undefined || toData === undefined) {
      throw new HarborError('not_found', 'no such version');
    }
    const path = asset.path;
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
}
