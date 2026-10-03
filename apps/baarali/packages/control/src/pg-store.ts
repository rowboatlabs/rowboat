import type { Db, Queryable } from './db.js';
import type { QuotaState } from './quota.js';
import {
  hashToken,
  type Account,
  type ControlStore,
  type Device,
  type InstanceRecord,
  type LedgerResult,
  type MediaJob,
  type MediaHistoryEntry,
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

interface DeviceRow {
  id: string;
  account_id: string;
  name: string;
  created_at: Date;
  last_seen_at: Date | null;
  revoked_at: Date | null;
}

const DEVICE_COLUMNS = 'id, account_id, name, created_at, last_seen_at, revoked_at';

const toDevice = (r: DeviceRow): Device => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  createdAt: r.created_at.getTime(),
  lastSeenAt: ms(r.last_seen_at),
  revokedAt: ms(r.revoked_at),
});

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

  /**
   * Links an account that predates the sign-in server (the owner's) to the
   * user who signs in with its email, once Better Auth says that email is
   * verified: the same rule as linking two identities (architecture §3.5).
   * Does nothing until that user exists, nor once the account is linked.
   */
  async linkUserByVerifiedEmail(accountId: string, email: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `UPDATE baarali.accounts a SET user_id = u.id FROM baarali.users u
       WHERE a.id = $1 AND a.user_id IS NULL AND lower(u.email) = lower($2) AND u."emailVerified"
         AND NOT EXISTS (SELECT 1 FROM baarali.accounts o WHERE o.user_id = u.id)
       RETURNING a.id`,
      [accountId, email],
    );
    return rows.length > 0;
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

  async mediaHistory(accountId: string, limit: number): Promise<MediaHistoryEntry[]> {
    const { rows } = await this.db.query<{ at: Date | string; kind: MediaHistoryEntry['kind']; credits: number; model: string | null }>(
      `SELECT l.at, l.kind, l.credits, j.model
         FROM baarali.media_ledger l
         LEFT JOIN baarali.media_jobs j ON l.kind <> 'topup' AND j.charge_ref = l.reference
        WHERE l.account_id = $1
        ORDER BY l.at DESC, l.id DESC
        LIMIT $2`,
      [accountId, limit],
    );
    return rows.map((r) => ({ at: new Date(r.at).getTime(), kind: r.kind, credits: num(r.credits), model: r.model ?? null }));
  }

  async accountForUser(userId: string) {
    const { rows } = await this.db.query<AccountRow>(
      `SELECT id, email, plan_id, created_at FROM baarali.accounts WHERE user_id = $1 OR id = $1
       ORDER BY (user_id IS NOT NULL AND user_id = $1) DESC LIMIT 1`,
      [userId],
    );
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async instance(accountId: string): Promise<InstanceRecord | null> {
    const { rows } = await this.db.query<{ account_id: string; app: string; machine_id: string | null; volume_id: string | null; image: string | null; managed: boolean }>(
      'SELECT account_id, app, machine_id, volume_id, image, managed FROM baarali.instances WHERE account_id = $1',
      [accountId],
    );
    const r = rows[0];
    return r ? { accountId: r.account_id, app: r.app, machineId: r.machine_id, volumeId: r.volume_id, image: r.image, managed: r.managed } : null;
  }

  async saveInstance(i: InstanceRecord) {
    await this.db.query(
      `INSERT INTO baarali.instances (account_id, app, machine_id, volume_id, image, managed) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id) DO UPDATE SET app = EXCLUDED.app, machine_id = EXCLUDED.machine_id, volume_id = EXCLUDED.volume_id,
         image = EXCLUDED.image, managed = EXCLUDED.managed`,
      [i.accountId, i.app, i.machineId, i.volumeId, i.image, i.managed],
    );
  }

  async removeInstance(accountId: string) {
    await this.db.query('DELETE FROM baarali.instances WHERE account_id = $1', [accountId]);
  }

  async countInstances() {
    const { rows } = await this.db.query<{ n: unknown }>('SELECT count(*) AS n FROM baarali.instances');
    return num(rows[0].n);
  }

  async addDevice(d: Device, keyHash: string) {
    await this.db.query(
      'INSERT INTO baarali.devices (id, account_id, key_hash, name, created_at, last_seen_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [d.id, d.accountId, keyHash, d.name, new Date(d.createdAt), date(d.lastSeenAt), date(d.revokedAt)],
    );
  }

  async deviceByKey(key: string) {
    const { rows } = await this.db.query<DeviceRow>(
      `SELECT ${DEVICE_COLUMNS} FROM baarali.devices WHERE key_hash = $1 AND revoked_at IS NULL`,
      [hashToken(key)],
    );
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async devices(accountId: string) {
    const { rows } = await this.db.query<DeviceRow>(
      `SELECT ${DEVICE_COLUMNS} FROM baarali.devices WHERE account_id = $1 ORDER BY created_at`,
      [accountId],
    );
    return rows.map(toDevice);
  }

  async touchDevice(id: string, at: number) {
    await this.db.query('UPDATE baarali.devices SET last_seen_at = $2 WHERE id = $1', [id, new Date(at)]);
  }

  async revokeDevice(accountId: string, id: string, at: number) {
    const { rows } = await this.db.query(
      'UPDATE baarali.devices SET revoked_at = $3 WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL RETURNING id',
      [id, accountId, new Date(at)],
    );
    return rows.length > 0;
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
