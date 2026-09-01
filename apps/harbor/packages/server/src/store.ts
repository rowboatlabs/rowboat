import type {
  Attribution,
  BlobInfo,
  ChangeSet,
  Member,
  Membership,
  Message,
  Space,
  SpaceEvent,
  Topic,
} from '@rowboat/spaces-protocol';

// Data-access boundary. The stub implements it in memory (memory-store.ts); the
// real Harbor's Postgres driver replaces that one file. The service core owns
// all orchestration and never reaches around this interface.
//
// Atomicity contract: every read-decide-write sequence runs inside
// withSpaceLock(spaceId). In memory that is a per-space async mutex; in
// Postgres it becomes a transaction with the space row locked.

/**
 * An asset as stored — the inode model (migration 007): `id` is the storage
 * identity (version rows and change-sets key on it, forever), `path` is the
 * product identity and a mutable property, unique among the living. Nothing
 * relocates on move/delete/restore; only these fields change.
 */
export interface AssetRecord {
  id: string;
  path: string;
  version: number;
  updatedAt: string;
  state: 'live' | 'deleted';
  /** Present when the head version is binary. */
  blob?: BlobInfo;
}

/** One version's stored data: exactly one side is populated (spec §6: one namespace, one log). */
export interface AssetVersionData {
  content: string | null;
  blob: BlobInfo | null;
}

/**
 * The space-level read gate for uploaded bytes (the analogue of Buzz's
 * per-community sidecar): bytes dedup per org in the BlobStore underneath,
 * but a blob is referencable and servable only in spaces it was uploaded to.
 */
export interface StoredSpaceBlob {
  spaceId: string;
  hash: string;
  size: number;
  mime: string;
  /** Pixel dimensions for sniffed images (BlobInfo doc) — display hint, may be absent. */
  width?: number;
  height?: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface StoredInvite {
  token: string;
  spaceId: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
  revoked: boolean;
}

/** A durable, offsetted fact as stored — exactly what WS replay sends. */
export interface StoredEvent {
  offset: number;
  at: string;
  event: SpaceEvent;
}

/**
 * A reaction as stored: keyed (spaceId, messageId, emoji, by.memberId) — one
 * per member+emoji, Slack semantics.
 */
export interface StoredReaction {
  spaceId: string;
  messageId: string;
  emoji: string;
  by: Attribution;
  at: string;
}

export interface Store {
  // members (org-level)
  getMember(id: string): Promise<Member | undefined>;
  putMember(member: Member): Promise<void>;

  // identity mapping — (issuer, subject) → member (spec §4: the token proves
  // WHO; this table says which member that is). Written only by the invite
  // ceremony (and seeding); the oidc auth driver reads, never creates.
  getMemberByIdentity(iss: string, sub: string): Promise<Member | undefined>;
  putIdentity(iss: string, sub: string, memberId: string): Promise<void>;

  // spaces
  putSpace(space: Space): Promise<void>;
  getSpace(id: string): Promise<Space | undefined>;
  listSpacesFor(memberId: string): Promise<Space[]>;

  // membership
  getMembership(spaceId: string, memberId: string): Promise<Membership | undefined>;
  listMemberships(spaceId: string): Promise<Membership[]>;
  putMembership(membership: Membership): Promise<void>;
  deleteMembership(spaceId: string, memberId: string): Promise<void>;

  // assets — id-keyed (inode model); every version's data is kept; version 0
  // reads as { content: '', blob: null }
  listAssets(spaceId: string, includeDeleted: boolean): Promise<AssetRecord[]>;
  getLiveAssetByPath(spaceId: string, path: string): Promise<AssetRecord | undefined>;
  /** Most recently deleted asset whose path is `path` (the trash entry restore targets). */
  getLatestDeletedByPath(spaceId: string, path: string): Promise<AssetRecord | undefined>;
  getAssetById(spaceId: string, assetId: string): Promise<AssetRecord | undefined>;
  /** Insert the assets row (its first version arrives via putAssetVersion). */
  createAsset(spaceId: string, record: AssetRecord): Promise<void>;
  getAssetVersion(spaceId: string, assetId: string, version: number): Promise<AssetVersionData | undefined>;
  /** Writes the version row and bumps the head (version, updatedAt, head blob). */
  putAssetVersion(spaceId: string, assetId: string, version: number, data: AssetVersionData, updatedAt: string): Promise<void>;
  setAssetPath(spaceId: string, assetId: string, path: string, updatedAt: string): Promise<void>;
  setAssetState(spaceId: string, assetId: string, state: 'live' | 'deleted', updatedAt: string): Promise<void>;

  // redirects — old paths forwarding to their asset (hot only while the asset is live)
  putRedirect(spaceId: string, path: string, assetId: string, movedAt: string): Promise<void>;
  getRedirect(spaceId: string, path: string): Promise<string | undefined>;
  deleteRedirect(spaceId: string, path: string): Promise<void>;

  // uploaded blobs (space-scoped registry; bytes live in the BlobStore)
  /** First write wins — re-uploading the same bytes never changes the recorded mime/uploader. */
  putSpaceBlob(blob: StoredSpaceBlob): Promise<void>;
  getSpaceBlob(spaceId: string, hash: string): Promise<StoredSpaceBlob | undefined>;

  // change log (append-only). assetId is the internal lineage key — never on
  // the wire; it makes per-file history a filter instead of a chain walk.
  appendChangeSet(changeSet: ChangeSet, assetId: string): Promise<void>;
  getChangeSet(spaceId: string, id: string): Promise<ChangeSet | undefined>;
  /** Newest first. `assetId` filters to one file's lineage; `beforeOffset` pages backwards. */
  listChangeSets(
    spaceId: string,
    opts: { assetId?: string; beforeOffset?: number; limit: number },
  ): Promise<ChangeSet[]>;

  // topics & messages — the annotation model (migration 011): messages form
  // one stream per space with a write-once threadRoot pointer; a topic is one
  // row pointing at a root, holding title + archived, and never any messages.
  getTopic(spaceId: string, topicId: string): Promise<Topic | undefined>;
  /** The topic annotating this thread, if one exists (rootMessageId is unique). */
  getTopicByRoot(spaceId: string, rootMessageId: string): Promise<Topic | undefined>;
  /** Insert or update (retitle / archive flips) — the row is the whole object. */
  putTopic(topic: Topic): Promise<void>;
  /** "Convert back to thread": the row goes, the messages never knew it existed. */
  deleteTopic(spaceId: string, topicId: string): Promise<void>;
  listTopics(spaceId: string, includeArchived: boolean): Promise<Topic[]>;
  getMessage(spaceId: string, messageId: string): Promise<Message | undefined>;
  /**
   * The stream: ROOT messages only (threadRoot null), oldest first. With
   * opts: the NEWEST `limit` roots whose offset is below `beforeOffset`
   * (when given) — still returned oldest first.
   */
  listStream(spaceId: string, opts?: { beforeOffset?: number; limit?: number }): Promise<Message[]>;
  /** One flat thread's replies (threadRoot = rootMessageId), same window semantics as listStream. */
  listThread(spaceId: string, rootMessageId: string, opts?: { beforeOffset?: number; limit?: number }): Promise<Message[]>;
  listMessagesBySpace(spaceId: string): Promise<Message[]>;
  appendMessage(message: Message): Promise<void>;
  /**
   * Recompute a root's reply denorm (replyCount = live replies, lastReplyAt =
   * newest reply) from the truth. Called inside the space lock whenever a
   * reply is appended or tombstoned — recompute beats deltas because deletes
   * and replays can't drift it.
   */
  refreshReplyStats(spaceId: string, rootMessageId: string): Promise<void>;
  /**
   * Tombstone: blanks the row's body and sets deletedAt — and redacts the
   * stored `message` event the same way. That event rewrite is the one
   * mutation the log allows: a deleted body must be unrecoverable, replay
   * included. The message_deleted event itself is appended by the service.
   */
  markMessageDeleted(spaceId: string, messageId: string, deletedAt: string): Promise<void>;
  markMessageEdited(spaceId: string, messageId: string, body: string, editedAt: string): Promise<void>;

  // reactions — per-(member, emoji) toggles on messages
  getReaction(spaceId: string, messageId: string, emoji: string, memberId: string): Promise<StoredReaction | undefined>;
  putReaction(reaction: StoredReaction): Promise<void>;
  deleteReaction(spaceId: string, messageId: string, emoji: string, memberId: string): Promise<void>;
  /** Oldest first (fold order). */
  listReactionsByMessage(spaceId: string, messageId: string): Promise<StoredReaction[]>;
  /** All reactions on the given messages (one page's fold), oldest first. */
  listReactionsForMessages(spaceId: string, messageIds: string[]): Promise<StoredReaction[]>;

  // invites
  putInvite(invite: StoredInvite): Promise<void>;
  getInvite(token: string): Promise<StoredInvite | undefined>;

  // event log (one durable sequence per space, offsets start at 1)
  head(spaceId: string): Promise<number>;
  /** `offset` must be head+1 — the caller allocates inside the space lock. */
  appendEvent(spaceId: string, stored: StoredEvent): Promise<void>;
  listEventsAfter(spaceId: string, afterOffset: number): Promise<StoredEvent[]>;

  // atomicity
  withSpaceLock<T>(spaceId: string, fn: () => Promise<T>): Promise<T>;
}
