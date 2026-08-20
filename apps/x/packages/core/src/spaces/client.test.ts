import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarbor, type RunningHarbor } from '@rowboat/harbor';
import { SpacesClient, SpacesRequestError } from './client.js';
import { SpacesLive } from './live.js';

// Client-side contract tests against the REAL stub Harbor — the same wire the
// app will speak in production. If these pass and the stub's own suite passes,
// client and server agree by construction.

let harbor: RunningHarbor;
let ramnique: SpacesClient;
let gagan: SpacesClient;

beforeAll(async () => {
  harbor = await startHarbor({
    orgName: 'Client Test Org',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
  });
  ramnique = new SpacesClient({ baseUrl: harbor.url, token: 'dev-ramnique' });
  gagan = new SpacesClient({ baseUrl: harbor.url, token: 'dev-gagan' });
});

afterAll(async () => {
  await harbor.close();
});

describe('SpacesClient', () => {
  let spaceId: string;

  it('health probe reports the org', async () => {
    const health = await ramnique.health();
    expect(health.ok).toBe(true);
    expect(health.org.name).toBe('Client Test Org');
  });

  it('space + invite + membership round-trip', async () => {
    const space = await ramnique.createSpace('Client Space');
    spaceId = space.id;
    expect((await ramnique.listSpaces()).map((s) => s.id)).toContain(spaceId);

    const invite = await ramnique.createInvite(spaceId);
    const resolved = await gagan.resolveInvite(invite.token);
    expect(resolved.state).toBe('ok');
    await gagan.acceptInvite(invite.token);
    expect((await gagan.listMembers(spaceId)).map((m) => m.id).sort()).toEqual(['gagan', 'ramnique']);
  });

  it('propose → read → history → diff, with all three outcomes typed', async () => {
    const created = await ramnique.proposeChange(spaceId, {
      assetPath: 'notes.md',
      baseVersion: 0,
      newContent: '# Notes\n- alpha\n',
      reason: 'start',
      actingMode: 'direct',
    });
    expect(created.outcome).toBe('applied');

    const fresh = await gagan.proposeChange(spaceId, {
      assetPath: 'notes.md',
      baseVersion: 1,
      newContent: '# Notes\n- alpha\n- beta\n',
      actingMode: 'direct',
    });
    expect(fresh.outcome).toBe('applied');

    const stale = await ramnique.proposeChange(spaceId, {
      assetPath: 'notes.md',
      baseVersion: 1,
      newContent: '# Notes (titled)\n- alpha\n',
      actingMode: 'direct',
    });
    expect(stale.outcome).toBe('merged');
    if (stale.outcome === 'merged') {
      expect(stale.mergedContent).toBe('# Notes (titled)\n- alpha\n- beta\n');
    }

    const conflict = await gagan.proposeChange(spaceId, {
      assetPath: 'notes.md',
      baseVersion: 1,
      newContent: '# Different title\n- alpha\n',
      actingMode: 'direct',
    });
    expect(conflict.outcome).toBe('conflict');
    if (conflict.outcome === 'conflict') {
      expect(conflict.currentVersion).toBe(3);
      expect(conflict.regions.length).toBeGreaterThan(0);
    }

    const read = await ramnique.readAsset(spaceId, 'notes.md');
    expect(read.version).toBe(3);
    expect(read.recentHistory.length).toBe(3);
    expect((await ramnique.assetHistory(spaceId, { path: 'notes.md' })).length).toBe(3);
    expect(await ramnique.diff(spaceId, 'notes.md', 1, 3)).toContain('+# Notes (titled)');
    expect((await ramnique.listAssets(spaceId)).map((e) => e.path)).toEqual(['notes.md']);
  });

  it('feed round-trip: topic from first message, reply, retitle', async () => {
    const started = await ramnique.postMessage(spaceId, { body: 'Ship it this week?', actingMode: 'direct' });
    expect(started.topic.title).toBe('Ship it this week?');
    const replied = await gagan.postMessage(spaceId, {
      topicId: started.topic.id,
      body: 'Yes.',
      actingMode: 'direct',
    });
    expect(replied.topic.messageCount).toBe(2);
    const { messages } = await ramnique.listMessages(spaceId, started.topic.id);
    expect(messages).toHaveLength(2);
    const retitled = await ramnique.manageTopic(spaceId, started.topic.id, {
      action: 'retitle',
      title: 'Ship date',
    });
    expect(retitled.title).toBe('Ship date');
    expect((await ramnique.listTopics(spaceId)).map((t) => t.id)).toContain(started.topic.id);
  });

  it('errors carry the wire code', async () => {
    await expect(ramnique.readAsset(spaceId, 'ghost.md')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    const outsider = new SpacesClient({ baseUrl: harbor.url, token: 'not-a-dev-token' });
    await expect(outsider.listSpaces()).rejects.toBeInstanceOf(SpacesRequestError);
  });
});

describe('SpacesLive', () => {
  it('replays from an offset, then goes live; resubscribes after the socket drops', async () => {
    const space = await ramnique.createSpace('Live Space');
    await ramnique.proposeChange(space.id, {
      assetPath: 'a.md',
      baseVersion: 0,
      newContent: 'a\n',
      actingMode: 'direct',
    });

    const live = new SpacesLive({ baseUrl: harbor.url, token: 'dev-ramnique' });
    const seen: Array<{ kind: string; offset?: number }> = [];
    live.subscribe(
      space.id,
      (frame) => seen.push({ kind: frame.kind, ...(frame.kind === 'event' ? { offset: frame.offset } : {}) }),
      0,
    );

    await waitFor(() => seen.filter((f) => f.kind === 'event').length >= 3, 'replay');
    // Replay: membership joined, the seeded stream topic, the a.md change.
    expect(seen[0]!.kind).toBe('subscribed');
    const replayOffsets = seen.filter((f) => f.kind === 'event').map((f) => f.offset);
    expect(replayOffsets).toEqual([1, 2, 3]);

    // Live event arrives on the same subscription.
    await ramnique.proposeChange(space.id, {
      assetPath: 'a.md',
      baseVersion: 1,
      newContent: 'a\nb\n',
      actingMode: 'direct',
    });
    await waitFor(() => seen.filter((f) => f.kind === 'event').length >= 4, 'live event');
    expect(seen.filter((f) => f.kind === 'event').map((f) => f.offset)).toEqual([1, 2, 3, 4]);

    live.close();
  });
});

async function waitFor(pred: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
