import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  BlobInfo,
  ChangeSet,
  Member,
  Membership,
  Message,
  Space,
  Topic,
} from '@rowboat/spaces-protocol';
import { migrate } from './migrations.js';
import type { SqlDb, SqlExecutor } from './sql.js';
import type { AssetRecord, AssetVersionData, Store, StoredEvent, StoredInvite, StoredReaction, StoredSpaceBlob } from './store.js';

// The real Harbor's storage: mergeable text lives inline in Postgres (≤1MB,
// riding the log rows); binary versions carry {hash, size, mime} pointing into
// the content-addressed BlobStore (spec §6). Current state, history, feed, and
// the event stream are projections of the append-only log.
//
// Atomicity: withSpaceLock = one transaction holding a per-space advisory
// lock; every store call inside the callback runs on that transaction via
// AsyncLocalStorage. Timestamps stay ISO-8601 text end to end — what the
// contract carries is exactly what's stored. "offset" is reserved in SQL, so
// columns are stream_offset.
//
// Schema lives in migrations.ts (versioned, append-only); init() applies it.

interface MemberRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: Member['role'];
}

function rowToMember(r: MemberRow): Member {
  return {
    id: r.id,
    displayName: r.display_name,
    ...(r.avatar_url !== null ? { avatarUrl: r.avatar_url } : {}),
    role: r.role,
  };
}

interface ChangeSetRow {
  id: string;
  space_id: string;
  asset_path: string;
  base_version: number;
  result_version: number;
  attribution: ChangeSet['attribution'];
  reason: string | null;
  topic_id: string | null;
  blob: BlobInfo | null;
  op: ChangeSet['op'] | null;
  moved_from: string | null;
  committed_at: string;
  stream_offset: number;
}

function rowToChangeSet(r: ChangeSetRow): ChangeSet {
  return {
    id: r.id,
    spaceId: r.space_id,
    assetPath: r.asset_path,
    baseVersion: r.base_version,
    resultVersion: r.result_version,
    attribution: r.attribution,
    ...(r.reason !== null ? { reason: r.reason } : {}),
    ...(r.topic_id !== null ? { topicId: r.topic_id } : {}),
    ...(r.blob !== null && r.blob !== undefined ? { blob: r.blob } : {}),
    ...(r.op !== null && r.op !== undefined ? { op: r.op } : {}),
    ...(r.moved_from !== null && r.moved_from !== undefined ? { movedFrom: r.moved_from } : {}),
    committedAt: r.committed_at,
    offset: r.stream_offset,
  };
}

interface TopicRow {
  id: string;
  space_id: string;
  title: string;
  kind: Topic['kind'];
  created_by: Topic['createdBy'];
  created_at: string;
  archived: boolean;
  anchor_change_set_id: string | null;
  anchor_message_id: string | null;
  last_activity_at: string;
  message_count: number;
}

function rowToTopic(r: TopicRow): Topic {
  return {
    id: r.id,
    spaceId: r.space_id,
    title: r.title,
    kind: r.kind,
    createdBy: r.created_by,
    createdAt: r.created_at,
    archived: r.archived,
    ...(r.anchor_change_set_id !== null ? { anchorChangeSetId: r.anchor_change_set_id } : {}),
    ...(r.anchor_message_id !== null ? { anchorMessageId: r.anchor_message_id } : {}),
    lastActivityAt: r.last_activity_at,
    messageCount: r.message_count,
  };
}

interface MessageRow {
  id: string;
  space_id: string;
  topic_id: string;
  author: Message['author'];
  body: string;
  posted_at: string;
  stream_offset: number;
}

function rowToMessage(r: MessageRow): Message {
  return {
    id: r.id,
    spaceId: r.space_id,
    topicId: r.topic_id,
    author: r.author,
    body: r.body,
    postedAt: r.posted_at,
    offset: r.stream_offset,
    // Live reaction state is folded in by the service on reads; rows carry none.
    reactions: [],
  };
}

interface ReactionRow {
  space_id: string;
  message_id: string;
  emoji: string;
  attribution: StoredReaction['by'];
  at: string;
}

function rowToReaction(r: ReactionRow): StoredReaction {
  return {
    spaceId: r.space_id,
    messageId: r.message_id,
    emoji: r.emoji,
    by: r.attribution,
    at: r.at,
  };
}

interface AssetRow {
  id: string;
  path: string;
  version: number;
  updated_at: string;
  state: AssetRecord['state'];
  blob: BlobInfo | null;
}

/** The implicit org of every pre-multi-org deployment (migration 003 default). */
export const DEFAULT_ORG_ID = 'org-default';

export class PgStore implements Store {
  private readonly als = new AsyncLocalStorage<SqlExecutor>();

  /**
   * One instance per org over a shared SqlDb: the Store interface stays the
   * per-org view HarborService has always seen; org scoping lives in the
   * queries here. Space-scoped tables key off globally-unique ULIDs and are
   * deliberately unscoped.
   */
  constructor(
    private readonly db: SqlDb,
    private readonly orgId: string = DEFAULT_ORG_ID,
  ) {}

  async init(): Promise<void> {
    await migrate(this.db);
  }

  /** The active executor: the lock's transaction inside withSpaceLock, the pool outside. */
  private get sql(): SqlExecutor {
    return this.als.getStore() ?? this.db;
  }

  async withSpaceLock<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.db.withTransaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [spaceId]);
      return this.als.run(tx, fn);
    });
  }

  // --- members ---------------------------------------------------------------

  async getMember(id: string): Promise<Member | undefined> {
    const rows = await this.sql.query<MemberRow>(
      'select id, display_name, avatar_url, role from members where org_id = $1 and id = $2',
      [this.orgId, id],
    );
    return rows[0] ? rowToMember(rows[0]) : undefined;
  }

  async putMember(member: Member): Promise<void> {
    await this.sql.query(
      `insert into members (org_id, id, display_name, avatar_url, role) values ($1, $2, $3, $4, $5)
       on conflict (org_id, id) do update set display_name = excluded.display_name, avatar_url = excluded.avatar_url, role = excluded.role`,
      [this.orgId, member.id, member.displayName, member.avatarUrl ?? null, member.role],
    );
  }

  async getMemberByIdentity(iss: string, sub: string): Promise<Member | undefined> {
    const rows = await this.sql.query<MemberRow>(
      `select m.id, m.display_name, m.avatar_url, m.role from member_identities mi
       join members m on m.org_id = mi.org_id and m.id = mi.member_id
       where mi.org_id = $1 and mi.iss = $2 and mi.sub = $3`,
      [this.orgId, iss, sub],
    );
    return rows[0] ? rowToMember(rows[0]) : undefined;
  }

  async putIdentity(iss: string, sub: string, memberId: string): Promise<void> {
    await this.sql.query(
      `insert into member_identities (org_id, iss, sub, member_id) values ($1, $2, $3, $4)
       on conflict (org_id, iss, sub) do update set member_id = excluded.member_id`,
      [this.orgId, iss, sub, memberId],
    );
  }

  // --- spaces ----------------------------------------------------------------

  async putSpace(space: Space): Promise<void> {
    await this.sql.query(
      `insert into spaces (org_id, id, name, created_at) values ($1, $2, $3, $4)
       on conflict (id) do update set name = excluded.name`,
      [this.orgId, space.id, space.name, space.createdAt],
    );
  }

  async getSpace(id: string): Promise<Space | undefined> {
    // Org-scoped on purpose: this is what makes a foreign org's space ids
    // (and invite tokens, which resolve through here) not_found.
    const rows = await this.sql.query<{ id: string; name: string; created_at: string }>(
      'select id, name, created_at from spaces where org_id = $1 and id = $2',
      [this.orgId, id],
    );
    const r = rows[0];
    return r ? { id: r.id, name: r.name, createdAt: r.created_at } : undefined;
  }

  async listSpacesFor(memberId: string): Promise<Space[]> {
    const rows = await this.sql.query<{ id: string; name: string; created_at: string }>(
      `select s.id, s.name, s.created_at from spaces s
       join memberships m on m.space_id = s.id
       where s.org_id = $1 and m.member_id = $2 order by s.created_at, s.id`,
      [this.orgId, memberId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  // --- memberships -----------------------------------------------------------

  async getMembership(spaceId: string, memberId: string): Promise<Membership | undefined> {
    const rows = await this.sql.query<{ space_id: string; member_id: string; joined_at: string }>(
      'select space_id, member_id, joined_at from memberships where space_id = $1 and member_id = $2',
      [spaceId, memberId],
    );
    const r = rows[0];
    return r ? { spaceId: r.space_id, memberId: r.member_id, joinedAt: r.joined_at } : undefined;
  }

  async listMemberships(spaceId: string): Promise<Membership[]> {
    const rows = await this.sql.query<{ space_id: string; member_id: string; joined_at: string }>(
      'select space_id, member_id, joined_at from memberships where space_id = $1 order by joined_at, member_id',
      [spaceId],
    );
    return rows.map((r) => ({ spaceId: r.space_id, memberId: r.member_id, joinedAt: r.joined_at }));
  }

  async putMembership(membership: Membership): Promise<void> {
    await this.sql.query(
      `insert into memberships (space_id, member_id, joined_at) values ($1, $2, $3)
       on conflict (space_id, member_id) do nothing`,
      [membership.spaceId, membership.memberId, membership.joinedAt],
    );
  }

  async deleteMembership(spaceId: string, memberId: string): Promise<void> {
    await this.sql.query('delete from memberships where space_id = $1 and member_id = $2', [spaceId, memberId]);
  }

  // --- assets ----------------------------------------------------------------

  private assetRow(r: AssetRow): AssetRecord {
    return {
      id: r.id,
      path: r.path,
      version: r.version,
      updatedAt: r.updated_at,
      state: r.state,
      ...(r.blob !== null && r.blob !== undefined ? { blob: r.blob } : {}),
    };
  }

  private readonly assetSelect = `select a.id, a.path, a.version, a.updated_at, a.state, v.blob from assets a
       join asset_versions v on v.space_id = a.space_id and v.asset_id = a.id and v.version = a.version`;

  async listAssets(spaceId: string, includeDeleted: boolean): Promise<AssetRecord[]> {
    // Head blob metadata rides on the head version's row (one fetch, spec §6).
    const rows = await this.sql.query<AssetRow>(
      `${this.assetSelect} where a.space_id = $1 ${includeDeleted ? '' : "and a.state = 'live'"} order by a.path`,
      [spaceId],
    );
    return rows.map((r) => this.assetRow(r));
  }

  async getLiveAssetByPath(spaceId: string, path: string): Promise<AssetRecord | undefined> {
    const rows = await this.sql.query<AssetRow>(
      `${this.assetSelect} where a.space_id = $1 and a.path = $2 and a.state = 'live'`,
      [spaceId, path],
    );
    return rows[0] ? this.assetRow(rows[0]) : undefined;
  }

  async getLatestDeletedByPath(spaceId: string, path: string): Promise<AssetRecord | undefined> {
    const rows = await this.sql.query<AssetRow>(
      `${this.assetSelect} where a.space_id = $1 and a.path = $2 and a.state = 'deleted'
       order by a.updated_at desc limit 1`,
      [spaceId, path],
    );
    return rows[0] ? this.assetRow(rows[0]) : undefined;
  }

  async getAssetById(spaceId: string, assetId: string): Promise<AssetRecord | undefined> {
    const rows = await this.sql.query<AssetRow>(
      `${this.assetSelect} where a.space_id = $1 and a.id = $2`,
      [spaceId, assetId],
    );
    return rows[0] ? this.assetRow(rows[0]) : undefined;
  }

  async createAsset(spaceId: string, record: AssetRecord): Promise<void> {
    await this.sql.query(
      'insert into assets (space_id, id, path, version, updated_at, state) values ($1, $2, $3, $4, $5, $6)',
      [spaceId, record.id, record.path, record.version, record.updatedAt, record.state],
    );
  }

  async getAssetVersion(spaceId: string, assetId: string, version: number): Promise<AssetVersionData | undefined> {
    if (version === 0) return { content: '', blob: null };
    const rows = await this.sql.query<{ content: string | null; blob: BlobInfo | null }>(
      'select content, blob from asset_versions where space_id = $1 and asset_id = $2 and version = $3',
      [spaceId, assetId, version],
    );
    const r = rows[0];
    return r ? { content: r.content, blob: r.blob ?? null } : undefined;
  }

  async putAssetVersion(spaceId: string, assetId: string, version: number, data: AssetVersionData, updatedAt: string): Promise<void> {
    await this.sql.query(
      'update assets set version = $3, updated_at = $4 where space_id = $1 and id = $2',
      [spaceId, assetId, version, updatedAt],
    );
    await this.sql.query(
      'insert into asset_versions (space_id, asset_id, version, content, blob) values ($1, $2, $3, $4, $5::jsonb)',
      [spaceId, assetId, version, data.content, data.blob ? JSON.stringify(data.blob) : null],
    );
  }

  async setAssetPath(spaceId: string, assetId: string, path: string, updatedAt: string): Promise<void> {
    await this.sql.query('update assets set path = $3, updated_at = $4 where space_id = $1 and id = $2', [
      spaceId,
      assetId,
      path,
      updatedAt,
    ]);
  }

  async setAssetState(spaceId: string, assetId: string, state: 'live' | 'deleted', updatedAt: string): Promise<void> {
    await this.sql.query('update assets set state = $3, updated_at = $4 where space_id = $1 and id = $2', [
      spaceId,
      assetId,
      state,
      updatedAt,
    ]);
  }

  // --- redirects -------------------------------------------------------------

  async putRedirect(spaceId: string, path: string, assetId: string, movedAt: string): Promise<void> {
    await this.sql.query(
      `insert into asset_redirects (space_id, path, asset_id, moved_at) values ($1, $2, $3, $4)
       on conflict (space_id, path) do update set asset_id = excluded.asset_id, moved_at = excluded.moved_at`,
      [spaceId, path, assetId, movedAt],
    );
  }

  async getRedirect(spaceId: string, path: string): Promise<string | undefined> {
    const rows = await this.sql.query<{ asset_id: string }>(
      'select asset_id from asset_redirects where space_id = $1 and path = $2',
      [spaceId, path],
    );
    return rows[0]?.asset_id;
  }

  async deleteRedirect(spaceId: string, path: string): Promise<void> {
    await this.sql.query('delete from asset_redirects where space_id = $1 and path = $2', [spaceId, path]);
  }

  // --- uploaded blobs --------------------------------------------------------

  async putSpaceBlob(blob: StoredSpaceBlob): Promise<void> {
    // do nothing on conflict: first write wins (mime/uploader stay stable).
    await this.sql.query(
      `insert into space_blobs (space_id, hash, size, mime, uploaded_by, uploaded_at)
       values ($1, $2, $3, $4, $5, $6) on conflict (space_id, hash) do nothing`,
      [blob.spaceId, blob.hash, blob.size, blob.mime, blob.uploadedBy, blob.uploadedAt],
    );
  }

  async getSpaceBlob(spaceId: string, hash: string): Promise<StoredSpaceBlob | undefined> {
    const rows = await this.sql.query<{
      space_id: string;
      hash: string;
      size: number | string;
      mime: string;
      uploaded_by: string;
      uploaded_at: string;
    }>('select * from space_blobs where space_id = $1 and hash = $2', [spaceId, hash]);
    const r = rows[0];
    if (!r) return undefined;
    return {
      spaceId: r.space_id,
      hash: r.hash,
      // bigint arrives as string under node-postgres, number under PGlite.
      size: Number(r.size),
      mime: r.mime,
      uploadedBy: r.uploaded_by,
      uploadedAt: r.uploaded_at,
    };
  }

  // --- change log ------------------------------------------------------------

  async appendChangeSet(changeSet: ChangeSet, assetId: string): Promise<void> {
    await this.sql.query(
      `insert into change_sets (id, space_id, asset_id, asset_path, base_version, result_version, attribution, reason, topic_id, blob, op, moved_from, committed_at, stream_offset)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11, $12, $13, $14)`,
      [
        changeSet.id,
        changeSet.spaceId,
        assetId,
        changeSet.assetPath,
        changeSet.baseVersion,
        changeSet.resultVersion,
        JSON.stringify(changeSet.attribution),
        changeSet.reason ?? null,
        changeSet.topicId ?? null,
        changeSet.blob ? JSON.stringify(changeSet.blob) : null,
        changeSet.op ?? null,
        changeSet.movedFrom ?? null,
        changeSet.committedAt,
        changeSet.offset,
      ],
    );
  }

  async getChangeSet(spaceId: string, id: string): Promise<ChangeSet | undefined> {
    const rows = await this.sql.query<ChangeSetRow>(
      'select * from change_sets where space_id = $1 and id = $2',
      [spaceId, id],
    );
    return rows[0] ? rowToChangeSet(rows[0]) : undefined;
  }

  async listChangeSets(
    spaceId: string,
    opts: { assetId?: string; beforeOffset?: number; limit: number },
  ): Promise<ChangeSet[]> {
    const conditions = ['space_id = $1'];
    const params: unknown[] = [spaceId];
    if (opts.assetId !== undefined) {
      params.push(opts.assetId);
      conditions.push(`asset_id = $${params.length}`);
    }
    if (opts.beforeOffset !== undefined) {
      params.push(opts.beforeOffset);
      conditions.push(`stream_offset < $${params.length}`);
    }
    params.push(opts.limit);
    const rows = await this.sql.query<ChangeSetRow>(
      `select * from change_sets where ${conditions.join(' and ')} order by stream_offset desc limit $${params.length}`,
      params,
    );
    return rows.map(rowToChangeSet);
  }

  // --- topics & messages -----------------------------------------------------

  async getTopic(spaceId: string, topicId: string): Promise<Topic | undefined> {
    const rows = await this.sql.query<TopicRow>('select * from topics where space_id = $1 and id = $2', [spaceId, topicId]);
    return rows[0] ? rowToTopic(rows[0]) : undefined;
  }

  async putTopic(topic: Topic): Promise<void> {
    await this.sql.query(
      `insert into topics (id, space_id, title, kind, created_by, created_at, archived, anchor_change_set_id, anchor_message_id, last_activity_at, message_count)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set
         title = excluded.title, archived = excluded.archived,
         anchor_change_set_id = excluded.anchor_change_set_id,
         anchor_message_id = excluded.anchor_message_id,
         last_activity_at = excluded.last_activity_at, message_count = excluded.message_count`,
      [
        topic.id,
        topic.spaceId,
        topic.title,
        topic.kind,
        JSON.stringify(topic.createdBy),
        topic.createdAt,
        topic.archived,
        topic.anchorChangeSetId ?? null,
        topic.anchorMessageId ?? null,
        topic.lastActivityAt,
        topic.messageCount,
      ],
    );
  }

  async getTopicByAnchor(spaceId: string, anchorMessageId: string): Promise<Topic | undefined> {
    const rows = await this.sql.query<TopicRow>(
      'select * from topics where space_id = $1 and anchor_message_id = $2',
      [spaceId, anchorMessageId],
    );
    return rows[0] ? rowToTopic(rows[0]) : undefined;
  }

  async listTopics(spaceId: string, includeArchived: boolean): Promise<Topic[]> {
    const rows = await this.sql.query<TopicRow>(
      `select * from topics where space_id = $1 ${includeArchived ? '' : 'and archived = false'}
       order by last_activity_at desc, id desc`,
      [spaceId],
    );
    return rows.map(rowToTopic);
  }

  async getMessage(spaceId: string, messageId: string): Promise<Message | undefined> {
    const rows = await this.sql.query<MessageRow>(
      'select * from messages where space_id = $1 and id = $2',
      [spaceId, messageId],
    );
    return rows[0] ? rowToMessage(rows[0]) : undefined;
  }

  async listMessages(spaceId: string, topicId: string): Promise<Message[]> {
    const rows = await this.sql.query<MessageRow>(
      'select * from messages where space_id = $1 and topic_id = $2 order by stream_offset',
      [spaceId, topicId],
    );
    return rows.map(rowToMessage);
  }

  async listMessagesBySpace(spaceId: string): Promise<Message[]> {
    const rows = await this.sql.query<MessageRow>(
      'select * from messages where space_id = $1 order by stream_offset',
      [spaceId],
    );
    return rows.map(rowToMessage);
  }

  async appendMessage(message: Message): Promise<void> {
    await this.sql.query(
      `insert into messages (id, space_id, topic_id, author, body, posted_at, stream_offset)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [message.id, message.spaceId, message.topicId, JSON.stringify(message.author), message.body, message.postedAt, message.offset],
    );
  }

  async reassignMessages(spaceId: string, fromTopicId: string, toTopicId: string): Promise<number> {
    const rows = await this.sql.query<{ id: string }>(
      'update messages set topic_id = $3 where space_id = $1 and topic_id = $2 returning id',
      [spaceId, fromTopicId, toTopicId],
    );
    return rows.length;
  }

  // --- reactions -------------------------------------------------------------

  async getReaction(
    spaceId: string,
    messageId: string,
    emoji: string,
    memberId: string,
  ): Promise<StoredReaction | undefined> {
    const rows = await this.sql.query<ReactionRow>(
      'select * from reactions where space_id = $1 and message_id = $2 and emoji = $3 and member_id = $4',
      [spaceId, messageId, emoji, memberId],
    );
    return rows[0] ? rowToReaction(rows[0]) : undefined;
  }

  async putReaction(reaction: StoredReaction): Promise<void> {
    await this.sql.query(
      `insert into reactions (space_id, message_id, emoji, member_id, attribution, at)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (space_id, message_id, emoji, member_id) do update set attribution = excluded.attribution, at = excluded.at`,
      [reaction.spaceId, reaction.messageId, reaction.emoji, reaction.by.memberId, JSON.stringify(reaction.by), reaction.at],
    );
  }

  async deleteReaction(spaceId: string, messageId: string, emoji: string, memberId: string): Promise<void> {
    await this.sql.query(
      'delete from reactions where space_id = $1 and message_id = $2 and emoji = $3 and member_id = $4',
      [spaceId, messageId, emoji, memberId],
    );
  }

  async listReactionsByMessage(spaceId: string, messageId: string): Promise<StoredReaction[]> {
    const rows = await this.sql.query<ReactionRow>(
      'select * from reactions where space_id = $1 and message_id = $2 order by at, member_id',
      [spaceId, messageId],
    );
    return rows.map(rowToReaction);
  }

  async listReactionsByTopic(spaceId: string, topicId: string): Promise<StoredReaction[]> {
    const rows = await this.sql.query<ReactionRow>(
      `select r.* from reactions r
       join messages m on m.space_id = r.space_id and m.id = r.message_id
       where r.space_id = $1 and m.topic_id = $2 order by r.at, r.member_id`,
      [spaceId, topicId],
    );
    return rows.map(rowToReaction);
  }

  // --- invites ---------------------------------------------------------------

  async putInvite(invite: StoredInvite): Promise<void> {
    await this.sql.query(
      `insert into invites (token, space_id, created_by, created_at, expires_at, revoked)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (token) do update set expires_at = excluded.expires_at, revoked = excluded.revoked`,
      [invite.token, invite.spaceId, invite.createdBy, invite.createdAt, invite.expiresAt ?? null, invite.revoked],
    );
  }

  async getInvite(token: string): Promise<StoredInvite | undefined> {
    const rows = await this.sql.query<{
      token: string;
      space_id: string;
      created_by: string;
      created_at: string;
      expires_at: string | null;
      revoked: boolean;
    }>('select * from invites where token = $1', [token]);
    const r = rows[0];
    if (!r) return undefined;
    return {
      token: r.token,
      spaceId: r.space_id,
      createdBy: r.created_by,
      createdAt: r.created_at,
      ...(r.expires_at !== null ? { expiresAt: r.expires_at } : {}),
      revoked: r.revoked,
    };
  }

  // --- event log -------------------------------------------------------------

  async head(spaceId: string): Promise<number> {
    const rows = await this.sql.query<{ head: number }>(
      'select coalesce(max(stream_offset), 0) as head from events where space_id = $1',
      [spaceId],
    );
    return rows[0]?.head ?? 0;
  }

  async appendEvent(spaceId: string, stored: StoredEvent): Promise<void> {
    // The (space_id, stream_offset) primary key is the gap/duplicate guard —
    // the caller allocates head+1 inside the space lock.
    await this.sql.query(
      'insert into events (space_id, stream_offset, at, event) values ($1, $2, $3, $4::jsonb)',
      [spaceId, stored.offset, stored.at, JSON.stringify(stored.event)],
    );
  }

  async listEventsAfter(spaceId: string, afterOffset: number): Promise<StoredEvent[]> {
    const rows = await this.sql.query<{ stream_offset: number; at: string; event: StoredEvent['event'] }>(
      'select stream_offset, at, event from events where space_id = $1 and stream_offset > $2 order by stream_offset',
      [spaceId, afterOffset],
    );
    return rows.map((r) => ({ offset: r.stream_offset, at: r.at, event: r.event }));
  }
}
