import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type StreamEvent } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// Join lines in the stream (2026-09-29, the Matrix model): listStream's
// `events` carries the membership events between the page's messages. Each
// belongs to the page holding the next message after it, and the newest page
// also takes those after its newest message — so paging any way shows every
// event exactly once.

let harbor: RunningHarbor;
let spaceId: string;
let all: StreamEvent[];
const ramnique = () => restClient(harbor, 'dev-ramnique');

async function page(query: string) {
  const r = await ramnique().get(`/v1/spaces/${spaceId}/stream?${query}`);
  expect(r.status).toBe(200);
  return routes.listStream.response.parse(r.body);
}

const post = (body: string) => ramnique().post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct' });
const offsets = (events: StreamEvent[]) => events.map((e) => e.offset);

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
  });
  spaceId = (await ramnique().post('/v1/spaces', { name: 'Payments' })).body.space.id;
  // Ramnique joined (creation) · m1 · Harsh added · m2 · m3 · Gagan added, Harsh left · m4 · Harsh added back.
  await post('m1');
  await ramnique().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
  await post('m2');
  await post('m3');
  await ramnique().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
  await restClient(harbor, 'dev-harsh').post(`/v1/spaces/${spaceId}/leave`);
  await post('m4');
  await ramnique().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
  all = (await page('limit=100')).events;
});

afterAll(async () => {
  await harbor.close();
});

describe('listStream events', () => {
  it('carries every membership event, oldest first, with who added whom', () => {
    expect(all.map((e) => [e.event.action, e.event.membership.memberId, e.event.by?.memberId])).toEqual([
      ['joined', 'ramnique', undefined],
      ['joined', 'harsh', 'ramnique'],
      ['joined', 'gagan', 'ramnique'],
      ['left', 'harsh', undefined],
      ['joined', 'harsh', 'ramnique'],
    ]);
  });

  it('pages back one message at a time without a duplicate or a gap', async () => {
    const seen: StreamEvent[] = [];
    let q = 'limit=1';
    for (;;) {
      const p = await page(q);
      seen.unshift(...p.events);
      if (!p.hasMore) break;
      q = `limit=1&beforeOffset=${p.messages[0]!.offset}`;
    }
    expect(offsets(seen)).toEqual(offsets(all));
  });

  it('pages forward from the start the same way', async () => {
    const seen: StreamEvent[] = [];
    let after = 0;
    for (;;) {
      const p = await page(`limit=1&afterOffset=${after}`);
      seen.push(...p.events);
      if (!p.hasMoreAfter) break;
      after = p.messages.at(-1)!.offset;
    }
    expect(offsets(seen)).toEqual(offsets(all));
  });

  it('gives a page around a message the events that page answers for', async () => {
    const m3 = (await page('limit=100')).messages.find((m) => m.body === 'm3')!;
    const around = await page(`limit=2&aroundOffset=${m3.offset}`); // m2 and m3
    expect(around.messages.map((m) => m.body)).toEqual(['m2', 'm3']);
    // Harsh's add sits between m1 and m2, so it belongs here; Gagan's add sits after m3, so it does not.
    expect(around.events.map((e) => e.event.membership.memberId)).toEqual(['harsh']);
  });

  it('shows the joins of a space nobody has posted in', async () => {
    const quiet = (await ramnique().post('/v1/spaces', { name: 'Quiet' })).body.space.id;
    const r = routes.listStream.response.parse((await ramnique().get(`/v1/spaces/${quiet}/stream`)).body);
    expect(r.messages).toEqual([]);
    expect(r.events.map((e) => [e.event.action, e.event.membership.memberId])).toEqual([['joined', 'ramnique']]);
  });
});
