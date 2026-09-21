import type { z } from 'zod';
import type { BlobStore } from './blobs.js';
import { Assets } from './core/assets.js';
import { Feed } from './core/feed.js';
import { Kernel, type ActorCtx, type BindIdentity, type OrgInfo } from './core/kernel.js';
import { ReadState } from './core/read-state.js';
import { Spaces } from './core/spaces.js';
import type { RenameSpaceInput } from './core/spaces.js';
import type { CreateTopicInput, DeleteMessageInput, EditMessageInput, EndPollInput, ManageTopicAction, NewMessage, PageOpts, ReactInput, VotePollInput } from './core/feed.js';
import type { MarkReadInput, UnreadSnapshot } from './core/read-state.js';
import type { SpaceHub } from './hub.js';
import type { Notifier } from './notify.js';
import type { PushLevel, Store, StoredEvent } from './store.js';
import type {
  ActingMode,
  AcceptInviteResult,
  ActivityKind,
  ActivityPage,
  Asset,
  BlobInfo,
  ChangeSet,
  CreateAsset,
  CreateAssetResult,
  CreateInviteResult,
  DeleteAssetResult,
  Member,
  Message,
  MoveAssetResult,
  PresenceState,
  ProposeChange,
  ProposeChangeResult,
  ReadAssetResult,
  ResolveInviteResult,
  RestoreAssetResult,
  Routes,
  SearchKind,
  SearchResults,
  Space,
  Topic,
  TopicListing,
} from '@rowboat/spaces-protocol';

// The one service core (spec §9: one core, three doors). REST (http.ts), the
// live face (ws.ts) and MCP (mcp.ts) are thin projections over this class;
// neither has a privileged path. The class is a facade: the work lives in
// core/ — one aggregate per file over a shared Kernel (the space lock, the
// log, the access gate) — and every public method here delegates to it, so
// the faces and the tests see one object with one surface. Add a feature in
// its aggregate; add its delegate here.

export type { ActorCtx, BindIdentity, OrgInfo } from './core/kernel.js';
export type { ActingMode };

export class HarborService {
  private readonly k: Kernel;
  private readonly spaces: Spaces;
  private readonly assets: Assets;
  private readonly feed: Feed;
  private readonly readState: ReadState;

  constructor(
    store: Store,
    hub: SpaceHub,
    org: OrgInfo,
    /** Absent = uploads unconfigured on this org (routes refuse loudly, everything else works). */
    blobs?: BlobStore,
    /** Absent = no notifications on this org (notify.ts: frames + push). */
    notifier?: Notifier,
  ) {
    this.k = new Kernel(store, hub, org);
    this.spaces = new Spaces(this.k);
    this.assets = new Assets(this.k, blobs);
    this.feed = new Feed(this.k, this.assets, notifier);
    this.readState = new ReadState(this.k, this.spaces, this.feed);
  }

  /** The org this service serves — `address` is set once the listener knows its port (server.ts). */
  get org(): OrgInfo {
    return this.k.org;
  }

  /** Over-limit means read-only, never lockout (spec §4). Flip via the control plane; here a knob for tests. */
  get readOnly(): boolean {
    return this.k.readOnly;
  }
  set readOnly(value: boolean) {
    this.k.readOnly = value;
  }

  // --- the kernel (core/kernel.ts) -------------------------------------------------
  requireMember(ctx: ActorCtx, spaceId: string): Promise<Space> {
    return this.k.requireMember(ctx, spaceId);
  }

  // --- spaces & membership (core/spaces.ts) ----------------------------------------
  me(ctx: ActorCtx): Promise<Member> {
    return this.spaces.me(ctx);
  }
  listSpaces(ctx: ActorCtx, opts: { includeDirect?: boolean } = {}): Promise<Space[]> {
    return this.spaces.listSpaces(ctx, opts);
  }
  createSpace(ctx: ActorCtx, name: string): Promise<Space> {
    return this.spaces.createSpace(ctx, name);
  }
  renameSpace(ctx: ActorCtx, spaceId: string, input: RenameSpaceInput): Promise<Space> {
    return this.spaces.renameSpace(ctx, spaceId, input);
  }
  openDirect(ctx: ActorCtx, otherMemberId: string): Promise<{ space: Space; created: boolean }> {
    return this.spaces.openDirect(ctx, otherMemberId);
  }
  listMembers(ctx: ActorCtx, spaceId: string): Promise<Member[]> {
    return this.spaces.listMembers(ctx, spaceId);
  }
  listOrgMembers(ctx: ActorCtx): Promise<Member[]> {
    return this.spaces.listOrgMembers(ctx);
  }
  leaveSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    return this.spaces.leaveSpace(ctx, spaceId);
  }
  createInvite(ctx: ActorCtx, spaceId: string, expiresInHours?: number): Promise<CreateInviteResult> {
    return this.spaces.createInvite(ctx, spaceId, expiresInHours);
  }
  resolveInvite(token: string): Promise<ResolveInviteResult> {
    return this.spaces.resolveInvite(token);
  }
  bindInvite(identity: BindIdentity, token: string): Promise<AcceptInviteResult> {
    return this.spaces.bindInvite(identity, token);
  }
  acceptInvite(ctx: ActorCtx, token: string): Promise<AcceptInviteResult> {
    return this.spaces.acceptInvite(ctx, token);
  }
  registerPush(ctx: ActorCtx, input: { token: string; level: PushLevel }): Promise<{ ok: true }> {
    return this.spaces.registerPush(ctx, input);
  }
  unregisterPush(ctx: ActorCtx, input: { token: string }): Promise<{ ok: true }> {
    return this.spaces.unregisterPush(ctx, input);
  }
  publishPresence(
    ctx: ActorCtx,
    spaceId: string,
    state: PresenceState,
    threadRootId?: string,
  ): Promise<void> {
    return this.spaces.publishPresence(ctx, spaceId, state, threadRootId);
  }
  publishWhiteboard(ctx: ActorCtx, spaceId: string, boardId: string, payload: unknown): Promise<void> {
    return this.spaces.publishWhiteboard(ctx, spaceId, boardId, payload);
  }
  replay(ctx: ActorCtx, spaceId: string, afterOffset?: number): Promise<{ head: number; events: StoredEvent[] }> {
    return this.spaces.replay(ctx, spaceId, afterOffset);
  }

  // --- files (core/assets.ts) ------------------------------------------------------
  listAssets(ctx: ActorCtx, spaceId: string, includeDeleted = false): Promise<Asset[]> {
    return this.assets.listAssets(ctx, spaceId, includeDeleted);
  }
  readAsset(ctx: ActorCtx, spaceId: string, assetId: string, version?: number): Promise<ReadAssetResult> {
    return this.assets.readAsset(ctx, spaceId, assetId, version);
  }
  createAsset(ctx: ActorCtx, spaceId: string, input: CreateAsset): Promise<CreateAssetResult> {
    return this.assets.createAsset(ctx, spaceId, input);
  }
  moveAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['moveAsset']['request']>,
  ): Promise<MoveAssetResult> {
    return this.assets.moveAsset(ctx, spaceId, input);
  }
  deleteAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['deleteAsset']['request']>,
  ): Promise<DeleteAssetResult> {
    return this.assets.deleteAsset(ctx, spaceId, input);
  }
  restoreAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['restoreAsset']['request']>,
  ): Promise<RestoreAssetResult> {
    return this.assets.restoreAsset(ctx, spaceId, input);
  }
  uploadBlob(
    ctx: ActorCtx,
    spaceId: string,
    bytes: Uint8Array,
    opts: { declaredSha256: string; declaredMime?: string },
  ): Promise<BlobInfo> {
    return this.assets.uploadBlob(ctx, spaceId, bytes, opts);
  }
  downloadBlob(
    ctx: ActorCtx,
    spaceId: string,
    hash: string,
    name?: string,
  ): Promise<{ blob: BlobInfo; disposition: string; url?: string; bytes?: Uint8Array }> {
    return this.assets.downloadBlob(ctx, spaceId, hash, name);
  }
  proposeChange(ctx: ActorCtx, spaceId: string, input: ProposeChange): Promise<ProposeChangeResult> {
    return this.assets.proposeChange(ctx, spaceId, input);
  }
  assetHistory(
    ctx: ActorCtx,
    spaceId: string,
    opts: { assetId?: string; beforeOffset?: number; limit?: number },
  ): Promise<ChangeSet[]> {
    return this.assets.assetHistory(ctx, spaceId, opts);
  }
  diff(ctx: ActorCtx, spaceId: string, assetId: string, from: number, to: number): Promise<string> {
    return this.assets.diff(ctx, spaceId, assetId, from, to);
  }

  // --- the feed (core/feed.ts) -----------------------------------------------------
  listTopics(ctx: ActorCtx, spaceId: string, includeArchived = false): Promise<TopicListing[]> {
    return this.feed.listTopics(ctx, spaceId, includeArchived);
  }
  listStream(
    ctx: ActorCtx,
    spaceId: string,
    opts?: PageOpts,
  ): Promise<{ messages: Message[]; topics: Topic[]; hasMore: boolean; hasMoreAfter: boolean; readOffset: number }> {
    return this.feed.listStream(ctx, spaceId, opts);
  }
  listThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    opts?: PageOpts,
  ): Promise<{
    root: Message;
    topic: Topic | null;
    messages: Message[];
    hasMore: boolean;
    hasMoreAfter: boolean;
    readOffset: number | null;
    following: boolean;
  }> {
    return this.feed.listThread(ctx, spaceId, rootMessageId, opts);
  }
  getMessage(ctx: ActorCtx, spaceId: string, messageId: string): Promise<Message> {
    return this.feed.getMessage(ctx, spaceId, messageId);
  }
  postMessage(ctx: ActorCtx, spaceId: string, input: NewMessage): Promise<{ message: Message }> {
    return this.feed.postMessage(ctx, spaceId, input);
  }
  createTopic(
    ctx: ActorCtx,
    spaceId: string,
    input: CreateTopicInput,
  ): Promise<{ topic: Topic; rootMessage: Message }> {
    return this.feed.createTopic(ctx, spaceId, input);
  }
  migrateMentions(opts: { force?: boolean } = {}): Promise<{ messages: number; titles: number; restamped: number }> {
    return this.feed.migrateMentions(opts);
  }
  deleteMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: DeleteMessageInput,
  ): Promise<Message> {
    return this.feed.deleteMessage(ctx, spaceId, messageId, input);
  }
  editMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: EditMessageInput,
  ): Promise<Message> {
    return this.feed.editMessage(ctx, spaceId, messageId, input);
  }
  reactToMessage(ctx: ActorCtx, spaceId: string, messageId: string, input: ReactInput): Promise<Message> {
    return this.feed.reactToMessage(ctx, spaceId, messageId, input);
  }
  votePoll(ctx: ActorCtx, spaceId: string, messageId: string, input: VotePollInput): Promise<Message> {
    return this.feed.votePoll(ctx, spaceId, messageId, input);
  }
  endPoll(ctx: ActorCtx, spaceId: string, messageId: string, input: EndPollInput): Promise<Message> {
    return this.feed.endPoll(ctx, spaceId, messageId, input);
  }
  manageTopic(ctx: ActorCtx, spaceId: string, topicId: string, action: ManageTopicAction): Promise<Topic> {
    return this.feed.manageTopic(ctx, spaceId, topicId, action);
  }
  search(
    ctx: ActorCtx,
    spaceId: string,
    rawQuery: string,
    opts?: { kinds?: SearchKind[]; limit?: number },
  ): Promise<SearchResults> {
    return this.feed.search(ctx, spaceId, rawQuery, opts);
  }

  // --- read state & activity (core/read-state.ts) ----------------------------------
  markRead(ctx: ActorCtx, spaceId: string, input: MarkReadInput): Promise<{ readOffset: number }> {
    return this.readState.markRead(ctx, spaceId, input);
  }
  followThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    following: boolean,
  ): Promise<{ following: boolean; readOffset: number }> {
    return this.readState.followThread(ctx, spaceId, rootMessageId, following);
  }
  activity(
    ctx: ActorCtx,
    q: { kinds?: ActivityKind[]; spaceId?: string; unread?: boolean; cursor?: string; limit?: number },
  ): Promise<ActivityPage> {
    return this.readState.activity(ctx, q);
  }
  markActivitySeen(ctx: ActorCtx, at: string): Promise<{ seenAt: string }> {
    return this.readState.markActivitySeen(ctx, at);
  }
  readAll(ctx: ActorCtx, input: { spaceId?: string }): Promise<{ spaces: Array<{ spaceId: string; readOffset: number }>; threads: number; seenAt: string }> {
    return this.readState.readAll(ctx, input);
  }
  unread(ctx: ActorCtx): Promise<UnreadSnapshot> {
    return this.readState.unread(ctx);
  }
}
