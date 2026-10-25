import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message, TopicListing } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// A thread's participants (2026-10-25, the threads discussion in Main): the
// root's author first, then each member who has replied, in the order they
// first replied. Folded at read like reactions, on every path that lists or
// fetches a root, so the Threads list can show faces and filter by them.

let harbor: RunningHarbor;
let ramnique: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let gagan: ReturnType<typeof restClient>;
let main: string;

async function post(client: ReturnType<typeof restClient>, body: string, extra: Record<string, unknown> = {}): Promise<Message> {
  const r = await client.post(`/v1/spaces/${main}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

async function inStream(id: string): Promise<Message> {
  const messages = (await ramnique.get(`/v1/spaces/${main}/stream`)).body.messages as Message[];
  return messages.find((m) => m.id === id)!;
}

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  });
  ramnique = restClient(harbor, 'dev-ramnique');
  harsh = restClient(harbor, 'dev-harsh');
  gagan = restClient(harbor, 'dev-gagan');
  main = (await ramnique.get('/v1/spaces')).body.spaces[0].id;
  const invite = await ramnique.post('/v1/invites', { spaceId: main });
  expect((await harsh.post('/v1/invites/accept', { token: invite.body.token })).status).toBe(200);
  const second = await ramnique.post('/v1/invites', { spaceId: main });
  expect((await gagan.post('/v1/invites/accept', { token: second.body.token })).status).toBe(200);
});

afterAll(async () => {
  await harbor?.close();
});

describe('thread participants', () => {
  it('lists the root author first, then repliers in first-reply order, once each', async () => {
    const root = await post(ramnique, 'Ship the threads view');
    await post(harsh, 'On it', { threadRoot: root.id });
    await post(gagan, 'Reviewing', { threadRoot: root.id });
    await post(harsh, 'Pushed', { threadRoot: root.id });
    expect((await inStream(root.id)).participants).toEqual(['ramnique', 'harsh', 'gagan']);
    const fetched = (await ramnique.get(`/v1/spaces/${main}/messages/${root.id}`)).body.message as Message;
    expect(fetched.participants).toEqual(['ramnique', 'harsh', 'gagan']);
    const thread = (await ramnique.get(`/v1/spaces/${main}/threads/${root.id}`)).body;
    expect((thread.root as Message).participants).toEqual(['ramnique', 'harsh', 'gagan']);
    // A reply is nobody's thread: the field is a root's.
    expect((thread.messages as Message[]).every((m) => m.participants.length === 0)).toBe(true);
  });

  it('is the author alone on a reply-less root, and rides a topic listing', async () => {
    const root = await post(ramnique, 'Quiet thought');
    expect((await inStream(root.id)).participants).toEqual(['ramnique']);
    await post(harsh, 'Agreed', { threadRoot: root.id });
    const topic = await ramnique.post(`/v1/spaces/${main}/topics`, { rootMessageId: root.id, title: 'Quiet', actingMode: 'direct' });
    expect(topic.status).toBe(200);
    const topics = (await ramnique.get(`/v1/spaces/${main}/topics`)).body.topics as TopicListing[];
    expect(topics.find((t) => t.rootMessageId === root.id)?.rootMessage?.participants).toEqual(['ramnique', 'harsh']);
  });

  it('drops a member whose only reply was deleted, and keeps a deleted root author', async () => {
    const root = await post(ramnique, 'Short-lived');
    const reply = await post(gagan, 'Never mind', { threadRoot: root.id });
    await post(harsh, 'Still here', { threadRoot: root.id });
    expect((await inStream(root.id)).participants).toEqual(['ramnique', 'gagan', 'harsh']);
    expect((await gagan.post(`/v1/spaces/${main}/messages/${reply.id}/delete`, { actingMode: 'direct' })).status).toBe(200);
    expect((await inStream(root.id)).participants).toEqual(['ramnique', 'harsh']);
    expect((await ramnique.post(`/v1/spaces/${main}/messages/${root.id}/delete`, { actingMode: 'direct' })).status).toBe(200);
    // A tombstone keeps its attribution, so the author stays a participant.
    expect((await inStream(root.id)).participants).toEqual(['ramnique', 'harsh']);
  });
});
