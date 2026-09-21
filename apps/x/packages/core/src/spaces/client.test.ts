import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgStore, pgliteDb, startHarbor, type RunningHarbor } from '@rowboat/harbor';
import { SpacesClient, SpacesRequestError } from './client.js';
import { SpacesLive } from './live.js';

// Client-side contract tests against the REAL stub Harbor — the same wire the
// app will speak in production. If these pass and the stub's own suite passes,
// client and server agree by construction.

let harbor: RunningHarbor;
let ramnique: SpacesClient;
let gagan: SpacesClient;

/** A harbor over its own in-process Postgres (PGlite) — the store the server's own tests run on; close() takes it down too. */
async function startTestHarbor(options: Omit<Parameters<typeof startHarbor>[0], 'store'>): Promise<RunningHarbor> {
  const db = await pgliteDb();
  const store = new PgStore(db);
  await store.init();
  const started = await startHarbor({ ...options, store });
  return {
    ...started,
    close: async () => {
      await started.close();
      await db.close();
    },
  };
}

beforeAll(async () => {
  harbor = await startTestHarbor({
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

  it('create → propose → read → history → diff, with all three outcomes typed', async () => {
    // Birth is the one path-shaped call; everything after addresses the id.
    const born = await ramnique.createAsset(spaceId, {
      path: 'notes.md',
      newContent: '# Notes\n- alpha\n',
      reason: 'start',
      actingMode: 'direct',
    });
    const notes = born.asset.id;
    expect(born.asset).toMatchObject({ path: 'notes.md', version: 1 });
    expect(born.changeSet.assetId).toBe(notes);

    const fresh = await gagan.proposeChange(spaceId, {
      assetId: notes,
      baseVersion: 1,
      newContent: '# Notes\n- alpha\n- beta\n',
      actingMode: 'direct',
    });
    expect(fresh.outcome).toBe('applied');

    const stale = await ramnique.proposeChange(spaceId, {
      assetId: notes,
      baseVersion: 1,
      newContent: '# Notes (titled)\n- alpha\n',
      actingMode: 'direct',
    });
    expect(stale.outcome).toBe('merged');
    if (stale.outcome === 'merged') {
      expect(stale.mergedContent).toBe('# Notes (titled)\n- alpha\n- beta\n');
    }

    const conflict = await gagan.proposeChange(spaceId, {
      assetId: notes,
      baseVersion: 1,
      newContent: '# Different title\n- alpha\n',
      actingMode: 'direct',
    });
    expect(conflict.outcome).toBe('conflict');
    if (conflict.outcome === 'conflict') {
      expect(conflict.currentVersion).toBe(3);
      expect(conflict.regions.length).toBeGreaterThan(0);
    }

    const read = await ramnique.readAsset(spaceId, notes);
    expect(read).toMatchObject({ id: notes, path: 'notes.md', version: 3 });
    expect(read.recentHistory.length).toBe(3);
    expect((await ramnique.assetHistory(spaceId, { assetId: notes })).length).toBe(3);
    expect(await ramnique.diff(spaceId, notes, 1, 3)).toContain('+# Notes (titled)');
    expect((await ramnique.listAssets(spaceId)).map((e) => [e.id, e.path])).toEqual([[notes, 'notes.md']]);
    // A second file at a live path is refused — the path is a name, unique among the living.
    await expect(
      ramnique.createAsset(spaceId, { path: 'notes.md', newContent: 'dup\n', actingMode: 'direct' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
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

  it('search returns categorized hits with mention expansion over the wire', async () => {
    await ramnique.postMessage(spaceId, { body: 'hey @gagan the quarterly numbers landed', actingMode: 'direct' });
    const quarterly = await ramnique.createAsset(spaceId, {
      path: 'finance/quarterly.md',
      newContent: 'Quarterly numbers: all green.',
      actingMode: 'direct',
    });

    const results = await ramnique.search(spaceId, { q: 'quarterly' });
    expect(results.messages.length).toBe(1);
    expect(results.messages[0]!.snippet).toContain('quarterly numbers');
    // File hits carry the id — the discovery surface for every later call.
    expect(results.assets.map((a) => [a.id, a.path])).toContainEqual([quarterly.asset.id, 'finance/quarterly.md']);
    expect(results.truncated.messages).toBe(false);

    // "gagan" is a display name — the hit is the @-mention of the member id.
    const byName = await ramnique.search(spaceId, { q: 'gagan numbers', kinds: ['messages'] });
    expect(byName.messages.length).toBe(1);
    expect(byName.assets).toEqual([]);
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

  it('pages around and forward: the params reach the org and the window lands on the row', async () => {
    const all = await ramnique.listStream(spaceId, { limit: 200 });
    expect(all.messages.length).toBeGreaterThanOrEqual(3);
    const target = all.messages[1]!;
    const around = await ramnique.listStream(spaceId, { aroundOffset: target.offset, limit: 2 });
    expect(around.messages.map((m) => m.id)).toEqual([all.messages[0]!.id, target.id]);
    expect(around.hasMoreAfter).toBe(all.messages.length > 2);
    const after = await ramnique.listStream(spaceId, { afterOffset: target.offset, limit: 200 });
    expect(after.messages.map((m) => m.id)).toEqual(all.messages.slice(2).map((m) => m.id));
    expect(after.hasMoreAfter).toBe(false);
  });

  it('reactions toggle and fold into message reads', async () => {
    const started = await ramnique.postMessage(spaceId, { body: 'Reaction target', actingMode: 'direct' });
    const messageId = started.message.id;

    const one = await gagan.reactToMessage(spaceId, messageId, { emoji: '👍', action: 'add', actingMode: 'direct' });
    expect(one.reactions).toEqual([{ emoji: '👍', memberIds: ['gagan'], lastOffset: expect.any(Number) }]);
    const two = await ramnique.reactToMessage(spaceId, messageId, { emoji: '👍', action: 'add', actingMode: 'direct' });
    expect(two.reactions).toEqual([{ emoji: '👍', memberIds: ['gagan', 'ramnique'], lastOffset: expect.any(Number) }]);

    const { messages } = await gagan.listStream(spaceId);
    expect(messages.find((m) => m.id === messageId)?.reactions).toEqual(two.reactions);

    const removed = await gagan.reactToMessage(spaceId, messageId, { emoji: '👍', action: 'remove', actingMode: 'direct' });
    expect(removed.reactions).toEqual([{ emoji: '👍', memberIds: ['ramnique'], lastOffset: expect.any(Number) }]);
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

    const born = await ramnique.createAsset(spaceId, {
      path: 'docs/spec.pdf',
      blob: blob.hash,
      reason: 'attach the spec',
      actingMode: 'direct',
    });
    expect(born.changeSet.blob?.hash).toBe(blob.hash);

    const entries = await ramnique.listAssets(spaceId);
    expect(entries.find((e) => e.id === born.asset.id)?.blob?.mime).toBe('application/pdf');

    const fetched = await ramnique.fetchBlob(spaceId, blob.hash);
    expect(Buffer.from(fetched.bytes)).toEqual(Buffer.from(bytes));
    expect(fetched.mime).toBe('application/pdf');

    // Never-uploaded hashes are not_found (membership/space gating is the stub suite's job).
    await expect(ramnique.fetchBlob(spaceId, 'f'.repeat(64))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('move → same-id read → delete → trash listing → restore round-trip', async () => {
    const scratch = (await ramnique.createAsset(spaceId, {
      path: 'tmp/scratch.md', newContent: 'scratch\n', actingMode: 'direct',
    })).asset.id;
    const moved = await ramnique.moveAsset(spaceId, {
      assetId: scratch, toPath: 'notes/scratch.md', baseVersion: 1, reason: 'tidy', actingMode: 'direct',
    });
    expect(moved.outcome).toBe('moved');
    if (moved.outcome === 'moved') expect(moved.changeSet).toMatchObject({ op: 'move', assetId: scratch, assetPath: 'notes/scratch.md', movedFrom: 'tmp/scratch.md' });

    // The id is the identity: the same read answers with the file's CURRENT path.
    const read = await ramnique.readAsset(spaceId, scratch);
    expect(read.path).toBe('notes/scratch.md');

    const deleted = await ramnique.deleteAsset(spaceId, {
      assetId: scratch, baseVersion: 1, reason: 'done with it', actingMode: 'direct',
    });
    expect(deleted.outcome).toBe('deleted');
    expect((await ramnique.listAssets(spaceId)).map((e) => e.id)).not.toContain(scratch);
    const trash = await ramnique.listAssets(spaceId, { includeDeleted: true });
    expect(trash.find((e) => e.id === scratch)).toMatchObject({ path: 'notes/scratch.md', state: 'deleted' });
    // A trashed file is not readable — it must be restored first.
    await expect(ramnique.readAsset(spaceId, scratch)).rejects.toMatchObject({ code: 'not_found' });

    const restored = await ramnique.restoreAsset(spaceId, { assetId: scratch, actingMode: 'direct' });
    expect(restored.outcome).toBe('restored');
    expect((await ramnique.readAsset(spaceId, scratch)).content).toBe('scratch\n');
  });

  it('direct messages: get-or-create from either side, hidden unless asked, fixed membership', async () => {
    const opened = await ramnique.openDirect('gagan');
    expect(opened.created).toBe(true);
    expect(opened.space.kind).toBe('direct');
    expect(opened.space.participants).toEqual(['gagan', 'ramnique']);
    const again = await gagan.openDirect('ramnique');
    expect(again).toMatchObject({ created: false, space: { id: opened.space.id } });
    expect((await ramnique.listSpaces()).some((s) => s.id === opened.space.id)).toBe(false);
    expect((await gagan.listSpaces({ includeDirect: true })).some((s) => s.id === opened.space.id)).toBe(true);
    await expect(ramnique.createInvite(opened.space.id)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(gagan.leaveSpace(opened.space.id)).rejects.toMatchObject({ code: 'invalid_request' });
    // Your own id = your self-DM, one participant.
    const notes = await ramnique.openDirect('ramnique');
    expect(notes.space).toMatchObject({ kind: 'direct', participants: ['ramnique'] });
    expect((await ramnique.openDirect('ramnique')).created).toBe(false);
    // The org roster is the union of your spaces (DMs included), deduped, A–Z.
    expect((await ramnique.listOrgMembers()).map((m) => m.id)).toEqual(['gagan', 'ramnique']);
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

describe('SpacesClient.listOrgMembers', () => {
  // The org computes the roster (union of the caller's spaces, DMs included,
  // deduped, A–Z); the client's job is one GET on the route's path with the
  // bearer, and the contract check on the way back. Mocked fetch: the route
  // is protocol-declared, and this pins the wire shape the app relies on.
  function fakeFetch(body: unknown, status = 200) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('GETs /v1/members with the bearer and returns the members list', async () => {
    const members = [
      { id: 'gagan', displayName: 'Gagan', role: 'member' },
      { id: 'ramnique', displayName: 'Ramnique', role: 'member' },
    ];
    const { calls, fetchImpl } = fakeFetch({ members });
    const client = new SpacesClient({ baseUrl: 'http://org.test/', token: 'dev-ramnique', fetchImpl });
    expect(await client.listOrgMembers()).toEqual(members);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://org.test/v1/members');
    expect(calls[0].init?.method).toBe('GET');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer dev-ramnique');
  });

  it('rejects a response that breaks the contract', async () => {
    const { fetchImpl } = fakeFetch({ people: [] });
    const client = new SpacesClient({ baseUrl: 'http://org.test', token: 'dev-ramnique', fetchImpl });
    await expect(client.listOrgMembers()).rejects.toMatchObject({ name: 'SpacesRequestError', code: 'internal' });
  });

  it('surfaces the wire error for an org that does not serve the route', async () => {
    const { fetchImpl } = fakeFetch({ code: 'not_found', message: 'no such route', retryable: false }, 404);
    const client = new SpacesClient({ baseUrl: 'http://org.test', token: 'dev-ramnique', fetchImpl });
    await expect(client.listOrgMembers()).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('SpacesClient transport failures', () => {
  // The dev-org-left-behind case (2026-09-14): an org whose Harbor is not
  // running failed as a bare "fetch failed" with the errno dropped before it
  // reached any log. The client owns naming the org and the cause.
  it('names the org and the errno when nothing is listening', async () => {
    const closed = await (async () => {
      const { createServer } = await import('node:net');
      const srv = createServer();
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
      const port = (srv.address() as { port: number }).port;
      await new Promise<void>((r) => srv.close(() => r()));
      return port;
    })();
    const client = new SpacesClient({ baseUrl: `http://127.0.0.1:${closed}`, token: 'dev-ramnique' });
    const err = await client.listSpaces().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpacesRequestError);
    expect(err).toMatchObject({ status: 0, code: 'unreachable', retryable: true });
    expect((err as Error).message).toBe(`Rowboat org at http://127.0.0.1:${closed} is unreachable (ECONNREFUSED)`);
  });

  it('digs the code out of a nested cause and falls back to the deepest message', async () => {
    const withCode = (async () => {
      throw new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('connect ECONNREFUSED ::1:1'), { code: 'ECONNREFUSED' })]) });
    }) as typeof fetch;
    await expect(new SpacesClient({ baseUrl: 'http://org.test', token: 't', fetchImpl: withCode }).health()).rejects.toMatchObject({
      code: 'unreachable',
      message: 'Rowboat org at http://org.test is unreachable (ECONNREFUSED)',
    });
    const noCode = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('other side closed') });
    }) as typeof fetch;
    await expect(new SpacesClient({ baseUrl: 'http://org.test', token: 't', fetchImpl: noCode }).health()).rejects.toMatchObject({
      message: 'Rowboat org at http://org.test is unreachable (other side closed)',
    });
  });
});

describe('SpacesLive', () => {
  it('replays from an offset, then goes live; resubscribes after the socket drops', async () => {
    const space = await ramnique.createSpace('Live Space');
    const a = (await ramnique.createAsset(space.id, { path: 'a.md', newContent: 'a\n', actingMode: 'direct' })).asset.id;

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
      assetId: a,
      baseVersion: 1,
      newContent: 'a\nb\n',
      actingMode: 'direct',
    });
    await waitFor(() => seen.filter((f) => f.kind === 'event').length >= 3, 'live event');
    expect(seen.filter((f) => f.kind === 'event').map((f) => f.offset)).toEqual([1, 2, 3]);

    live.close();
  });

  it('a member-addressed space_added frame reaches the other participant without any subscription', async () => {
    await harbor.store.putMember({ id: 'harsh', displayName: 'Harsh', role: 'member' });
    const harsh = new SpacesLive({ baseUrl: harbor.url, token: 'dev-harsh' });
    const added: Array<{ spaceId: string; by: string }> = [];
    harsh.onMemberFrame((frame) => {
      if (frame.kind === 'space_added') added.push({ spaceId: frame.spaceId, by: frame.by });
    });
    await waitFor(() => harsh.status === 'open', 'harsh socket open (no subscriptions, just the member handler)');

    const opened = await ramnique.openDirect('harsh');
    await waitFor(() => added.length >= 1, 'space_added frame');
    expect(added[0]).toEqual({ spaceId: opened.space.id, by: 'ramnique' });
    harsh.close();
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
    const silent = await startTestHarbor({
      orgName: 'Silent Org',
      seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
      liveHeartbeatMs: 3_600_000,
    });
    try {
      const client = new SpacesClient({ baseUrl: silent.url, token: 'dev-ramnique' });
      const space = await client.createSpace('Liveness');
      const a = (await client.createAsset(space.id, { path: 'a.md', newContent: 'a\n', actingMode: 'direct' })).asset.id;

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
      await client.proposeChange(space.id, { assetId: a, baseVersion: 1, newContent: 'a\nb\n', actingMode: 'direct' });
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

describe('read state', () => {
  it('marks are org-owned offsets: posting reads, marking clears, the snapshot agrees', async () => {
    const space = await ramnique.createSpace('Read marks');
    const invite = await ramnique.createInvite(space.id);
    await gagan.acceptInvite(invite.token);

    const { message } = await ramnique.postMessage(space.id, { body: 'hello', actingMode: 'direct' });
    const before = (await gagan.unread()).spaces.find((s) => s.spaceId === space.id)!;
    expect(before).toMatchObject({ readOffset: 0, unreadRoots: 1, threads: [] });
    expect((await gagan.listStream(space.id)).readOffset).toBe(0);

    expect(await gagan.markRead(space.id, { offset: message.offset })).toEqual({ readOffset: message.offset });
    expect((await gagan.unread()).spaces.find((s) => s.spaceId === space.id)).toMatchObject({ unreadRoots: 0, readOffset: message.offset });

    // Replying follows; the root's author follows from that reply on.
    const { message: reply } = await gagan.postMessage(space.id, { threadRoot: message.id, body: 'hi back', actingMode: 'direct' });
    expect(await gagan.listThread(space.id, message.id)).toMatchObject({ following: true, readOffset: reply.offset });
    expect((await ramnique.unread()).spaces.find((s) => s.spaceId === space.id)!.threads).toEqual([
      { rootMessageId: message.id, readOffset: message.offset, lastReplyOffset: reply.offset, unreadReplies: 1, unreadMentions: 0 },
    ]);
    expect(await ramnique.followThread(space.id, message.id, false)).toEqual({ following: false, readOffset: message.offset });
    expect((await ramnique.unread()).spaces.find((s) => s.spaceId === space.id)!.threads).toEqual([]);
  });
});
