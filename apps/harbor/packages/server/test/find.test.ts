import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type FindResult, type Message } from '@rowboat/spaces-protocol';
import { jevApi } from '../src/connectors/jev/api.js';
import { MAX_FIND_CANDIDATES, MAX_FIND_TEXT_CHARS, NONE_OPTION, buildFindRequest, decideFind, selectFindCandidates, type FindCandidate } from '../src/connectors/jev/find.js';
import { FINDS_PER_MINUTE } from '../src/core/find.js';
import type { RunningHarbor } from '../src/server.js';
import { FakeTypeSafe } from './fake-typesafe.js';
import { restClient, startTestHarbor } from './helpers.js';

// /find on Harbor (protocol find.ts, 2026-10-07): Harbor gathers the
// candidates within what the caller can read, Jev (a stand-in for TypeSafe's
// API as OpenRouter serves it) picks, and the ranking comes back with where
// to land. No Ro in the org here: /find does not need it in the space.

let fake: FakeTypeSafe;
let harbor: RunningHarbor;
let spaceId: string;
const as = (t: string) => restClient(harbor, t);

async function post(body: string, extra: Record<string, unknown> = {}, t = 'dev-ramnique'): Promise<Message> {
  const r = await as(t).post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...extra });
  expect(r.status).toBe(200);
  return routes.postMessage.response.parse(r.body).message;
}

async function find(query: string, t = 'dev-ramnique', space = spaceId): Promise<{ status: number; body: FindResult & { code?: string; retryable?: boolean } }> {
  return as(t).post(`/v1/spaces/${space}/find`, { query });
}

beforeAll(async () => {
  fake = await new FakeTypeSafe().start();
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'priya', displayName: 'Priya' },
    ],
    jev: () => jevApi('sk-or-test', fake.url),
  });
  spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Eng' })).body.space.id;
  const invite = await as('dev-ramnique').post('/v1/invites', { spaceId });
  await as('dev-harsh').post('/v1/invites/accept', { token: invite.body.token });
});

afterAll(async () => {
  await harbor.close();
  await fake.close();
});

describe('/find', () => {
  it('lands on the root Jev picks, with where it lives, and Jev never sees an id', async () => {
    await post('Lunch is on me today');
    const offsite = await post('Where should the November offsite be?');
    await post('Lisbon gets my vote', { threadRoot: offsite.id }, 'dev-harsh');

    const r = await find('that thing about the offsite');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reason: 'ranked', found: true, presence: 0.9 });
    expect(r.body.ranked[0]).toEqual({ messageId: offsite.id, threadRootId: offsite.id, title: null, replyCount: 1, offset: offsite.offset, probability: 0.8 });

    const call = fake.finds.at(-1)!;
    expect(call.auth).toBe('Bearer sk-or-test');
    expect(call.state).toMatchObject({ space: 'Eng', query: 'that thing about the offsite' });
    expect(JSON.stringify(call.state)).not.toContain(offsite.id);
    expect(Object.keys(call.questions)).toEqual(['match', 'present']);
  });

  it('reaches replies through the word search, and lands on them in their thread', async () => {
    const root = await post('Planning thread');
    const reply = await post('the zanzibar numbers are in the sheet', { threadRoot: root.id }, 'dev-harsh');
    const r = await find('zanzibar');
    expect(r.body.found).toBe(true);
    expect(r.body.ranked[0]).toMatchObject({ messageId: reply.id, threadRootId: root.id, offset: reply.offset });
    expect(r.body.ranked[0]!.replyCount).toBeUndefined();
    expect(fake.finds.at(-1)!.state.messages.find((m) => m.text.includes('zanzibar'))).toMatchObject({ is_reply: true, by: 'Harsh' });
  });

  it('carries the topic title', async () => {
    const root = await post('Kickoff agenda draft');
    await as('dev-ramnique').post(`/v1/spaces/${spaceId}/topics`, { rootMessageId: root.id, title: 'Quarterly kickoff', actingMode: 'direct' });
    const r = await find('kickoff');
    expect(r.body.ranked[0]).toMatchObject({ messageId: root.id, title: 'Quarterly kickoff' });
  });

  it('is not found when Jev picks none of these', async () => {
    const r = await find('the quokka');
    expect(r.body).toMatchObject({ reason: 'ranked', found: false, ranked: [] });
  });

  it('is open to a reader of an open space who is not in it, and refused where they cannot read', async () => {
    const open = (await as('dev-ramnique').post('/v1/spaces', { name: 'Lobby', visibility: 'open' })).body.space.id;
    await as('dev-ramnique').post(`/v1/spaces/${open}/messages`, { body: 'The wifi password is on the fridge', actingMode: 'direct' });
    expect((await find('wifi', 'dev-gagan', open)).body.found).toBe(true);

    const asked = fake.finds.length;
    const refused = await find('offsite', 'dev-gagan');
    expect(refused.status).toBe(403);
    expect(fake.finds.length).toBe(asked);
  });

  it('refuses an empty query', async () => {
    expect((await find('   ')).status).toBe(400);
  });

  it('says rate_limited when OpenRouter stays busy', async () => {
    fake.failWith = [503];
    const r = await find('offsite', 'dev-harsh');
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: 'rate_limited', retryable: true });
  });

  it(`allows ${FINDS_PER_MINUTE} finds a minute per member`, async () => {
    // A fresh member: the budget is per member, and the others above spent some.
    await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['priya'], actingMode: 'direct' });
    for (let i = 0; i < FINDS_PER_MINUTE; i++) expect((await find('offsite', 'dev-priya')).status).toBe(200);
    const r = await find('offsite', 'dev-priya');
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('rate_limited');
  });
});

describe('/find without Jev', () => {
  it('answers unavailable, so the app can fall back', async () => {
    const bare = await startTestHarbor({ seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }] });
    try {
      const client = restClient(bare, 'dev-ramnique');
      const space = (await client.post('/v1/spaces', { name: 'Eng' })).body.space.id;
      await client.post(`/v1/spaces/${space}/messages`, { body: 'hello', actingMode: 'direct' });
      const r = await client.post(`/v1/spaces/${space}/find`, { query: 'hello' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ reason: 'unavailable', ranked: [], found: false });
    } finally {
      await bare.close();
    }
  });
});

// The pure half, carried over from the desktop app's find_questions.test.ts.
const candidate = (over: Partial<FindCandidate> & { messageId: string }): FindCandidate => ({
  threadRootId: over.messageId,
  title: null,
  text: 'text',
  at: '2026-09-22T10:00:00.000Z',
  offset: 1,
  ...over,
});

describe('find questions', () => {
  it('keeps one entry per message, the first given, capped before sorting newest first, text clipped', () => {
    const many = Array.from({ length: MAX_FIND_CANDIDATES + 3 }, (_, i) =>
      candidate({ messageId: `m${i}`, at: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00.000Z` }),
    );
    const picked = selectFindCandidates([candidate({ messageId: 'hit', text: 'x'.repeat(999), at: '2020-01-01T00:00:00.000Z' }), ...many, candidate({ messageId: 'hit', text: 'dupe' })]);
    expect(picked).toHaveLength(MAX_FIND_CANDIDATES);
    // The first given (a search hit) survives the cap though it is the oldest.
    expect(picked.at(-1)!.messageId).toBe('hit');
    expect(picked.at(-1)!.text).toHaveLength(MAX_FIND_TEXT_CHARS);
    for (let i = 1; i < picked.length; i++) expect(picked[i - 1]!.at >= picked[i]!.at).toBe(true);
  });

  it('describes each message, marks replies, and offers none of these', () => {
    const { state, questions } = buildFindRequest({ spaceName: 'eng', query: 'the offsite thing' }, [
      candidate({ messageId: 'a', title: 'Offsite', text: 'Where in November?', author: 'Priya', replyCount: 5 }),
      candidate({ messageId: 'b', threadRootId: 'a', text: 'Lisbon gets my vote' }),
    ]);
    const s = state as { messages: Record<string, unknown>[] };
    expect(s.messages[0]).toMatchObject({ id: 'message_1', thread_title: 'Offsite', by: 'Priya', replies: 5 });
    expect(s.messages[1]).toMatchObject({ id: 'message_2', is_reply: true });
    expect(Object.keys(questions.match.criteria)).toEqual(['message_1', 'message_2', NONE_OPTION]);
  });

  it('is not found on none of these or low presence, and throws without a match answer', () => {
    const three = [candidate({ messageId: 'a' }), candidate({ messageId: 'b' }), candidate({ messageId: 'c' })];
    const choice = (pick: string, probabilities: Record<string, number>) => ({ type: 'choice' as const, choice: pick, probabilities, confidence: 0.9 });
    expect(decideFind({ match: choice(NONE_OPTION, { message_1: 0.3, [NONE_OPTION]: 0.7 }) }, three)).toMatchObject({ found: false, ranked: [{ messageId: 'a' }] });
    expect(decideFind({ match: choice('message_1', { message_1: 0.9 }), present: { type: 'noul', noul: 0.3 } }, three).found).toBe(false);
    expect(decideFind({ match: choice('message_1', { message_1: 0.9 }) }, three).found).toBe(true);
    expect(() => decideFind({}, three)).toThrow(/no match/);
  });
});

