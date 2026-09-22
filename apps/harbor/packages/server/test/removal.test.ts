import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import { SpaceHub } from '../src/hub.js';
import { PgStore } from '../src/pg-store.js';
import type { RunningHarbor } from '../src/server.js';
import { HarborService } from '../src/service.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb } from '../src/sql.js';
import { liveClient, restClient, startTestHarbor } from './helpers.js';

// The removal primitives (2026-09-22): a member's write re-verifies access
// inside the space lock, and a departure ends live delivery. Both exist so
// that a membership ending — a leave today, an admin's removal tomorrow —
// can leave neither an act on the log after the `left` event nor frames on
// a socket after it.

/** A store whose lock lets the membership vanish between the gate and the transaction — the race, made deterministic. */
class RacingStore extends PgStore {
  dropBeforeLock: { spaceId: string; memberId: string } | undefined;
  override async withSpaceLock<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
    const drop = this.dropBeforeLock;
    if (drop && drop.spaceId === spaceId) {
      this.dropBeforeLock = undefined;
      await this.deleteMembership(spaceId, drop.memberId); // on the pool, committed: the removal that won the race
    }
    return super.withSpaceLock(spaceId, fn);
  }
}

describe("a member's write re-verifies access inside the lock", () => {
  let db: SqlDb;
  let store: RacingStore;
  let service: HarborService;
  let spaceId: string;

  async function join(memberId: string): Promise<void> {
    const invite = await service.createInvite({ memberId: 'ramnique' }, spaceId);
    await service.acceptInvite({ memberId }, invite.token);
  }

  beforeAll(async () => {
    db = await pgliteDb();
    store = new RacingStore(db);
    await store.init();
    service = new HarborService(store, new SpaceHub(), { name: 'Org', address: 'org.test' });
    for (const id of ['ramnique', 'gagan']) await store.putMember({ id, displayName: id, role: 'member' });
    spaceId = (await service.createSpace({ memberId: 'ramnique' }, 'Main')).id;
    await join('gagan');
  });
  afterAll(async () => {
    await db.close();
  });

  it('a post that passed the gate but lost the race to a removal is refused, and nothing lands', async () => {
    const headBefore = await store.head(spaceId);
    store.dropBeforeLock = { spaceId, memberId: 'gagan' };
    await expect(
      service.postMessage({ memberId: 'gagan' }, spaceId, { body: 'too late', actingMode: 'direct' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await store.head(spaceId)).toBe(headBefore);
    expect(await store.listStream(spaceId)).toEqual([]);
    expect(await store.getMembership(spaceId, 'gagan')).toBeUndefined(); // the removal stood; the write did not
  });

  it('the same race on a file write is refused the same way', async () => {
    const { asset } = await service.createAsset({ memberId: 'ramnique' }, spaceId, { path: 'a.md', newContent: 'a\n', actingMode: 'direct' });
    await join('gagan');
    store.dropBeforeLock = { spaceId, memberId: 'gagan' };
    await expect(
      service.proposeChange({ memberId: 'gagan' }, spaceId, { assetId: asset.id, baseVersion: 1, newContent: 'b\n', actingMode: 'direct' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await service.readAsset({ memberId: 'ramnique' }, spaceId, asset.id)).version).toBe(1);
  });

  it('with no race, the same writes land', async () => {
    await join('gagan');
    const { message } = await service.postMessage({ memberId: 'gagan' }, spaceId, { body: 'in time', actingMode: 'direct' });
    expect((await store.listStream(spaceId)).map((m) => m.id)).toEqual([message.id]);
  });
});

describe('leaving ends live delivery', () => {
  let harbor: RunningHarbor;
  let spaceId: string;

  beforeAll(async () => {
    harbor = await startTestHarbor({
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'gagan', displayName: 'Gagan' },
      ],
      seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
    });
    spaceId = (await harbor.service.listSpaces({ memberId: 'ramnique' }))[0]!.id;
  });
  afterAll(async () => {
    await harbor.close();
  });

  it('the leaver gets space_removed, the subscription is dropped before it, and re-subscribing is refused', async () => {
    const gagan = await liveClient(harbor, 'dev-gagan');
    gagan.send({ kind: 'subscribe', spaceId });
    await gagan.until((fs) => fs.some((f) => f.kind === 'subscribed'), 'subscribed');

    expect((await restClient(harbor, 'dev-gagan').post(`/v1/spaces/${spaceId}/leave`)).status).toBe(200);
    await gagan.until((fs) => fs.some((f) => f.kind === 'space_removed'), 'space_removed');
    expect(gagan.frames.find((f) => f.kind === 'space_removed')).toMatchObject({ kind: 'space_removed', spaceId, by: 'gagan' });

    // The `left` event may have reached the socket before the frame; nothing after it does.
    const eventsAtDeparture = gagan.frames.filter((f) => f.kind === 'event').length;
    await harbor.service.postMessage({ memberId: 'ramnique' }, spaceId, { body: 'after gagan left', actingMode: 'direct' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(gagan.frames.filter((f) => f.kind === 'event').length).toBe(eventsAtDeparture);

    gagan.send({ kind: 'subscribe', spaceId });
    await gagan.until((fs) => fs.some((f) => f.kind === 'error'), 'refused');
    expect((gagan.frames.find((f) => f.kind === 'error') as Extract<ServerFrame, { kind: 'error' }>).code).toBe('forbidden');
    gagan.close();
  });
});
