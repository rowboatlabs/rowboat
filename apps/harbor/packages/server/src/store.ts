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

export interface AssetHead {
  path: string;
  version: number;
  updatedAt: string;
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
 * per member+emoji, Slack semantics. Topic membership is derived through the
 * message (merge_into repoints messages; reactions follow by messageId).
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

  // assets — every version's data is kept; version 0 reads as { content: '', blob: null }
  listAssets(spaceId: string): Promise<AssetHead[]>;
  getAssetHead(spaceId: string, path: string): Promise<AssetHead | undefined>;
  getAssetVersion(spaceId: string, path: string, version: number): Promise<AssetVersionData | undefined>;
  putAssetVersion(spaceId: string, path: string, version: number, data: AssetVersionData, updatedAt: string): Promise<void>;

  // uploaded blobs (space-scoped registry; bytes live in the BlobStore)
  /** First write wins — re-uploading the same bytes never changes the recorded mime/uploader. */
  putSpaceBlob(blob: StoredSpaceBlob): Promise<void>;
  getSpaceBlob(spaceId: string, hash: string): Promise<StoredSpaceBlob | undefined>;

  // change log (append-only)
  appendChangeSet(changeSet: ChangeSet): Promise<void>;
  getChangeSet(spaceId: string, id: string): Promise<ChangeSet | undefined>;
  /** Newest first. `path` filters to one asset; `beforeOffset` pages backwards. */
  listChangeSets(
    spaceId: string,
    opts: { path?: string; beforeOffset?: number; limit: number },
  ): Promise<ChangeSet[]>;

  // topics & messages
  getTopic(spaceId: string, topicId: string): Promise<Topic | undefined>;
  /** The topic grown from this message, if one exists (anchorMessageId is unique). */
  getTopicByAnchor(spaceId: string, anchorMessageId: string): Promise<Topic | undefined>;
  putTopic(topic: Topic): Promise<void>;
  listTopics(spaceId: string, includeArchived: boolean): Promise<Topic[]>;
  getMessage(spaceId: string, messageId: string): Promise<Message | undefined>;
  /** Oldest first. */
  listMessages(spaceId: string, topicId: string): Promise<Message[]>;
  listMessagesBySpace(spaceId: string): Promise<Message[]>;
  appendMessage(message: Message): Promise<void>;
  /** merge_into support: repoints messages; returns how many moved. */
  reassignMessages(spaceId: string, fromTopicId: string, toTopicId: string): Promise<number>;

  // reactions — per-(member, emoji) toggles on messages
  getReaction(spaceId: string, messageId: string, emoji: string, memberId: string): Promise<StoredReaction | undefined>;
  putReaction(reaction: StoredReaction): Promise<void>;
  deleteReaction(spaceId: string, messageId: string, emoji: string, memberId: string): Promise<void>;
  /** Oldest first (fold order). */
  listReactionsByMessage(spaceId: string, messageId: string): Promise<StoredReaction[]>;
  /** All reactions on the topic's current messages, oldest first. */
  listReactionsByTopic(spaceId: string, topicId: string): Promise<StoredReaction[]>;

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
