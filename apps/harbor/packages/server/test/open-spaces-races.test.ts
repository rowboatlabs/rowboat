import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import { MemoryBlobStore, blobHash } from '../src/blobs.js';
import { SpaceHub } from '../src/hub.js';
import { PgStore } from '../src/pg-store.js';
import { HarborService } from '../src/service.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb } from '../src/sql.js';
import type { StoredEvent } from '../src/store.js';
import type { RunningHarbor } from '../src/server.js';
import { liveClient, restClient, startTestHarbor } from './helpers.js';

// Controlled failures prove the transaction boundary rather than relying on timing (spec §5, 2026-09-23).
class RacingStore extends PgStore {
  removeBeforeLock: string | undefined;
  failAppend = false;
  override async withSpaceLock<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
    if (this.removeBeforeLock) {
      const memberId = this.removeBeforeLock;
      this.removeBeforeLock = undefined;
      await this.deleteMembership(spaceId, memberId);
      await this.deleteReadMarks(spaceId, memberId);
    }
    return super.withSpaceLock(spaceId, fn);
  }
  override async appendEvent(spaceId: string, event: StoredEvent): Promise<void> {
    await super.appendEvent(spaceId, event);
    if (this.failAppend) throw new Error('injected append failure');
  }
}

describe('open-space transactional boundaries', () => {
  let db: SqlDb;
  let store: RacingStore;
  let hub: SpaceHub;
  let service: HarborService;
  let spaceId: string;
  let root: string;
  beforeAll(async () => {
    db = await pgliteDb();
    store = new RacingStore(db);
    await store.init();
    hub = new SpaceHub();
    service = new HarborService(store, hub, { name: 'Race org', address: 'race.test' }, new MemoryBlobStore());
    for (const id of ['owner', 'reader']) await store.putMember({ id, displayName: id, role: 'member' });
    spaceId = (await service.createSpace({ memberId: 'owner' }, 'Open', 'open')).id;
    root = (await service.postMessage({ memberId: 'owner' }, spaceId, { body: 'root', actingMode: 'direct' })).message.id;
  });
  afterAll(async () => { await db.close(); });

  it('rolls back membership and events without notifying when join fails', async () => {
    const frames: ServerFrame[] = [];
    const unsubSpace = hub.subscribe(spaceId, (f) => frames.push(f));
    const unsubMember = hub.subscribeMember('reader', (f) => frames.push(f));
    const head = await store.head(spaceId);
    store.failAppend = true;
    try {
      await expect(service.joinSpace({ memberId: 'reader' }, spaceId)).rejects.toThrow('injected append failure');
      expect(await store.getMembership(spaceId, 'reader')).toBeUndefined();
      expect(await store.head(spaceId)).toBe(head);
      expect(frames).toEqual([]);
    } finally { store.failAppend = false; unsubSpace(); unsubMember(); }
  });

  it('rechecks membership for content, personal state, invitations and ephemeral publication', async () => {
    const ctx = { memberId: 'reader' };
    const bytes = Buffer.from('late upload');
    const calls = [
      () => service.uploadBlob(ctx, spaceId, bytes, { declaredSha256: blobHash(bytes) }),
      () => service.postMessage(ctx, spaceId, { body: 'late', actingMode: 'direct' }),
      () => service.createAsset(ctx, spaceId, { path: 'late.md', newContent: 'late', actingMode: 'direct' }),
      () => service.markRead(ctx, spaceId, { offset: 1 }),
      () => service.followThread(ctx, spaceId, root, true),
      () => service.createInvite(ctx, spaceId),
      () => service.readAll(ctx, { spaceId }),
      () => service.publishPresence(ctx, spaceId, 'typing'),
      () => service.publishWhiteboard(ctx, spaceId, 'board', {}),
    ];
    for (const call of calls) {
      await service.joinSpace(ctx, spaceId);
      const head = await store.head(spaceId);
      const frames: ServerFrame[] = [];
      const unsub = hub.subscribe(spaceId, (f) => frames.push(f));
      store.removeBeforeLock = ctx.memberId;
      try {
        await expect(call()).rejects.toMatchObject({ code: 'forbidden', message: 'join this space to post' });
        expect(await store.head(spaceId)).toBe(head);
        expect(await store.getMembership(spaceId, ctx.memberId)).toBeUndefined();
        expect(await store.getThreadReadMark(spaceId, root, ctx.memberId)).toBeUndefined();
        expect(frames).toEqual([]);
        expect(await store.getSpaceBlob(spaceId, blobHash(bytes))).toBeUndefined();
        await expect(service.listStream(ctx, spaceId)).resolves.toBeDefined();
      } finally { unsub(); }
    }
  });
});

describe('pending preview subscriptions', () => {
  let harbor: RunningHarbor;
  let spaceId: string;
  beforeAll(async () => {
    harbor = await startTestHarbor({ seedMembers: [{ id: 'owner', displayName: 'Owner' }, { id: 'reader', displayName: 'Reader' }] });
    spaceId = (await harbor.service.createSpace({ memberId: 'owner' }, 'Open', 'open')).id;
  });
  afterAll(async () => { await harbor.close(); });

  it('a replaced replay cannot acknowledge or deliver after the newer subscription', async () => {
    const live = await liveClient(harbor, 'dev-reader');
    const replay = harbor.service.replay.bind(harbor.service);
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const spy = vi.spyOn(harbor.service, 'replay').mockImplementationOnce(async (...args) => {
      const result = await replay(...args);
      entered();
      await paused;
      return result;
    });
    try {
      live.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
      await started;
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'));
      release();
      // The write supplies an observable barrier after the old replay resumes.
      await restClient(harbor, 'dev-owner').post(`/v1/spaces/${spaceId}/messages`, { body: 'barrier', actingMode: 'direct' });
      await live.until((fs) => fs.some((f) => f.kind === 'event' && f.event.type === 'message'));
      expect(live.frames.filter((f) => f.kind === 'subscribed')).toHaveLength(1);
      expect(live.events()).toHaveLength(1);
    } finally { release(); spy.mockRestore(); live.close(); }
  });

  it('departure cancels pending replay and an explicit new subscription can browse', async () => {
    await harbor.service.joinSpace({ memberId: 'reader' }, spaceId);
    const live = await liveClient(harbor, 'dev-reader');
    const replay = harbor.service.replay.bind(harbor.service);
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const spy = vi.spyOn(harbor.service, 'replay').mockImplementationOnce(async (...args) => {
      const result = await replay(...args);
      entered();
      await paused;
      return result;
    });
    try {
      live.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
      await started;
      await harbor.service.leaveSpace({ memberId: 'reader' }, spaceId);
      await live.until((fs) => fs.some((f) => f.kind === 'space_removed'));
      release();
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'));
      expect(live.frames.filter((f) => f.kind === 'subscribed')).toHaveLength(1);
      expect(live.events()).toHaveLength(0);
    } finally { release(); spy.mockRestore(); live.close(); }
  });
});
