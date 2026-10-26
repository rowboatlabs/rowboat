import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message, ServerFrame } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, callStructured, liveClient, restClient, startTestHarbor } from './helpers.js';

// A message's summary (2026-10-25, the threads discussion in Main): the
// author's short version of a long body, which clients show first with
// "Show more". Set at post, replaced or removed by an edit, redacted with
// the body, read by notifications and search.

let harbor: RunningHarbor;
let ramnique: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let main: string;

async function post(client: ReturnType<typeof restClient>, body: string, extra: Record<string, unknown> = {}): Promise<Message> {
  const r = await client.post(`/v1/spaces/${main}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

async function edit(id: string, extra: Record<string, unknown>) {
  return ramnique.post(`/v1/spaces/${main}/messages/${id}/edit`, { actingMode: 'direct', ...extra });
}

async function fetchMessage(id: string): Promise<Message> {
  return (await ramnique.get(`/v1/spaces/${main}/messages/${id}`)).body.message as Message;
}

/** The stored `message` event as replay serves it. */
async function replayed(id: string): Promise<Message> {
  const live = await liveClient(harbor, 'dev-ramnique');
  try {
    live.send({ kind: 'subscribe', spaceId: main, afterOffset: 0 });
    const find = () => live.events().find((f) => f.event.type === 'message' && f.event.message.id === id);
    await live.until(() => !!find(), 'the replayed message');
    const frame = find()!;
    if (frame.event.type !== 'message') throw new Error('not a message');
    return frame.event.message;
  } finally {
    live.close();
  }
}

const LONG = 'Plan\n\n1. Read the auth module\n2. Patch the token refresh\n3. Add tests\n4. Open the PR';

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

describe('message summary', () => {
  it('rides a root and a reply into the stream, the thread and replay', async () => {
    const root = await post(ramnique, LONG, { summary: 'Fixing token refresh; PR next' });
    const reply = await post(harsh, LONG, { threadRoot: root.id, summary: 'Done: PR #12' });
    expect(root.summary).toBe('Fixing token refresh; PR next');
    const stream = (await ramnique.get(`/v1/spaces/${main}/stream`)).body.messages as Message[];
    expect(stream.find((m) => m.id === root.id)?.summary).toBe('Fixing token refresh; PR next');
    const thread = (await ramnique.get(`/v1/spaces/${main}/threads/${root.id}`)).body.messages as Message[];
    expect(thread.find((m) => m.id === reply.id)?.summary).toBe('Done: PR #12');
    expect((await replayed(root.id)).summary).toBe('Fixing token refresh; PR next');
    const plain = await post(ramnique, 'short');
    expect(plain.summary).toBeUndefined();
  });

  it('is kept by an edit that leaves it out, replaced by a string, removed by null', async () => {
    const m = await post(ramnique, LONG, { summary: 'first' });
    const kept = await edit(m.id, { body: `${LONG}\n5. Ship` });
    expect(kept.status).toBe(200);
    expect(kept.body.message.summary).toBe('first');
    expect((await edit(m.id, { body: `${LONG}\n5. Ship`, summary: 'second' })).body.message.summary).toBe('second');
    expect((await fetchMessage(m.id)).summary).toBe('second');
    expect((await replayed(m.id)).summary).toBe('second');
    const removed = await edit(m.id, { body: `${LONG}\n5. Ship`, summary: null });
    expect(removed.body.message.summary).toBeUndefined();
    expect((await fetchMessage(m.id)).summary).toBeUndefined();
    expect((await replayed(m.id)).summary).toBeUndefined();
  });

  it('an edit that changes nothing is a no-op: no edited mark', async () => {
    const m = await post(ramnique, LONG, { summary: 'same' });
    const r = await edit(m.id, { body: LONG, summary: 'same' });
    expect(r.body.message.editedAt).toBeUndefined();
  });

  it('carries the summary on the live edit frame', async () => {
    const m = await post(ramnique, LONG, { summary: 'before' });
    const live = await liveClient(harbor, 'dev-harsh');
    try {
      live.send({ kind: 'subscribe', spaceId: main, fromOffset: m.offset });
      await edit(m.id, { body: LONG, summary: 'after' });
      const find = () => live.events().find((f) => f.event.type === 'message_edited' && f.event.edit.messageId === m.id);
      await live.until(() => !!find(), 'the edit frame');
      const frame = find()!;
      expect(frame.event.type === 'message_edited' && frame.event.edit.summary).toBe('after');
    } finally {
      live.close();
    }
  });

  it('is redacted with the body on deletion, replay included', async () => {
    const m = await post(ramnique, LONG, { summary: 'secret outcome' });
    const r = await ramnique.post(`/v1/spaces/${main}/messages/${m.id}/delete`, { actingMode: 'direct' });
    expect(r.status).toBe(200);
    expect(r.body.message.summary).toBeUndefined();
    expect((await fetchMessage(m.id)).summary).toBeUndefined();
    expect((await replayed(m.id)).summary).toBeUndefined();
    const found = (await ramnique.get(`/v1/spaces/${main}/search?q=secret`)).body.messages as unknown[];
    expect(found).toEqual([]);
  });

  it('is searchable', async () => {
    await post(ramnique, LONG, { summary: 'zanzibar rollout finished' });
    const found = (await ramnique.get(`/v1/spaces/${main}/search?q=zanzibar`)).body.messages as unknown[];
    expect(found).toHaveLength(1);
  });

  it('is what a notification reads', async () => {
    const live = await liveClient(harbor, 'dev-harsh');
    try {
      await post(ramnique, `[@Harsh](#member:harsh) ${LONG}`, { summary: 'Review the plan' });
      const notify = () => live.frames.find((f): f is Extract<ServerFrame, { kind: 'notify' }> => f.kind === 'notify');
      await live.until(() => !!notify(), 'the notify frame');
      expect(notify()!.body).toBe('Review the plan');
    } finally {
      live.close();
    }
  });

  it('lets an agent post and edit one through the tools, and read it back', async () => {
    const agent = await agentClient(harbor, 'dev-harsh', { agentName: 'Claude' });
    try {
      const { messageId } = await callStructured<{ messageId: string }>(agent, 'post_message', { spaceId: main, body: LONG, summary: 'Agent outcome' });
      const read = await callStructured<{ messages: Message[] }>(agent, 'read_stream', { spaceId: main });
      expect(read.messages.find((m) => m.id === messageId)?.summary).toBe('Agent outcome');
      const edited = await callStructured<{ message: Message }>(agent, 'edit_message', { spaceId: main, messageId, body: LONG, summary: null });
      expect(edited.message.summary).toBeUndefined();
    } finally {
      await agent.close();
    }
  });
});
