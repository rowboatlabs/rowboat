import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProposeChangeResult } from '@rowboat/spaces-protocol';
import { startHarbor, type RunningHarbor } from '../src/server.js';

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

describe('feed: topics and messages', () => {
  let spaceId: string;

  beforeAll(async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Feed' });
    spaceId = r.body.space.id;
    const inv = await ramnique.post('/v1/invites', { spaceId });
    await gagan.post('/v1/invites/accept', { token: inv.body.token });
  });

  it('first message creates the topic and becomes its title (markdown stripped)', async () => {
    const r = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      body: '## Should we cut the pricing section?\nIt reads long to me.',
      actingMode: 'direct',
    });
    expect(r.status).toBe(200);
    expect(r.body.topic.title).toBe('Should we cut the pricing section?');
    expect(r.body.topic.messageCount).toBe(1);
    expect(r.body.message.offset).toBeGreaterThan(0);
  });

  it('replies thread into the topic; counts and lastActivity move', async () => {
    const topics = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    const topicId = topics.body.topics[0].id;
    const r = await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      topicId,
      body: 'Cut it — link the pricing page instead.',
      actingMode: 'direct',
    });
    expect(r.body.topic.messageCount).toBe(2);
    const msgs = await ramnique.get(`/v1/spaces/${spaceId}/topics/${topicId}/messages`);
    expect(msgs.body.messages).toHaveLength(2);
    expect(msgs.body.messages[0].author.memberId).toBe('ramnique');
    expect(msgs.body.messages[1].author.memberId).toBe('gagan');
  });

  it('retitle, archive (hidden by default), unarchive-by-reply', async () => {
    const topics = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    // The seeded stream topic is not archivable chatter — operate on the discussion.
    const topicId = topics.body.topics.find((t: { kind: string }) => t.kind === 'discussion').id;

    const retitled = await ramnique.post(`/v1/spaces/${spaceId}/topics/${topicId}`, {
      action: 'retitle',
      title: 'Pricing section: cut or keep',
    });
    expect(retitled.body.topic.title).toBe('Pricing section: cut or keep');

    await ramnique.post(`/v1/spaces/${spaceId}/topics/${topicId}`, { action: 'archive' });
    const remaining = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    expect(remaining.body.topics.map((t: { kind: string }) => t.kind)).toEqual(['general']);
    const withArchived = await ramnique.get(`/v1/spaces/${spaceId}/topics?includeArchived=true`);
    expect(withArchived.body.topics).toHaveLength(2);

    const reply = await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      topicId,
      body: 'Reviving this — Acme asked about pricing again.',
      actingMode: 'direct',
    });
    expect(reply.body.topic.archived).toBe(false);
  });

  it('topics anchored to a change-set validate the anchor', async () => {
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
    expect(ok.body.topic.anchorChangeSetId).toBe(cs.body.changeSet.id);

    const bad = await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'Anchored to nothing',
      anchorChangeSetId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      actingMode: 'direct',
    });
    expect(bad.status).toBe(400);
  });

  it('every space is born with its stream topic — exactly one, kind general, empty', async () => {
    const r = await ramnique.post('/v1/spaces', { name: 'Born with a stream' });
    const topics = await ramnique.get(`/v1/spaces/${r.body.space.id}/topics`);
    const generals = topics.body.topics.filter((t: any) => t.kind === 'general');
    expect(generals).toHaveLength(1);
    expect(generals[0]).toMatchObject({ title: 'messages', messageCount: 0, archived: false });
    expect(topics.body.topics).toHaveLength(1);
  });

  it('a topic can grow from a message — once, and the anchor must exist', async () => {
    const topics = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    const general = topics.body.topics.find((t: any) => t.kind === 'general');
    const parent = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      topicId: general.id,
      body: 'The launch date question keeps coming back.',
      actingMode: 'direct',
    });

    const thread = await gagan.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'The launch date question keeps coming back.',
      anchorMessageId: parent.body.message.id,
      actingMode: 'direct',
    });
    expect(thread.status).toBe(200);
    expect(thread.body.topic.kind).toBe('discussion');
    expect(thread.body.topic.anchorMessageId).toBe(parent.body.message.id);

    // One topic per message: a second claim is refused and names the winner.
    const again = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'Me too',
      anchorMessageId: parent.body.message.id,
      actingMode: 'direct',
    });
    expect(again.status).toBe(400);
    expect(again.body.message).toContain(thread.body.topic.id);

    const dangling = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'Anchored to nothing',
      anchorMessageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      actingMode: 'direct',
    });
    expect(dangling.status).toBe(400);
  });

  it('change-sets carry topic provenance — explicit topicId validated, reason suffix derived', async () => {
    const topics = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    const topicId = topics.body.topics[0].id;

    const explicit = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'provenance.md',
      baseVersion: 0,
      newContent: '# From a topic\n',
      topicId,
      actingMode: 'direct',
    });
    expect(explicit.body.changeSet.topicId).toBe(topicId);

    const derived = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'provenance.md',
      baseVersion: 1,
      newContent: '# From a topic, via the reason suffix\n',
      reason: `folded the discussion · topic:${topicId}`,
      actingMode: 'agent',
      agentName: 'Rowboat',
    });
    expect(derived.body.changeSet.topicId).toBe(topicId);

    const bad = await ramnique.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'provenance.md',
      baseVersion: 2,
      newContent: '# Bad provenance\n',
      topicId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      actingMode: 'direct',
    });
    expect(bad.status).toBe(400);
  });

  it('merge_into moves messages, archives the source, returns the target', async () => {
    const a = await ramnique.post(`/v1/spaces/${spaceId}/messages`, { body: 'SSO scoping', actingMode: 'direct' });
    const b = await gagan.post(`/v1/spaces/${spaceId}/messages`, { body: 'SSO scoping (dup)', actingMode: 'direct' });
    const merged = await ramnique.post(`/v1/spaces/${spaceId}/topics/${b.body.topic.id}`, {
      action: 'merge_into',
      targetTopicId: a.body.topic.id,
    });
    expect(merged.body.topic.id).toBe(a.body.topic.id);
    expect(merged.body.topic.messageCount).toBe(2);
    const msgs = await ramnique.get(`/v1/spaces/${spaceId}/topics/${a.body.topic.id}/messages`);
    expect(msgs.body.messages.map((m: any) => m.body)).toEqual(['SSO scoping', 'SSO scoping (dup)']);
    const all = await ramnique.get(`/v1/spaces/${spaceId}/topics?includeArchived=true`);
    expect(all.body.topics.find((t: any) => t.id === b.body.topic.id)?.archived).toBe(true);
    expect((await ramnique.post(`/v1/spaces/${spaceId}/topics/${a.body.topic.id}`, {
      action: 'merge_into',
      targetTopicId: a.body.topic.id,
    })).status).toBe(400);
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
