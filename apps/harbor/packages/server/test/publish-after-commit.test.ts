import { describe, expect, it } from 'vitest';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import { SpaceHub } from '../src/hub.js';
import { MemoryStore } from '../src/memory-store.js';
import { HarborService } from '../src/service.js';

// Publish after commit (2026-09-11): a durable event's frame reaches the hub
// only once the space lock — the transaction, on Postgres — has returned.
// The store below makes the commit observable: `committed` flips after the
// locked function resolves, the way COMMIT follows the callback.

class CommitStore extends MemoryStore {
  committed = 0;
  rollbacks = 0;
  override async withSpaceLock<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await super.withSpaceLock(spaceId, fn);
      this.committed += 1;
      return result;
    } catch (err) {
      this.rollbacks += 1;
      throw err;
    }
  }
}

async function setup() {
  const store = new CommitStore();
  const hub = new SpaceHub();
  const service = new HarborService(store, hub, { name: 'Org', address: 'org.test' });
  await store.putMember({ id: 'ramnique', displayName: 'Ramnique', role: 'member' });
  const space = await service.createSpace({ memberId: 'ramnique' }, 'Main');
  return { store, hub, service, space };
}

describe('publish after commit', () => {
  it('every event frame arrives after the lock has committed, in order', async () => {
    const { store, hub, service, space } = await setup();
    const seen: Array<{ kind: string; committedAtArrival: number }> = [];
    hub.subscribe(space.id, (frame: ServerFrame) => seen.push({ kind: frame.kind, committedAtArrival: store.committed }));
    const before = store.committed;
    const { message } = await service.postMessage({ memberId: 'ramnique' }, space.id, { body: 'hello', actingMode: 'direct' });
    await service.postMessage({ memberId: 'ramnique' }, space.id, { body: 'a reply', actingMode: 'direct', threadRoot: message.id });
    expect(seen.map((s) => s.kind)).toEqual(['event', 'event']);
    // The first frame saw the first commit already counted, the second the second.
    expect(seen.map((s) => s.committedAtArrival)).toEqual([before + 1, before + 2]);
  });

  it('a thrown lock publishes nothing — no phantoms on a rollback', async () => {
    const { store, hub, service, space } = await setup();
    const seen: ServerFrame[] = [];
    hub.subscribe(space.id, (frame) => seen.push(frame));
    // The event is appended, then a later step inside the same lock throws:
    // the transaction rolls back, and the frame that was already parked in
    // the outbox must never leave (before the fix it had gone out already).
    store.advanceStreamReadMark = async () => {
      throw new Error('disk on fire');
    };
    await expect(service.postMessage({ memberId: 'ramnique' }, space.id, { body: 'doomed', actingMode: 'direct' })).rejects.toThrow('disk on fire');
    expect(store.rollbacks).toBe(1);
    expect(seen).toEqual([]);
  });
});
