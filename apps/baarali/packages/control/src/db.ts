import type pg from 'pg';

// The control plane's Postgres (architecture §3.5; data model §2): its own
// `baarali` schema, with its own migration ladder, never Harbor's tables
// (UPSTREAM.md §2). Every statement names the schema, so nothing can land
// in another one by accident.

export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** A connection that can also run a transaction. */
export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

export function poolDb(pool: pg.Pool): Db {
  return {
    query: async <R>(text: string, params?: unknown[]) => {
      const res = await pool.query(text, params);
      return { rows: res.rows as R[] };
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: async <R>(text: string, params?: unknown[]) => ({ rows: (await client.query(text, params)).rows as R[] }),
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Append only: a migration once deployed is never edited, the next change is
 * a new entry. Numbered from 1, applied in order, each in its own transaction.
 */
export const MIGRATIONS: string[] = [
  // 1 — accounts, quota, usage and media credits (decided 01/10/2026), the
  // in-memory store of phase 0 made durable. Plans stay in code (catalog.ts).
  `
  CREATE TABLE baarali.accounts (
    id text PRIMARY KEY,
    email text,
    plan_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- Bearer tokens, by SHA-256 only (security H12).
  CREATE TABLE baarali.access_tokens (
    token_hash text PRIMARY KEY,
    account_id text NOT NULL REFERENCES baarali.accounts(id),
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE baarali.quota_states (
    account_id text PRIMARY KEY REFERENCES baarali.accounts(id),
    session_start timestamptz,
    session_used bigint NOT NULL,
    week_start timestamptz NOT NULL,
    week_used bigint NOT NULL
  );

  CREATE TABLE baarali.usage_records (
    id bigserial PRIMARY KEY,
    account_id text NOT NULL REFERENCES baarali.accounts(id),
    at timestamptz NOT NULL,
    path text NOT NULL,
    model text,
    requested_model text,
    status integer NOT NULL,
    credits bigint NOT NULL,
    estimated boolean NOT NULL,
    use_case text,
    agent_name text
  );
  CREATE INDEX usage_records_account_at ON baarali.usage_records (account_id, at);

  CREATE TABLE baarali.media_jobs (
    id text PRIMARY KEY,
    account_id text NOT NULL REFERENCES baarali.accounts(id),
    model text NOT NULL,
    credits integer NOT NULL,
    charge_ref text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    url text,
    refunded boolean NOT NULL DEFAULT false
  );

  -- Append only, like every ledger (data model §1).
  CREATE TABLE baarali.media_ledger (
    id bigserial PRIMARY KEY,
    account_id text NOT NULL REFERENCES baarali.accounts(id),
    at timestamptz NOT NULL,
    kind text NOT NULL CHECK (kind IN ('topup', 'charge', 'refund')),
    credits integer NOT NULL,
    reference text NOT NULL,
    UNIQUE (kind, reference)
  );
  CREATE INDEX media_ledger_account ON baarali.media_ledger (account_id);
  CREATE FUNCTION baarali.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION '% is append only', TG_TABLE_NAME; END $$;
  CREATE TRIGGER media_ledger_append_only BEFORE UPDATE OR DELETE ON baarali.media_ledger
    FOR EACH ROW EXECUTE FUNCTION baarali.refuse_change();
  `,
  // 2 — sign-in codes (security §4.1, decided 01/10/2026): every send is
  // counted, to cap them per number or address; phone codes are kept hashed.
  // Better Auth's own tables are created by its migrator, in this schema too.
  `
  CREATE TABLE baarali.code_sends (
    id bigserial PRIMARY KEY,
    identifier text NOT NULL,
    at timestamptz NOT NULL
  );
  CREATE INDEX code_sends_identifier_at ON baarali.code_sends (identifier, at);

  CREATE TABLE baarali.phone_codes (
    phone_e164 text PRIMARY KEY,
    code_hash text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL
  );
  `,
  // 3 — one instance per account, reached through the control plane
  // (decided 01/10/2026; architecture §3.5 « Instances », security §2).
  // `user_id`: the sign-in user an account answers to, when it is not the
  // account's own id (the owner's account predates the sign-in server).
  // A device holds a key of its own, never the instance's: kept by hash,
  // revoked one by one.
  `
  ALTER TABLE baarali.accounts ADD COLUMN user_id text UNIQUE;

  CREATE TABLE baarali.instances (
    account_id text PRIMARY KEY REFERENCES baarali.accounts(id),
    app text NOT NULL,
    machine_id text,
    volume_id text,
    image text,
    managed boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE baarali.devices (
    id text PRIMARY KEY,
    account_id text NOT NULL REFERENCES baarali.accounts(id),
    key_hash text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL,
    last_seen_at timestamptz,
    revoked_at timestamptz
  );
  CREATE INDEX devices_account ON baarali.devices (account_id);
  `,
];

/** Brings the schema up to date. Safe on several machines at once: the lock serializes them. */
export async function migrate(db: Db): Promise<number> {
  // The product was renamed Baarali on 01/10/2026; its schema was `warell`.
  // Renamed in place, data and all, the first time a new version starts.
  // Triggers point to their function, not its name: nothing else to redo.
  await db.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'warell')
       AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'baarali') THEN
      ALTER SCHEMA warell RENAME TO baarali;
    END IF;
  END $$`);
  await db.query('CREATE SCHEMA IF NOT EXISTS baarali');
  await db.query(
    'CREATE TABLE IF NOT EXISTS baarali.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  let applied = 0;
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const version = i + 1;
    const done = await db.transaction(async (tx) => {
      // Arbitrary constant: one lock for this ladder, released at commit.
      await tx.query('SELECT pg_advisory_xact_lock(7262011)');
      const { rows } = await tx.query('SELECT 1 FROM baarali.schema_migrations WHERE version = $1', [version]);
      if (rows.length > 0) return false;
      await tx.query(MIGRATIONS[i]);
      await tx.query('INSERT INTO baarali.schema_migrations (version) VALUES ($1)', [version]);
      return true;
    });
    if (done) applied++;
  }
  return applied;
}
