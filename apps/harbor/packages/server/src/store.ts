import type {
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

export interface Store {
  // members (org-level)
  getMember(id: string): Promise<Member | undefined>;
  putMember(member: Member): Promise<void>;

  // spaces
  putSpace(space: Space): Promise<void>;
  getSpace(id: string): Promise<Space | undefined>;
  listSpacesFor(memberId: string): Promise<Space[]>;

  // membership
  getMembership(spaceId: string, memberId: string): Promise<Membership | undefined>;
  listMemberships(spaceId: string): Promise<Membership[]>;
  putMembership(membership: Membership): Promise<void>;
  deleteMembership(spaceId: string, memberId: string): Promise<void>;

  // assets — every version's content is kept; version 0 reads as ''
  listAssets(spaceId: string): Promise<AssetHead[]>;
  getAssetHead(spaceId: string, path: string): Promise<AssetHead | undefined>;
  getAssetContent(spaceId: string, path: string, version: number): Promise<string | undefined>;
  putAssetVersion(spaceId: string, path: string, version: number, content: string, updatedAt: string): Promise<void>;

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
  putTopic(topic: Topic): Promise<void>;
  listTopics(spaceId: string, includeArchived: boolean): Promise<Topic[]>;
  /** Oldest first. */
  listMessages(spaceId: string, topicId: string): Promise<Message[]>;
  listMessagesBySpace(spaceId: string): Promise<Message[]>;
  appendMessage(message: Message): Promise<void>;
  /** merge_into support: repoints messages; returns how many moved. */
  reassignMessages(spaceId: string, fromTopicId: string, toTopicId: string): Promise<number>;

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
