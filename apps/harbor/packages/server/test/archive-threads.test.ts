import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, type Message } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, restClient, startTestHarbor } from './helpers.js';

// Archiving a plain thread (2026-11-03, "archive threads" in Main): the flag
// sits on the root, so a thread leaves the active lists without being named.
// A discussion keeps its archive on the topic row; a reply or naming the
// thread brings it back. Idempotent calls write nothing.

let harbor: RunningHarbor;
let spaceId: string;
let agent: Client;
const ram = () => restClient(harbor, 'dev-ramnique');
const gagan = () => restClient(harbor, 'dev-gagan');
const prakhar = () => restClient(harbor, 'dev-prakhar');
const archive = (rootId: string, archived = true, client = ram()) =>
  client.post(`/v1/spaces/${spaceId}/threads/${rootId}/archive`, { archived, actingMode: 'direct' });
const archivedIds = async () =>
  ((await ram().get(`/v1/spaces/${spaceId}/archived-threads`)).body.threads as Message[]).map((m) => m.id);
const threadEvents = async () =>
  (await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === 'thread_archive').map((e) => e.event);
const post = async (body: string, threadRoot?: string, client = ram()) =>
  (await client.post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...(threadRoot ? { threadRoot } : {}) })).body.message as Message;

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await agent.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`tool ${name} errored: ${JSON.stringify(result.content)}`);
  const parsed = mcpTools.find((t) => t.name === name)!.output.safeParse(result.structuredContent);
  if (!parsed.success) throw new Error(`tool ${name} output failed its schema: ${parsed.error.message}`);
  return result.structuredContent as T;
}

beforeAll(async () => {
  harbor = await startTestHarbor({
    name: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
    ],
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
  });
  spaceId = (await ram().post('/v1/spaces', { name: 'Launch', visibility: 'private' })).body.space.id;
  await ram().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
  agent = await agentClient(harbor, 'dev-gagan', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await agent.close();
  await harbor.close();
});

describe('archive a plain thread', () => {
  it('archives without naming, lists it, and carries the flag on every read of the root', async () => {
    const root = await post('coding session: fix login');
    await post('done', root.id);
    const res = await archive(root.id);
    expect(res.status).toBe(200);
    expect(res.body.root).toMatchObject({ id: root.id, archived: true, replyCount: 1 });
    expect((await ram().get(`/v1/spaces/${spaceId}/topics?includeArchived=1`)).body.topics).toEqual([]);
    expect(await archivedIds()).toEqual([root.id]);
    expect((await ram().get(`/v1/spaces/${spaceId}/threads/${root.id}`)).body.root.archived).toBe(true);
    const stream = (await ram().get(`/v1/spaces/${spaceId}/stream`)).body.messages as Message[];
    expect(stream.find((m) => m.id === root.id)?.archived).toBe(true);
    const events = await threadEvents();
    expect(events.at(-1)).toMatchObject({ rootMessageId: root.id, action: 'archived', by: { memberId: 'ramnique', actingMode: 'direct' } });

    // Same state again: a no-op with no event.
    const before = events.length;
    expect((await archive(root.id)).status).toBe(200);
    expect(await threadEvents()).toHaveLength(before);

    expect((await archive(root.id, false)).body.root.archived).toBeUndefined();
    expect(await archivedIds()).toEqual([]);
    expect((await threadEvents()).at(-1)).toMatchObject({ action: 'unarchived' });
  });

  it('a reply brings it back, attributed to the replier', async () => {
    const root = await post('session two');
    await archive(root.id);
    await post('one more thing', root.id, gagan());
    expect(await archivedIds()).toEqual([]);
    expect((await threadEvents()).at(-1)).toMatchObject({ rootMessageId: root.id, action: 'unarchived', by: { memberId: 'gagan' } });
  });

  it('naming it brings it back too, so a thread has one archive flag', async () => {
    const root = await post('session three');
    await archive(root.id);
    const created = await ram().post(`/v1/spaces/${spaceId}/topics`, { rootMessageId: root.id, title: 'Session three', actingMode: 'direct' });
    expect(created.status).toBe(200);
    expect(created.body.topic.archived).toBe(false);
    expect(created.body.rootMessage.archived).toBeUndefined();
    expect(await archivedIds()).toEqual([]);
    expect((await threadEvents()).at(-1)).toMatchObject({ rootMessageId: root.id, action: 'unarchived' });
  });

  it('refuses a reply, a discussion, an unknown message and a non-member', async () => {
    const root = await post('session four');
    const reply = await post('a reply', root.id);
    expect((await archive(reply.id)).body.code).toBe('invalid_request');
    await ram().post(`/v1/spaces/${spaceId}/topics`, { rootMessageId: root.id, title: 'Named', actingMode: 'direct' });
    expect((await archive(root.id)).body.code).toBe('invalid_request');
    expect((await archive('01J8KQ4T3M9V2B7XCH0RDQ5AEF')).status).toBe(404);
    expect((await archive(root.id, true, prakhar())).status).toBe(403);
    expect((await prakhar().get(`/v1/spaces/${spaceId}/archived-threads`)).status).toBe(403);
  });

  it('works the same through the agent face', async () => {
    const root = await post('session five');
    const archived = await call<{ root: Message }>('archive_thread', { spaceId, rootMessageId: root.id });
    expect(archived.root.archived).toBe(true);
    expect((await threadEvents()).at(-1)).toMatchObject({ by: { memberId: 'gagan', actingMode: 'agent' } });
    const listed = await call<{ threads: Message[] }>('list_archived_threads', { spaceId });
    expect(listed.threads.map((m) => m.id)).toEqual([root.id]);
    const restored = await call<{ root: Message }>('archive_thread', { spaceId, rootMessageId: root.id, archived: false });
    expect(restored.root.archived).toBeUndefined();
  });
});
