import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgStore, pgliteDb, startHarbor, type RunningHarbor } from '@rowboat/harbor';
import type { spaces as spacesShared } from '@x/shared';
import { harborChannelHandlers, type HarborChannelHandlers } from './channels.js';
import { SpacesClient } from './client.js';
import { SpacesLive } from './live.js';
import { SpaceSubscriptions } from './subscriptions.js';

// The shared channel table against the REAL Harbor: what every host (the
// desktop's main and rowboat-server, the web app) serves for these channels.

let harbor: RunningHarbor;
let live: SpacesLive;
let table: HarborChannelHandlers;
const emitted: spacesShared.SpacesBusEvent[] = [];
const orgId = 'org-1';

beforeAll(async () => {
  const db = await pgliteDb();
  const store = new PgStore(db);
  await store.init();
  const started = await startHarbor({
    orgName: 'Channel Test Org',
    store,
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
  });
  harbor = { ...started, close: async () => { await started.close(); await db.close(); } };
  const client = new SpacesClient({ baseUrl: harbor.url, token: 'dev-ramnique' });
  live = new SpacesLive({ baseUrl: harbor.url, token: 'dev-ramnique' });
  const known = (id: string) => {
    if (id !== orgId) throw new Error(`unknown org ${id}`);
  };
  table = harborChannelHandlers({
    getClient: (id) => (known(id), client),
    getLive: (id) => (known(id), live),
    subscriptions: new SpaceSubscriptions({ getLive: () => live, onRuntimeReset: () => () => {} }),
    emit: (event) => emitted.push(event),
  });
});

afterAll(async () => {
  live.close();
  await harbor.close();
});

describe('harborChannelHandlers', () => {
  let spaceId: string;

  it('creates and lists a space', async () => {
    const { space } = await table['spaces:createSpace']({ orgId, name: 'Channels' });
    spaceId = space.id;
    const { spaces } = await table['spaces:listSpaces']({ orgId });
    expect(spaces.map((s) => s.id)).toContain(spaceId);
  });

  it('posts as a person acting directly, and relays the live frame to emit', async () => {
    await table['spaces:subscribeSpace']({ orgId, spaceId });
    const { message } = await table['spaces:postMessage']({ orgId, spaceId, body: 'hello from the table' });
    expect(message.author).toEqual({ memberId: 'ramnique', actingMode: 'direct' });
    await vi.waitFor(() => {
      const frames = emitted.flatMap((e) => ('frame' in e && e.orgId === orgId ? [e.frame] : []));
      expect(frames.some((f) => f.kind === 'event')).toBe(true);
    });
    const page = await table['spaces:listStream']({ orgId, spaceId });
    expect(page.messages.map((m) => m.body)).toContain('hello from the table');
    await table['spaces:unsubscribeSpace']({ orgId, spaceId });
  });

  it('reacts, edits and deletes', async () => {
    const { message } = await table['spaces:postMessage']({ orgId, spaceId, body: 'draft' });
    const reacted = await table['spaces:reactToMessage']({ orgId, spaceId, messageId: message.id, emoji: '👍', action: 'add' });
    expect(reacted.message.reactions).toEqual([expect.objectContaining({ emoji: '👍', memberIds: ['ramnique'] })]);
    const edited = await table['spaces:editMessage']({ orgId, spaceId, messageId: message.id, body: 'final' });
    expect(edited.message.body).toBe('final');
    const deleted = await table['spaces:deleteMessage']({ orgId, spaceId, messageId: message.id });
    expect(deleted.message.deletedAt).toBeDefined();
  });

  it('resolves an invite before the org is added, by its base URL alone', async () => {
    const invite = await table['spaces:createInvite']({ orgId, spaceId });
    const resolved = await table['spaces:resolveInvite']({ baseUrl: harbor.url, token: invite.token });
    expect(resolved).toMatchObject({ state: 'ok', space: { id: spaceId } });
  });

  it('passes the activity query on without the org id', async () => {
    const page = await table['spaces:getActivity']({ orgId, unread: true });
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('fails for an org the host does not know', async () => {
    await expect(table['spaces:listSpaces']({ orgId: 'nope' })).rejects.toThrow('unknown org nope');
  });
});
