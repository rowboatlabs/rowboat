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

  it('feed round-trip: root into the stream, flat reply, promote + retitle', async () => {
    const started = await ramnique.postMessage(spaceId, { body: 'Ship it this week?', actingMode: 'direct' });
    expect(started.message.threadRoot).toBeUndefined();
    const replied = await gagan.postMessage(spaceId, {
      threadRoot: started.message.id,
      body: 'Yes.',
      actingMode: 'direct',
    });
    expect(replied.message.threadRoot).toBe(started.message.id);
    const thread = await ramnique.listThread(spaceId, started.message.id);
    expect(thread.root.replyCount).toBe(1);
    expect(thread.topic).toBeNull();
    expect(thread.messages).toHaveLength(1);

    const { topic } = await ramnique.createTopic(spaceId, {
      rootMessageId: started.message.id,
      title: 'Decide: ship date',
      actingMode: 'direct',
    });
    const retitled = await ramnique.manageTopic(spaceId, topic.id, {
      action: 'retitle',
      title: 'Decide: ship date (v2)',
      actingMode: 'direct',
    });
    expect(retitled.title).toBe('Decide: ship date (v2)');
    const listed = await ramnique.listTopics(spaceId);
    expect(listed.map((t) => t.id)).toContain(topic.id);
    // listTopics always carries the root message (no per-topic fetch).
    expect(listed.find((t) => t.id === topic.id)?.rootMessage?.id).toBe(started.message.id);
  });

  it('the stream windows newest-first and pages back by offset, roots only', async () => {
    const roots: string[] = [];
    for (const body of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      const posted = await ramnique.postMessage(spaceId, { body, actingMode: 'direct' });
      roots.push(posted.message.id);
    }
    // A reply must never appear in the stream window.
    await ramnique.postMessage(spaceId, { threadRoot: roots[0]!, body: 'a reply', actingMode: 'direct' });
    const latest = await ramnique.listStream(spaceId, { limit: 2 });
    expect(latest.messages.map((m) => m.body)).toEqual(['p4', 'p5']);
    expect(latest.hasMore).toBe(true);
    const older = await ramnique.listStream(spaceId, {
      limit: 2,
      beforeOffset: latest.messages[0]!.offset,
    });
    expect(older.messages.map((m) => m.body)).toEqual(['p2', 'p3']);
    expect(older.hasMore).toBe(true);
  });

  it('reactions toggle and fold into message reads', async () => {
    const started = await ramnique.postMessage(spaceId, { body: 'Reaction target', actingMode: 'direct' });
    const messageId = started.message.id;

    const one = await gagan.reactToMessage(spaceId, messageId, { emoji: '👍', action: 'add', actingMode: 'direct' });
    expect(one.reactions).toEqual([{ emoji: '👍', memberIds: ['gagan'] }]);
    const two = await ramnique.reactToMessage(spaceId, messageId, { emoji: '👍', action: 'add', actingMode: 'direct' });
    expect(two.reactions).toEqual([{ emoji: '👍', memberIds: ['gagan', 'ramnique'] }]);

    const { messages } = await gagan.listStream(spaceId);
    expect(messages.find((m) => m.id === messageId)?.reactions).toEqual(two.reactions);

    const removed = await gagan.reactToMessage(spaceId, messageId, { emoji: '👍', action: 'remove', actingMode: 'direct' });
    expect(removed.reactions).toEqual([{ emoji: '👍', memberIds: ['ramnique'] }]);
  });

  it('deletion tombstones the message: author-only, body gone from reads', async () => {
    const started = await ramnique.postMessage(spaceId, { body: 'posted in the wrong space', actingMode: 'direct' });
    const messageId = started.message.id;

    await expect(gagan.deleteMessage(spaceId, messageId, { actingMode: 'direct' })).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });

    const deleted = await ramnique.deleteMessage(spaceId, messageId, { actingMode: 'direct' });
    expect(deleted.body).toBe('');
    expect(deleted.deletedAt).toBeTruthy();

    const { messages } = await gagan.listStream(spaceId);
    const tombstone = messages.find((m) => m.id === messageId);
    expect(tombstone?.body).toBe('');
    expect(tombstone?.deletedAt).toBe(deleted.deletedAt);
  });

  it('blob upload → binary propose → listing → fetch round-trip', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 pretend-pdf payload');
    const blob = await ramnique.uploadBlob(spaceId, bytes, { declaredMime: 'application/pdf' });
    expect(blob.mime).toBe('application/pdf');
    expect(blob.size).toBe(bytes.byteLength);
    expect(blob.hash).toMatch(/^[0-9a-f]{64}$/);

    const proposed = await ramnique.proposeChange(spaceId, {
      assetPath: 'docs/spec.pdf',
      baseVersion: 0,
      blob: blob.hash,
      reason: 'attach the spec',
      actingMode: 'direct',
    });
    expect(proposed.outcome).toBe('applied');
    if (proposed.outcome === 'applied') expect(proposed.changeSet.blob?.hash).toBe(blob.hash);

    const entries = await ramnique.listAssets(spaceId);
    expect(entries.find((e) => e.path === 'docs/spec.pdf')?.blob?.mime).toBe('application/pdf');

    const fetched = await ramnique.fetchBlob(spaceId, blob.hash);
    expect(Buffer.from(fetched.bytes)).toEqual(Buffer.from(bytes));
    expect(fetched.mime).toBe('application/pdf');

    // Never-uploaded hashes are not_found (membership/space gating is the stub suite's job).
    await expect(ramnique.fetchBlob(spaceId, 'f'.repeat(64))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('move → redirect-aware read → delete → trash listing → restore round-trip', async () => {
    await ramnique.proposeChange(spaceId, {
      assetPath: 'tmp/scratch.md', baseVersion: 0, newContent: 'scratch\n', actingMode: 'direct',
    });
    const moved = await ramnique.moveAsset(spaceId, {
      fromPath: 'tmp/scratch.md', toPath: 'notes/scratch.md', baseVersion: 1, reason: 'tidy', actingMode: 'direct',
    });
    expect(moved.outcome).toBe('moved');
    if (moved.outcome === 'moved') expect(moved.changeSet).toMatchObject({ op: 'move', movedFrom: 'tmp/scratch.md' });

    // Old links answer with the file's CURRENT path — the client's redirect signal.
    const read = await ramnique.readAsset(spaceId, 'tmp/scratch.md');
    expect(read.path).toBe('notes/scratch.md');

    const deleted = await ramnique.deleteAsset(spaceId, {
      path: 'notes/scratch.md', baseVersion: 1, reason: 'done with it', actingMode: 'direct',
    });
    expect(deleted.outcome).toBe('deleted');
    expect((await ramnique.listAssets(spaceId)).map((e) => e.path)).not.toContain('notes/scratch.md');
    const trash = await ramnique.listAssets(spaceId, { includeDeleted: true });
    expect(trash.find((e) => e.path === 'notes/scratch.md')?.state).toBe('deleted');

    const restored = await ramnique.restoreAsset(spaceId, { path: 'notes/scratch.md', actingMode: 'direct' });
    expect(restored.outcome).toBe('restored');
    expect((await ramnique.readAsset(spaceId, 'notes/scratch.md')).content).toBe('scratch\n');
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

    await waitFor(() => seen.filter((f) => f.kind === 'event').length >= 2, 'replay');
    // Replay: membership joined, the a.md change (the stream is not an object).
    expect(seen[0]!.kind).toBe('subscribed');
    const replayOffsets = seen.filter((f) => f.kind === 'event').map((f) => f.offset);
    expect(replayOffsets).toEqual([1, 2]);

    // Live event arrives on the same subscription.
    await ramnique.proposeChange(space.id, {
      assetPath: 'a.md',
      baseVersion: 1,
      newContent: 'a\nb\n',
      actingMode: 'direct',
    });
    await waitFor(() => seen.filter((f) => f.kind === 'event').length >= 3, 'live event');
    expect(seen.filter((f) => f.kind === 'event').map((f) => f.offset)).toEqual([1, 2, 3]);

    live.close();
  });

  it('whiteboard frames round-trip: opaque payload out, sender-stamped frame in', async () => {
    const space = await ramnique.createSpace('Board Space');
    const invite = await ramnique.createInvite(space.id);
    await gagan.acceptInvite(invite.token);

    const watcher = new SpacesLive({ baseUrl: harbor.url, token: 'dev-ramnique' });
    const frames: Array<{ boardId: string; memberId: string; payload: unknown }> = [];
    watcher.subscribe(space.id, (frame) => {
      if (frame.kind === 'whiteboard') frames.push({ boardId: frame.boardId, memberId: frame.memberId, payload: frame.payload });
    });
    await waitFor(() => watcher.status === 'open', 'watcher socket open');

    const drawer = new SpacesLive({ baseUrl: harbor.url, token: 'dev-gagan' });
    drawer.subscribe(space.id, () => {});
    await waitFor(() => drawer.status === 'open', 'drawer socket open');

    // The payload is app vocabulary the org must relay untouched.
    const payload = { t: 'scene', clientId: 'pane-1', syncAll: false, elements: [{ id: 'rect', version: 2 }] };
    drawer.whiteboard(space.id, 'whiteboards/board.excalidraw', payload);

    await waitFor(() => frames.length >= 1, 'whiteboard frame');
    expect(frames[0]).toEqual({ boardId: 'whiteboards/board.excalidraw', memberId: 'gagan', payload });

    watcher.close();
    drawer.close();
  });
});

describe('SpacesLive liveness', () => {
  it('the watchdog bounces a silent socket and the stream resumes; new events still arrive', async () => {
    // A harbor whose heartbeat effectively never fires is the client's-eye
    // view of a half-open socket after sleep: OPEN, silent, no close coming.
    const silent = await startHarbor({
      orgName: 'Silent Org',
      seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
      liveHeartbeatMs: 3_600_000,
    });
    try {
      const client = new SpacesClient({ baseUrl: silent.url, token: 'dev-ramnique' });
      const space = await client.createSpace('Liveness');
      await client.proposeChange(space.id, { assetPath: 'a.md', baseVersion: 0, newContent: 'a\n', actingMode: 'direct' });

      const live = new SpacesLive({
        baseUrl: silent.url,
        token: 'dev-ramnique',
        staleAfterMs: 250,
        watchdogTickMs: 60,
      });
      const frames: Array<{ kind: string }> = [];
      live.subscribe(space.id, (frame) => frames.push({ kind: frame.kind }), 0);
      const subscribes = () => frames.filter((f) => f.kind === 'subscribed').length;

      await waitFor(() => subscribes() >= 1, 'first subscribe');
      // No beacons arrive → the watchdog presumes the socket dead, drops it,
      // and the reconnect machinery resubscribes on its own.
      await waitFor(() => subscribes() >= 2, 'watchdog resubscribe', 5000);

      // The resumed stream still carries new durable events (offset resume).
      const eventsBefore = frames.filter((f) => f.kind === 'event').length;
      await client.proposeChange(space.id, { assetPath: 'a.md', baseVersion: 1, newContent: 'a\nb\n', actingMode: 'direct' });
      await waitFor(() => frames.filter((f) => f.kind === 'event').length > eventsBefore, 'event after bounce', 5000);

      live.close();
    } finally {
      await silent.close();
    }
  });
});

async function waitFor(pred: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
