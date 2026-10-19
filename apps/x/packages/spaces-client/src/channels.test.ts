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
    // A seed space's creator is the org's admin, who may archive and delete.
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
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
    const invite = await table['spaces:createInvite']({ orgId, spaceIds: [spaceId] });
    const resolved = await table['spaces:resolveInvite']({ baseUrl: harbor.url, token: invite.token });
    expect(resolved).toMatchObject({ state: 'ok', space: { id: spaceId } });
  });

  it('passes the activity query on without the org id', async () => {
    const page = await table['spaces:getActivity']({ orgId, unread: true });
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('archives, unarchives and deletes a space', async () => {
    const { space } = await table['spaces:createSpace']({ orgId, name: 'Doomed' });
    expect((await table['spaces:archiveSpace']({ orgId, spaceId: space.id })).space.archived).toBe(true);
    await expect(table['spaces:postMessage']({ orgId, spaceId: space.id, body: 'too late' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await table['spaces:unarchiveSpace']({ orgId, spaceId: space.id })).space.archived).toBe(false);
    expect(await table['spaces:deleteSpace']({ orgId, spaceId: space.id })).toEqual({ deleted: true });
    const { spaces } = await table['spaces:listSpaces']({ orgId });
    expect(spaces.map((s) => s.id)).not.toContain(space.id);
  });

  it('admin controls: visibility, removal from a space, roles, the invite policy, removal from the org', async () => {
    const { space } = await table['spaces:createSpace']({ orgId, name: 'Admin' });
    expect((await table['spaces:setSpaceVisibility']({ orgId, spaceId: space.id, visibility: 'open' })).space.visibility).toBe('open');
    await table['spaces:addMembers']({ orgId, spaceId: space.id, memberIds: ['gagan'] });
    expect(await table['spaces:removeMember']({ orgId, spaceId: space.id, memberId: 'gagan' })).toEqual({ removed: true });
    expect((await table['spaces:setMemberRole']({ orgId, memberId: 'gagan', role: 'admin' })).member.role).toBe('admin');
    expect((await table['spaces:setMemberRole']({ orgId, memberId: 'gagan', role: 'member' })).member.role).toBe('member');
    expect((await table['spaces:getOrgSettings']({ orgId })).settings).toEqual({ invitePolicy: 'members' });
    expect((await table['spaces:setInvitePolicy']({ orgId, invitePolicy: 'admins' })).settings).toEqual({ invitePolicy: 'admins' });
    await table['spaces:setInvitePolicy']({ orgId, invitePolicy: 'members' });
    expect((await table['spaces:removeOrgMember']({ orgId, memberId: 'gagan' })).member.removedAt).toEqual(expect.any(String));
  });

  it('makes a space a default, and an invite to the org joins it', async () => {
    const { space } = await table['spaces:createSpace']({ orgId, name: 'Welcome', visibility: 'open' });
    expect((await table['spaces:setDefaultSpace']({ orgId, spaceId: space.id, isDefault: true })).space.isDefault).toBe(true);
    const invite = await table['spaces:createInvite']({ orgId });
    const resolved = await table['spaces:resolveInvite']({ baseUrl: harbor.url, token: invite.token });
    expect(resolved).toMatchObject({ state: 'ok', spaces: [{ id: space.id }] });
    await table['spaces:setDefaultSpace']({ orgId, spaceId: space.id, isDefault: false });
  });

  it('fails for an org the host does not know', async () => {
    await expect(table['spaces:listSpaces']({ orgId: 'nope' })).rejects.toThrow('unknown org nope');
  });
});
