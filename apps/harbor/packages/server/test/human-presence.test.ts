import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { routes } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { liveClient, restClient, startTestHarbor, type LiveClient } from './helpers.js';

let harbor: RunningHarbor;
const clients: LiveClient[] = [];
const LEASE_MS = 1_000;
beforeAll(async () => {
  harbor = await startTestHarbor({
    seedMembers: [{ id: 'viewer', displayName: 'Viewer' }, { id: 'person', displayName: 'Person' }],
    humanPresenceLeaseMs: LEASE_MS,
  });
});
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
afterAll(async () => { await harbor.close(); });

async function connect(id: string) {
  const client = await liveClient(harbor, `dev-${id}`);
  clients.push(client);
  return client;
}
async function online() {
  const result = await restClient(harbor, 'dev-viewer').get('/v1/members');
  return routes.listOrgMembers.response.parse(result.body).onlinePeople;
}
const activity = (client: LiveClient, sessionId: string, active: boolean) =>
  client.send({ kind: 'member_activity', sessionId, active });
const changed = (observer: LiveClient, online: boolean) =>
  observer.until(frames => frames.some(f => f.kind === 'member_presence' && f.memberId === 'person' && f.online === online));

it('keeps a background connection offline, turns green on focus, and clears immediately on blur', async () => {
  const observer = await connect('viewer');
  const person = await connect('person');
  expect(await online()).toEqual([]);
  activity(person, 'window', true);
  await changed(observer, true);
  expect(await online()).toEqual(['person']);
  activity(person, 'window', false);
  await changed(observer, false);
  expect(await online()).toEqual([]);
  // The background connection stays open for notifications.
  expect(person.frames.some(f => f.kind === 'error')).toBe(false);
});

it('keeps a person online while another window on the same connection remains focused', async () => {
  const observer = await connect('viewer');
  const person = await connect('person');
  activity(person, 'first', true);
  activity(person, 'second', true);
  await changed(observer, true);
  activity(person, 'first', false);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(await online()).toEqual(['person']);
  activity(person, 'second', false);
  await changed(observer, false);
  expect(await online()).toEqual([]);
});

it('combines devices and removes the final focused connection immediately when it closes', async () => {
  const observer = await connect('viewer');
  const first = await connect('person');
  const second = await connect('person');
  activity(first, 'window', true);
  activity(second, 'window', true);
  await changed(observer, true);
  first.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(await online()).toEqual(['person']);
  second.close();
  await changed(observer, false);
  expect(await online()).toEqual([]);
});

it('expires a stale foreground report even if its background socket remains open', async () => {
  const observer = await connect('viewer');
  const person = await connect('person');
  activity(person, 'window', true);
  await changed(observer, true);
  await changed(observer, false);
  expect(await online()).toEqual([]);
});

it('renews the focused lease and does not announce duplicate online frames', async () => {
  const observer = await connect('viewer');
  const person = await connect('person');
  activity(person, 'window', true);
  await changed(observer, true);
  await new Promise(resolve => setTimeout(resolve, LEASE_MS * 0.6));
  activity(person, 'window', true);
  await new Promise(resolve => setTimeout(resolve, LEASE_MS * 0.6));
  expect(await online()).toEqual(['person']);
  expect(observer.frames.filter(f => f.kind === 'member_presence' && f.memberId === 'person')).toHaveLength(1);
  activity(person, 'window', false);
  await changed(observer, false);
});

it('does not infer focus when a disconnected person reconnects', async () => {
  const observer = await connect('viewer');
  const first = await connect('person');
  activity(first, 'window', true);
  await changed(observer, true);
  first.close();
  await changed(observer, false);
  const second = await connect('person');
  expect(await online()).toEqual([]);
  observer.frames.length = 0;
  activity(second, 'window', true);
  await changed(observer, true);
  expect(await online()).toEqual(['person']);
});
