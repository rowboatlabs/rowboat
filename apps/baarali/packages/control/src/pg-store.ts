import type { Db, Queryable } from './db.js';
import type { QuotaState } from './quota.js';
import {
  hashToken,
  type Account,
  type ControlStore,
  type LedgerResult,
  type MediaJob,
  type MediaLedgerEntry,
  type Plan,
  type UsageRecord,
} from './store.js';

// The durable store (decided 01/10/2026): what phase 0 kept in memory, in the
// `baarali` schema (db.ts). Plans stay in code, priced by catalog.ts.

const ms = (d: Date | null): number | null => (d === null ? null : d.getTime());
const date = (t: number | null): Date | null => (t === null ? null : new Date(t));
// pg returns bigint columns as strings: they hold credits, safe as numbers.
const num = (v: unknown): number => Number(v);

interface AccountRow {
  id: string;
  email: string | null;
  plan_id: string;
  created_at: Date;
}

const toAccount = (r: AccountRow): Account => ({ id: r.id, email: r.email, planId: r.plan_id, createdAt: r.created_at.getTime() });

async function balanceOf(q: Queryable, accountId: string): Promise<number> {
  const { rows } = await q.query<{ balance: unknown }>(
    'SELECT COALESCE(SUM(credits), 0) AS balance FROM baarali.media_ledger WHERE account_id = $1',
    [accountId],
  );
  return num(rows[0].balance);
}

export class PgStore implements ControlStore {
  constructor(
    private readonly db: Db,
    private readonly catalog: Plan[],
  ) {}

  /** Creates or updates an account; its plan follows the latest call. */
  async upsertAccount(account: Account): Promise<void> {
    await this.db.query(
      `INSERT INTO baarali.accounts (id, email, plan_id, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, plan_id = EXCLUDED.plan_id`,
      [account.id, account.email, account.planId, new Date(account.createdAt)],
    );
  }

  /** Lets `token` act as the account. Kept hashed only. */
  async grantToken(token: string, accountId: string): Promise<void> {
    await this.db.query(
      'INSERT INTO baarali.access_tokens (token_hash, account_id) VALUES ($1, $2) ON CONFLICT (token_hash) DO UPDATE SET account_id = EXCLUDED.account_id',
      [hashToken(token), accountId],
    );
  }

  async accountByToken(token: string) {
    const { rows } = await this.db.query<AccountRow>(
      `SELECT a.id, a.email, a.plan_id, a.created_at FROM baarali.access_tokens t
       JOIN baarali.accounts a ON a.id = t.account_id WHERE t.token_hash = $1`,
      [hashToken(token)],
    );
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async account(id: string) {
    const { rows } = await this.db.query<AccountRow>('SELECT id, email, plan_id, created_at FROM baarali.accounts WHERE id = $1', [id]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async plan(planId: string) {
    return this.catalog.find((p) => p.id === planId) ?? null;
  }

  async plans() {
    return this.catalog;
  }

  async quotaState(accountId: string): Promise<QuotaState | null> {
    const { rows } = await this.db.query<{ session_start: Date | null; session_used: unknown; week_start: Date; week_used: unknown }>(
      'SELECT session_start, session_used, week_start, week_used FROM baarali.quota_states WHERE account_id = $1',
      [accountId],
    );
    const r = rows[0];
    if (!r) return null;
    return { sessionStart: ms(r.session_start), sessionUsed: num(r.session_used), weekStart: r.week_start.getTime(), weekUsed: num(r.week_used) };
  }

  async saveQuotaState(accountId: string, s: QuotaState) {
    await this.db.query(
      `INSERT INTO baarali.quota_states (account_id, session_start, session_used, week_start, week_used) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id) DO UPDATE SET session_start = EXCLUDED.session_start, session_used = EXCLUDED.session_used,
         week_start = EXCLUDED.week_start, week_used = EXCLUDED.week_used`,
      [accountId, date(s.sessionStart), Math.round(s.sessionUsed), new Date(s.weekStart), Math.round(s.weekUsed)],
    );
  }

  async appendUsage(r: UsageRecord) {
    await this.db.query(
      `INSERT INTO baarali.usage_records (account_id, at, path, model, requested_model, status, credits, estimated, use_case, agent_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [r.accountId, new Date(r.at), r.path, r.model, r.requestedModel, r.status, Math.round(r.credits), r.estimated, r.useCase, r.agentName],
    );
  }

  async mediaJob(id: string): Promise<MediaJob | null> {
    const { rows } = await this.db.query<{
      id: string; account_id: string; model: string; credits: number; charge_ref: string; status: MediaJob['status']; url: string | null; refunded: boolean;
    }>('SELECT id, account_id, model, credits, charge_ref, status, url, refunded FROM baarali.media_jobs WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, accountId: r.account_id, model: r.model, credits: r.credits, chargeRef: r.charge_ref, status: r.status, url: r.url, refunded: r.refunded };
  }

  async saveMediaJob(j: MediaJob) {
    await this.db.query(
      `INSERT INTO baarali.media_jobs (id, account_id, model, credits, charge_ref, status, url, refunded) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, url = EXCLUDED.url, refunded = EXCLUDED.refunded`,
      [j.id, j.accountId, j.model, j.credits, j.chargeRef, j.status, j.url, j.refunded],
    );
  }

  async mediaBalance(accountId: string) {
    return balanceOf(this.db, accountId);
  }

  async applyMediaEntry(e: MediaLedgerEntry): Promise<LedgerResult> {
    return this.db.transaction(async (tx) => {
      // Locking the account row serializes its ledger: two charges sent
      // together cannot both read the same balance.
      await tx.query('SELECT 1 FROM baarali.accounts WHERE id = $1 FOR UPDATE', [e.accountId]);
      const seen = await tx.query('SELECT 1 FROM baarali.media_ledger WHERE kind = $1 AND reference = $2', [e.kind, e.reference]);
      if (seen.rows.length > 0) return 'duplicate';
      if ((await balanceOf(tx, e.accountId)) + e.credits < 0) return 'insufficient';
      await tx.query(
        'INSERT INTO baarali.media_ledger (account_id, at, kind, credits, reference) VALUES ($1, $2, $3, $4, $5)',
        [e.accountId, new Date(e.at), e.kind, e.credits, e.reference],
      );
      return 'applied';
    });
  }
}
