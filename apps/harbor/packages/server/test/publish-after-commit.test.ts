import { describe, expect, it } from 'vitest';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import { SpaceHub } from '../src/hub.js';
import { PgStore } from '../src/pg-store.js';
import { HarborService } from '../src/service.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb, SqlExecutor } from '../src/sql.js';

// Publish after commit (2026-09-11): a durable event's frame reaches the hub
// only once the space lock — the transaction — has returned. Over a real
// Postgres transaction: the SqlDb below counts COMMITs and ROLLBACKs as they
// happen, and a rolled-back write is checked to have left no row behind.

async function setup() {
  const db = await pgliteDb();
  const counts = { committed: 0, rollbacks: 0 };
  const counting: SqlDb = {
    ...db,
    async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      try {
        const result = await db.withTransaction(fn);
        counts.committed += 1;
        return result;
      } catch (err) {
        counts.rollbacks += 1;
        throw err;
      }
    },
  };
  const store = new PgStore(counting);
  await store.init();
  const hub = new SpaceHub();
  const service = new HarborService(store, hub, { name: 'Org', address: 'org.test' });
  await store.putMember({ id: 'ramnique', displayName: 'Ramnique', role: 'member' });
  const space = await service.createSpace({ memberId: 'ramnique' }, 'Main');
  return { db, store, hub, service, space, counts };
}

describe('publish after commit', () => {
  it('every event frame arrives after its transaction committed, in order', async () => {
    const { db, hub, service, space, counts } = await setup();
    const seen: Array<{ kind: string; committedAtArrival: number }> = [];
    hub.subscribe(space.id, (frame: ServerFrame) => seen.push({ kind: frame.kind, committedAtArrival: counts.committed }));
    const before = counts.committed;
    const { message } = await service.postMessage({ memberId: 'ramnique' }, space.id, { body: 'hello', actingMode: 'direct' });
    await service.postMessage({ memberId: 'ramnique' }, space.id, { body: 'a reply', actingMode: 'direct', threadRoot: message.id });
    expect(seen.map((s) => s.kind)).toEqual(['event', 'event']);
    // The first frame saw the first commit already counted, the second the second.
    expect(seen.map((s) => s.committedAtArrival)).toEqual([before + 1, before + 2]);
    await db.close();
  });

  it('a thrown lock publishes nothing and persists nothing — a real ROLLBACK, no phantoms', async () => {
    const { db, store, hub, service, space, counts } = await setup();
    const seen: ServerFrame[] = [];
    hub.subscribe(space.id, (frame) => seen.push(frame));
    const headBefore = await store.head(space.id);
    // The message row and its event are written, then a later step inside the
    // same lock throws: the transaction rolls back, and the frame that was
    // already parked in the outbox must never leave.
    store.advanceStreamReadMark = async () => {
      throw new Error('disk on fire');
    };
    await expect(service.postMessage({ memberId: 'ramnique' }, space.id, { body: 'doomed', actingMode: 'direct' })).rejects.toThrow('disk on fire');
    expect(counts.rollbacks).toBe(1);
    expect(seen).toEqual([]);
    // What a fake commit counter could never say: the rows are gone too.
    expect(await store.listStream(space.id)).toEqual([]);
    expect(await store.head(space.id)).toBe(headBefore);
    await db.close();
  });
});
