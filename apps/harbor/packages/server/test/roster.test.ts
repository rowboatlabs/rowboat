import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decideNotifications } from '../src/notify.js';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb } from '../src/sql.js';
import { restClient } from './helpers.js';

// Rosters are one statement (2026-09-22). These pin the count so the
// one-member-at-a-time loop cannot come back unnoticed: on Postgres each
// query is a round trip, and a roster is read on every search, every posted
// message, and every agent read of a stream.

let db: SqlDb;
let harbor: RunningHarbor;
let statements = 0;
let main: string;

beforeAll(async () => {
  db = await pgliteDb();
  const counting: SqlDb = {
    ...db,
    async query<R>(text: string, params?: unknown[]): Promise<R[]> {
      statements += 1;
      return db.query<R>(text, params);
    },
  };
  const store = new PgStore(counting);
  await store.init();
  harbor = await startHarbor({
    store,
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'harsh' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'loner', displayName: 'Loner' },
    ],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  });
  main = (await harbor.service.listSpaces({ memberId: 'ramnique' }))[0]!.id;
  // A DM makes gagan reachable to ramnique through a second space; loner shares nothing (seed spaces take everyone, so leave).
  await restClient(harbor, 'dev-loner').post(`/v1/spaces/${main}/leave`);
});
afterAll(async () => {
  await harbor.close();
  await db.close();
});

/** The write path notifies fire-and-forget; wait until no statement has run for a beat. */
async function settled(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    statements = 0;
    await new Promise((r) => setTimeout(r, 25));
    if (statements === 0) return;
  }
  throw new Error('background work never settled');
}

const count = async <T,>(fn: () => Promise<T>): Promise<{ result: T; statements: number }> => {
  statements = 0;
  const result = await fn();
  return { result, statements };
};

describe('rosters are one statement', () => {
  it('listMembers: the gate (space + membership) and the roster — three statements, join order', async () => {
    const { result, statements: n } = await count(() => harbor.service.listMembers({ memberId: 'ramnique' }, main));
    expect(n).toBe(3);
    expect(result.map((m) => m.id)).toEqual(['ramnique', 'harsh', 'gagan']);
  });

  it('listOrgMembers: one statement, the caller included, sorted by name case-insensitively', async () => {
    const { result, statements: n } = await count(() => harbor.service.listOrgMembers({ memberId: 'ramnique' }));
    expect(n).toBe(1);
    expect(result.map((m) => m.id)).toEqual(['gagan', 'harsh', 'ramnique']);
    const alone = await count(() => harbor.service.listOrgMembers({ memberId: 'loner' }));
    expect(alone.statements).toBe(1);
    expect(alone.result.map((m) => m.id)).toEqual(['loner']);
  });

  it('the notification decision reads the roster once for a root message', async () => {
    const { message } = await harbor.service.postMessage({ memberId: 'ramnique' }, main, { body: 'hello', actingMode: 'direct' });
    const space = (await harbor.service.listSpaces({ memberId: 'ramnique' }))[0]!;
    await settled(); // the post's own fire-and-forget notifier must not be counted
    const { result, statements: n } = await count(() => decideNotifications(harbor.store, space, message));
    expect(n).toBe(1);
    expect(result.map((r) => r.memberId).sort()).toEqual(['gagan', 'harsh']);
  });
});
