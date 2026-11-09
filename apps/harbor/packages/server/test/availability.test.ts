import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Availability, currentStatus, notificationsPaused, type Message } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { decideNotifications } from '../src/notify.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

const schedule = { timeZone: 'Asia/Kolkata', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };
describe('notification hours', () => {
  it('uses the chosen timezone, weekdays and exclusive end boundary', () => {
    const paused = (at: string) => notificationsPaused({ schedule }, Date.parse(at));
    expect(paused('2026-11-05T03:29:59Z')).toBe(true);
    expect(paused('2026-11-05T03:30:00Z')).toBe(false);
    expect(paused('2026-11-05T11:30:00Z')).toBe(true);
    expect(paused('2026-11-07T06:00:00Z')).toBe(true);
  });
  it('handles overnight shifts, full days and DST using local clock time', () => {
    const overnight = { timeZone: 'UTC', days: [1], start: '22:00', end: '06:00' };
    expect(notificationsPaused({ schedule: overnight }, Date.parse('2026-11-03T05:59:00Z'))).toBe(false);
    expect(notificationsPaused({ schedule: overnight }, Date.parse('2026-11-03T06:00:00Z'))).toBe(true);
    expect(notificationsPaused({ schedule: { ...overnight, start: '00:00', end: '00:00' } }, Date.parse('2026-11-02T23:59:00Z'))).toBe(false);
    const dst = { timeZone: 'America/New_York', days: [0], start: '01:00', end: '02:00' };
    for (const at of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) expect(notificationsPaused({ schedule: dst }, Date.parse(at))).toBe(false);
  });
  it('expires manual pauses and statuses and validates schedule input', () => {
    const now = Date.parse('2026-11-05T06:00:00Z');
    expect(notificationsPaused({ pausedUntil: new Date(now + 1).toISOString() }, now)).toBe(true);
    expect(notificationsPaused({ pausedUntil: new Date(now).toISOString() }, now)).toBe(false);
    expect(notificationsPaused({ status: { text: 'Busy', emoji: '💻', pauseNotifications: true, expiresAt: new Date(now + 1).toISOString() } }, now)).toBe(true);
    expect(notificationsPaused({ status: null }, now)).toBe(false);
    expect(currentStatus({ status: { text: 'Busy', emoji: '💻', expiresAt: new Date(now).toISOString() } }, now)).toBeUndefined();
    expect(Availability.safeParse({ schedule: { ...schedule, timeZone: 'invalid' } }).success).toBe(false);
    expect(Availability.safeParse({ schedule: { ...schedule, start: '25:00' } }).success).toBe(false);
    expect(notificationsPaused({ schedule: { ...schedule, days: [] }, resumedUntil: new Date(now + 1).toISOString() }, now)).toBe(false);
  });
});

let harbor: RunningHarbor;
beforeAll(async () => { harbor = await startTestHarbor({ seedMembers: [{ id: 'alice', displayName: 'Alice' }, { id: 'bob', displayName: 'Bob' }] }); });
afterAll(async () => { await harbor.close(); });
const as = (id: string) => restClient(harbor, `dev-${id}`);

it('persists partial availability edits on both faces, publishes the profile and validates them', async () => {
  const observer = await liveClient(harbor, 'dev-bob');
  const status = { text: 'Busy', emoji: '💻', expiresAt: null };
  expect((await as('alice').put('/v1/me', { availability: { status, schedule } })).status).toBe(200);
  await observer.until(frames => frames.some(f => f.kind === 'profile_updated' && f.member.id === 'alice' && f.member.availability?.status?.text === 'Busy'));
  const agent = await agentClient(harbor, 'dev-alice', { agentName: 'Test' });
  const result = await agent.callTool({ name: 'update_profile', arguments: { availability: { manualAway: true } } });
  expect(result.isError).not.toBe(true);
  expect((await as('alice').get('/v1/me')).body.member.availability).toMatchObject({ status, schedule, manualAway: true });
  await as('alice').put('/v1/me', { title: 'Engineer' });
  expect((await as('bob').get('/v1/members')).body.members.find((m: { id: string }) => m.id === 'alice').availability.status).toEqual(status);
  expect((await as('alice').put('/v1/me', { availability: { schedule: { ...schedule, timeZone: 'Nope' } } })).status).toBe(400);
  await as('alice').put('/v1/me', { availability: { manualAway: false, status: null, schedule: null } });
  await agent.close(); observer.close();
});

it('manual away overrides active devices; idle tabs cannot hide an active one; DND leaves presence alone', async () => {
  const first = await liveClient(harbor, 'dev-alice');
  const second = await liveClient(harbor, 'dev-alice');
  const observer = await liveClient(harbor, 'dev-bob');
  try {
    await as('alice').put('/v1/me', { availability: { manualAway: true } });
    first.send({ kind: 'activity', active: true });
    expect((await as('bob').get('/v1/members')).body.onlinePeople).not.toContain('alice');
    await as('alice').put('/v1/me', { availability: { manualAway: false } });
    await observer.until(frames => frames.some(f => f.kind === 'member_presence' && f.memberId === 'alice' && f.online));
    first.send({ kind: 'activity', active: false });
    await as('alice').put('/v1/me', { availability: { pausedUntil: new Date(Date.now() + 60_000).toISOString() } });
    expect((await as('bob').get('/v1/members')).body.onlinePeople).toContain('alice');
    second.send({ kind: 'activity', active: false });
    await observer.until(frames => frames.some(f => f.kind === 'member_presence' && f.memberId === 'alice' && !f.online));
    expect((await as('bob').get('/v1/members')).body.onlinePeople).not.toContain('alice');
  } finally { first.close(); second.close(); observer.close(); }
});

it('suppresses notification recipients without suppressing the message or unread state', async () => {
  const created = await as('bob').post('/v1/spaces', { name: 'Availability' });
  const space = created.body.space;
  expect((await as('bob').post(`/v1/spaces/${space.id}/members`, { memberIds: ['alice'], actingMode: 'direct' })).status).toBe(200);
  await as('alice').put('/v1/me', { availability: { pausedUntil: new Date(Date.now() + 60_000).toISOString() } });
  const posted = await as('bob').post(`/v1/spaces/${space.id}/messages`, { body: '[@Alice](#member:alice) hello', actingMode: 'direct' });
  expect(posted.status).toBe(200);
  const message = posted.body.message as Message;
  const unread = (await as('alice').get('/v1/unread')).body.spaces.find((s: { spaceId: string }) => s.spaceId === space.id);
  expect(unread.unreadMentions).toBe(1);
  expect(await decideNotifications(harbor.store, space, message)).toEqual([]);
  await as('alice').put('/v1/me', { availability: { pausedUntil: null, schedule: { ...schedule, days: [] } } });
  expect(await decideNotifications(harbor.store, space, message)).toEqual([]);
  await as('alice').put('/v1/me', { availability: { resumedUntil: new Date(Date.now() + 60_000).toISOString() } });
  expect((await decideNotifications(harbor.store, space, message)).map(row => row.memberId)).toContain('alice');
});

it('expires a connected client with no activity reports after ten minutes', async () => {
  await as('alice').put('/v1/me', { availability: { manualAway: false } });
  const client = await liveClient(harbor, 'dev-alice');
  try {
    expect((await as('bob').get('/v1/members')).body.onlinePeople).toContain('alice');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000 + 1);
    try { expect((await as('bob').get('/v1/members')).body.onlinePeople).not.toContain('alice'); }
    finally { clock.mockRestore(); }
  } finally { client.close(); }
});
