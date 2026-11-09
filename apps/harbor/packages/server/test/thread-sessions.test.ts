import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, type Member, type Message, type ThreadListing } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, restClient, startTestHarbor } from './helpers.js';

// Sessions (2026-11-05, "coding session: threads" in Main): a person marks a
// thread as short-lived work. Each member's threads, sessions among them, are
// one list across their spaces with where each stands for them. Ending a
// session is archiving its thread. A discussion is never a session.

let harbor: RunningHarbor;
let spaceId: string;
let otherSpaceId: string;
let agent: Client;
let hermes: { member: Member; key: string };
const ram = () => restClient(harbor, 'dev-ramnique');
const gagan = () => restClient(harbor, 'dev-gagan');
const prakhar = () => restClient(harbor, 'dev-prakhar');
const mention = (m: Member) => `[@${m.displayName}](#member:${m.id})`;
const post = async (body: string, extra: Record<string, unknown> = {}, client = ram(), space = spaceId) => {
  const res = await client.post(`/v1/spaces/${space}/messages`, { body, actingMode: 'direct', ...extra });
  expect(res.status).toBe(200);
  return res.body as { message: Message; invocations: Array<{ id: string; state: string }> };
};
const setSession = (rootId: string, session: { title: string } | null, client = ram()) =>
  client.post(`/v1/spaces/${spaceId}/threads/${rootId}/session`, { session, actingMode: 'direct' });
const threads = async (client = ram(), archived = false) => {
  const res = await client.get(`/v1/threads${archived ? '?archived=true' : ''}`);
  expect(res.status).toBe(200);
  return res.body.threads as ThreadListing[];
};
const ids = async (client = ram(), archived = false) => (await threads(client, archived)).map((t) => t.root.id);
const sessionEvents = async () =>
  (await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === 'thread_session').map((e) => e.event);

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
  otherSpaceId = (await ram().post('/v1/spaces', { name: 'Design', visibility: 'private' })).body.space.id;
  await ram().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
  const created = await ram().post('/v1/agents', { displayName: 'Hermes' });
  hermes = { member: created.body.agent as Member, key: created.body.key.secret as string };
  await ram().post(`/v1/spaces/${spaceId}/members`, { memberIds: [hermes.member.id], actingMode: 'direct' });
  agent = await agentClient(harbor, 'dev-gagan', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await agent.close();
  await harbor.close();
});

describe('starting a session', () => {
  it('posts a root marked as a session in one step, carried on every read', async () => {
    const { message } = await post('fix thread nav', { session: { title: 'fix thread nav' } });
    expect(message.session).toEqual({ title: 'fix thread nav' });
    expect((await ram().get(`/v1/spaces/${spaceId}/threads/${message.id}`)).body.root.session).toEqual({ title: 'fix thread nav' });
    const stream = (await ram().get(`/v1/spaces/${spaceId}/stream`)).body.messages as Message[];
    expect(stream.find((m) => m.id === message.id)?.session).toEqual({ title: 'fix thread nav' });
  });

  it('refuses a session on a reply', async () => {
    const { message: root } = await post('a plain root');
    const res = await ram().post(`/v1/spaces/${spaceId}/messages`, {
      body: 'reply',
      threadRoot: root.id,
      session: { title: 'nope' },
      actingMode: 'direct',
    });
    expect(res.body.code).toBe('invalid_request');
  });
});

describe('marking a thread', () => {
  it('marks, retitles and unmarks, with one event per real change', async () => {
    const { message: root } = await post('look into flaky tests');
    const before = (await sessionEvents()).length;
    const marked = await setSession(root.id, { title: 'flaky tests' });
    expect(marked.status).toBe(200);
    expect(marked.body.root.session).toEqual({ title: 'flaky tests' });
    expect((await sessionEvents()).at(-1)).toMatchObject({ rootMessageId: root.id, session: { title: 'flaky tests' }, by: { memberId: 'ramnique' } });

    // Same title again: a no-op with no event.
    expect((await setSession(root.id, { title: 'flaky tests' })).status).toBe(200);
    expect(await sessionEvents()).toHaveLength(before + 1);

    expect((await setSession(root.id, { title: 'flaky CI' })).body.root.session).toEqual({ title: 'flaky CI' });
    const cleared = await setSession(root.id, null);
    expect(cleared.body.root.session).toBeUndefined();
    expect((await sessionEvents()).at(-1)).toMatchObject({ session: null });
    expect(await sessionEvents()).toHaveLength(before + 3);
  });

  it('a discussion is never a session, either way round', async () => {
    const { message: named } = await post('to be named');
    await ram().post(`/v1/spaces/${spaceId}/topics`, { rootMessageId: named.id, title: 'Named', actingMode: 'direct' });
    expect((await setSession(named.id, { title: 'x' })).body.code).toBe('invalid_request');

    const { message: session } = await post('a session', { session: { title: 'a session' } });
    const naming = await ram().post(`/v1/spaces/${spaceId}/topics`, { rootMessageId: session.id, title: 'Named', actingMode: 'direct' });
    expect(naming.body.code).toBe('invalid_request');
  });

  it('refuses a reply, an unknown message and a non-member', async () => {
    const { message: root } = await post('root');
    const { message: reply } = await post('reply', { threadRoot: root.id });
    expect((await setSession(reply.id, { title: 'x' })).body.code).toBe('invalid_request');
    expect((await setSession('01J8KQ4T3M9V2B7XCH0RDQ5AEF', { title: 'x' })).status).toBe(404);
    expect((await setSession(root.id, { title: 'x' }, prakhar())).status).toBe(403);
  });
});

describe('my threads', () => {
  it('lists the threads I started or follow across my spaces, newest activity first', async () => {
    const { message: mine } = await post('mine', { session: { title: 'mine' } });
    const { message: theirs } = await post('theirs', { session: { title: 'theirs' } }, gagan());
    const { message: joined } = await post('a plain thread', {}, gagan());
    await post('I am in', { threadRoot: joined.id });
    const { message: lonely } = await post('a root nobody answered');

    const listed = await ids();
    expect(listed).toContain(mine.id); // a session is a thread from its first message
    expect(listed).toContain(joined.id); // replying follows
    expect(listed).not.toContain(theirs.id);
    expect(listed).not.toContain(lonely.id);
    expect(listed.indexOf(joined.id)).toBeLessThan(listed.indexOf(mine.id));
    expect((await threads()).find((t) => t.root.id === mine.id)).toMatchObject({ spaceId, spaceName: 'Launch', status: 'idle', root: { session: { title: 'mine' } } });
    expect((await threads()).find((t) => t.root.id === joined.id)?.root.session).toBeUndefined();

    // Ending a session is archiving its thread: it moves to the archived list, and a reply brings it back.
    await ram().post(`/v1/spaces/${spaceId}/threads/${mine.id}/archive`, { archived: true, actingMode: 'direct' });
    expect(await ids()).not.toContain(mine.id);
    expect(await ids(ram(), true)).toContain(mine.id);
    await post('one more thing', { threadRoot: mine.id });
    expect(await ids()).toContain(mine.id);
  });

  it('carries a discussion with its topic, archived on the topic', async () => {
    const { message: root } = await post('pricing');
    await post('thoughts', { threadRoot: root.id });
    const topic = (await ram().post(`/v1/spaces/${spaceId}/topics`, { rootMessageId: root.id, title: 'Pricing page', actingMode: 'direct' })).body.topic;
    expect((await threads()).find((t) => t.root.id === root.id)?.topic).toMatchObject({ id: topic.id, title: 'Pricing page' });
    await ram().post(`/v1/spaces/${spaceId}/topics/${topic.id}`, { action: 'archive', actingMode: 'direct' });
    expect(await ids()).not.toContain(root.id);
    expect(await ids(ram(), true)).toContain(root.id);
  });

  it('spans every space I am in', async () => {
    const { message } = await post('design pass', { session: { title: 'design pass' } }, ram(), otherSpaceId);
    expect((await threads()).find((t) => t.root.id === message.id)).toMatchObject({ spaceId: otherSpaceId, spaceName: 'Design' });
    expect(await ids(gagan())).not.toContain(message.id);
  });

  it('says where each stands: working, needs you, idle', async () => {
    const { message: root, invocations } = await post(`${mention(hermes.member)} fix the rail`, { session: { title: 'fix the rail' } });
    const status = async () => (await threads()).find((t) => t.root.id === root.id)?.status;
    expect(await status()).toBe('working');
    const id = invocations[0]!.id;
    const connector = restClient(harbor, hermes.key);
    await connector.post(`/v1/agent/invocations/${id}/ack`);
    expect(await status()).toBe('working');
    await connector.post(`/v1/agent/invocations/${id}/update`, { state: 'waiting', activity: 'Which branch?' });
    expect(await status()).toBe('needs_you');
    await connector.post(`/v1/agent/invocations/${id}/update`, { state: 'working' });
    // The agent's progress reply is unread, but it is still working.
    await post('on it', { threadRoot: root.id }, connector);
    expect(await status()).toBe('working');
    await connector.post(`/v1/agent/invocations/${id}/update`, { state: 'done' });
    const listing = (await threads()).find((t) => t.root.id === root.id)!;
    expect(listing).toMatchObject({ status: 'needs_you', unreadReplies: 1 });
    await ram().post(`/v1/spaces/${spaceId}/read`, { threadRootId: root.id, offset: listing.root.lastReplyOffset });
    expect(await status()).toBe('idle');
  });
});

describe('the agent face', () => {
  it('starts, marks, lists and unmarks the same way', async () => {
    const posted = await call<{ messageId: string }>('post_message', { spaceId, body: 'agent session', session: { title: 'agent session' } });
    const root = (await ram().get(`/v1/spaces/${spaceId}/threads/${posted.messageId}`)).body.root as Message;
    expect(root.session).toEqual({ title: 'agent session' });
    expect((await call<{ threads: ThreadListing[] }>('list_my_threads', {})).threads.map((t) => t.root.id)).toContain(root.id);
    const retitled = await call<{ root: Message }>('set_session', { spaceId, rootMessageId: root.id, title: 'renamed' });
    expect(retitled.root.session).toEqual({ title: 'renamed' });
    expect((await sessionEvents()).at(-1)).toMatchObject({ by: { memberId: 'gagan', actingMode: 'agent' } });
    const cleared = await call<{ root: Message }>('set_session', { spaceId, rootMessageId: root.id, title: null });
    expect(cleared.root.session).toBeUndefined();
  });
});
