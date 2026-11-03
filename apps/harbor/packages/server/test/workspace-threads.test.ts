import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message, ThreadsPage } from '@rowboat/spaces-protocol';
import { agentClient, callStructured, restClient, startTestHarbor } from './helpers.js';

let harbor: Awaited<ReturnType<typeof startTestHarbor>>;
let me: ReturnType<typeof restClient>, other: ReturnType<typeof restClient>;
let channel: string, second: string, dm: string, secret: string, privateDm: string;
let mine: Message, theirs: Message, named: Message, archived: Message;
async function post(client: typeof me, space: string, body: string, threadRoot?: string): Promise<Message> {
  const result = await client.post(`/v1/spaces/${space}/messages`, { body, actingMode: 'direct', ...(threadRoot ? { threadRoot } : {}) });
  expect(result.status).toBe(200);
  return result.body.message;
}
async function page(query = ''): Promise<ThreadsPage> {
  const result = await me.get(`/v1/threads${query}`);
  expect(result.status).toBe(200);
  return result.body;
}
beforeAll(async () => {
  harbor = await startTestHarbor({ orgName: 'Threads', seedMembers: [{ id: 'me', displayName: 'Me' }, { id: 'other', displayName: 'Other' }, { id: 'third', displayName: 'Third' }], seedSpaces: [{ name: 'Main', creator: 'me' }, { name: 'Second', creator: 'me' }] });
  me = restClient(harbor, 'dev-me'); other = restClient(harbor, 'dev-other');
  const rooms = (await me.get('/v1/spaces')).body.spaces;
  channel = rooms.find((s: { name: string }) => s.name === 'Main').id;
  second = rooms.find((s: { name: string }) => s.name === 'Second').id;
  secret = (await other.post('/v1/spaces', { name: 'Secret', visibility: 'private' })).body.space.id;
  const invite = await me.post('/v1/invites', { spaceId: channel });
  await other.post('/v1/invites/accept', { token: invite.body.token });
  dm = (await me.post('/v1/direct', { memberId: 'other' })).body.space.id;
  mine = await post(me, channel, 'My thread'); await post(other, channel, 'Reply', mine.id);
  theirs = await post(other, channel, 'Their thread'); await post(other, channel, 'Reply', theirs.id);
  named = await post(me, second, 'Named root');
  expect((await me.post(`/v1/spaces/${second}/topics`, { rootMessageId: named.id, title: 'Named thread', actingMode: 'direct' })).status).toBe(200);
  archived = await post(me, second, 'Archived root');
  const topic = await me.post(`/v1/spaces/${second}/topics`, { rootMessageId: archived.id, title: 'Archived thread', actingMode: 'direct' });
  await me.post(`/v1/spaces/${second}/topics/${topic.body.topic.id}`, { action: 'archive', actingMode: 'direct' });
  const direct = await post(other, dm, 'DM thread'); await post(me, dm, 'Reply', direct.id);
  await post(me, channel, 'Standalone root');
  const hidden = await post(other, secret, 'Private thread'); await post(other, secret, 'Reply', hidden.id);
  privateDm = (await other.post('/v1/direct', { memberId: 'third' })).body.space.id;
  const privateRoot = await post(other, privateDm, 'Someone else’s DM'); await post(other, privateDm, 'Reply', privateRoot.id);
});
afterAll(async () => { await harbor?.close() });

describe('workspace Threads', () => {
  it('pools joined channels and DMs, including named roots with no replies', async () => {
    const result = await page();
    expect(new Set(result.items.map((r) => r.space.id))).toEqual(new Set([channel, second, dm]));
    expect(result.items).toHaveLength(4);
    expect(result.items.some((r) => r.root.id === named.id && r.topic?.title === 'Named thread')).toBe(true);
    expect(result.items.map((r) => r.lastActivityAt)).toEqual(result.items.map((r) => r.lastActivityAt).sort().reverse());
    expect(result.names).toMatchObject({ me: 'Me', other: 'Other' });
  });
  it('filters before pagination by author, participant, source and archived status', async () => {
    expect((await page('?filter=mine')).items.map((r) => r.root.id).sort()).toEqual([mine.id, named.id].sort());
    expect((await page('?filter=named')).items.map((r) => r.root.id)).toEqual([named.id]);
    expect((await page('?filter=named&archived=true')).items.map((r) => r.root.id)).toEqual([archived.id]);
    expect((await page(`?spaceId=${channel}&participantId=me`)).items.map((r) => r.root.id)).toEqual([mine.id]);
    expect((await page(`?spaceId=${channel}&participantId=other`)).items).toHaveLength(2);
  });
  it('pages across space boundaries without duplicating or losing threads', async () => {
    const ids: string[] = []; let cursor: string | undefined;
    do {
      const result = await page(`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      ids.push(...result.items.map((r) => r.root.id)); cursor = result.nextCursor;
    } while (cursor);
    expect(ids).toEqual((await page()).items.map((r) => r.root.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('rejects inaccessible sources and malformed queries', async () => {
    expect((await me.get(`/v1/threads?spaceId=${secret}`)).status).toBe(403);
    expect((await me.get(`/v1/threads?spaceId=${privateDm}`)).status).toBe(403);
    expect((await me.get('/v1/threads?cursor=bad')).status).toBe(400);
    expect((await me.get('/v1/threads?limit=101')).status).toBe(400);
  });
  it('exposes the same membership-scoped page through MCP', async () => {
    const agent = await agentClient(harbor, 'dev-me');
    try {
      expect(await callStructured<ThreadsPage>(agent, 'list_threads', { filter: 'named' })).toEqual(await page('?filter=named'));
    } finally { await agent.close() }
  });
});
