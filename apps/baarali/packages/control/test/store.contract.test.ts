import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS } from '../src/db.js';
import { PgStore } from '../src/pg-store.js';
import { MemoryStore, hashToken, type Account, type ControlStore, type Plan } from '../src/store.js';
import { pgliteDb } from './pglite.js';

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
const PLAN: Plan = { id: 'essentiel', category: 'starter', displayName: 'Essentiel', weekCredits: 100, monthlyPrices: [], models: null };
const ME: Account = { id: 'acc_me', email: 'me@example.test', planId: 'essentiel', createdAt: T0 };
const OTHER: Account = { id: 'acc_other', email: null, planId: 'essentiel', createdAt: T0 };

// One database for the file: PGlite takes seconds to start, a schema
// moments to rebuild. Every test starts from an empty `baarali` schema.
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
}, 60_000);

async function freshDb() {
  const db = pgliteDb(pg);
  await db.query('DROP SCHEMA IF EXISTS baarali CASCADE');
  return db;
}

async function pgStore(): Promise<ControlStore> {
  const db = await freshDb();
  await migrate(db);
  const store = new PgStore(db, [PLAN]);
  for (const a of [ME, OTHER]) await store.upsertAccount(a);
  await store.grantToken('tok-me', ME.id);
  return store;
}

async function memoryStore(): Promise<ControlStore> {
  return new MemoryStore(new Map([[hashToken('tok-me'), ME], [hashToken('tok-other'), OTHER]]), [PLAN]);
}

// The same rules for both stores: phase 0 runs the memory one, production the
// Postgres one, and the routes must not tell them apart.
describe.each([
  ['memory', memoryStore],
  ['postgres', pgStore],
])('%s store', (_name, make) => {
  it('finds an account by its token, never by a wrong one', async () => {
    const store = await make();
    expect(await store.accountByToken('tok-me')).toEqual(ME);
    expect(await store.accountByToken('nope')).toBeNull();
    expect(await store.account(ME.id)).toEqual(ME);
    expect(await store.account('acc_nobody')).toBeNull();
  });

  it('keeps the quota state, with an open or a closed session', async () => {
    const store = await make();
    expect(await store.quotaState(ME.id)).toBeNull();
    await store.saveQuotaState(ME.id, { sessionStart: T0, sessionUsed: 1234567, weekStart: T0, weekUsed: 7654321 });
    expect(await store.quotaState(ME.id)).toEqual({ sessionStart: T0, sessionUsed: 1234567, weekStart: T0, weekUsed: 7654321 });
    await store.saveQuotaState(ME.id, { sessionStart: null, sessionUsed: 0, weekStart: T0, weekUsed: 9 });
    expect(await store.quotaState(ME.id)).toEqual({ sessionStart: null, sessionUsed: 0, weekStart: T0, weekUsed: 9 });
  });

  it('keeps a media job and its updates', async () => {
    const store = await make();
    const job = { id: 'px1', accountId: ME.id, model: 'lyria', credits: 5, chargeRef: 'c1', status: 'pending' as const, url: null, refunded: false };
    await store.saveMediaJob(job);
    await store.saveMediaJob({ ...job, status: 'completed', url: 'https://cdn.test/a.wav' });
    expect(await store.mediaJob('px1')).toEqual({ ...job, status: 'completed', url: 'https://cdn.test/a.wav' });
    expect(await store.mediaJob('px2')).toBeNull();
  });

  it('applies each ledger entry once and never lets the balance go below zero', async () => {
    const store = await make();
    const entry = (kind: 'topup' | 'charge' | 'refund', credits: number, reference: string) =>
      store.applyMediaEntry({ accountId: ME.id, at: T0, kind, credits, reference });
    expect(await entry('topup', 71, 'pay-1')).toBe('applied');
    expect(await entry('topup', 71, 'pay-1')).toBe('duplicate');
    expect(await entry('charge', -80, 'c1')).toBe('insufficient');
    expect(await entry('charge', -38, 'c2')).toBe('applied');
    expect(await entry('refund', 38, 'c2')).toBe('applied');
    expect(await entry('refund', 38, 'c2')).toBe('duplicate');
    expect(await store.mediaBalance(ME.id)).toBe(71);
    expect(await store.mediaBalance(OTHER.id)).toBe(0);
  });

  it('tells its owner what the credits went to, newest first', async () => {
    const store = await make();
    await store.applyMediaEntry({ accountId: ME.id, at: T0, kind: 'topup', credits: 71, reference: 'pay-1' });
    await store.saveMediaJob({ id: 'px1', accountId: ME.id, model: 'lyria', credits: 5, chargeRef: 'c1', status: 'completed', url: null, refunded: false });
    await store.applyMediaEntry({ accountId: ME.id, at: T0 + 1000, kind: 'charge', credits: -5, reference: 'c1' });
    await store.applyMediaEntry({ accountId: OTHER.id, at: T0 + 2000, kind: 'topup', credits: 9, reference: 'pay-2' });
    expect(await store.mediaHistory(ME.id, 10)).toEqual([
      { at: T0 + 1000, kind: 'charge', credits: -5, model: 'lyria' },
      { at: T0, kind: 'topup', credits: 71, model: null },
    ]);
    expect(await store.mediaHistory(ME.id, 1)).toHaveLength(1);
  });

  it('lets only one of two simultaneous charges spend the same credits', async () => {
    const store = await make();
    await store.applyMediaEntry({ accountId: ME.id, at: T0, kind: 'topup', credits: 50, reference: 'pay' });
    const results = await Promise.all(
      ['a', 'b'].map((r) => store.applyMediaEntry({ accountId: ME.id, at: T0, kind: 'charge', credits: -40, reference: r })),
    );
    expect(results.sort()).toEqual(['applied', 'insufficient']);
    expect(await store.mediaBalance(ME.id)).toBe(10);
  });

  it('grants a token to an account', async () => {
    const store = await make();
    await store.grantToken('tok-new', OTHER.id);
    expect(await store.accountByToken('tok-new')).toEqual(OTHER);
  });

  it('keeps an instance record and its later steps', async () => {
    const store = await make();
    expect(await store.instance(ME.id)).toBeNull();
    const record = { accountId: ME.id, app: 'baarali-instances', machineId: null, volumeId: 'vol_1', image: null, managed: true };
    await store.saveInstance(record);
    await store.saveInstance({ ...record, machineId: 'm1', image: 'img:1' });
    expect(await store.instance(ME.id)).toEqual({ ...record, machineId: 'm1', image: 'img:1' });
    expect(await store.countInstances()).toBe(1);
    await store.removeInstance(ME.id);
    expect(await store.instance(ME.id)).toBeNull();
    expect(await store.countInstances()).toBe(0);
  });

  it('finds a device by its key until it is revoked, and only its owner revokes it', async () => {
    const store = await make();
    const device = { id: 'dev_1', accountId: ME.id, name: 'Mac', createdAt: T0, lastSeenAt: null, revokedAt: null };
    await store.addDevice(device, hashToken('bdk_secret'));
    expect(await store.deviceByKey('bdk_secret')).toEqual(device);
    expect(await store.deviceByKey('bdk_other')).toBeNull();
    await store.touchDevice('dev_1', T0 + 5);
    expect(await store.devices(ME.id)).toEqual([{ ...device, lastSeenAt: T0 + 5 }]);
    expect(await store.devices(OTHER.id)).toEqual([]);
    expect(await store.revokeDevice(OTHER.id, 'dev_1', T0 + 9)).toBe(false);
    expect(await store.revokeDevice(ME.id, 'dev_1', T0 + 9)).toBe(true);
    expect(await store.revokeDevice(ME.id, 'dev_1', T0 + 10)).toBe(false);
    expect(await store.deviceByKey('bdk_secret')).toBeNull();
    expect((await store.devices(ME.id))[0].revokedAt).toBe(T0 + 9);
  });

  it('gives a signed-in user the account they created', async () => {
    const store = await make();
    expect(await store.accountForUser(ME.id)).toEqual(ME);
    expect(await store.accountForUser('user_nobody')).toBeNull();
  });

  it('appends usage without failing', async () => {
    const store = await make();
    await store.appendUsage({
      accountId: ME.id, at: T0, path: '/chat/completions', model: 'deepseek/deepseek-v4.1-flash', requestedModel: null,
      status: 200, credits: 12345, estimated: false, useCase: 'chat', agentName: 'copilot',
    });
  });

  // The admin console (03/10/2026).
  it('lists every account once, with its activity counted from a date', async () => {
    const store = await make();
    const call = (at: number, credits: number) => store.appendUsage({
      accountId: ME.id, at, path: '/chat/completions', model: 'm', requestedModel: null,
      status: 200, credits, estimated: false, useCase: 'chat', agentName: 'copilot',
    });
    await call(T0 + 10, 100);
    await call(T0 + 20, 50);
    await store.applyMediaEntry({ accountId: ME.id, at: T0, kind: 'topup', credits: 7, reference: 'r' });
    const list = await store.listAccounts(T0 + 15);
    expect(list.map((s) => s.account.id)).toEqual([ME.id, OTHER.id]);
    expect(list[0]).toMatchObject({ account: ME, quota: null, mediaBalance: 7, lastActiveAt: T0 + 20, recentCredits: 50 });
    expect(list[1]).toMatchObject({ account: OTHER, mediaBalance: 0, lastActiveAt: null, recentCredits: 0 });
  });

  it('changes a plan and suspends, seen through the account\'s token', async () => {
    const store = await make();
    expect(await store.setPlan(ME.id, 'pro')).toBe(true);
    expect(await store.setPlan('acc_nobody', 'pro')).toBe(false);
    expect((await store.accountByToken('tok-me'))?.planId).toBe('pro');
    expect(await store.setSuspended(ME.id, T0 + 5)).toBe(true);
    expect((await store.accountByToken('tok-me'))?.suspendedAt).toBe(T0 + 5);
    expect((await store.accountForUser(ME.id))?.suspendedAt).toBe(T0 + 5);
    await store.setSuspended(ME.id, null);
    expect(await store.account(ME.id)).toEqual({ ...ME, planId: 'pro' });
  });

  it('keeps the console journal, newest first, per account if asked', async () => {
    const store = await make();
    await store.appendAdminLog({ at: T0, actor: 'a@x', action: 'plan', accountId: ME.id, detail: 'A → B' });
    await store.appendAdminLog({ at: T0, actor: 'a@x', action: 'credits', accountId: OTHER.id, detail: '+5' });
    await store.appendAdminLog({ at: T0 + 1, actor: 'token', action: 'suspend', accountId: ME.id, detail: 'x' });
    expect((await store.adminLog(10)).map((e) => e.action)).toEqual(['suspend', 'credits', 'plan']);
    expect((await store.adminLog(1)).map((e) => e.action)).toEqual(['suspend']);
    expect(await store.adminLog(10, ME.id)).toEqual([
      { at: T0 + 1, actor: 'token', action: 'suspend', accountId: ME.id, detail: 'x' },
      { at: T0, actor: 'a@x', action: 'plan', accountId: ME.id, detail: 'A → B' },
    ]);
  });

  it('lists every instance', async () => {
    const store = await make();
    const record = { accountId: ME.id, app: 'baarali-instances', machineId: 'm1', volumeId: 'v1', image: 'img:1', managed: true };
    await store.saveInstance(record);
    expect(await store.allInstances()).toEqual([record]);
  });
});

describe('linking an account to a sign-in', () => {
  // Better Auth's own table, reduced to the columns the link reads.
  async function withUsers(users: Array<{ id: string; email: string; verified: boolean }>) {
    const db = await freshDb();
    await migrate(db);
    await db.query('CREATE TABLE baarali.users (id text PRIMARY KEY, email text NOT NULL, "emailVerified" boolean NOT NULL)');
    for (const u of users) await db.query('INSERT INTO baarali.users VALUES ($1, $2, $3)', [u.id, u.email, u.verified]);
    const store = new PgStore(db, [PLAN]);
    await store.upsertAccount({ ...ME, id: 'owner', email: 'Me@Example.test' });
    return store;
  }

  it('links the owner to the user who signed in with its email, verified', async () => {
    const store = await withUsers([{ id: 'user_1', email: 'me@example.test', verified: true }]);
    // The account the sign-in created first, on Découverte, is set aside.
    await store.upsertAccount({ ...ME, id: 'user_1', planId: 'decouverte' });
    expect(await store.linkUserByVerifiedEmail('owner', 'Me@Example.test')).toBe(true);
    expect((await store.accountForUser('user_1'))?.id).toBe('owner');
    expect(await store.linkUserByVerifiedEmail('owner', 'Me@Example.test')).toBe(false);
  });

  it('never links an unverified email, nor a user already linked', async () => {
    const store = await withUsers([{ id: 'user_1', email: 'me@example.test', verified: false }]);
    expect(await store.linkUserByVerifiedEmail('owner', 'me@example.test')).toBe(false);
    expect(await store.accountForUser('user_1')).toBeNull();
  });
});

describe('migrations', () => {
  it('apply once, and again is a no-op', async () => {
    const db = await freshDb();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await migrate(db)).toBe(0);
  });

  it('rename the former `warell` schema in place, data and all', async () => {
    const db = await freshDb();
    await db.query('DROP SCHEMA IF EXISTS warell CASCADE');
    await migrate(db);
    await db.query('ALTER SCHEMA baarali RENAME TO warell');
    await db.query("INSERT INTO warell.accounts (id, plan_id) VALUES ('acc_old', 'essentiel')");
    expect(await migrate(db)).toBe(0);
    const { rows } = await db.query<{ id: string }>('SELECT id FROM baarali.accounts');
    expect(rows.map((r) => r.id)).toEqual(['acc_old']);
    const left = await db.query("SELECT 1 FROM pg_namespace WHERE nspname = 'warell'");
    expect(left.rows).toHaveLength(0);
  });

  it('keep the media ledger append only', async () => {
    const db = await freshDb();
    await migrate(db);
    const store = new PgStore(db, [PLAN]);
    await store.upsertAccount(ME);
    await store.applyMediaEntry({ accountId: ME.id, at: T0, kind: 'topup', credits: 10, reference: 'p' });
    await expect(db.query('UPDATE baarali.media_ledger SET credits = 1000 WHERE reference = $1', ['p'])).rejects.toThrow(/append only/);
    await expect(db.query('DELETE FROM baarali.media_ledger WHERE reference = $1', ['p'])).rejects.toThrow(/append only/);
  });

  it('keep an account\'s plan when it is upserted again, as at every boot', async () => {
    const db = await freshDb();
    await migrate(db);
    const store = new PgStore(db, [PLAN]);
    await store.upsertAccount(ME);
    await store.setPlan(ME.id, 'pro');
    // The owner's account at the next boot, BAARALI_PLAN_ID unchanged.
    await store.upsertAccount({ ...ME, email: 'new@example.test' });
    expect(await store.account(ME.id)).toEqual({ ...ME, email: 'new@example.test', planId: 'pro' });
  });

  it('keep the console journal append only', async () => {
    const db = await freshDb();
    await migrate(db);
    const store = new PgStore(db, [PLAN]);
    await store.appendAdminLog({ at: T0, actor: 'a@x', action: 'plan', accountId: null, detail: 'A → B' });
    await expect(db.query("UPDATE baarali.admin_log SET detail = 'rien'")).rejects.toThrow(/append only/);
    await expect(db.query('DELETE FROM baarali.admin_log')).rejects.toThrow(/append only/);
  });
});
