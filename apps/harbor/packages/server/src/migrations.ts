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
