import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMember } from '../src/auth.js';
import { SpaceHub } from '../src/hub.js';
import { PgStore } from '../src/pg-store.js';
import { HarborService } from '../src/service.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from '../src/sql-pglite.js';

// Store-level paths the §11 day doesn't walk, exercised on real Postgres
// through the real service (no HTTP — this is the storage contract, not the
// wire one): history pagination, thread pointers + reply denorm, topic
// lifecycle, invite expiry, search over jsonb-backed rows.

let db: SqlDb;
let store: PgStore;
let service: HarborService;
let spaceId: string;
/** log.md's id — files are addressed by id (2026-09-14); the path is a display property. */
let logId: string;

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
    const born = await service.createAsset(ram, spaceId, {
      path: 'log.md',
      newContent: 'line\n',
      reason: 'edit 1',
      actingMode: 'direct',
    });
    logId = born.asset.id;
    expect(born.changeSet).toMatchObject({ assetId: logId, assetPath: 'log.md', baseVersion: 0, resultVersion: 1 });
    for (let i = 1; i < 7; i++) {
      const head = (await service.readAsset(ram, spaceId, logId)).version;
      const r = await service.proposeChange(ram, spaceId, {
        assetId: logId,
        baseVersion: head,
        newContent: `line\n`.repeat(i + 1),
        reason: `edit ${i + 1}`,
        actingMode: 'direct',
      });
      expect(r.outcome).toBe('applied');
    }
    const page1 = await service.assetHistory(ram, spaceId, { assetId: logId, limit: 3 });
    expect(page1.map((cs) => cs.resultVersion)).toEqual([7, 6, 5]);
    const page2 = await service.assetHistory(ram, spaceId, {
      assetId: logId,
      beforeOffset: page1.at(-1)!.offset,
      limit: 3,
    });
    expect(page2.map((cs) => cs.resultVersion)).toEqual([4, 3, 2]);
    const page3 = await service.assetHistory(ram, spaceId, {
      assetId: logId,
      beforeOffset: page2.at(-1)!.offset,
      limit: 3,
    });
    expect(page3.map((cs) => cs.resultVersion)).toEqual([1]);
    // An unknown id is an empty lineage, not an error.
    expect(await service.assetHistory(ram, spaceId, { assetId: 'no-such-asset', limit: 3 })).toEqual([]);
  });

  it('time-travel reads reconstruct any version with history filtered to it', async () => {
    const v3 = await service.readAsset(ram, spaceId, logId, 3);
    expect(v3).toMatchObject({ id: logId, path: 'log.md', version: 3 });
    expect(v3.content).toBe('line\n'.repeat(3));
    expect(v3.recentHistory.every((cs) => cs.resultVersion <= 3)).toBe(true);
  });

  it('thread pointers and the reply denorm hold on Postgres; topic lifecycle is one-row', async () => {
    const a = await service.postMessage(ram, spaceId, { body: 'Root A', actingMode: 'direct' });
    const reply = await service.postMessage(gagan, spaceId, { threadRoot: a.message.id, body: 'A follow-up', actingMode: 'direct' });
    expect(reply.message.threadRoot).toBe(a.message.id);

    const root = await store.getMessage(spaceId, a.message.id);
    expect(root?.replyCount).toBe(1);
    expect(root?.lastReplyAt).toBe(reply.message.postedAt);

    const { topic } = await service.createTopic(ram, spaceId, {
      rootMessageId: a.message.id,
      title: 'Decide: root A things',
      actingMode: 'direct',
    });
    const visible = await service.listTopics(ram, spaceId, false);
    expect(visible.map((t) => t.id)).toContain(topic.id);

    await service.manageTopic(ram, spaceId, topic.id, { action: 'archive', actingMode: 'direct' });
    expect((await service.listTopics(ram, spaceId, false)).map((t) => t.id)).not.toContain(topic.id);
    expect((await service.listTopics(ram, spaceId, true)).find((t) => t.id === topic.id)?.archived).toBe(true);

    // Remove: the row goes, the thread is untouched, on real Postgres.
    await service.manageTopic(ram, spaceId, topic.id, { action: 'remove', actingMode: 'direct' });
    expect(await store.getTopicByRoot(spaceId, a.message.id)).toBeUndefined();
    const thread = await service.listThread(ram, spaceId, a.message.id);
    expect(thread.topic).toBeNull();
    expect(thread.messages.map((m) => m.body)).toEqual(['A follow-up']);
  });

  it('a topic\'s document is the asset id on the row, carried through rename and trash (migrations 019/020)', async () => {
    const { asset } = await service.createAsset(ram, spaceId, { path: 'brief.md', newContent: '# Brief\n', actingMode: 'direct' });
    const b = await service.postMessage(ram, spaceId, { body: 'Root B', actingMode: 'direct' });
    const { topic } = await service.createTopic(ram, spaceId, {
      rootMessageId: b.message.id,
      title: 'Review: the brief',
      documentAssetId: asset.id,
      actingMode: 'direct',
    });
    expect(topic.documentAssetId).toBe(asset.id);
    // The row carries the id; putTopic (a retitle) must not disturb it.
    expect((await store.getTopic(spaceId, topic.id))?.documentAssetId).toBe(asset.id);
    const retitled = await service.manageTopic(ram, spaceId, topic.id, { action: 'retitle', title: 'Review: the brief (v2)', actingMode: 'direct' });
    expect(retitled.documentAssetId).toBe(asset.id);

    // Rename → the link is by id, so nothing on the topic changes; the
    // getTopicByRoot and thread paths carry the same id.
    await service.moveAsset(ram, spaceId, { assetId: asset.id, toPath: 'journal.md', baseVersion: 1, actingMode: 'direct' });
    expect((await store.getTopicByRoot(spaceId, b.message.id))?.documentAssetId).toBe(asset.id);
    expect((await service.listThread(ram, spaceId, b.message.id)).topic?.documentAssetId).toBe(asset.id);
    expect((await service.readAsset(ram, spaceId, asset.id)).path).toBe('journal.md');

    // Trash → the id is still projected (the client decides what to show);
    // detach is a real change, and a second detach is a no-op.
    await service.deleteAsset(ram, spaceId, { assetId: asset.id, baseVersion: 1, actingMode: 'direct' });
    expect((await store.getTopic(spaceId, topic.id))?.documentAssetId).toBe(asset.id);
    const detached = await service.manageTopic(ram, spaceId, topic.id, { action: 'detach_document', actingMode: 'direct' });
    expect(detached.documentAssetId).toBeUndefined();
    expect((await store.getTopic(spaceId, topic.id))?.documentAssetId).toBeUndefined();
    await service.manageTopic(ram, spaceId, topic.id, { action: 'detach_document', actingMode: 'direct' });
    // A trashed file cannot be attached; restore it, attach, and attaching the same id again is a no-op.
    await expect(
      service.manageTopic(ram, spaceId, topic.id, { action: 'attach_document', assetId: asset.id, actingMode: 'direct' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await service.restoreAsset(ram, spaceId, { assetId: asset.id, actingMode: 'direct' });
    const attached = await service.manageTopic(ram, spaceId, topic.id, { action: 'attach_document', assetId: asset.id, actingMode: 'direct' });
    expect(attached.documentAssetId).toBe(asset.id);
    await service.manageTopic(ram, spaceId, topic.id, { action: 'attach_document', assetId: asset.id, actingMode: 'direct' });
    const events = await store.listEventsAfter(spaceId, 0);
    expect(events.filter((e) => e.event.type === 'topic' && e.event.topic.id === topic.id).map((e) => (e.event as { action: string }).action))
      .toEqual(['created', 'retitled', 'document_detached', 'document_attached']);
  });

  it('search finds topic-title and body matches across jsonb-backed rows', async () => {
    const posted = await service.postMessage(ram, spaceId, { body: 'exponential backoff, capped', actingMode: 'direct' });
    await service.createTopic(ram, spaceId, {
      rootMessageId: posted.message.id,
      title: 'Decide: webhook retry strategy',
      actingMode: 'direct',
    });
    const byTitle = await service.search(ram, spaceId, 'webhook retry');
    expect(byTitle.topics.length).toBe(1);
    expect(byTitle.topics[0]!.topic.rootMessageId).toBe(posted.message.id);
    const byBody = await service.search(ram, spaceId, 'exponential');
    expect(byBody.messages.length).toBe(1);
    expect(byBody.messages[0]!.snippet).toContain('exponential');
    expect(byBody.messages[0]!.topicTitle).toBe('Decide: webhook retry strategy');
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
      assetId: logId,
      baseVersion: (await service.readAsset(gagan, spaceId, logId)).version,
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

  it('reactions toggle on Postgres and fold on windowed reads', async () => {
    const posted = await service.postMessage(ram, spaceId, { body: 'React to me', actingMode: 'direct' });
    const messageId = posted.message.id;

    await service.reactToMessage(gagan, spaceId, messageId, { emoji: '👍', action: 'add', actingMode: 'direct' });
    const both = await service.reactToMessage(ram, spaceId, messageId, {
      emoji: '👍',
      action: 'add',
      actingMode: 'agent',
      agentName: 'Rowboat',
    });
    expect(both.reactions).toEqual([{ emoji: '👍', memberIds: ['gagan', 'ramnique'], lastOffset: expect.any(Number) }]);

    // Attribution jsonb round-trips (same guarantee change_sets has).
    const stored = await store.getReaction(spaceId, messageId, '👍', 'ramnique');
    expect(stored?.by).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });

    // Windowed stream reads fold the same state in.
    const stream = await service.listStream(ram, spaceId);
    expect(stream.messages.find((m) => m.id === messageId)?.reactions).toEqual([
      { emoji: '👍', memberIds: ['gagan', 'ramnique'], lastOffset: expect.any(Number) },
    ]);

    // Remove drops the member; removing the last drops the group.
    await service.reactToMessage(gagan, spaceId, messageId, { emoji: '👍', action: 'remove', actingMode: 'direct' });
    const last = await service.reactToMessage(ram, spaceId, messageId, { emoji: '👍', action: 'remove', actingMode: 'direct' });
    expect(last.reactions).toEqual([]);
  });

  it('deletion tombstones the row AND redacts the stored message event jsonb', async () => {
    const posted = await service.postMessage(ram, spaceId, { body: 'the secret was rosebud', actingMode: 'direct' });
    const messageId = posted.message.id;

    const deleted = await service.deleteMessage(ram, spaceId, messageId, { actingMode: 'direct' });
    expect(deleted.body).toBe('');
    expect(deleted.deletedAt).toBeTruthy();

    // The row is a tombstone.
    const reread = await store.getMessage(spaceId, messageId);
    expect(reread?.body).toBe('');
    expect(reread?.deletedAt).toBe(deleted.deletedAt);

    // The stored message event was redacted in place — replay carries no body —
    // and the message_deleted event narrates with full attribution.
    const events = await store.listEventsAfter(spaceId, 0);
    const messageEvent = events.find((e) => e.event.type === 'message' && e.event.message.id === messageId)!;
    expect(messageEvent.event).toMatchObject({ message: { body: '', deletedAt: deleted.deletedAt } });
    const deletion = events.find((e) => e.event.type === 'message_deleted')!;
    expect(deletion.event).toMatchObject({
      deletion: { messageId, by: { memberId: 'ramnique', actingMode: 'direct' } },
    });

    // Idempotent: re-deleting writes nothing new.
    const head = await store.head(spaceId);
    await service.deleteMessage(ram, spaceId, messageId, { actingMode: 'direct' });
    expect(await store.head(spaceId)).toBe(head);
  });

  it('polls round-trip through jsonb: definition on the row, votes fold, single-select move, early end', async () => {
    const posted = await service.postMessage(ram, spaceId, {
      body: '📊 **Where to?**',
      poll: { question: 'Where to?', answers: [{ text: 'A' }, { text: 'B', emoji: '🅱️' }], durationHours: 2 },
      actingMode: 'direct',
    });
    const messageId = posted.message.id;
    expect(posted.message.poll?.answers).toEqual([
      { id: 1, text: 'A' },
      { id: 2, text: 'B', emoji: '🅱️' },
    ]);

    // Votes fold from the poll_votes table; the single-select move rewrites in one lock.
    await service.votePoll(gagan, spaceId, messageId, { answerId: 1, action: 'add', actingMode: 'direct' });
    const moved = await service.votePoll(gagan, spaceId, messageId, { answerId: 2, action: 'add', actingMode: 'direct' });
    expect(moved.poll?.votes).toEqual([{ answerId: 2, memberIds: ['gagan'] }]);
    const listed = await service.listStream(ram, spaceId);
    expect(listed.messages.find((m) => m.id === messageId)?.poll?.votes).toEqual([{ answerId: 2, memberIds: ['gagan'] }]);

    // Early end stamps the row's poll jsonb; the stored message event keeps its at-post poll.
    const ended = await service.endPoll(ram, spaceId, messageId, { actingMode: 'direct' });
    expect(ended.poll?.endedAt).toBeTruthy();
    expect((await store.getMessage(spaceId, messageId))?.poll?.endedAt).toBe(ended.poll?.endedAt);
    const events = await store.listEventsAfter(spaceId, 0);
    const messageEvent = events.find((e) => e.event.type === 'message' && e.event.message.id === messageId)!;
    expect((messageEvent.event as { message: { poll?: { endedAt?: string } } }).message.poll?.endedAt).toBeUndefined();
    expect(events.some((e) => e.event.type === 'poll_ended')).toBe(true);

    // Deletion redacts the poll from the row and the stored event alike, and
    // the poll_votes rows go with it — gagan's vote on B must not outlive the poll.
    expect(await store.listPollVotesForMessages(spaceId, [messageId])).toHaveLength(1);
    const deleted = await service.deleteMessage(ram, spaceId, messageId, { actingMode: 'direct' });
    expect(deleted.poll).toBeUndefined();
    expect(await store.listPollVotesForMessages(spaceId, [messageId])).toEqual([]);
    const redacted = (await store.listEventsAfter(spaceId, 0)).find(
      (e) => e.event.type === 'message' && e.event.message.id === messageId,
    )!;
    expect((redacted.event as { message: { poll?: unknown } }).message.poll).toBeUndefined();
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

describe('migration 022 — hygiene', () => {
  it('the enum-shaped columns refuse values the code never writes', async () => {
    await expect(
      db.query(`insert into spaces (org_id, id, name, created_at, kind) values ('org-default', '01HZCHECK00000000000000000', 'x', '2026-01-01T00:00:00.000Z', 'weird')`),
    ).rejects.toThrow(/spaces_kind_check/);
    await expect(db.query(`insert into push_prefs (org_id, member_id, level) values ('org-default', 'x', 'loud')`)).rejects.toThrow(/push_prefs_level_check/);
    await expect(db.query(`update members set role = 'owner' where id = 'ramnique'`)).rejects.toThrow(/members_role_check/);
  });

  it('author_member_id is the author, computed by the database on every row', async () => {
    const rows = await db.query<{ n: number; drift: number }>(
      `select count(*)::int as n, count(*) filter (where author_member_id <> author->>'memberId')::int as drift from messages`,
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
    expect(rows[0]!.drift).toBe(0);
    // Nothing may write it — the column is the expression, not a field.
    await expect(db.query(`update messages set author_member_id = 'someone-else'`)).rejects.toThrow(/can only be updated to DEFAULT/);
  });

  it('activity seen marks are org-scoped: the same member id in two orgs keeps two marks', async () => {
    const alpha = new PgStore(db, 'org-alpha');
    const beta = new PgStore(db, 'org-beta');
    expect(await alpha.advanceActivitySeenAt('shared-id', '2026-09-21T10:00:00.000Z')).toBe('2026-09-21T10:00:00.000Z');
    expect(await beta.getActivitySeenAt('shared-id')).toBeUndefined();
    expect(await beta.advanceActivitySeenAt('shared-id', '2026-09-21T09:00:00.000Z')).toBe('2026-09-21T09:00:00.000Z');
    expect(await alpha.getActivitySeenAt('shared-id')).toBe('2026-09-21T10:00:00.000Z');
  });
});
