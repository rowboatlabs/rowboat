import type { SqlDb } from './sql.js';

// Versioned schema migrations, in code (no files, no CLI — Harbor stays a
// single artifact). Each entry is an ordered list of single statements
// (PGlite's query path is single-statement). Applied entries are recorded in
// schema_migrations and never rerun; application takes a transaction-scoped
// advisory lock so concurrently booting nodes can't race.
//
// Rules for new migrations: append only, never edit an applied entry; one
// concern per migration; keep statements idempotent where cheap (belt), but
// ordering + recording is the real contract. 001 is the pre-migration-era
// bootstrap verbatim — fully idempotent, so an existing database adopts the
// ladder by simply no-opping through it.

export interface Migration {
  id: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001-init',
    statements: [
      `create table if not exists members (
        id text primary key,
        display_name text not null,
        avatar_url text
      )`,
      `create table if not exists member_identities (
        iss text not null,
        sub text not null,
        member_id text not null,
        primary key (iss, sub)
      )`,
      `create table if not exists spaces (
        id text primary key,
        name text not null,
        created_at text not null
      )`,
      `create table if not exists memberships (
        space_id text not null,
        member_id text not null,
        joined_at text not null,
        primary key (space_id, member_id)
      )`,
      `create table if not exists assets (
        space_id text not null,
        path text not null,
        version int not null,
        updated_at text not null,
        primary key (space_id, path)
      )`,
      `create table if not exists asset_versions (
        space_id text not null,
        path text not null,
        version int not null,
        content text not null,
        primary key (space_id, path, version)
      )`,
      `create table if not exists change_sets (
        id text primary key,
        space_id text not null,
        asset_path text not null,
        base_version int not null,
        result_version int not null,
        attribution jsonb not null,
        reason text,
        committed_at text not null,
        stream_offset int not null
      )`,
      `create index if not exists change_sets_space_offset on change_sets (space_id, stream_offset desc)`,
      `create table if not exists topics (
        id text primary key,
        space_id text not null,
        title text not null,
        created_by jsonb not null,
        created_at text not null,
        archived boolean not null,
        anchor_change_set_id text,
        last_activity_at text not null,
        message_count int not null
      )`,
      `create index if not exists topics_space on topics (space_id, last_activity_at desc)`,
      `create table if not exists messages (
        id text primary key,
        space_id text not null,
        topic_id text not null,
        author jsonb not null,
        body text not null,
        posted_at text not null,
        stream_offset int not null
      )`,
      `create index if not exists messages_topic on messages (space_id, topic_id, stream_offset)`,
      `create table if not exists invites (
        token text primary key,
        space_id text not null,
        created_by text not null,
        created_at text not null,
        expires_at text,
        revoked boolean not null default false
      )`,
      `create table if not exists events (
        space_id text not null,
        stream_offset int not null,
        at text not null,
        event jsonb not null,
        primary key (space_id, stream_offset)
      )`,
    ],
  },
  {
    id: '002-member-role',
    statements: [
      // The org-level admin bit (spec §4, 2026-08-19 amendment). Data first;
      // enforcement routes arrive with org management.
      `alter table members add column if not exists role text not null default 'member'`,
    ],
  },
  {
    id: '003-multi-org',
    statements: [
      // Spec §4 "Deployment and tenancy": one deployment serves 1..N orgs,
      // resolved from the Host header. Org-scoped tables gain org_id;
      // space-scoped tables (assets, topics, messages, events, change_sets)
      // key off globally-unique ULIDs and need nothing. Existing single-org
      // data adopts the default org id.
      `create table if not exists orgs (
        id text primary key,
        name text not null,
        created_at text not null,
        issuer text,
        allowed_email_domains jsonb
      )`,
      `create table if not exists org_domains (
        domain text primary key,
        org_id text not null
      )`,
      `alter table members add column if not exists org_id text not null default 'org-default'`,
      `alter table members drop constraint members_pkey`,
      `alter table members add primary key (org_id, id)`,
      `alter table spaces add column if not exists org_id text not null default 'org-default'`,
      `create index if not exists spaces_org on spaces (org_id)`,
      // The same (iss, sub) is legitimately a DIFFERENT member in each org.
      `alter table member_identities add column if not exists org_id text not null default 'org-default'`,
      `alter table member_identities drop constraint member_identities_pkey`,
      `alter table member_identities add primary key (org_id, iss, sub)`,
      // Invites need no org_id: resolution goes token → space, and the space
      // lookup is org-scoped, so a foreign org's token is already not_found.
    ],
  },
  {
    id: '004-topic-contract',
    statements: [
      // Promote the chat-first client conventions (apps/x spaces-conventions.ts)
      // into the contract: Topic.kind, Topic.anchorMessageId, ChangeSet.topicId.
      // The backfills below parse the exact legacy shapes those conventions
      // wrote, so pre-004 data reads identically through the new fields.
      `alter table topics add column if not exists kind text not null default 'discussion'`,
      `alter table topics add column if not exists anchor_message_id text`,
      `alter table change_sets add column if not exists topic_id text`,
      // The stream: the oldest open topic titled "messages" (legacy "general")
      // per space — same tie-break as the client's findGeneralTopic.
      `update topics set kind = 'general' where id in (
        select distinct on (space_id) id from topics
        where lower(btrim(title)) in ('messages', 'general') and archived = false
        order by space_id, created_at asc, id asc
      )`,
      // Thread parentage: the "<!-- rowboat:topic parent=msg:<id> … -->" marker
      // in each topic's first message. Oldest claimant wins a contested parent
      // (same rule the client's thread index applies).
      `update topics set anchor_message_id = claims.parent from (
        select distinct on (parent) topic_id, parent from (
          select distinct on (topic_id) topic_id, posted_at,
            substring(body from '<!--\\s*rowboat:(?:topic|thread)\\s+parent=msg:([0-9A-Za-z_-]+)') as parent
          from messages
          order by topic_id, stream_offset asc
        ) firsts
        where parent is not null
        order by parent, posted_at asc, topic_id asc
      ) claims
      where topics.id = claims.topic_id and topics.anchor_message_id is null`,
      // Artifact provenance: the "· topic:<id>" reason suffix (legacy "thread:",
      // or a bare "topic:<id>" reason).
      `update change_sets set topic_id = coalesce(
        substring(reason from '·\\s*(?:topic|thread):([0-9A-Za-z_-]+)\\s*$'),
        substring(reason from '^(?:topic|thread):([0-9A-Za-z_-]+)$')
      ) where reason is not null and topic_id is null`,
      // What the conventions could never have: invariants. Exactly one stream
      // per space; at most one topic grown from any message.
      `create unique index if not exists topics_one_general_per_space on topics (space_id) where kind = 'general'`,
      `create unique index if not exists topics_anchor_message on topics (anchor_message_id) where anchor_message_id is not null`,
    ],
  },
  {
    id: '005-reactions',
    statements: [
      // Slack-style reactions: one row per (message, emoji, member) — the
      // primary key IS the toggle invariant. `attribution` mirrors the
      // change_sets column (jsonb Attribution); topic membership is derived
      // through messages so merge_into needs no backfill here.
      `create table if not exists reactions (
        space_id text not null,
        message_id text not null,
        emoji text not null,
        member_id text not null,
        attribution jsonb not null,
        at text not null,
        primary key (space_id, message_id, emoji, member_id)
      )`,
      `create index if not exists reactions_space_message on reactions (space_id, message_id)`,
    ],
  },
  {
    id: '006-blobs',
    statements: [
      // Spec §6 binary assets: bytes live in the content-addressed BlobStore;
      // the database carries {hash, size, mime} as jsonb (the attribution
      // pattern). A version is text (content) XOR binary (blob) — one
      // namespace, one log, only the populated column differs.
      `alter table asset_versions alter column content drop not null`,
      `alter table asset_versions add column if not exists blob jsonb`,
      `alter table change_sets add column if not exists blob jsonb`,
      // The space-level read gate for uploads: bytes dedup per org underneath,
      // but a blob is referencable/servable only in spaces it was uploaded to.
      `create table if not exists space_blobs (
        space_id text not null,
        hash text not null,
        size bigint not null,
        mime text not null,
        uploaded_by text not null,
        uploaded_at text not null,
        primary key (space_id, hash)
      )`,
    ],
  },
  {
    id: '007-asset-ids',
    statements: [
      // The inode model (decision 2026-08-26): the PATH stays the product's
      // identity — every wire surface is unchanged — but STORAGE keys on an
      // internal per-asset id, so move/delete/restore are property updates
      // and version rows never relocate. The backfill joins by path, which is
      // unambiguous precisely because no move has ever happened before 007.
      `alter table assets add column if not exists id text`,
      `alter table assets add column if not exists state text not null default 'live'`,
      `update assets set id = gen_random_uuid()::text where id is null`,
      `alter table assets alter column id set not null`,
      `alter table asset_versions add column if not exists asset_id text`,
      `update asset_versions v set asset_id = a.id from assets a
        where v.space_id = a.space_id and v.path = a.path and v.asset_id is null`,
      `alter table asset_versions alter column asset_id set not null`,
      `alter table change_sets add column if not exists asset_id text`,
      `update change_sets c set asset_id = a.id from assets a
        where c.space_id = a.space_id and c.asset_path = a.path and c.asset_id is null`,
      // Identity swap: assets key on id; the path is a mutable property,
      // unique only among the living (the trash never blocks a name).
      `alter table assets drop constraint assets_pkey`,
      `alter table assets add primary key (space_id, id)`,
      `create unique index if not exists assets_live_path on assets (space_id, path) where state = 'live'`,
      `alter table asset_versions drop constraint asset_versions_pkey`,
      `alter table asset_versions add primary key (space_id, asset_id, version)`,
      // The path column on versions is now derivable and would only go stale.
      `alter table asset_versions drop column path`,
      // Namespace op columns on the log (op: move|delete|restore; moved_from on moves).
      `alter table change_sets add column if not exists op text`,
      `alter table change_sets add column if not exists moved_from text`,
      // Old paths forward to their asset — reads follow, proposes refuse-with-pointer.
      `create table if not exists asset_redirects (
        space_id text not null,
        path text not null,
        asset_id text not null,
        moved_at text not null,
        primary key (space_id, path)
      )`,
    ],
  },
  {
    id: '008-message-deletion',
    statements: [
      // Author-only tombstones: deleted_at is the marker; the body is redacted
      // in place — in the messages row AND the stored message event, the one
      // log rewrite the design allows (replay must never resurrect a deleted
      // body). No backfill: nothing was deletable before this.
      `alter table messages add column if not exists deleted_at text`,
    ],
  },
];

export async function migrate(db: SqlDb): Promise<void> {
  await db.exec(
    'create table if not exists schema_migrations (id text primary key, applied_at text not null)',
  );
  for (const m of MIGRATIONS) {
    await db.withTransaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', ['harbor-schema-migrations']);
      const done = await tx.query('select id from schema_migrations where id = $1', [m.id]);
      if (done.length > 0) return;
      for (const statement of m.statements) await tx.query(statement);
      await tx.query('insert into schema_migrations (id, applied_at) values ($1, $2)', [
        m.id,
        new Date().toISOString(),
      ]);
    });
  }
}
