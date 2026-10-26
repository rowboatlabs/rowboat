import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// Who has replied (2026-10-25, "managing sessions" in Main): a root carries
// the distinct authors of its live replies, in first-reply order, so the
// Threads view can show participants and filter by one.

let harbor: RunningHarbor;
let ramnique: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let arjun: ReturnType<typeof restClient>;
let main: string;

async function post(client: ReturnType<typeof restClient>, body: string, extra: Record<string, unknown> = {}): Promise<Message> {
  const r = await client.post(`/v1/spaces/${main}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

async function rootOf(id: string): Promise<Message> {
  return (await ramnique.get(`/v1/spaces/${main}/threads/${id}`)).body.root as Message;
}

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'arjun', displayName: 'Arjun' },
    ],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  });
  ramnique = restClient(harbor, 'dev-ramnique');
  harsh = restClient(harbor, 'dev-harsh');
  arjun = restClient(harbor, 'dev-arjun');
  main = (await ramnique.get('/v1/spaces')).body.spaces[0].id;
  for (const who of [harsh, arjun]) {
    const invite = await ramnique.post('/v1/invites', { spaceId: main });
    expect((await who.post('/v1/invites/accept', { token: invite.body.token })).status).toBe(200);
  }
});

afterAll(async () => {
  await harbor?.close();
});

describe('reply authors', () => {
  it('lists distinct live repliers in first-reply order, on the thread and the stream', async () => {
    const root = await post(ramnique, 'Coding session');
    expect(root.replyAuthors).toEqual([]);
    await post(harsh, 'one', { threadRoot: root.id });
    await post(ramnique, 'two', { threadRoot: root.id });
    const last = await post(arjun, 'three', { threadRoot: root.id });
    await post(harsh, 'four', { threadRoot: root.id });
    expect(last.replyAuthors).toEqual([]);
    expect((await rootOf(root.id)).replyAuthors).toEqual(['harsh', 'ramnique', 'arjun']);
    const stream = (await ramnique.get(`/v1/spaces/${main}/stream`)).body.messages as Message[];
    expect(stream.find((m) => m.id === root.id)?.replyAuthors).toEqual(['harsh', 'ramnique', 'arjun']);
  });

  it('drops an author whose only reply was deleted', async () => {
    const root = await post(ramnique, 'Another session');
    const reply = await post(arjun, 'oops', { threadRoot: root.id });
    await post(harsh, 'kept', { threadRoot: root.id });
    expect((await rootOf(root.id)).replyAuthors).toEqual(['arjun', 'harsh']);
    expect((await arjun.post(`/v1/spaces/${main}/messages/${reply.id}/delete`, { actingMode: 'direct' })).status).toBe(200);
    expect((await rootOf(root.id)).replyAuthors).toEqual(['harsh']);
  });
});
