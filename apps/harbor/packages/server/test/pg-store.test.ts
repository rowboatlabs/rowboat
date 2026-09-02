import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMember } from '../src/auth.js';
import { SpaceHub } from '../src/hub.js';
import { PgStore } from '../src/pg-store.js';
import { HarborService } from '../src/service.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';

// Store-level paths the §11 day doesn't walk, exercised on real Postgres
// through the real service (no HTTP — this is the storage contract, not the
// wire one): history pagination, thread pointers + reply denorm, topic
// lifecycle, invite expiry, search over jsonb-backed rows.

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
    expect(both.reactions).toEqual([{ emoji: '👍', memberIds: ['gagan', 'ramnique'] }]);

    // Attribution jsonb round-trips (same guarantee change_sets has).
    const stored = await store.getReaction(spaceId, messageId, '👍', 'ramnique');
    expect(stored?.by).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });

    // Windowed stream reads fold the same state in.
    const stream = await service.listStream(ram, spaceId);
    expect(stream.messages.find((m) => m.id === messageId)?.reactions).toEqual([
      { emoji: '👍', memberIds: ['gagan', 'ramnique'] },
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
    const events = await service.eventsAfter(spaceId, 0);
    const messageEvent = events.find((e) => e.event.type === 'message' && e.event.message.id === messageId)!;
    expect(messageEvent.event).toMatchObject({ message: { body: '', deletedAt: deleted.deletedAt } });
    const deletion = events.find((e) => e.event.type === 'message_deleted')!;
    expect(deletion.event).toMatchObject({
      deletion: { messageId, by: { memberId: 'ramnique', actingMode: 'direct' } },
    });

    // Idempotent: re-deleting writes nothing new.
    const head = await service.headOffset(spaceId);
    await service.deleteMessage(ram, spaceId, messageId, { actingMode: 'direct' });
    expect(await service.headOffset(spaceId)).toBe(head);
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
    const events = await service.eventsAfter(spaceId, 0);
    const messageEvent = events.find((e) => e.event.type === 'message' && e.event.message.id === messageId)!;
    expect((messageEvent.event as { message: { poll?: { endedAt?: string } } }).message.poll?.endedAt).toBeUndefined();
    expect(events.some((e) => e.event.type === 'poll_ended')).toBe(true);

    // Deletion redacts the poll from the row and the stored event alike, and
    // the poll_votes rows go with it — gagan's vote on B must not outlive the poll.
    expect(await store.listPollVotesForMessages(spaceId, [messageId])).toHaveLength(1);
    const deleted = await service.deleteMessage(ram, spaceId, messageId, { actingMode: 'direct' });
    expect(deleted.poll).toBeUndefined();
    expect(await store.listPollVotesForMessages(spaceId, [messageId])).toEqual([]);
    const redacted = (await service.eventsAfter(spaceId, 0)).find(
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
