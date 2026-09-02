import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProposeChangeResult } from '@rowboat/spaces-protocol';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { liveClient } from './helpers.js';

// Render-face contract tests: real HTTP against a real listener, every route.

let harbor: RunningHarbor;

beforeAll(async () => {
  harbor = await startHarbor({
    orgName: 'Test Org',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
    ],
  });
});

afterAll(async () => {
  await harbor.close();
});

function api(token: string | null) {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  return {
    async get(path: string) {
      const res = await fetch(`${harbor.url}${path}`, { headers: headers() });
      return { status: res.status, body: (await res.json()) as any };
    },
    async post(path: string, body?: unknown) {
      const res = await fetch(`${harbor.url}${path}`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body ?? {}),
      });
      return { status: res.status, body: (await res.json()) as any };
    },
  };
}

const ramnique = api('dev-ramnique');
const gagan = api('dev-gagan');
const prakhar = api('dev-prakhar');

describe('auth', () => {
  it('health is pre-auth', async () => {
    const r = await api(null).get('/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('routes reject missing and malformed tokens', async () => {
    expect((await api(null).get('/v1/spaces')).status).toBe(401);
    const bad = await api('sometoken').get('/v1/spaces');
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('unauthorized');
  });
});

describe('spaces, invites, membership', () => {
  let spaceId: string;

  it('creates a space; creator is a member; a membership event is on the log', async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Show HN draft' });
    expect(r.status).toBe(200);
    spaceId = r.body.space.id;
    const list = await ramnique.get('/v1/spaces');
    expect(list.body.spaces.map((s: any) => s.id)).toContain(spaceId);
  });

  it('non-members are forbidden, unknown spaces are 404, bad ids are 400', async () => {
    expect((await gagan.get(`/v1/spaces/${spaceId}/assets`)).status).toBe(403);
    expect((await ramnique.get('/v1/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV/assets')).status).toBe(404);
    expect((await ramnique.get('/v1/spaces/not-a-ulid/assets')).status).toBe(400);
  });

  it('invite: create → resolve pre-auth → accept → idempotent re-accept', async () => {
    const inv = await ramnique.post('/v1/invites', { spaceId });
    expect(inv.status).toBe(200);
    expect(inv.body.link).toContain('/join/');

    const resolved = await api(null).post('/v1/invites/resolve', { token: inv.body.token });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({
      state: 'ok',
      space: { id: spaceId, name: 'Show HN draft' },
      invitedBy: 'Ramnique',
    });

    const accept = await gagan.post('/v1/invites/accept', { token: inv.body.token });
    expect(accept.status).toBe(200);
    expect(accept.body.membership.memberId).toBe('gagan');

    const again = await gagan.post('/v1/invites/accept', { token: inv.body.token });
    expect(again.status).toBe(200);
    expect(again.body.membership.joinedAt).toBe(accept.body.membership.joinedAt);

    const members = await gagan.get(`/v1/spaces/${spaceId}/members`);
    expect(members.body.members.map((m: any) => m.id).sort()).toEqual(['gagan', 'ramnique']);
  });

  it('unknown invite is 404; expired invite resolves as expired and cannot be accepted', async () => {
    expect((await api(null).post('/v1/invites/resolve', { token: 'x'.repeat(20) })).status).toBe(404);
    const inv = await ramnique.post('/v1/invites', { spaceId, expiresInHours: 1 });
    const stored = await harbor.store.getInvite(inv.body.token);
    await harbor.store.putInvite({ ...stored!, expiresAt: new Date(Date.now() - 1000).toISOString() });
    const resolved = await api(null).post('/v1/invites/resolve', { token: inv.body.token });
    expect(resolved.body.state).toBe('expired');
    expect((await prakhar.post('/v1/invites/accept', { token: inv.body.token })).status).toBe(403);
  });

  it('the /join/<token> page names the space pre-auth', async () => {
    const inv = await ramnique.post('/v1/invites', { spaceId });
    const res = await fetch(`${harbor.url}/join/${inv.body.token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Show HN draft');
  });

  it('leave removes membership', async () => {
    const inv = await ramnique.post('/v1/invites', { spaceId });
    await prakhar.post('/v1/invites/accept', { token: inv.body.token });
    expect((await prakhar.post(`/v1/spaces/${spaceId}/leave`)).status).toBe(200);
    expect((await prakhar.get(`/v1/spaces/${spaceId}/assets`)).status).toBe(403);
  });
});

describe('assets and the change-set log', () => {
  let spaceId: string;

  beforeAll(async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Assets' });
    spaceId = r.body.space.id;
    const inv = await ramnique.post('/v1/invites', { spaceId });
    await gagan.post('/v1/invites/accept', { token: inv.body.token });
  });

  it('baseVersion 0 creates; reading bundles recent history', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes.md',
      baseVersion: 0,
      newContent: '# Notes\n- alpha\n',
      reason: 'start the notes',
      actingMode: 'direct',
    });
    expect(r.body.outcome).toBe('applied');
    expect(r.body.version).toBe(1);
    expect(r.body.changeSet.attribution).toEqual({ memberId: 'ramnique', actingMode: 'direct' });

    const read = await gagan.get(`/v1/spaces/${spaceId}/asset?path=notes.md`);
    expect(read.body.version).toBe(1);
    expect(read.body.recentHistory).toHaveLength(1);
    expect(read.body.recentHistory[0].reason).toBe('start the notes');
  });

  it('creating an asset that already exists conflicts (create race)', async () => {
    const r = await gagan.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes.md',
      baseVersion: 0,
      newContent: '# Different notes\n',
      actingMode: 'direct',
    });
    expect(r.body.outcome).toBe('conflict');
    expect(r.body.currentVersion).toBe(1);
  });

  it('proposing against a version ahead of the asset is invalid', async () => {
    const r = await gagan.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes.md',
      baseVersion: 9,
      newContent: 'x\n',
      actingMode: 'direct',
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('invalid_request');
  });

  it('proposing against a missing asset with baseVersion > 0 is 404', async () => {
    const r = await gagan.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'ghost.md',
      baseVersion: 3,
      newContent: 'x\n',
      actingMode: 'direct',
    });
    expect(r.status).toBe(404);
  });

  it('stale non-overlapping proposals merge; the proposer must adopt mergedContent', async () => {
    const fresh = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes.md',
      baseVersion: 1,
      newContent: '# Notes\n- alpha\n- beta (from Ramnique)\n',
      actingMode: 'direct',
    });
    expect(fresh.body.outcome).toBe('applied');
    expect(fresh.body.version).toBe(2);

    const stale = await gagan.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes.md',
      baseVersion: 1,
      newContent: '# Notes (better title)\n- alpha\n',
      reason: 'sharpen the title',
      actingMode: 'agent',
      agentName: 'Rowboat',
    });
    expect(stale.body.outcome).toBe('merged');
    expect(stale.body.version).toBe(3);
    expect(stale.body.mergedContent).toBe('# Notes (better title)\n- alpha\n- beta (from Ramnique)\n');
    expect(stale.body.changeSet.attribution).toEqual({ memberId: 'gagan', actingMode: 'agent', agentName: 'Rowboat' });
  });

  it('overlapping stale proposals conflict: nothing written, retry bundle included', async () => {
    const before = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=notes.md`);
    const r = (await gagan.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'notes.md',
      baseVersion: 1,
      newContent: '# Totally different heading\n- alpha\n',
      actingMode: 'direct',
    })) as { status: number; body: Extract<ProposeChangeResult, { outcome: 'conflict' }> };
    expect(r.status).toBe(200); // conflicts are outcomes, not errors
    expect(r.body.outcome).toBe('conflict');
    expect(r.body.currentVersion).toBe(3);
    expect(r.body.currentContent).toBe(before.body.content);
    expect(r.body.regions[0]).toMatchObject({ baseStart: 1, baseEnd: 1 });
    expect(r.body.regions[0]!.current).toEqual(['# Notes (better title)']);
    expect(r.body.regions[0]!.proposed).toEqual(['# Totally different heading']);
    expect(r.body.recentHistory.length).toBeGreaterThan(0);

    const after = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=notes.md`);
    expect(after.body.version).toBe(3); // nothing was written
  });

  it('time-travel reads and diffs', async () => {
    const v1 = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=notes.md&version=1`);
    expect(v1.body.content).toBe('# Notes\n- alpha\n');
    expect(v1.body.recentHistory).toHaveLength(1);

    const diff = await ramnique.get(`/v1/spaces/${spaceId}/diff?path=notes.md&from=1&to=3`);
    expect(diff.body.unified).toContain('-# Notes');
    expect(diff.body.unified).toContain('+# Notes (better title)');
    expect((await ramnique.get(`/v1/spaces/${spaceId}/diff?path=notes.md&from=1&to=9`)).status).toBe(404);
  });

  it('history: whole space, per path, pagination', async () => {
    await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'other.md',
      baseVersion: 0,
      newContent: 'other\n',
      actingMode: 'direct',
    });
    const all = await ramnique.get(`/v1/spaces/${spaceId}/history`);
    expect(all.body.changeSets.length).toBe(4); // notes v1..v3 + other v1
    expect(all.body.changeSets[0].assetPath).toBe('other.md'); // newest first

    const notes = await ramnique.get(`/v1/spaces/${spaceId}/history?path=notes.md`);
    expect(notes.body.changeSets.map((cs: any) => cs.resultVersion)).toEqual([3, 2, 1]);

    const page = await ramnique.get(
      `/v1/spaces/${spaceId}/history?path=notes.md&beforeOffset=${notes.body.changeSets[0].offset}&limit=1`,
    );
    expect(page.body.changeSets.map((cs: any) => cs.resultVersion)).toEqual([2]);

    const entries = await ramnique.get(`/v1/spaces/${spaceId}/assets`);
    expect(entries.body.entries.map((e: any) => e.path)).toEqual(['notes.md', 'other.md']);
  });

  it('asset paths with traversal are rejected', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: '../escape.md',
      baseVersion: 0,
      newContent: 'x\n',
      actingMode: 'direct',
    });
    expect(r.status).toBe(400);
  });
});

describe('feed: the stream, threads, and topic annotations', () => {
  let spaceId: string;

  beforeAll(async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Feed' });
    spaceId = r.body.space.id;
    const inv = await ramnique.post('/v1/invites', { spaceId });
    await gagan.post('/v1/invites/accept', { token: inv.body.token });
  });

  it('a new space has an empty stream and no topics — the stream is not an object', async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Born empty' });
    const stream = await ramnique.get(`/v1/spaces/${r.body.space.id}/stream`);
    expect(stream.body).toEqual({ messages: [], topics: [], hasMore: false });
    const topics = await ramnique.get(`/v1/spaces/${r.body.space.id}/topics`);
    expect(topics.body.topics).toEqual([]);
  });

  it('posting a root lands in the stream and creates NO container', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'Should we cut the pricing section? It reads long to me.',
      actingMode: 'direct',
    });
    expect(r.status).toBe(200);
    expect(r.body.message.threadRoot).toBeUndefined();
    expect(r.body.message.replyCount).toBe(0);
    expect(r.body.message.offset).toBeGreaterThan(0);
    const topics = await ramnique.get(`/v1/spaces/${spaceId}/topics?includeArchived=true`);
    expect(topics.body.topics).toEqual([]);
  });

  it('replies point at the root; the reply chip denorm moves; reply-to-a-reply lands flat', async () => {
    const stream = await ramnique.get(`/v1/spaces/${spaceId}/stream`);
    const rootId = stream.body.messages[0].id;
    const first = await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      threadRoot: rootId,
      body: 'Cut it — link the pricing page instead.',
      actingMode: 'direct',
    });
    expect(first.body.message.threadRoot).toBe(rootId);

    // Replying to the REPLY normalizes to the root — threads are flat by shape.
    const second = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      threadRoot: first.body.message.id,
      body: 'Agreed.',
      actingMode: 'direct',
    });
    expect(second.body.message.threadRoot).toBe(rootId);

    const thread = await ramnique.get(`/v1/spaces/${spaceId}/threads/${rootId}`);
    expect(thread.body.topic).toBeNull();
    expect(thread.body.root.replyCount).toBe(2);
    expect(thread.body.root.lastReplyAt).toBe(second.body.message.postedAt);
    expect(thread.body.messages.map((m: any) => m.author.memberId)).toEqual(['gagan', 'ramnique']);

    // The stream shows only the root, chip data riding on it; replies stay behind it.
    const after = await ramnique.get(`/v1/spaces/${spaceId}/stream`);
    expect(after.body.messages).toHaveLength(1);
    expect(after.body.messages[0].replyCount).toBe(2);

    // A reply's id in the thread path resolves to the root (Slack-style).
    const viaReply = await ramnique.get(`/v1/spaces/${spaceId}/threads/${first.body.message.id}`);
    expect(viaReply.body.root.id).toBe(rootId);
  });

  it('promote: a title annotates the thread; one topic per root; replies refuse', async () => {
    const stream = await ramnique.get(`/v1/spaces/${spaceId}/stream`);
    const rootId = stream.body.messages[0].id;

    const created = await ramnique.post(`/v1/spaces/${spaceId}/topics`, {
      rootMessageId: rootId,
      title: 'Decide: pricing section, cut or keep',
      actingMode: 'direct',
    });
    expect(created.status).toBe(200);
    expect(created.body.topic).toMatchObject({ rootMessageId: rootId, title: 'Decide: pricing section, cut or keep', archived: false });
    expect(created.body.rootMessage.id).toBe(rootId);

    // The stream page now decorates the root with its annotation.
    const after = await ramnique.get(`/v1/spaces/${spaceId}/stream`);
    expect(after.body.topics).toHaveLength(1);
    expect(after.body.topics[0].id).toBe(created.body.topic.id);

    // One topic per thread; a reply cannot be promoted (the error names the root).
    const again = await gagan.post(`/v1/spaces/${spaceId}/topics`, { rootMessageId: rootId, title: 'Duplicate', actingMode: 'direct' });
    expect(again.status).toBe(400);
    expect(again.body.message).toContain(created.body.topic.id);
    const thread = await ramnique.get(`/v1/spaces/${spaceId}/threads/${rootId}`);
    const replyId = thread.body.messages[0].id;
    const onReply = await ramnique.post(`/v1/spaces/${spaceId}/topics`, { rootMessageId: replyId, title: 'On a reply', actingMode: 'direct' });
    expect(onReply.status).toBe(400);
    expect(onReply.body.message).toContain(rootId);

    // Exactly one of rootMessageId | body.
    expect((await ramnique.post(`/v1/spaces/${spaceId}/topics`, { title: 'Neither', actingMode: 'direct' })).status).toBe(400);
  });

  it('from scratch: body posts the root into the stream, then annotates it', async () => {
    const r = await gagan.post(`/v1/spaces/${spaceId}/topics`, {
      title: 'Ship: importer fix',
      body: 'Tracking the importer fix to done.',
      actingMode: 'direct',
    });
    expect(r.status).toBe(200);
    expect(r.body.topic.rootMessageId).toBe(r.body.rootMessage.id);
    // Nothing is born outside the stream.
    const stream = await ramnique.get(`/v1/spaces/${spaceId}/stream`);
    expect(stream.body.messages.some((m: any) => m.id === r.body.rootMessage.id)).toBe(true);
  });

  it('retitle, archive (off the rail, thread untouched), revive-by-reply', async () => {
    const topics = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    const topic = topics.body.topics.find((t: any) => t.title.startsWith('Ship:'));

    const retitled = await ramnique.post(`/v1/spaces/${spaceId}/topics/${topic.id}`, {
      action: 'retitle',
      title: 'Ship: importer fix (v2)',
      actingMode: 'direct',
    });
    expect(retitled.body.topic.title).toBe('Ship: importer fix (v2)');

    await ramnique.post(`/v1/spaces/${spaceId}/topics/${topic.id}`, { action: 'archive', actingMode: 'direct' });
    const rail = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    expect(rail.body.topics.some((t: any) => t.id === topic.id)).toBe(false);
    const all = await ramnique.get(`/v1/spaces/${spaceId}/topics?includeArchived=true`);
    expect(all.body.topics.find((t: any) => t.id === topic.id)?.archived).toBe(true);
    // Archiving hides nothing: the root keeps its stream place, the thread reads fine.
    const stream = await ramnique.get(`/v1/spaces/${spaceId}/stream`);
    expect(stream.body.messages.some((m: any) => m.id === topic.rootMessageId)).toBe(true);

    // Gmail semantics: a new reply revives it.
    await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      threadRoot: topic.rootMessageId,
      body: 'Reviving this — Acme asked again.',
      actingMode: 'direct',
    });
    const revived = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    expect(revived.body.topics.find((t: any) => t.id === topic.id)?.archived).toBe(false);
  });

  it('remove converts back to a thread: the row goes, every message stays, re-promote is lossless', async () => {
    const topics = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    const topic = topics.body.topics.find((t: any) => t.title.startsWith('Ship:'));
    const removed = await ramnique.post(`/v1/spaces/${spaceId}/topics/${topic.id}`, { action: 'remove', actingMode: 'direct' });
    expect(removed.status).toBe(200);

    const all = await ramnique.get(`/v1/spaces/${spaceId}/topics?includeArchived=true`);
    expect(all.body.topics.some((t: any) => t.id === topic.id)).toBe(false);
    // The thread is untouched — root in the stream, replies behind it.
    const thread = await ramnique.get(`/v1/spaces/${spaceId}/threads/${topic.rootMessageId}`);
    expect(thread.body.topic).toBeNull();
    expect(thread.body.root.replyCount).toBeGreaterThan(0);

    // Re-promoting round-trips.
    const back = await ramnique.post(`/v1/spaces/${spaceId}/topics`, {
      rootMessageId: topic.rootMessageId,
      title: 'Ship: importer fix (returned)',
      actingMode: 'direct',
    });
    expect(back.status).toBe(200);
    await ramnique.post(`/v1/spaces/${spaceId}/topics/${back.body.topic.id}`, { action: 'remove', actingMode: 'direct' });
  });

  it('the rail sorts by activity: newest reply, else the root post', async () => {
    const quiet = await ramnique.post(`/v1/spaces/${spaceId}/topics`, {
      title: 'Fix: quiet one', body: 'quiet thread', actingMode: 'direct',
    });
    const busy = await ramnique.post(`/v1/spaces/${spaceId}/topics`, {
      title: 'Fix: busy one', body: 'busy thread', actingMode: 'direct',
    });
    await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      threadRoot: quiet.body.rootMessage.id, body: 'now the quiet one is loudest', actingMode: 'direct',
    });
    const rail = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    const titles = rail.body.topics.map((t: any) => t.title);
    expect(titles.indexOf('Fix: quiet one')).toBeLessThan(titles.indexOf('Fix: busy one'));
    const quietRow = rail.body.topics.find((t: any) => t.title === 'Fix: quiet one');
    expect(quietRow.rootMessage.replyCount).toBe(1);
    expect(quietRow.lastActivityAt).toBe(quietRow.rootMessage.lastReplyAt);
  });

  it('reply-to-activity-row: anchorChangeSetId rides the root message, validated', async () => {
    const cs = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'draft.md',
      baseVersion: 0,
      newContent: '# Draft\n',
      actingMode: 'direct',
    });
    const ok = await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'Why did the draft drop the intro?',
      anchorChangeSetId: cs.body.changeSet.id,
      actingMode: 'direct',
    });
    expect(ok.body.message.anchorChangeSetId).toBe(cs.body.changeSet.id);

    const bad = await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'Anchored to nothing',
      anchorChangeSetId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      actingMode: 'direct',
    });
    expect(bad.status).toBe(400);
  });

  it('change-sets carry thread provenance — explicit threadRootId validated, reason suffix derived', async () => {
    const stream = await ramnique.get(`/v1/spaces/${spaceId}/stream`);
    const rootId = stream.body.messages[0].id;

    const explicit = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'provenance.md',
      baseVersion: 0,
      newContent: '# From a thread\n',
      threadRootId: rootId,
      actingMode: 'direct',
    });
    expect(explicit.body.changeSet.threadRootId).toBe(rootId);

    const derived = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'provenance.md',
      baseVersion: 1,
      newContent: '# From a thread, via the reason suffix\n',
      reason: `folded the discussion · thread:${rootId}`,
      actingMode: 'agent',
      agentName: 'Rowboat',
    });
    expect(derived.body.changeSet.threadRootId).toBe(rootId);

    const bad = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'provenance.md',
      baseVersion: 2,
      newContent: '# Bad provenance\n',
      threadRootId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      actingMode: 'direct',
    });
    expect(bad.status).toBe(400);
  });

  it('topic lifecycle narrates on the log with its actor', async () => {
    const live = await liveClient(harbor, 'dev-ramnique');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((frames) => frames.some((f) => f.kind === 'subscribed'), 'subscribed');

    const made = await gagan.post(`/v1/spaces/${spaceId}/topics`, {
      title: 'Decide: logging vendor', body: 'datadog or axiom?', actingMode: 'direct',
    });
    await ramnique.post(`/v1/spaces/${spaceId}/topics/${made.body.topic.id}`, {
      action: 'retitle', title: 'Decide: observability vendor', actingMode: 'direct',
    });
    await ramnique.post(`/v1/spaces/${spaceId}/topics/${made.body.topic.id}`, { action: 'remove', actingMode: 'direct' });

    await live.until(
      (frames) => frames.some((f) => f.kind === 'event' && f.event.type === 'topic_removed'),
      'topic lifecycle events',
    );
    const topicEvents = live.events().filter((f) => f.event.type === 'topic' || f.event.type === 'topic_removed');
    expect(topicEvents.map((f) => (f.event.type === 'topic' ? f.event.action : 'removed'))).toEqual([
      'created',
      'retitled',
      'removed',
    ]);
    const createdEvent = topicEvents[0]!.event as Extract<typeof topicEvents[0]['event'], { type: 'topic' }>;
    expect(createdEvent.by.memberId).toBe('gagan');
    const removedEvent = topicEvents[2]!.event as Extract<typeof topicEvents[0]['event'], { type: 'topic_removed' }>;
    expect(removedEvent.removal).toMatchObject({ topicId: made.body.topic.id, rootMessageId: made.body.rootMessage.id, by: { memberId: 'ramnique' } });
    live.close();
  });
});

describe('reactions', () => {
  let spaceId: string;
  let messageId: string;

  const react = (who: ReturnType<typeof api>, emoji: string, action: 'add' | 'remove') =>
    who.post(`/v1/spaces/${spaceId}/messages/${messageId}/reactions`, { emoji, action, actingMode: 'direct' });

  beforeAll(async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Reactions' });
    spaceId = r.body.space.id;
    const inv = await ramnique.post('/v1/invites', { spaceId });
    await gagan.post('/v1/invites/accept', { token: inv.body.token });
    const posted = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'Shipped the importer fix 🎉',
      actingMode: 'direct',
    });
    messageId = posted.body.message.id;
  });

  it('any member reacts to any message; groups fold in first-reacted order', async () => {
    const first = await react(gagan, '👍', 'add');
    expect(first.status).toBe(200);
    expect(first.body.message.reactions).toEqual([{ emoji: '👍', memberIds: ['gagan'] }]);

    await react(ramnique, '👍', 'add'); // second member joins the group
    const second = await react(ramnique, '🚀', 'add'); // new emoji appends a group
    expect(second.body.message.reactions).toEqual([
      { emoji: '👍', memberIds: ['gagan', 'ramnique'] },
      { emoji: '🚀', memberIds: ['ramnique'] },
    ]);

    // Reads fold the same state in.
    const stream = await gagan.get(`/v1/spaces/${spaceId}/stream`);
    expect(stream.body.messages[0].reactions).toEqual(second.body.message.reactions);
  });

  it('toggles are idempotent: re-add and re-remove write nothing and emit nothing', async () => {
    // Live-only subscription (no replay): every event from here on is new.
    const live = await liveClient(harbor, 'dev-ramnique');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((frames) => frames.some((f) => f.kind === 'subscribed'), 'subscribed');

    const again = await react(gagan, '👍', 'add');
    expect(again.status).toBe(200);
    expect(again.body.message.reactions[0].memberIds).toEqual(['gagan', 'ramnique']);

    const removed = await react(gagan, '👍', 'remove');
    expect(removed.body.message.reactions[0].memberIds).toEqual(['ramnique']);
    const removedAgain = await react(gagan, '👍', 'remove');
    expect(removedAgain.status).toBe(200);
    expect(removedAgain.body.message.reactions).toEqual(removed.body.message.reactions);

    // Exactly ONE durable event for the three calls: the real removal.
    await live.until((frames) => frames.some((f) => f.kind === 'event'), 'reaction event');
    const reactionEvents = live.events().filter((f) => f.event.type === 'reaction');
    expect(reactionEvents).toHaveLength(1);
    expect(reactionEvents[0]!.event).toMatchObject({
      type: 'reaction',
      action: 'removed',
      reaction: { messageId, emoji: '👍', by: { memberId: 'gagan', actingMode: 'direct' } },
    });
    live.close();
  });

  it('removing the last member drops the group', async () => {
    await react(ramnique, '🚀', 'remove');
    const r = await react(ramnique, '👍', 'remove');
    expect(r.body.message.reactions).toEqual([]);
  });

  it('non-members are forbidden; unknown messages 404; whitespace is not an emoji', async () => {
    expect((await react(prakhar, '👍', 'add')).status).toBe(403);
    const ghost = await ramnique.post(
      `/v1/spaces/${spaceId}/messages/01ARZ3NDEKTSV4RRFFQ69G5FAV/reactions`,
      { emoji: '👍', action: 'add', actingMode: 'direct' },
    );
    expect(ghost.status).toBe(404);
    expect((await react(ramnique, 'not an emoji', 'add')).status).toBe(400);
  });
});

describe('message deletion', () => {
  let spaceId: string;
  let rootId: string;

  const del = (who: ReturnType<typeof api>, messageId: string) =>
    who.post(`/v1/spaces/${spaceId}/messages/${messageId}/delete`, { actingMode: 'direct' });
  const react = (who: ReturnType<typeof api>, messageId: string, emoji: string, action: 'add' | 'remove') =>
    who.post(`/v1/spaces/${spaceId}/messages/${messageId}/reactions`, { emoji, action, actingMode: 'direct' });

  beforeAll(async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Deletion' });
    spaceId = r.body.space.id;
    const inv = await ramnique.post('/v1/invites', { spaceId });
    await gagan.post('/v1/invites/accept', { token: inv.body.token });
    const root = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { body: 'thread base', actingMode: 'direct' });
    rootId = root.body.message.id;
  });

  it('the author tombstones a reply; reads, replay, and the reply chip all forget it', async () => {
    const posted = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      threadRoot: rootId,
      body: 'oops — that was for another space',
      actingMode: 'direct',
    });
    const messageId = posted.body.message.id;

    const r = await del(ramnique, messageId);
    expect(r.status).toBe(200);
    expect(r.body.message.body).toBe('');
    expect(r.body.message.deletedAt).toBeTruthy();

    // Reads carry the tombstone, and it no longer counts toward the chip.
    const thread = await gagan.get(`/v1/spaces/${spaceId}/threads/${rootId}`);
    const m = thread.body.messages.find((x: any) => x.id === messageId);
    expect(m.body).toBe('');
    expect(m.deletedAt).toBe(r.body.message.deletedAt);
    expect(thread.body.root.replyCount).toBe(0);

    // Replay redaction: a full catch-up gets the REDACTED message event plus the deletion.
    const live = await liveClient(harbor, 'dev-gagan');
    live.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
    await live.until(
      (frames) => frames.some((f) => f.kind === 'event' && f.event.type === 'message_deleted'),
      'replayed deletion',
    );
    const replayed = live.events().find((f) => f.event.type === 'message' && f.event.message.id === messageId)!;
    expect(replayed.event).toMatchObject({
      type: 'message',
      message: { id: messageId, body: '', deletedAt: r.body.message.deletedAt },
    });
    expect(live.events().find((f) => f.event.type === 'message_deleted')!.event).toMatchObject({
      type: 'message_deleted',
      deletion: { messageId, threadRoot: rootId, by: { memberId: 'ramnique', actingMode: 'direct' } },
    });
    live.close();
  });

  it('only the author can delete; non-members and unknown messages refuse', async () => {
    const posted = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { threadRoot: rootId, body: 'keep out', actingMode: 'direct' });
    const messageId = posted.body.message.id;
    expect((await del(gagan, messageId)).status).toBe(403);
    expect((await del(prakhar, messageId)).status).toBe(403);
    expect((await del(ramnique, '01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404);
  });

  it('re-deleting is an idempotent no-op: one event for two calls', async () => {
    const posted = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { threadRoot: rootId, body: 'delete me twice', actingMode: 'direct' });
    const messageId = posted.body.message.id;

    // Live-only subscription (no replay): every event from here on is new.
    const live = await liveClient(harbor, 'dev-ramnique');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((frames) => frames.some((f) => f.kind === 'subscribed'), 'subscribed');

    await del(ramnique, messageId);
    const again = await del(ramnique, messageId);
    expect(again.status).toBe(200);
    expect(again.body.message.deletedAt).toBeTruthy();

    await live.until(
      (frames) => frames.some((f) => f.kind === 'event' && f.event.type === 'message_deleted'),
      'deletion event',
    );
    expect(live.events().filter((f) => f.event.type === 'message_deleted')).toHaveLength(1);
    live.close();
  });

  it('tombstones take no new reactions; removes still work', async () => {
    const posted = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { threadRoot: rootId, body: 'react then delete', actingMode: 'direct' });
    const messageId = posted.body.message.id;
    await react(gagan, messageId, '👍', 'add');
    await del(ramnique, messageId);

    expect((await react(gagan, messageId, '🚀', 'add')).status).toBe(400);
    const removed = await react(gagan, messageId, '👍', 'remove');
    expect(removed.status).toBe(200);
    expect(removed.body.message.reactions).toEqual([]);
  });
});

describe('message editing', () => {
  let spaceId: string;

  const edit = (who: ReturnType<typeof api>, messageId: string, body: string) =>
    who.post(`/v1/spaces/${spaceId}/messages/${messageId}/edit`, { body, actingMode: 'direct' });

  beforeAll(async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Editing' });
    spaceId = r.body.space.id;
    const inv = await ramnique.post('/v1/invites', { spaceId });
    await gagan.post('/v1/invites/accept', { token: inv.body.token });
  });

  it('the author rewrites a body; reads and replay serve the new text', async () => {
    const posted = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'teh quick fix',
      actingMode: 'direct',
    });
    const messageId = posted.body.message.id;

    const r = await edit(ramnique, messageId, 'the quick fix');
    expect(r.status).toBe(200);
    expect(r.body.message.body).toBe('the quick fix');
    expect(r.body.message.editedAt).toBeTruthy();

    // Reads carry the rewrite; counts and activity are untouched.
    const stream = await gagan.get(`/v1/spaces/${spaceId}/stream`);
    const m = stream.body.messages.find((x: any) => x.id === messageId);
    expect(m.body).toBe('the quick fix');
    expect(m.editedAt).toBe(r.body.message.editedAt);

    // Replay rewrite: catch-up gets the REWRITTEN message event plus the edit event.
    const live = await liveClient(harbor, 'dev-gagan');
    live.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
    await live.until(
      (frames) => frames.some((f) => f.kind === 'event' && f.event.type === 'message_edited'),
      'replayed edit',
    );
    const replayed = live.events().find((f) => f.event.type === 'message' && f.event.message.id === messageId)!;
    expect(replayed.event).toMatchObject({
      type: 'message',
      message: { id: messageId, body: 'the quick fix', editedAt: r.body.message.editedAt },
    });
    expect(live.events().find((f) => f.event.type === 'message_edited')!.event).toMatchObject({
      type: 'message_edited',
      edit: { messageId, body: 'the quick fix', by: { memberId: 'ramnique', actingMode: 'direct' } },
    });
    live.close();
  });

  it('only the author edits; tombstones and unknown messages refuse', async () => {
    const posted = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { body: 'mine', actingMode: 'direct' });
    const messageId = posted.body.message.id;
    expect((await edit(gagan, messageId, 'hijack')).status).toBe(403);
    expect((await edit(ramnique, '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'ghost')).status).toBe(404);
    await ramnique.post(`/v1/spaces/${spaceId}/messages/${messageId}/delete`, { actingMode: 'direct' });
    expect((await edit(ramnique, messageId, 'necromancy')).status).toBe(400);
  });

  it('an identical body is an idempotent no-op: no event', async () => {
    const posted = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { body: 'stable', actingMode: 'direct' });
    const messageId = posted.body.message.id;

    const live = await liveClient(harbor, 'dev-ramnique');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((frames) => frames.some((f) => f.kind === 'subscribed'), 'subscribed');

    const same = await edit(ramnique, messageId, 'stable');
    expect(same.status).toBe(200);
    expect(same.body.message.editedAt).toBeUndefined();

    await edit(ramnique, messageId, 'stable, now edited');
    await live.until(
      (frames) => frames.some((f) => f.kind === 'event' && f.event.type === 'message_edited'),
      'edit event',
    );
    expect(live.events().filter((f) => f.event.type === 'message_edited')).toHaveLength(1);
    live.close();
  });
});

describe('polls', () => {
  let spaceId: string;

  const postPoll = (who: ReturnType<typeof api>, poll: Record<string, unknown>, body = '📊 **poll**') =>
    who.post(`/v1/spaces/${spaceId}/messages`, { body, poll, actingMode: 'direct' });
  const vote = (who: ReturnType<typeof api>, messageId: string, answerId: number, action: 'add' | 'remove', actingMode = 'direct') =>
    who.post(`/v1/spaces/${spaceId}/messages/${messageId}/poll/votes`, { answerId, action, actingMode });
  const end = (who: ReturnType<typeof api>, messageId: string) =>
    who.post(`/v1/spaces/${spaceId}/messages/${messageId}/poll/end`, { actingMode: 'direct' });

  beforeAll(async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Polls' });
    spaceId = r.body.space.id;
    const inv = await ramnique.post('/v1/invites', { spaceId });
    await gagan.post('/v1/invites/accept', { token: inv.body.token });
  });

  it('the org stamps the poll: sequential answer ids, expiry from duration, defaults applied', async () => {
    const r = await postPoll(ramnique, {
      question: 'Where do we take standup?',
      answers: [{ text: 'Keep it async' }, { text: 'Daily call', emoji: '📞' }],
      durationHours: 48,
    });
    expect(r.status).toBe(200);
    const poll = r.body.message.poll;
    expect(poll.answers).toEqual([
      { id: 1, text: 'Keep it async' },
      { id: 2, text: 'Daily call', emoji: '📞' },
    ]);
    expect(poll.allowMultiselect).toBe(false);
    expect(poll.votes).toEqual([]);
    expect(Date.parse(poll.expiresAt) - Date.parse(r.body.message.postedAt)).toBe(48 * 3_600_000);
  });

  it('bad polls refuse: one answer, too many, oversized text', async () => {
    expect((await postPoll(ramnique, { question: 'q', answers: [{ text: 'only' }] })).status).toBe(400);
    expect(
      (await postPoll(ramnique, { question: 'q', answers: Array.from({ length: 11 }, (_, i) => ({ text: `a${i}` })) })).status,
    ).toBe(400);
    expect((await postPoll(ramnique, { question: 'q', answers: [{ text: 'x'.repeat(56) }, { text: 'b' }] })).status).toBe(400);
  });

  it('single-select: votes fold on reads; adding elsewhere MOVES the vote (removed + added events)', async () => {
    const posted = await postPoll(ramnique, { question: 'Pick one', answers: [{ text: 'A' }, { text: 'B' }] });
    const messageId = posted.body.message.id;

    const live = await liveClient(harbor, 'dev-ramnique');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((frames) => frames.some((f) => f.kind === 'subscribed'), 'subscribed');

    const first = await vote(gagan, messageId, 1, 'add');
    expect(first.status).toBe(200);
    expect(first.body.message.poll.votes).toEqual([{ answerId: 1, memberIds: ['gagan'] }]);

    // Reads fold the same state in.
    const msgs = await ramnique.get(`/v1/spaces/${spaceId}/stream`);
    const m = msgs.body.messages.find((x: any) => x.id === messageId);
    expect(m.poll.votes).toEqual([{ answerId: 1, memberIds: ['gagan'] }]);

    // The move: voting B while holding A removes A and adds B atomically.
    const moved = await vote(gagan, messageId, 2, 'add');
    expect(moved.body.message.poll.votes).toEqual([{ answerId: 2, memberIds: ['gagan'] }]);

    await live.until(
      (frames) => frames.filter((f) => f.kind === 'event' && f.event.type === 'poll_vote').length >= 3,
      'vote events',
    );
    const actions = live
      .events()
      .filter((f) => f.event.type === 'poll_vote')
      .map((f) => (f.event as any).action);
    expect(actions).toEqual(['added', 'removed', 'added']);
    live.close();
  });

  it('toggles are idempotent; multiselect answers toggle independently', async () => {
    const posted = await postPoll(ramnique, {
      question: 'Pick many',
      answers: [{ text: 'A' }, { text: 'B' }],
      allowMultiselect: true,
    });
    const messageId = posted.body.message.id;

    await vote(gagan, messageId, 1, 'add');
    const both = await vote(gagan, messageId, 2, 'add');
    expect(both.body.message.poll.votes).toEqual([
      { answerId: 1, memberIds: ['gagan'] },
      { answerId: 2, memberIds: ['gagan'] },
    ]);

    const again = await vote(gagan, messageId, 1, 'add');
    expect(again.body.message.poll.votes).toEqual(both.body.message.poll.votes);
    const removed = await vote(gagan, messageId, 1, 'remove');
    expect(removed.body.message.poll.votes).toEqual([{ answerId: 2, memberIds: ['gagan'] }]);
  });

  it('agents cannot vote; unknown answers and non-poll messages refuse', async () => {
    const posted = await postPoll(ramnique, { question: 'q', answers: [{ text: 'A' }, { text: 'B' }] });
    const messageId = posted.body.message.id;
    expect((await vote(gagan, messageId, 1, 'add', 'agent')).status).toBe(400);
    expect((await vote(gagan, messageId, 9, 'add')).status).toBe(400);
    const plain = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { body: 'no poll here', actingMode: 'direct' });
    expect((await vote(gagan, plain.body.message.id, 1, 'add')).status).toBe(400);
  });

  it('poll messages cannot be edited; deletion redacts the poll everywhere', async () => {
    const posted = await postPoll(ramnique, { question: 'q', answers: [{ text: 'A' }, { text: 'B' }] });
    const messageId = posted.body.message.id;
    const edited = await ramnique.post(`/v1/spaces/${spaceId}/messages/${messageId}/edit`, {
      body: 'rewritten',
      actingMode: 'direct',
    });
    expect(edited.status).toBe(400);

    const deleted = await ramnique.post(`/v1/spaces/${spaceId}/messages/${messageId}/delete`, { actingMode: 'direct' });
    expect(deleted.body.message.poll).toBeUndefined();
    expect((await vote(gagan, messageId, 1, 'add')).status).toBe(400);

    // Replay redaction: the stored message event lost its poll with its body.
    const live = await liveClient(harbor, 'dev-gagan');
    live.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
    await live.until(
      (frames) => frames.some((f) => f.kind === 'event' && f.event.type === 'message' && f.event.message.id === messageId),
      'replayed message',
    );
    const replayed = live.events().find((f) => f.event.type === 'message' && f.event.message.id === messageId)!;
    expect((replayed.event as any).message.poll).toBeUndefined();
    expect((replayed.event as any).message.body).toBe('');
    live.close();
  });

  it('ending early is author-only and idempotent; closed polls refuse votes', async () => {
    const posted = await postPoll(ramnique, { question: 'q', answers: [{ text: 'A' }, { text: 'B' }] });
    const messageId = posted.body.message.id;
    await vote(gagan, messageId, 1, 'add');

    expect((await end(gagan, messageId)).status).toBe(403);

    const live = await liveClient(harbor, 'dev-ramnique');
    live.send({ kind: 'subscribe', spaceId });
    await live.until((frames) => frames.some((f) => f.kind === 'subscribed'), 'subscribed');

    const ended = await end(ramnique, messageId);
    expect(ended.status).toBe(200);
    expect(ended.body.message.poll.endedAt).toBeTruthy();
    expect(ended.body.message.poll.votes).toEqual([{ answerId: 1, memberIds: ['gagan'] }]);

    const again = await end(ramnique, messageId);
    expect(again.status).toBe(200);
    expect(again.body.message.poll.endedAt).toBe(ended.body.message.poll.endedAt);

    expect((await vote(gagan, messageId, 2, 'add')).status).toBe(400);
    expect((await vote(gagan, messageId, 1, 'remove')).status).toBe(400);

    // Exactly ONE poll_ended event for the two calls; reads carry endedAt.
    await live.until((frames) => frames.some((f) => f.kind === 'event' && f.event.type === 'poll_ended'), 'poll_ended');
    expect(live.events().filter((f) => f.event.type === 'poll_ended')).toHaveLength(1);
    const msgs = await gagan.get(`/v1/spaces/${spaceId}/stream`);
    const m = msgs.body.messages.find((x: any) => x.id === messageId);
    expect(m.poll.endedAt).toBe(ended.body.message.poll.endedAt);
    live.close();
  });
});

describe('read-only limit (spec §4: never lockout)', () => {
  it('writes pause, reads keep working', async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Limits' });
    const spaceId = r.body.space.id;
    await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'a.md',
      baseVersion: 0,
      newContent: 'a\n',
      actingMode: 'direct',
    });
    harbor.service.readOnly = true;
    try {
      const write = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
        assetPath: 'a.md',
        baseVersion: 1,
        newContent: 'b\n',
        actingMode: 'direct',
      });
      expect(write.status).toBe(403);
      expect(write.body.code).toBe('read_only_limit');
      const read = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=a.md`);
      expect(read.status).toBe(200);
    } finally {
      harbor.service.readOnly = false;
    }
  });
});
