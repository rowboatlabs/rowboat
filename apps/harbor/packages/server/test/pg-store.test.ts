import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMember } from '../src/auth.js';
import { SpaceHub } from '../src/hub.js';
import { PgStore } from '../src/pg-store.js';
import { HarborService } from '../src/service.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';

// Store-level paths the §11 day doesn't walk, exercised on real Postgres
// through the real service (no HTTP — this is the storage contract, not the
// wire one): history pagination, merge_into reassignment, invite expiry,
// archived filtering, search over jsonb-backed rows.

let db: SqlDb;
let store: PgStore;
let service: HarborService;
let spaceId: string;

const ram = { memberId: 'ramnique' };
const gagan = { memberId: 'gagan' };

beforeAll(async () => {
  db = await pgliteDb();
  store = new PgStore(db);
  await store.init();
  service = new HarborService(store, new SpaceHub(), { name: 'PG Org', address: 'pg.test' });
  await ensureMember(store, 'ramnique');
  await ensureMember(store, 'gagan');
  const space = await service.createSpace(ram, 'PG Space');
  spaceId = space.id;
  const invite = await service.createInvite(ram, spaceId);
  await service.acceptInvite(gagan, invite.token);
});

afterAll(async () => {
  await db.close();
});

describe('PgStore through the service', () => {
  it('history pagination pages backwards without gaps or repeats', async () => {
    for (let i = 0; i < 7; i++) {
      const head = i === 0 ? 0 : (await service.readAsset(ram, spaceId, 'log.md')).version;
      const r = await service.proposeChange(ram, spaceId, {
        assetPath: 'log.md',
        baseVersion: head,
        newContent: `line\n`.repeat(i + 1),
        reason: `edit ${i + 1}`,
        actingMode: 'direct',
      });
      expect(r.outcome).toBe('applied');
    }
    const page1 = await service.assetHistory(ram, spaceId, { path: 'log.md', limit: 3 });
    expect(page1.map((cs) => cs.resultVersion)).toEqual([7, 6, 5]);
    const page2 = await service.assetHistory(ram, spaceId, {
      path: 'log.md',
      beforeOffset: page1.at(-1)!.offset,
      limit: 3,
    });
    expect(page2.map((cs) => cs.resultVersion)).toEqual([4, 3, 2]);
    const page3 = await service.assetHistory(ram, spaceId, {
      path: 'log.md',
      beforeOffset: page2.at(-1)!.offset,
      limit: 3,
    });
    expect(page3.map((cs) => cs.resultVersion)).toEqual([1]);
  });

  it('time-travel reads reconstruct any version with history filtered to it', async () => {
    const v3 = await service.readAsset(ram, spaceId, 'log.md', 3);
    expect(v3.content).toBe('line\n'.repeat(3));
    expect(v3.recentHistory.every((cs) => cs.resultVersion <= 3)).toBe(true);
  });

  it('merge_into repoints messages in order, archives the source, survives round-trip', async () => {
    const a = await service.postMessage(ram, spaceId, { body: 'Topic A', actingMode: 'direct' });
    const b = await service.postMessage(gagan, spaceId, { body: 'Topic B', actingMode: 'direct' });
    await service.postMessage(gagan, spaceId, { topicId: b.topic.id, body: 'B follow-up', actingMode: 'direct' });

    const merged = await service.manageTopic(ram, spaceId, b.topic.id, {
      action: 'merge_into',
      targetTopicId: a.topic.id,
    });
    expect(merged.id).toBe(a.topic.id);
    expect(merged.messageCount).toBe(3);

    const thread = await service.listMessages(ram, spaceId, a.topic.id);
    expect(thread.messages.map((m) => m.body)).toEqual(['Topic A', 'Topic B', 'B follow-up']);

    const visible = await service.listTopics(ram, spaceId, false);
    expect(visible.map((t) => t.id)).not.toContain(b.topic.id);
    const all = await service.listTopics(ram, spaceId, true);
    expect(all.find((t) => t.id === b.topic.id)?.archived).toBe(true);
  });

  it('search finds title and body matches across jsonb-backed rows', async () => {
    await service.postMessage(ram, spaceId, { body: 'Webhook retry strategy\nexponential backoff', actingMode: 'direct' });
    const byTitle = await service.searchFeed(ram, spaceId, 'webhook retry');
    expect(byTitle.length).toBe(1);
    const byBody = await service.searchFeed(ram, spaceId, 'exponential');
    expect(byBody.length).toBe(1);
    expect(byBody[0]!.snippet).toContain('exponential');
  });

  it('invite expiry round-trips through storage', async () => {
    const invite = await service.createInvite(ram, spaceId, 1);
    const stored = await store.getInvite(invite.token);
    expect(stored?.expiresAt).toBe(invite.expiresAt);
    await store.putInvite({ ...stored!, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await service.resolveInvite(invite.token)).toEqual({ state: 'expired' });
  });

  it('attribution jsonb survives storage byte-for-byte', async () => {
    const r = await service.proposeChange(gagan, spaceId, {
      assetPath: 'log.md',
      baseVersion: (await service.readAsset(gagan, spaceId, 'log.md')).version,
      newContent: 'rewritten\n',
      reason: 'agent push',
      actingMode: 'agent',
      agentName: 'Claude Code',
    });
    expect(r.outcome).toBe('applied');
    if (r.outcome !== 'applied') return;
    const reread = await store.getChangeSet(spaceId, r.changeSet.id);
    expect(reread?.attribution).toEqual({ memberId: 'gagan', actingMode: 'agent', agentName: 'Claude Code' });
  });

  it('identity mapping: (iss, sub) → member, upsert repoints, unmapped is undefined', async () => {
    const iss = 'https://as.example/auth/v1';
    expect(await store.getMemberByIdentity(iss, 'sub-1')).toBeUndefined();
    await store.putIdentity(iss, 'sub-1', 'ramnique');
    expect((await store.getMemberByIdentity(iss, 'sub-1'))?.id).toBe('ramnique');
    // Same sub under another issuer is a different identity (spec §4 namespacing).
    expect(await store.getMemberByIdentity('https://other.example', 'sub-1')).toBeUndefined();
    await store.putIdentity(iss, 'sub-1', 'gagan');
    expect((await store.getMemberByIdentity(iss, 'sub-1'))?.id).toBe('gagan');
  });
});
