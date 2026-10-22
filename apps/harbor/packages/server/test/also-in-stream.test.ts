import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, callStructured, liveClient, restClient, startTestHarbor } from './helpers.js';

// Sending a reply to the stream (2026-10-22, Slack's "Also send to channel"):
// the reply lives in its thread and also lists in the stream at its own
// offset, with its root carried on the page so a client can name the thread.

let harbor: RunningHarbor;
let ramnique: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let main: string;

async function post(client: ReturnType<typeof restClient>, body: string, extra: Record<string, unknown> = {}): Promise<Message> {
  const r = await client.post(`/v1/spaces/${main}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

async function stream(client: ReturnType<typeof restClient>, query = '') {
  const r = await client.get(`/v1/spaces/${main}/stream${query}`);
  expect(r.status).toBe(200);
  return r.body as { messages: Message[]; threadRoots: Message[]; topics: Array<{ rootMessageId: string; title: string }> };
}

async function unreadRoots(client: ReturnType<typeof restClient>): Promise<number> {
  const r = await client.get('/v1/unread');
  return (r.body.spaces as Array<{ spaceId: string; unreadRoots: number }>).find((s) => s.spaceId === main)!.unreadRoots;
}

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  });
  ramnique = restClient(harbor, 'dev-ramnique');
  harsh = restClient(harbor, 'dev-harsh');
  main = (await ramnique.get('/v1/spaces')).body.spaces[0].id;
  const invite = await ramnique.post('/v1/invites', { spaceId: main });
  expect((await harsh.post('/v1/invites/accept', { token: invite.body.token })).status).toBe(200);
});

afterAll(async () => {
  await harbor?.close();
});

describe('also in stream', () => {
  it('lists a sent reply in the stream and its thread, and carries the root it names', async () => {
    const root = await post(ramnique, 'Fix the login bug');
    const quiet = await post(harsh, 'looking', { threadRoot: root.id });
    const sent = await post(harsh, 'PR is up, tests pass', { threadRoot: root.id, alsoInStream: true });
    expect(sent.alsoInStream).toBe(true);
    expect(quiet.alsoInStream).toBeUndefined();

    const page = await stream(ramnique);
    expect(page.messages.map((m) => m.id)).toEqual([root.id, sent.id]);
    expect(page.threadRoots).toEqual([]); // the root is on the page already

    // Paged so the root falls off: the page still names its thread.
    const older = await stream(ramnique, `?afterOffset=${root.offset}`);
    expect(older.messages.map((m) => m.id)).toEqual([sent.id]);
    expect(older.threadRoots.map((m) => m.id)).toEqual([root.id]);
    expect(older.threadRoots[0]!.replyCount).toBe(2);

    const thread = await ramnique.get(`/v1/spaces/${main}/threads/${root.id}`);
    expect((thread.body.messages as Message[]).map((m) => m.id)).toEqual([quiet.id, sent.id]);
  });

  it('carries the topic of a thread the page names', async () => {
    const root = await post(ramnique, 'Launch plan');
    expect((await ramnique.post(`/v1/spaces/${main}/topics`, { rootMessageId: root.id, title: 'Launch', actingMode: 'direct' })).status).toBe(200);
    const sent = await post(harsh, 'Shipped', { threadRoot: root.id, alsoInStream: true });
    const page = await stream(ramnique, `?afterOffset=${sent.offset - 1}`);
    expect(page.threadRoots.map((m) => m.id)).toEqual([root.id]);
    expect(page.topics.find((t) => t.rootMessageId === root.id)?.title).toBe('Launch');
  });

  it('refuses the flag on a root', async () => {
    const r = await ramnique.post(`/v1/spaces/${main}/messages`, { body: 'hello', actingMode: 'direct', alsoInStream: true });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('invalid_request');
  });

  it('counts a sent reply as unread in the stream, and a quiet one not', async () => {
    const root = await post(ramnique, 'Standup');
    await ramnique.post(`/v1/spaces/${main}/read`, { offset: root.offset });
    const before = await unreadRoots(ramnique);
    await post(harsh, 'quiet reply', { threadRoot: root.id });
    expect(await unreadRoots(ramnique)).toBe(before);
    await post(harsh, 'sent reply', { threadRoot: root.id, alsoInStream: true });
    expect(await unreadRoots(ramnique)).toBe(before + 1);
  });

  it('sends the flag on the live frame', async () => {
    const root = await post(ramnique, 'Live root');
    const live = await liveClient(harbor, 'dev-ramnique');
    try {
      live.send({ kind: 'subscribe', spaceId: main, fromOffset: root.offset });
      const sent = await post(harsh, 'live sent', { threadRoot: root.id, alsoInStream: true });
      await live.until(
        () => live.events().some((f) => f.event.type === 'message' && f.event.message.id === sent.id),
        'the sent reply',
      );
      const frame = live.events().find((f) => f.event.type === 'message' && f.event.message.id === sent.id)!;
      expect(frame.event.type === 'message' && frame.event.message.alsoInStream).toBe(true);
    } finally {
      live.close();
    }
  });

  it('lets an agent send its result through post_message, and read_stream shows it', async () => {
    const root = await post(ramnique, 'Agent task');
    const agent = await agentClient(harbor, 'dev-harsh', { agentName: 'Claude' });
    try {
      const { messageId } = await callStructured<{ messageId: string }>(agent, 'post_message', {
        spaceId: main, threadRoot: root.id, body: 'Done: PR #1', alsoInStream: true,
      });
      const read = await callStructured<{ messages: Message[] }>(agent, 'read_stream', { spaceId: main });
      const listed = read.messages.find((m) => m.id === messageId);
      expect(listed?.alsoInStream).toBe(true);
      expect(listed?.threadRoot).toBe(root.id);
    } finally {
      await agent.close();
    }
  });
});
