import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Label, LabelListing, Message, TopicListing } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';
import { liveClient, type LiveClient } from './helpers.js';

// Labels ("topics" in the UI, 2026-08-25): explicit member-created groupings.
// One label per message; a thread inherits its anchor message's label by
// derivation; the sidebar lists only labels someone made. Runs on both
// stores, the §11 dual gate.

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let live: LiveClient;
let spaceId: string;
let generalId: string;
let m1: Message;
let m2: Message;
let launch: Label;

function api(token: string) {
  return {
    async get(path: string) {
      const res = await fetch(`${harbor.url}${path}`, { headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, body: (await res.json()) as any };
    },
    async post(path: string, body?: unknown) {
      const res = await fetch(`${harbor.url}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      return { status: res.status, body: (await res.json()) as any };
    },
  };
}

let ramnique: ReturnType<typeof api>;
let gagan: ReturnType<typeof api>;

describe.each([['memory'], ['postgres']] as const)('labels (%s store)', (storeKind) => {
  beforeAll(async () => {
    const options: HarborOptions = {
      orgName: 'Label Test Org',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'gagan', displayName: 'Gagan' },
      ],
    };
    if (storeKind === 'postgres') {
      sqlDb = await pgliteDb();
      const store = new PgStore(sqlDb);
      await store.init();
      options.store = store;
    }
    harbor = await startHarbor(options);
    ramnique = api('dev-ramnique');
    gagan = api('dev-gagan');
    const created = await ramnique.post('/v1/spaces', { name: 'Labelled' });
    spaceId = created.body.space.id;
    const invite = await ramnique.post('/v1/invites', { spaceId });
    await gagan.post('/v1/invites/accept', { token: invite.body.token });
    const topics = await ramnique.get(`/v1/spaces/${spaceId}/topics`);
    generalId = (topics.body.topics as TopicListing[]).find((t) => t.kind === 'general')!.id;
    m1 = (await ramnique.post(`/v1/spaces/${spaceId}/messages`, { topicId: generalId, body: 'ship the launch email', actingMode: 'direct' })).body.message;
    m2 = (await gagan.post(`/v1/spaces/${spaceId}/messages`, { topicId: generalId, body: 'draft is in the doc', actingMode: 'direct' })).body.message;
    live = await liveClient(harbor, 'dev-ramnique');
    live.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
  });

  afterAll(async () => {
    live.close();
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('creates a label and lists it with zero messages', async () => {
    const res = await ramnique.post(`/v1/spaces/${spaceId}/labels`, { name: 'Launch', actingMode: 'direct' });
    expect(res.status).toBe(200);
    launch = res.body.label;
    expect(launch.name).toBe('Launch');
    expect(launch.archived).toBe(false);
    const listed = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    expect((listed.body.labels as LabelListing[]).map((l) => [l.id, l.messageCount])).toEqual([[launch.id, 0]]);
  });

  it('create is get-or-create, case- and whitespace-insensitively — no duplicate labels', async () => {
    const again = await gagan.post(`/v1/spaces/${spaceId}/labels`, { name: '  LAUNCH ', actingMode: 'direct' });
    expect(again.status).toBe(200);
    expect(again.body.label.id).toBe(launch.id);
    expect(again.body.label.name).toBe('Launch');
  });

  it('any member labels any message; reads fold the current labelId in', async () => {
    const res = await gagan.post(`/v1/spaces/${spaceId}/messages/${m1.id}/label`, { labelId: launch.id, actingMode: 'direct' });
    expect(res.status).toBe(200);
    expect(res.body.message.labelId).toBe(launch.id);
    const read = await ramnique.get(`/v1/spaces/${spaceId}/topics/${generalId}/messages`);
    const readM1 = (read.body.messages as Message[]).find((m) => m.id === m1.id)!;
    expect(readM1.labelId).toBe(launch.id);
    expect((read.body.messages as Message[]).find((m) => m.id === m2.id)!.labelId).toBeUndefined();
  });

  it('a thread anchored on a labelled message counts as that label\'s activity', async () => {
    const thread = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      anchorMessageId: m1.id,
      body: 'ship the launch email\n\n<!-- rowboat:topic parent=msg:x by=y at=z -->',
      actingMode: 'direct',
    });
    expect(thread.status).toBe(200);
    const reply = await gagan.post(`/v1/spaces/${spaceId}/messages`, { topicId: thread.body.topic.id, body: 'on it', actingMode: 'direct' });
    expect(reply.status).toBe(200);
    const listed = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    const row = (listed.body.labels as LabelListing[]).find((l) => l.id === launch.id)!;
    // Only m1 carries the label — thread replies inherit, they are not tagged rows.
    expect(row.messageCount).toBe(1);
    expect(row.lastActivityAt >= reply.body.message.postedAt).toBe(true);
  });

  it('lists a label\'s messages with the listMessages window semantics', async () => {
    await ramnique.post(`/v1/spaces/${spaceId}/messages/${m2.id}/label`, { labelId: launch.id, actingMode: 'direct' });
    const all = await ramnique.get(`/v1/spaces/${spaceId}/labels/${launch.id}/messages`);
    expect(all.status).toBe(200);
    expect((all.body.messages as Message[]).map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(all.body.hasMore).toBe(false);
    const newest = await ramnique.get(`/v1/spaces/${spaceId}/labels/${launch.id}/messages?limit=1`);
    expect((newest.body.messages as Message[]).map((m) => m.id)).toEqual([m2.id]);
    expect(newest.body.hasMore).toBe(true);
    const paged = await ramnique.get(`/v1/spaces/${spaceId}/labels/${launch.id}/messages?limit=1&beforeOffset=${m2.offset}`);
    expect((paged.body.messages as Message[]).map((m) => m.id)).toEqual([m1.id]);
    expect(paged.body.hasMore).toBe(false);
  });

  it('one label per message: a set replaces, null clears, and no-ops are idempotent', async () => {
    const design = (await ramnique.post(`/v1/spaces/${spaceId}/labels`, { name: 'Design', actingMode: 'direct' })).body.label as Label;
    const moved = await ramnique.post(`/v1/spaces/${spaceId}/messages/${m2.id}/label`, { labelId: design.id, actingMode: 'direct' });
    expect(moved.body.message.labelId).toBe(design.id);
    const launchNow = await ramnique.get(`/v1/spaces/${spaceId}/labels/${launch.id}/messages`);
    expect((launchNow.body.messages as Message[]).map((m) => m.id)).toEqual([m1.id]);
    // Idempotent re-set, then clear.
    const again = await ramnique.post(`/v1/spaces/${spaceId}/messages/${m2.id}/label`, { labelId: design.id, actingMode: 'direct' });
    expect(again.status).toBe(200);
    const cleared = await ramnique.post(`/v1/spaces/${spaceId}/messages/${m2.id}/label`, { labelId: null, actingMode: 'direct' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.message.labelId).toBeUndefined();
    const designNow = await ramnique.get(`/v1/spaces/${spaceId}/labels/${design.id}/messages`);
    expect(designNow.body.messages).toEqual([]);
  });

  it('rename works; renaming into a live name is refused', async () => {
    const labels = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    const design = (labels.body.labels as LabelListing[]).find((l) => l.name === 'Design')!;
    const renamed = await ramnique.post(`/v1/spaces/${spaceId}/labels/${design.id}`, { action: 'rename', name: 'Design Sync' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.label.name).toBe('Design Sync');
    const collide = await ramnique.post(`/v1/spaces/${spaceId}/labels/${design.id}`, { action: 'rename', name: 'launch' });
    expect(collide.status).toBe(400);
    expect(collide.body.code).toBe('invalid_request');
  });

  it('archived labels leave the default listing; assigning one revives it', async () => {
    const labels = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    const design = (labels.body.labels as LabelListing[]).find((l) => l.name === 'Design Sync')!;
    const archived = await ramnique.post(`/v1/spaces/${spaceId}/labels/${design.id}`, { action: 'archive' });
    expect(archived.body.label.archived).toBe(true);
    const defaultList = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    expect((defaultList.body.labels as LabelListing[]).some((l) => l.id === design.id)).toBe(false);
    const withArchived = await ramnique.get(`/v1/spaces/${spaceId}/labels?includeArchived=1`);
    expect((withArchived.body.labels as LabelListing[]).some((l) => l.id === design.id)).toBe(true);
    // Assigning the archived label revives it.
    const assigned = await gagan.post(`/v1/spaces/${spaceId}/messages/${m2.id}/label`, { labelId: design.id, actingMode: 'direct' });
    expect(assigned.status).toBe(200);
    const revived = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    expect((revived.body.labels as LabelListing[]).find((l) => l.id === design.id)?.archived).toBe(false);
  });

  it('archiving frees the name; unarchiving into a retaken name is refused', async () => {
    await ramnique.post(`/v1/spaces/${spaceId}/labels/${launch.id}`, { action: 'archive' });
    const fresh = await ramnique.post(`/v1/spaces/${spaceId}/labels`, { name: 'Launch', actingMode: 'direct' });
    expect(fresh.body.label.id).not.toBe(launch.id);
    const stuck = await ramnique.post(`/v1/spaces/${spaceId}/labels/${launch.id}`, { action: 'unarchive' });
    expect(stuck.status).toBe(400);
    expect(stuck.body.code).toBe('invalid_request');
  });

  it('tombstones take no label, and deleted messages leave the stats', async () => {
    const doomed = (await ramnique.post(`/v1/spaces/${spaceId}/messages`, { topicId: generalId, body: 'oops', actingMode: 'direct' })).body.message as Message;
    const labels = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    const design = (labels.body.labels as LabelListing[]).find((l) => l.name === 'Design Sync')!;
    await ramnique.post(`/v1/spaces/${spaceId}/messages/${doomed.id}/label`, { labelId: design.id, actingMode: 'direct' });
    const before = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    const countBefore = (before.body.labels as LabelListing[]).find((l) => l.id === design.id)!.messageCount;
    await ramnique.post(`/v1/spaces/${spaceId}/messages/${doomed.id}/delete`, { actingMode: 'direct' });
    const after = await ramnique.get(`/v1/spaces/${spaceId}/labels`);
    expect((after.body.labels as LabelListing[]).find((l) => l.id === design.id)!.messageCount).toBe(countBefore - 1);
    const refused = await ramnique.post(`/v1/spaces/${spaceId}/messages/${doomed.id}/label`, { labelId: design.id, actingMode: 'direct' });
    expect(refused.status).toBe(400);
    // Clearing a tombstone's label stays legal (cleanup).
    const clearOk = await ramnique.post(`/v1/spaces/${spaceId}/messages/${doomed.id}/label`, { labelId: null, actingMode: 'direct' });
    expect(clearOk.status).toBe(200);
  });

  it('unknown labels and messages are not_found', async () => {
    const noLabel = await ramnique.get(`/v1/spaces/${spaceId}/labels/01ARZ3NDEKTSV4RRFFQ69G5FAV/messages`);
    expect(noLabel.status).toBe(404);
    const noMessage = await ramnique.post(`/v1/spaces/${spaceId}/messages/01ARZ3NDEKTSV4RRFFQ69G5FAV/label`, { labelId: launch.id, actingMode: 'direct' });
    expect(noMessage.status).toBe(404);
  });

  it('label and message_label events ride the space\'s one durable sequence', async () => {
    await live.until(
      (frames) =>
        frames.some((f) => f.kind === 'event' && f.event.type === 'label') &&
        frames.some((f) => f.kind === 'event' && f.event.type === 'message_label'),
      'label events on the stream',
    );
    const events = live.events().map((f) => f.event);
    const labelEvents = events.filter((e) => e.type === 'label');
    const assignments = events.filter((e) => e.type === 'message_label');
    // Creation events for distinct labels only — the get-or-create path emits nothing.
    expect(labelEvents.filter((e) => e.type === 'label' && e.label.name === 'Launch' && !e.label.archived).length).toBeGreaterThanOrEqual(1);
    const first = assignments[0]!;
    expect(first.type === 'message_label' && first.assignment.messageId).toBe(m1.id);
    expect(first.type === 'message_label' && first.assignment.labelId).toBe(launch.id);
    expect(first.type === 'message_label' && first.assignment.by.memberId).toBe('gagan');
    // Offsets are strictly increasing across every event kind — one sequence.
    const offsets = live.events().map((f) => f.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});
