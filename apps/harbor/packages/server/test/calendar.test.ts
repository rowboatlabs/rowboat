import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  describeCalendarWhen,
  expandOccurrences,
  mcpTools,
  normalizeCalendarTimes,
  routes,
  type CalendarEntry,
  type CalendarOccurrence,
  type Invocation,
  type Member,
  type Message,
} from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// The space calendar (2026-11-28, "channel calendar" in rowboat): entries
// any member writes, told to the members they tag through a message in the
// space and nothing else. The first half pins what an entry's times mean
// (the arithmetic the app shares); the second speaks the wire.

const times = (start: string, end: string, extra: Partial<CalendarEntry> = {}) =>
  ({ id: '01HZZZZZZZZZZZZZZZZZZZZZZZ', allDay: false, start, end, timeZone: 'America/Los_Angeles', ...extra }) as CalendarEntry;
const starts = (list: CalendarOccurrence[]) => list.map((o) => o.start);

describe('occurrences', () => {
  it('an entry that does not repeat happens once, when the range overlaps it', () => {
    const entry = times('2026-12-01T17:00:00.000Z', '2026-12-01T17:30:00.000Z');
    expect(expandOccurrences(entry, '2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z')).toEqual([
      { entryId: entry.id, start: '2026-12-01T17:00:00.000Z', end: '2026-12-01T17:30:00.000Z' },
    ]);
    expect(expandOccurrences(entry, '2026-12-01T17:15:00Z', '2026-12-01T17:20:00Z')).toHaveLength(1);
    // The range is half-open, and so is the entry: touching is not overlapping.
    expect(expandOccurrences(entry, '2026-12-01T17:30:00Z', '2026-12-02T00:00:00Z')).toEqual([]);
    expect(expandOccurrences(entry, '2026-11-30T00:00:00Z', '2026-12-01T17:00:00Z')).toEqual([]);
  });

  it('a daily repeat keeps its wall-clock time across a daylight-saving change', () => {
    // 09:00 in Los Angeles: 17:00Z on PST, 16:00Z once PDT starts on 2027-03-14.
    const entry = times('2027-03-12T17:00:00.000Z', '2027-03-12T17:30:00.000Z', { recurrence: { freq: 'daily', interval: 1 } });
    expect(starts(expandOccurrences(entry, '2027-03-12T00:00:00Z', '2027-03-16T00:00:00Z'))).toEqual([
      '2027-03-12T17:00:00.000Z',
      '2027-03-13T17:00:00.000Z',
      '2027-03-14T16:00:00.000Z',
      '2027-03-15T16:00:00.000Z',
    ]);
  });

  it('a daily repeat set up long ago is found without walking to it, on its own interval', () => {
    const entry = times('2020-01-01T17:00:00.000Z', '2020-01-01T18:00:00.000Z', { recurrence: { freq: 'daily', interval: 3 } });
    const found = starts(expandOccurrences(entry, '2026-12-01T00:00:00Z', '2026-12-08T00:00:00Z'));
    expect(found).toEqual(['2026-12-01T17:00:00.000Z', '2026-12-04T17:00:00.000Z', '2026-12-07T17:00:00.000Z']);
    for (const start of found) expect(((Date.parse(start) - Date.parse(entry.start)) / 86_400_000) % 3).toBe(0);
  });

  it('a weekly repeat falls on its weekdays, every interval weeks, never before it starts', () => {
    // Starts Wed 2026-12-02; Mon, Wed and Fri every second week.
    const entry = times('2026-12-02T17:00:00.000Z', '2026-12-02T18:00:00.000Z', { recurrence: { freq: 'weekly', interval: 2, weekdays: [1, 3, 5] } });
    expect(starts(expandOccurrences(entry, '2026-11-01T00:00:00Z', '2026-12-31T00:00:00Z')).map((s) => s.slice(0, 10))).toEqual([
      '2026-12-02', '2026-12-04', '2026-12-14', '2026-12-16', '2026-12-18', '2026-12-28', '2026-12-30',
    ]);
    // With no weekdays named, it is the start's own.
    const plain = times('2026-12-02T17:00:00.000Z', '2026-12-02T18:00:00.000Z', { recurrence: { freq: 'weekly', interval: 1 } });
    expect(starts(expandOccurrences(plain, '2026-12-01T00:00:00Z', '2026-12-20T00:00:00Z')).map((s) => s.slice(0, 10))).toEqual(['2026-12-02', '2026-12-09', '2026-12-16']);
  });

  it('a monthly repeat skips months without its day, and stops at `until`', () => {
    const entry = times('2027-01-31T17:00:00.000Z', '2027-01-31T18:00:00.000Z', { recurrence: { freq: 'monthly', interval: 1, until: '2027-07-31' } });
    expect(starts(expandOccurrences(entry, '2027-01-01T00:00:00Z', '2027-12-31T00:00:00Z')).map((s) => s.slice(0, 10))).toEqual([
      '2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31',
    ]);
  });

  it('an all-day entry covers its dates in its own zone, and repeats by date', () => {
    const entry = times('2026-12-01', '2026-12-02', { allDay: true, timeZone: 'Asia/Kolkata', recurrence: { freq: 'weekly', interval: 1 } });
    expect(expandOccurrences(entry, '2026-12-01T00:00:00Z', '2026-12-10T00:00:00Z')).toEqual([
      { entryId: entry.id, start: '2026-12-01', end: '2026-12-02' },
      { entryId: entry.id, start: '2026-12-08', end: '2026-12-09' },
    ]);
    // Dec 1 in Kolkata begins at 18:30Z on Nov 30.
    expect(expandOccurrences(entry, '2026-11-30T18:00:00Z', '2026-11-30T18:30:00Z')).toEqual([]);
    expect(expandOccurrences(entry, '2026-11-30T18:30:00Z', '2026-11-30T19:00:00Z')).toHaveLength(1);
  });

  it('refuses times that mean nothing, and keeps instants in UTC', () => {
    const base = { allDay: false, timeZone: 'UTC' };
    expect(normalizeCalendarTimes({ ...base, start: '2026-12-01T09:00:00-08:00', end: '2026-12-01T09:30:00-08:00' })).toEqual({
      ok: true,
      times: { ...base, start: '2026-12-01T17:00:00.000Z', end: '2026-12-01T17:30:00.000Z' },
    });
    expect(normalizeCalendarTimes({ ...base, start: '2026-12-01T10:00:00Z', end: '2026-12-01T10:00:00Z' })).toMatchObject({ ok: false });
    expect(normalizeCalendarTimes({ ...base, start: '2026-12-01', end: '2026-12-02' })).toMatchObject({ ok: false });
    expect(normalizeCalendarTimes({ ...base, allDay: true, start: '2026-12-02', end: '2026-12-01' })).toMatchObject({ ok: false });
    expect(normalizeCalendarTimes({ ...base, allDay: true, start: '2026-12-01T10:00:00Z', end: '2026-12-02' })).toMatchObject({ ok: false });
    const timed = { ...base, start: '2026-12-01T10:00:00Z', end: '2026-12-01T11:00:00Z' };
    expect(normalizeCalendarTimes({ ...timed, recurrence: { freq: 'daily', interval: 1, weekdays: [1] } })).toMatchObject({ ok: false });
    expect(normalizeCalendarTimes({ ...timed, recurrence: { freq: 'daily', interval: 1, until: '2026-11-30' } })).toMatchObject({ ok: false });
  });

  it('says when in words, in the entry’s zone', () => {
    const now = new Date('2026-11-28T00:00:00Z');
    expect(describeCalendarWhen(times('2026-12-01T17:00:00.000Z', '2026-12-01T17:30:00.000Z'), { now })).toBe('Tue, Dec 1, 9:00 – 9:30 AM PST');
    expect(describeCalendarWhen(times('2026-12-01T19:30:00.000Z', '2026-12-01T21:00:00.000Z'), { now })).toBe('Tue, Dec 1, 11:30 AM – 1:00 PM PST');
    expect(describeCalendarWhen(times('2027-03-01T17:00:00.000Z', '2027-03-01T18:00:00.000Z', { recurrence: { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] } }), { now })).toBe(
      'Mon, Mar 1, 2027, 9:00 – 10:00 AM PST, every weekday',
    );
    expect(describeCalendarWhen(times('2026-12-01', '2026-12-03', { allDay: true, recurrence: { freq: 'monthly', interval: 2, until: '2027-06-01' } }), { now })).toBe(
      'Tue, Dec 1 – Thu, Dec 3, every 2 months on day 1 until Jun 1, 2027',
    );
  });
});

let harbor: RunningHarbor;
let spaceId: string;
let scout: Member;
let scoutKey: string;
let scoutTools: Client;
const as = (token: string) => restClient(harbor, token);
const arjun = () => as('dev-arjun');
const tushar = () => as('dev-tushar');
const calendar = (path = '') => `/v1/spaces/${spaceId}/calendar${path}`;
const DEC1 = { title: 'Weekly triage', start: '2026-12-01T09:00:00-08:00', end: '2026-12-01T09:30:00-08:00', timeZone: 'America/Los_Angeles' };

async function create(input: Record<string, unknown>, client = arjun()) {
  const r = await client.post(calendar(), { ...DEC1, actingMode: 'direct', ...input });
  expect(r.status).toBe(200);
  return routes.createCalendarEntry.response.parse(r.body);
}
async function update(entryId: string, input: Record<string, unknown>, client = arjun()) {
  const r = await client.post(calendar(`/${entryId}`), { actingMode: 'direct', ...input });
  expect(r.status).toBe(200);
  return routes.updateCalendarEntry.response.parse(r.body);
}
async function listed(from = '2026-11-29T00:00:00Z', to = '2026-12-13T00:00:00Z', client = arjun()) {
  const r = await client.get(`${calendar()}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  expect(r.status).toBe(200);
  return routes.listCalendarEntries.response.parse(r.body);
}
const thread = async (rootId: string) => (await arjun().get(`/v1/spaces/${spaceId}/threads/${rootId}`)).body as { root: Message; messages: Message[] };
const stream = async () => (await arjun().get(`/v1/spaces/${spaceId}/stream`)).body.messages as Message[];
const calendarEvents = async () => (await harbor.store.listEventsAfter(spaceId, 0)).map((e) => e.event).filter((e) => e.type === 'calendar_entry');
const invocationsOf = async (agentId: string) =>
  ((await arjun().get(`/v1/spaces/${spaceId}/invocations`)).body.invocations as Invocation[]).filter((i) => i.agentId === agentId);
const token = (member: { displayName: string; id: string }) => `[@${member.displayName}](#member:${member.id})`;

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`tool ${name} errored: ${JSON.stringify(result.content)}`);
  const parsed = mcpTools.find((t) => t.name === name)!.output.safeParse(result.structuredContent);
  if (!parsed.success) throw new Error(`tool ${name} output failed its schema: ${parsed.error.message}`);
  return result.structuredContent as T;
}

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'arjun', displayName: 'Arjun' },
      { id: 'tushar', displayName: 'Tushar' },
      { id: 'outsider', displayName: 'Outsider' },
    ],
    seedSpaces: [{ name: 'Lobby', creator: 'arjun' }],
  });
  spaceId = (await arjun().post('/v1/spaces', { name: 'OSS', visibility: 'private' })).body.space.id;
  const added = await arjun().post('/v1/agents', { displayName: 'OSS PM' });
  scout = added.body.agent;
  scoutKey = added.body.key.secret;
  await arjun().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['tushar', scout.id], actingMode: 'direct' });
  scoutTools = await agentClient(harbor, scoutKey);
});

afterAll(async () => {
  await scoutTools.close();
  await harbor.close();
});

describe('an entry that tags someone else', () => {
  it('posts its card as the creator, mentions the tagged members, and invokes a tagged agent', async () => {
    const before = (await stream()).length;
    const { entry, message, invocations } = await create({ attendees: ['arjun', scout.id, 'tushar'], description: 'Go through new issues', recurrence: { freq: 'weekly' } });

    expect(entry).toMatchObject({
      spaceId,
      title: 'Weekly triage',
      allDay: false,
      start: '2026-12-01T17:00:00.000Z',
      end: '2026-12-01T17:30:00.000Z',
      timeZone: 'America/Los_Angeles',
      recurrence: { freq: 'weekly', interval: 1 },
      attendees: ['arjun', scout.id, 'tushar'],
      createdBy: { memberId: 'arjun', actingMode: 'direct' },
    });
    // The card is a new root in the stream, and it is the entry's thread.
    expect(message).toMatchObject({ author: { memberId: 'arjun' }, mentions: [scout.id, 'tushar'] });
    expect(message!.threadRoot).toBeUndefined();
    expect(entry.threadRoot).toBe(message!.id);
    expect(message!.calendarEntry).toEqual(entry);
    expect(await stream()).toHaveLength(before + 1);
    // Its text tells the tagged members, and says nothing will run.
    expect(message!.body).toContain(`📅 **Weekly triage** · Tue, Dec 1, 9:00 – 9:30 AM PST, weekly on Tue`);
    expect(message!.body).toContain(`For @Arjun ${token(scout)} ${token({ displayName: 'Tushar', id: 'tushar' })}`);
    expect(message!.body).toContain('Go through new issues');
    expect(message!.body).toContain('nothing runs and no one is reminded');

    // The agent is invoked by the card, in the entry's thread; the person is not.
    expect(invocations).toEqual([expect.objectContaining({ agentId: scout.id, state: 'pending' })]);
    expect(await invocationsOf(scout.id)).toEqual([
      expect.objectContaining({ conversation: { spaceId, threadRootId: message!.id }, trigger: expect.objectContaining({ messageId: message!.id, authorId: 'arjun' }) }),
    ]);

    expect((await calendarEvents()).at(-1)).toMatchObject({ action: 'created', entry: { id: entry.id, threadRoot: message!.id }, by: { memberId: 'arjun' } });
  });

  it('a new time is one line in its thread to everyone it tags; a new title alone is silent', async () => {
    const { entry } = await create({ title: 'Design review', attendees: ['tushar'] });
    const before = (await thread(entry.threadRoot!)).messages.length;

    const retitled = await update(entry.id, { title: 'Design review: calendar' });
    expect(retitled.message).toBeUndefined();
    expect(retitled.entry).toMatchObject({ title: 'Design review: calendar', updatedBy: { memberId: 'arjun' } });
    expect((await thread(entry.threadRoot!)).messages).toHaveLength(before);

    const moved = await update(entry.id, { start: '2026-12-02T10:00:00-08:00', end: '2026-12-02T11:00:00-08:00' });
    expect(moved.message).toMatchObject({ threadRoot: entry.threadRoot, mentions: ['tushar'] });
    expect(moved.message!.body).toBe(`📅 **Design review: calendar** moved to Wed, Dec 2, 10:00 – 11:00 AM PST · ${token({ displayName: 'Tushar', id: 'tushar' })}`);
    expect(moved.message!.calendarEntry).toBeUndefined();
    // The card itself now shows the new time, wherever it is read.
    expect((await thread(entry.threadRoot!)).root.calendarEntry).toMatchObject({ start: '2026-12-02T18:00:00.000Z', title: 'Design review: calendar' });
    expect((await stream()).find((m) => m.id === entry.threadRoot)?.calendarEntry?.start).toBe('2026-12-02T18:00:00.000Z');
  });

  it('a change that changes nothing writes nothing', async () => {
    const { entry } = await create({ title: 'No-op', attendees: ['tushar'] });
    const events = (await calendarEvents()).length;
    const same = await update(entry.id, { title: 'No-op', start: DEC1.start, end: DEC1.end, attendees: ['tushar'] });
    expect(same.entry).toEqual(entry);
    expect(same.message).toBeUndefined();
    expect(await calendarEvents()).toHaveLength(events);
  });

  it('newly tagged members are told, and only they; the member acting never is', async () => {
    const { entry } = await create({ title: 'Release', attendees: ['tushar'] });
    const added = await update(entry.id, { attendees: ['tushar', scout.id] });
    expect(added.message).toMatchObject({ threadRoot: entry.threadRoot, mentions: [scout.id] });
    expect(added.message!.body).toBe(`📅 ${token(scout)} added to **Release** · Tue, Dec 1, 9:00 – 9:30 AM PST`);
    expect(added.invocations).toEqual([expect.objectContaining({ agentId: scout.id })]);

    // Tushar moves it: Arjun is not tagged, so only the agent is told.
    const moved = await update(entry.id, { start: '2026-12-03T09:00:00-08:00', end: '2026-12-03T09:30:00-08:00' }, tushar());
    expect(moved.message).toMatchObject({ author: { memberId: 'tushar' }, mentions: [scout.id] });
  });

  it('deleting it tells its thread, takes it off the calendar, and marks its card; twice is a no-op', async () => {
    const { entry } = await create({ title: 'Offsite', attendees: ['tushar'] });
    expect((await listed()).entries.map((e) => e.id)).toContain(entry.id);

    const r = await arjun().post(calendar(`/${entry.id}/delete`), { actingMode: 'direct' });
    expect(r.status).toBe(200);
    const deleted = routes.deleteCalendarEntry.response.parse(r.body);
    expect(deleted.entry.deletedAt).toBeDefined();
    expect(deleted.message!.body).toBe(`📅 **Offsite** was cancelled (it was Tue, Dec 1, 9:00 – 9:30 AM PST) · ${token({ displayName: 'Tushar', id: 'tushar' })}`);
    expect((await listed()).entries.map((e) => e.id)).not.toContain(entry.id);
    expect((await thread(entry.threadRoot!)).root.calendarEntry?.deletedAt).toBe(deleted.entry.deletedAt);
    expect((await calendarEvents()).at(-1)).toMatchObject({ action: 'deleted', entry: { id: entry.id } });

    const events = (await calendarEvents()).length;
    const again = await arjun().post(calendar(`/${entry.id}/delete`), { actingMode: 'direct' });
    expect(again.status).toBe(200);
    expect(again.body.message).toBeUndefined();
    expect(await calendarEvents()).toHaveLength(events);
    expect((await arjun().post(calendar(`/${entry.id}`), { title: 'Back', actingMode: 'direct' })).status).toBe(400);
  });
});

describe('an entry that tags no one else', () => {
  it('posts nothing, and has no thread', async () => {
    const before = (await stream()).length;
    const own = await create({ title: 'Heads down', attendees: ['arjun'] });
    const bare = await create({ title: 'Untagged' });
    for (const written of [own, bare]) {
      expect(written.message).toBeUndefined();
      expect(written.invocations).toEqual([]);
      expect(written.entry.threadRoot).toBeUndefined();
    }
    expect(bare.entry.attendees).toEqual([]);
    expect(await stream()).toHaveLength(before);
    // Moving it is silent too.
    const moved = await update(own.entry.id, { start: '2026-12-04T09:00:00-08:00', end: '2026-12-04T10:00:00-08:00' });
    expect(moved.message).toBeUndefined();
    expect(await stream()).toHaveLength(before);
  });

  it('gets its card the moment it tags someone', async () => {
    const { entry } = await create({ title: 'Was private' });
    const tagged = await update(entry.id, { attendees: ['tushar'] });
    expect(tagged.message).toMatchObject({ mentions: ['tushar'], calendarEntry: { id: entry.id } });
    expect(tagged.message!.threadRoot).toBeUndefined();
    expect(tagged.entry.threadRoot).toBe(tagged.message!.id);
  });

  it('the first message about it starts its one thread, with its card first; later ones reply there', async () => {
    const { entry } = await create({ title: 'Nightly sweep' });
    const first = await arjun().post(`/v1/spaces/${spaceId}/messages`, { calendarEntryId: entry.id, body: 'ran clean tonight', actingMode: 'direct' });
    expect(first.status).toBe(200);
    const reply = first.body.message as Message;
    const { root, messages } = await thread(reply.threadRoot!);
    expect(root).toMatchObject({ author: { memberId: 'arjun' }, mentions: [], calendarEntry: { id: entry.id, threadRoot: root.id } });
    expect(root.body).toContain('📅 **Nightly sweep**');
    expect(messages.map((m) => m.body)).toEqual(['ran clean tonight']);

    const second = await tushar().post(`/v1/spaces/${spaceId}/messages`, { calendarEntryId: entry.id, body: 'two flaky tests', actingMode: 'direct' });
    expect((second.body.message as Message).threadRoot).toBe(root.id);
    expect((await thread(root.id)).messages.map((m) => m.body)).toEqual(['ran clean tonight', 'two flaky tests']);

    // An entry id and a thread are two answers to one question.
    const both = await arjun().post(`/v1/spaces/${spaceId}/messages`, { calendarEntryId: entry.id, threadRoot: root.id, body: 'x', actingMode: 'direct' });
    expect(both.status).toBe(400);
  });

  it('two first messages at once still start one thread', async () => {
    const { entry } = await create({ title: 'Race' });
    const posts = await Promise.all(
      [arjun(), tushar()].map((client, i) => client.post(`/v1/spaces/${spaceId}/messages`, { calendarEntryId: entry.id, body: `update ${i}`, actingMode: 'direct' })),
    );
    const roots = new Set(posts.map((p) => (p.body.message as Message).threadRoot));
    expect(roots.size).toBe(1);
    expect((await stream()).filter((m) => m.calendarEntry?.id === entry.id)).toHaveLength(1);
  });
});

describe('an entry asked for in a thread', () => {
  it('takes that thread as its own: a reply names its root, the card is a reply, and nothing new starts', async () => {
    const ask = (await arjun().post(`/v1/spaces/${spaceId}/messages`, { body: 'please triage daily', actingMode: 'direct' })).body.message as Message;
    const reply = (await arjun().post(`/v1/spaces/${spaceId}/messages`, { body: 'at nine', threadRoot: ask.id, actingMode: 'direct' })).body.message as Message;
    const before = (await stream()).length;

    const silent = await create({ title: 'Daily triage', threadRoot: reply.id, recurrence: { freq: 'daily' } });
    expect(silent.entry.threadRoot).toBe(ask.id);
    expect(silent.message).toBeUndefined();

    const told = await create({ title: 'Daily triage review', threadRoot: ask.id, attendees: ['tushar'] });
    expect(told.message).toMatchObject({ threadRoot: ask.id, mentions: ['tushar'], calendarEntry: { id: told.entry.id } });
    expect(told.entry.threadRoot).toBe(ask.id);
    expect(await stream()).toHaveLength(before);

    const update = await arjun().post(`/v1/spaces/${spaceId}/messages`, { calendarEntryId: silent.entry.id, body: 'done for today', actingMode: 'direct' });
    expect((update.body.message as Message).threadRoot).toBe(ask.id);
  });
});

describe('reading the calendar', () => {
  it('answers a range with the entries in it and each time they happen', async () => {
    const quiet = (await arjun().post('/v1/spaces', { name: 'Quiet', visibility: 'private' })).body.space.id as string;
    const at = (path = '') => `/v1/spaces/${quiet}/calendar${path}`;
    const make = async (input: Record<string, unknown>) => (await arjun().post(at(), { ...DEC1, actingMode: 'direct', ...input })).body.entry as CalendarEntry;
    const once = await make({ title: 'Once' });
    const daily = await make({ title: 'Daily', recurrence: { freq: 'daily', until: '2026-12-03' } });
    const allDay = await make({ title: 'Launch day', allDay: true, start: '2026-12-02', end: '2026-12-02' });
    await make({ title: 'Later', start: '2027-02-01T09:00:00Z', end: '2027-02-01T10:00:00Z' });
    const gone = await make({ title: 'Gone' });
    await arjun().post(at(`/${gone.id}/delete`), { actingMode: 'direct' });

    const r = await arjun().get(`${at()}?from=2026-12-01T00:00:00Z&to=2026-12-08T00:00:00Z`);
    const { entries, occurrences } = routes.listCalendarEntries.response.parse(r.body);
    expect(entries.map((e) => e.title).sort()).toEqual(['Daily', 'Launch day', 'Once']);
    expect(occurrences).toEqual([
      { entryId: once.id, start: '2026-12-01T17:00:00.000Z', end: '2026-12-01T17:30:00.000Z' },
      { entryId: daily.id, start: '2026-12-01T17:00:00.000Z', end: '2026-12-01T17:30:00.000Z' },
      { entryId: allDay.id, start: '2026-12-02', end: '2026-12-02' },
      { entryId: daily.id, start: '2026-12-02T17:00:00.000Z', end: '2026-12-02T17:30:00.000Z' },
      { entryId: daily.id, start: '2026-12-03T17:00:00.000Z', end: '2026-12-03T17:30:00.000Z' },
    ]);

    expect((await arjun().get(`${at()}?from=2026-12-08T00:00:00Z&to=2026-12-01T00:00:00Z`)).status).toBe(400);
    expect((await arjun().get(`${at()}?from=2026-01-01T00:00:00Z&to=2027-06-01T00:00:00Z`)).status).toBe(400);
    expect((await arjun().get(at())).status).toBe(400);
  });

  it('is for members: a private space answers no one else, and no one else writes', async () => {
    const outsider = as('dev-outsider');
    expect((await outsider.get(`${calendar()}?from=2026-12-01T00:00:00Z&to=2026-12-08T00:00:00Z`)).status).toBe(403);
    expect((await outsider.post(calendar(), { ...DEC1, actingMode: 'direct' })).status).toBe(403);
    const { entry } = await create({ title: 'Members only' });
    expect((await outsider.post(calendar(`/${entry.id}`), { title: 'Mine now', actingMode: 'direct' })).status).toBe(403);
    expect((await outsider.post(calendar(`/${entry.id}/delete`), { actingMode: 'direct' })).status).toBe(403);
    expect((await outsider.post(`/v1/spaces/${spaceId}/messages`, { calendarEntryId: entry.id, body: 'hi', actingMode: 'direct' })).status).toBe(403);
  });

  it('refuses a tag for someone outside the space, and times that mean nothing', async () => {
    const stranger = await arjun().post(calendar(), { ...DEC1, attendees: ['outsider'], actingMode: 'direct' });
    expect(stranger.status).toBe(400);
    expect(stranger.body.message).toContain('not a member of this space');
    expect((await arjun().post(calendar(), { ...DEC1, end: DEC1.start, actingMode: 'direct' })).status).toBe(400);
    expect((await arjun().post(calendar(), { ...DEC1, timeZone: 'Mars/Olympus', actingMode: 'direct' })).status).toBe(400);
    expect((await arjun().post(calendar(), { ...DEC1, allDay: true, actingMode: 'direct' })).status).toBe(400);
    expect((await arjun().post(calendar('/01HZZZZZZZZZZZZZZZZZZZZZZZ'), { title: 'x', actingMode: 'direct' })).status).toBe(404);
  });
});

describe('the card as a message', () => {
  it('cannot be edited; deleting it leaves the entry on the calendar', async () => {
    const { entry, message } = await create({ title: 'Card', attendees: ['tushar'] });
    const edit = await arjun().post(`/v1/spaces/${spaceId}/messages/${message!.id}/edit`, { body: 'rewritten', actingMode: 'direct' });
    expect(edit.status).toBe(400);
    const gone = await arjun().post(`/v1/spaces/${spaceId}/messages/${message!.id}/delete`, { actingMode: 'direct' });
    expect(gone.status).toBe(200);
    expect(gone.body.message.calendarEntry).toBeUndefined();
    expect((await listed()).entries.map((e) => e.id)).toContain(entry.id);
  });

  it('reaches live clients as the message, then the entry as it ended up', async () => {
    const live = await liveClient(harbor, 'dev-tushar');
    try {
      live.send({ kind: 'subscribe', spaceId });
      await live.until((frames) => frames.some((f) => f.kind === 'subscribed'), 'subscribed');
      const { entry, message } = await create({ title: 'Live', attendees: ['tushar'] });
      await live.until(() => live.events().some((f) => f.event.type === 'calendar_entry' && f.event.entry.id === entry.id), 'the entry');
      const posted = live.events().find((f) => f.event.type === 'message' && f.event.message.id === message!.id)!;
      const created = live.events().find((f) => f.event.type === 'calendar_entry' && f.event.entry.id === entry.id)!;
      expect(created.offset).toBeGreaterThan(posted.offset);
      expect(created.event).toMatchObject({ action: 'created', entry: { threadRoot: message!.id } });
    } finally {
      live.close();
    }
  });
});

describe('agents on the calendar', () => {
  it('an agent logs its own work silently, in the thread it was asked in, through the same tools', async () => {
    const ask = (await arjun().post(`/v1/spaces/${spaceId}/messages`, { body: `${token(scout)} sweep stale issues every weekday`, actingMode: 'direct' })).body.message as Message;
    const before = (await stream()).length;
    const written = await call<{ entry: CalendarEntry; messageId?: string }>(scoutTools, 'create_calendar_entry', {
      spaceId,
      title: 'Stale issue sweep',
      start: '2026-12-01T06:00:00Z',
      end: '2026-12-01T06:15:00Z',
      timeZone: 'UTC',
      recurrence: { freq: 'weekly', weekdays: [1, 2, 3, 4, 5] },
      attendees: [scout.id],
      threadRoot: ask.id,
    });
    expect(written.messageId).toBeUndefined();
    expect(written.entry).toMatchObject({ createdBy: { memberId: scout.id, actingMode: 'direct' }, threadRoot: ask.id, attendees: [scout.id] });
    expect(await stream()).toHaveLength(before);

    // It reads the calendar without doing recurrence arithmetic.
    const read = await call<{ entries: CalendarEntry[]; occurrences: CalendarOccurrence[] }>(scoutTools, 'list_calendar_entries', {
      spaceId,
      from: '2026-12-01T00:00:00Z',
      to: '2026-12-08T00:00:00Z',
    });
    expect(read.occurrences.filter((o) => o.entryId === written.entry.id).map((o) => o.start.slice(0, 10))).toEqual([
      '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-07',
    ]);
    // With no range it is the next thirty days.
    await call(scoutTools, 'list_calendar_entries', { spaceId });

    // Its update goes to the entry, which is the thread it was asked in.
    const posted = await call<{ messageId: string; threadRoot?: string }>(scoutTools, 'post_message', { spaceId, calendarEntryId: written.entry.id, body: 'closed 4 stale issues' });
    expect(posted.threadRoot).toBe(ask.id);
  });

  it('an agent that tags a person tells them; changing and deleting work the same', async () => {
    const written = await call<{ entry: CalendarEntry; messageId?: string }>(scoutTools, 'create_calendar_entry', {
      spaceId,
      title: 'Release notes review',
      allDay: true,
      start: '2026-12-05',
      end: '2026-12-05',
      timeZone: 'Asia/Kolkata',
      attendees: ['arjun'],
    });
    const card = (await thread(written.messageId!)).root;
    expect(card).toMatchObject({ author: { memberId: scout.id }, mentions: ['arjun'] });
    expect(card.body).toContain('📅 **Release notes review** · Sat, Dec 5');

    const moved = await call<{ entry: CalendarEntry; messageId?: string }>(scoutTools, 'update_calendar_entry', { spaceId, entryId: written.entry.id, start: '2026-12-06', end: '2026-12-06', description: null });
    expect(moved.entry.start).toBe('2026-12-06');
    expect(moved.messageId).toBeDefined();
    const deleted = await call<{ entry: CalendarEntry; messageId?: string }>(scoutTools, 'delete_calendar_entry', { spaceId, entryId: written.entry.id });
    expect(deleted.entry.deletedAt).toBeDefined();
    expect((await thread(written.messageId!)).messages.map((m) => m.body.split(' · ')[0])).toEqual([
      '📅 **Release notes review** moved to Sun, Dec 6',
      '📅 **Release notes review** was cancelled (it was Sun, Dec 6)',
    ]);
  });
});
