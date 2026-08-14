import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ChangeSet,
  Member,
  Membership,
  Message,
  Space,
  Topic,
} from '@rowboat/spaces-protocol';
import type { SqlDb, SqlExecutor } from './sql.js';
import type { AssetHead, Store, StoredEvent, StoredInvite } from './store.js';

// The real Harbor's storage (spec deployment plan: Postgres only, no S3 in
// v1 — contents are ≤1MB text riding in the log rows; current state, history,
// feed, and the event stream are projections of the append-only log).
//
// Atomicity: withSpaceLock = one transaction holding a per-space advisory
// lock; every store call inside the callback runs on that transaction via
// AsyncLocalStorage. Timestamps stay ISO-8601 text end to end — what the
// contract carries is exactly what's stored. "offset" is reserved in SQL, so
// columns are stream_offset.

const SCHEMA = `
create table if not exists members (
  id text primary key,
  display_name text not null,
  avatar_url text
);
create table if not exists spaces (
  id text primary key,
  name text not null,
  created_at text not null
);
create table if not exists memberships (
  space_id text not null,
  member_id text not null,
  joined_at text not null,
  primary key (space_id, member_id)
);
create table if not exists assets (
  space_id text not null,
  path text not null,
  version int not null,
  updated_at text not null,
  primary key (space_id, path)
);
create table if not exists asset_versions (
  space_id text not null,
  path text not null,
  version int not null,
  content text not null,
  primary key (space_id, path, version)
);
create table if not exists change_sets (
  id text primary key,
  space_id text not null,
  asset_path text not null,
  base_version int not null,
  result_version int not null,
  attribution jsonb not null,
  reason text,
  committed_at text not null,
  stream_offset int not null
);
create index if not exists change_sets_space_offset on change_sets (space_id, stream_offset desc);
create table if not exists topics (
  id text primary key,
  space_id text not null,
  title text not null,
  created_by jsonb not null,
  created_at text not null,
  archived boolean not null,
  anchor_change_set_id text,
  last_activity_at text not null,
  message_count int not null
);
create index if not exists topics_space on topics (space_id, last_activity_at desc);
create table if not exists messages (
  id text primary key,
  space_id text not null,
  topic_id text not null,
  author jsonb not null,
  body text not null,
  posted_at text not null,
  stream_offset int not null
);
create index if not exists messages_topic on messages (space_id, topic_id, stream_offset);
create table if not exists invites (
  token text primary key,
  space_id text not null,
  created_by text not null,
  created_at text not null,
  expires_at text,
  revoked boolean not null default false
);
create table if not exists events (
  space_id text not null,
  stream_offset int not null,
  at text not null,
  event jsonb not null,
  primary key (space_id, stream_offset)
);
`;

interface ChangeSetRow {
  id: string;
  space_id: string;
  asset_path: string;
  base_version: number;
  result_version: number;
  attribution: ChangeSet['attribution'];
  reason: string | null;
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
    committedAt: r.committed_at,
    offset: r.stream_offset,
  };
}

interface TopicRow {
  id: string;
  space_id: string;
  title: string;
  created_by: Topic['createdBy'];
  created_at: string;
  archived: boolean;
  anchor_change_set_id: string | null;
  last_activity_at: string;
  message_count: number;
}

function rowToTopic(r: TopicRow): Topic {
  return {
    id: r.id,
    spaceId: r.space_id,
    title: r.title,
    createdBy: r.created_by,
    createdAt: r.created_at,
    archived: r.archived,
    ...(r.anchor_change_set_id !== null ? { anchorChangeSetId: r.anchor_change_set_id } : {}),
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
  };
}

export class PgStore implements Store {
  private readonly als = new AsyncLocalStorage<SqlExecutor>();

  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    await this.db.exec(SCHEMA);
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
    const rows = await this.sql.query<{ id: string; display_name: string; avatar_url: string | null }>(
      'select id, display_name, avatar_url from members where id = $1',
      [id],
    );
    const r = rows[0];
    if (!r) return undefined;
    return { id: r.id, displayName: r.display_name, ...(r.avatar_url !== null ? { avatarUrl: r.avatar_url } : {}) };
  }

  async putMember(member: Member): Promise<void> {
    await this.sql.query(
      `insert into members (id, display_name, avatar_url) values ($1, $2, $3)
       on conflict (id) do update set display_name = excluded.display_name, avatar_url = excluded.avatar_url`,
      [member.id, member.displayName, member.avatarUrl ?? null],
    );
  }

  // --- spaces ----------------------------------------------------------------

  async putSpace(space: Space): Promise<void> {
    await this.sql.query(
      `insert into spaces (id, name, created_at) values ($1, $2, $3)
       on conflict (id) do update set name = excluded.name`,
      [space.id, space.name, space.createdAt],
    );
  }

  async getSpace(id: string): Promise<Space | undefined> {
    const rows = await this.sql.query<{ id: string; name: string; created_at: string }>(
      'select id, name, created_at from spaces where id = $1',
      [id],
    );
    const r = rows[0];
    return r ? { id: r.id, name: r.name, createdAt: r.created_at } : undefined;
  }

  async listSpacesFor(memberId: string): Promise<Space[]> {
    const rows = await this.sql.query<{ id: string; name: string; created_at: string }>(
      `select s.id, s.name, s.created_at from spaces s
       join memberships m on m.space_id = s.id
       where m.member_id = $1 order by s.created_at, s.id`,
      [memberId],
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

  async listAssets(spaceId: string): Promise<AssetHead[]> {
    const rows = await this.sql.query<{ path: string; version: number; updated_at: string }>(
      'select path, version, updated_at from assets where space_id = $1 order by path',
      [spaceId],
    );
    return rows.map((r) => ({ path: r.path, version: r.version, updatedAt: r.updated_at }));
  }

  async getAssetHead(spaceId: string, path: string): Promise<AssetHead | undefined> {
    const rows = await this.sql.query<{ path: string; version: number; updated_at: string }>(
      'select path, version, updated_at from assets where space_id = $1 and path = $2',
      [spaceId, path],
    );
    const r = rows[0];
    return r ? { path: r.path, version: r.version, updatedAt: r.updated_at } : undefined;
  }

  async getAssetContent(spaceId: string, path: string, version: number): Promise<string | undefined> {
    if (version === 0) return '';
    const rows = await this.sql.query<{ content: string }>(
      'select content from asset_versions where space_id = $1 and path = $2 and version = $3',
      [spaceId, path, version],
    );
    return rows[0]?.content;
  }

  async putAssetVersion(spaceId: string, path: string, version: number, content: string, updatedAt: string): Promise<void> {
    await this.sql.query(
      `insert into assets (space_id, path, version, updated_at) values ($1, $2, $3, $4)
       on conflict (space_id, path) do update set version = excluded.version, updated_at = excluded.updated_at`,
      [spaceId, path, version, updatedAt],
    );
    await this.sql.query(
      'insert into asset_versions (space_id, path, version, content) values ($1, $2, $3, $4)',
      [spaceId, path, version, content],
    );
  }

  // --- change log ------------------------------------------------------------

  async appendChangeSet(changeSet: ChangeSet): Promise<void> {
    await this.sql.query(
      `insert into change_sets (id, space_id, asset_path, base_version, result_version, attribution, reason, committed_at, stream_offset)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        changeSet.id,
        changeSet.spaceId,
        changeSet.assetPath,
        changeSet.baseVersion,
        changeSet.resultVersion,
        JSON.stringify(changeSet.attribution),
        changeSet.reason ?? null,
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
    opts: { path?: string; beforeOffset?: number; limit: number },
  ): Promise<ChangeSet[]> {
    const conditions = ['space_id = $1'];
    const params: unknown[] = [spaceId];
    if (opts.path !== undefined) {
      params.push(opts.path);
      conditions.push(`asset_path = $${params.length}`);
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
      `insert into topics (id, space_id, title, created_by, created_at, archived, anchor_change_set_id, last_activity_at, message_count)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         title = excluded.title, archived = excluded.archived,
         anchor_change_set_id = excluded.anchor_change_set_id,
         last_activity_at = excluded.last_activity_at, message_count = excluded.message_count`,
      [
        topic.id,
        topic.spaceId,
        topic.title,
        JSON.stringify(topic.createdBy),
        topic.createdAt,
        topic.archived,
        topic.anchorChangeSetId ?? null,
        topic.lastActivityAt,
        topic.messageCount,
      ],
    );
  }

  async listTopics(spaceId: string, includeArchived: boolean): Promise<Topic[]> {
    const rows = await this.sql.query<TopicRow>(
      `select * from topics where space_id = $1 ${includeArchived ? '' : 'and archived = false'}
       order by last_activity_at desc, id desc`,
      [spaceId],
    );
    return rows.map(rowToTopic);
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
