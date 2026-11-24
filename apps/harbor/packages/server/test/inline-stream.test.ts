import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, callStructured, restClient, startTestHarbor } from './helpers.js';

// The inline view (2026-10-25): the stream read with `replies=true` lists
// every message by offset, and names the threads its replies belong to.
// Roots only stays the default.

let harbor: RunningHarbor;
let ramnique: ReturnType<typeof restClient>;
let main: string;

async function post(body: string, threadRoot?: string): Promise<Message> {
  const r = await ramnique.post(`/v1/spaces/${main}/messages`, { body, actingMode: 'direct', ...(threadRoot ? { threadRoot } : {}) });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

async function stream(query: string) {
  const r = await ramnique.get(`/v1/spaces/${main}/stream${query}`);
  expect(r.status).toBe(200);
  return r.body as { messages: Message[]; threadRoots: Message[]; topics: Array<{ rootMessageId: string; title: string }>; hasMore: boolean };
}

let old: Message;
let named: Message;
let newer: Message;
let replyOld: Message;
let replyNamed: Message;

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  });
  ramnique = restClient(harbor, 'dev-ramnique');
  main = (await ramnique.get('/v1/spaces')).body.spaces[0].id;
  old = await post('Fix the login bug');
  named = await post('Launch plan');
  expect((await ramnique.post(`/v1/spaces/${main}/topics`, { rootMessageId: named.id, title: 'Launch', actingMode: 'direct' })).status).toBe(200);
  newer = await post('Standup notes');
  replyOld = await post('PR is up', old.id);
  replyNamed = await post('Shipped', named.id);
});

afterAll(async () => {
  await harbor?.close();
});

describe('stream with replies', () => {
  it('stays roots only by default, and with replies=false', async () => {
    for (const q of ['', '?replies=false']) {
      expect((await stream(q)).messages.map((m) => m.id)).toEqual([old.id, named.id, newer.id]);
      expect((await stream(q)).threadRoots).toEqual([]);
    }
  });

  it('lists every message by offset with replies=true', async () => {
    const page = await stream('?replies=true');
    expect(page.messages.map((m) => m.id)).toEqual([old.id, named.id, newer.id, replyOld.id, replyNamed.id]);
    expect(page.threadRoots).toEqual([]); // both roots are on the page
  });

  it('carries the roots and topics of replies whose thread is off the page', async () => {
    const page = await stream(`?replies=true&limit=2`);
    expect(page.messages.map((m) => m.id)).toEqual([replyOld.id, replyNamed.id]);
    expect(page.hasMore).toBe(true);
    expect(page.threadRoots.map((m) => m.id).sort()).toEqual([old.id, named.id].sort());
    expect(page.threadRoots.find((m) => m.id === old.id)?.replyCount).toBe(1);
    expect(page.topics.find((t) => t.rootMessageId === named.id)?.title).toBe('Launch');
    const back = await stream(`?replies=true&limit=2&beforeOffset=${replyOld.offset}`);
    expect(back.messages.map((m) => m.id)).toEqual([named.id, newer.id]);
  });

  it('refuses a replies value that is not true or false', async () => {
    const r = await ramnique.get(`/v1/spaces/${main}/stream?replies=yes`);
    expect(r.status).toBe(400);
  });

  it('read_stream takes includeReplies on the agent face', async () => {
    const agent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Claude' });
    try {
      const roots = await callStructured<{ messages: Message[] }>(agent, 'read_stream', { spaceId: main });
      expect(roots.messages.some((m) => m.threadRoot !== undefined)).toBe(false);
      const all = await callStructured<{ messages: Message[] }>(agent, 'read_stream', { spaceId: main, includeReplies: true });
      expect(all.messages.find((m) => m.id === replyOld.id)?.threadRoot).toBe(old.id);
    } finally {
      await agent.close();
    }
  });
});
