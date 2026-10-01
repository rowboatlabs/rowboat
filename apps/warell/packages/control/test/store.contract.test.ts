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
// moments to rebuild. Every test starts from an empty `warell` schema.
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
}, 60_000);

async function freshDb() {
  const db = pgliteDb(pg);
  await db.query('DROP SCHEMA IF EXISTS warell CASCADE');
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

  it('lets only one of two simultaneous charges spend the same credits', async () => {
    const store = await make();
    await store.applyMediaEntry({ accountId: ME.id, at: T0, kind: 'topup', credits: 50, reference: 'pay' });
    const results = await Promise.all(
      ['a', 'b'].map((r) => store.applyMediaEntry({ accountId: ME.id, at: T0, kind: 'charge', credits: -40, reference: r })),
    );
    expect(results.sort()).toEqual(['applied', 'insufficient']);
    expect(await store.mediaBalance(ME.id)).toBe(10);
  });

  it('appends usage without failing', async () => {
    const store = await make();
    await store.appendUsage({
      accountId: ME.id, at: T0, path: '/chat/completions', model: 'deepseek/deepseek-v4.1-flash', requestedModel: null,
      status: 200, credits: 12345, estimated: false, useCase: 'chat', agentName: 'copilot',
    });
  });
});

describe('migrations', () => {
  it('apply once, and again is a no-op', async () => {
    const db = await freshDb();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await migrate(db)).toBe(0);
  });

  it('keep the media ledger append only', async () => {
    const db = await freshDb();
    await migrate(db);
    const store = new PgStore(db, [PLAN]);
    await store.upsertAccount(ME);
    await store.applyMediaEntry({ accountId: ME.id, at: T0, kind: 'topup', credits: 10, reference: 'p' });
    await expect(db.query('UPDATE warell.media_ledger SET credits = 1000 WHERE reference = $1', ['p'])).rejects.toThrow(/append only/);
    await expect(db.query('DELETE FROM warell.media_ledger WHERE reference = $1', ['p'])).rejects.toThrow(/append only/);
  });
});
