import { z } from 'zod';
import { ActingMode, CalendarEntry, CalendarEntryId, CalendarRecurrence, TimeZone } from './core.js';
import { MemberId, MessageId } from './ids.js';

// The space calendar (2026-11-28, "channel calendar" in rowboat): what an
// entry's times mean. Harbor answers a range with occurrences and writes the
// times into its messages; the app draws the same occurrences on its grid and
// folds live changes in. Both compute them here, so a repeat or a
// daylight-saving change can never come out differently on the two sides.
// Zone arithmetic is Intl's, with no dependency: the package ships to the
// server, the desktop and the phone.

// --- zones --------------------------------------------------------------------

/** A zone's offset from UTC at an instant, in minutes (positive east of Greenwich). */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a wall-clock time in a zone names: `2026-10-05T15:00` in America/New_York → 19:00Z. */
export function zonedToUtc(wall: string, timeZone: string): Date {
  const naive = new Date(`${wall}Z`);
  if (Number.isNaN(naive.getTime())) return naive;
  // Twice: the offset at the guess can differ from the offset at the answer across a DST change.
  let at = new Date(naive.getTime() - zoneOffsetMinutes(timeZone, naive) * 60_000);
  at = new Date(naive.getTime() - zoneOffsetMinutes(timeZone, at) * 60_000);
  return at;
}

/** The calendar date (YYYY-MM-DD) an instant falls on in a zone. */
export function dateInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The wall-clock time (HH:MM:SS) an instant shows in a zone. */
export function timeInZone(at: Date, timeZone: string): string {
  return new Date(at.getTime() + zoneOffsetMinutes(timeZone, at) * 60_000).toISOString().slice(11, 19);
}

/** The date `days` after this one, both YYYY-MM-DD. */
export function nextDate(date: string, days = 1): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one date to another, both YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Sunday to 6 = Saturday. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

// --- what a member sends --------------------------------------------------------

/** A timed entry's instant, with an offset or `Z`; Harbor keeps it as UTC. */
const CalendarInstant = z.iso.datetime({ offset: true });

const entryFields = {
  title: z.string().trim().min(1).max(200),
  /** Markdown. */
  description: z.string().trim().max(4_000),
  /** An all-day entry takes dates (YYYY-MM-DD), `end` being its last day; a timed one takes instants. */
  allDay: z.boolean(),
  start: z.union([CalendarInstant, z.iso.date()]),
  end: z.union([CalendarInstant, z.iso.date()]),
  timeZone: TimeZone,
  recurrence: CalendarRecurrence,
  attendees: z.array(MemberId).max(50),
};

/**
 * A new entry. `threadRoot` names a thread that already exists as the entry's
 * own: the one it was asked for in, so what follows about it lands there and
 * no second thread starts. Without it, Harbor posts the entry's card as a new
 * root when the entry tags someone other than its creator.
 */
export const NewCalendarEntry = z.object({
  title: entryFields.title,
  description: entryFields.description.optional(),
  allDay: entryFields.allDay.optional(),
  start: entryFields.start,
  end: entryFields.end,
  timeZone: entryFields.timeZone,
  recurrence: entryFields.recurrence.optional(),
  attendees: entryFields.attendees.optional(),
  threadRoot: MessageId.optional(),
  actingMode: ActingMode,
  agentName: z.string().max(64).optional(),
});
export type NewCalendarEntry = z.infer<typeof NewCalendarEntry>;

/** What changes on an entry: only the fields present. `null` clears the description or the repeat. */
export const CalendarEntryPatch = z.object({
  title: entryFields.title.optional(),
  description: entryFields.description.nullable().optional(),
  allDay: entryFields.allDay.optional(),
  start: entryFields.start.optional(),
  end: entryFields.end.optional(),
  timeZone: entryFields.timeZone.optional(),
  recurrence: entryFields.recurrence.nullable().optional(),
  attendees: entryFields.attendees.optional(),
  actingMode: ActingMode,
  agentName: z.string().max(64).optional(),
});
export type CalendarEntryPatch = z.infer<typeof CalendarEntryPatch>;

/** The most a calendar read spans, in days: a year's view and its edges. */
export const CALENDAR_RANGE_DAYS_MAX = 400;

/** One time an entry happens: the entry itself, or one turn of its repeat. Shaped like the entry's own `start` and `end`. */
export const CalendarOccurrence = z.object({ entryId: CalendarEntryId, start: z.string(), end: z.string() });
export type CalendarOccurrence = z.infer<typeof CalendarOccurrence>;

export type CalendarTimes = Pick<CalendarEntry, 'allDay' | 'start' | 'end' | 'timeZone' | 'recurrence'>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An entry's times as Harbor keeps them, or why it cannot: a timed entry's
 * instants in UTC with the end after the start, an all-day entry's dates
 * with the end no earlier, and weekdays only on a weekly repeat.
 */
export function normalizeCalendarTimes(times: CalendarTimes): { ok: true; times: CalendarTimes } | { ok: false; problem: string } {
  const { allDay, timeZone } = times;
  let { start, end } = times;
  if (allDay) {
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return { ok: false, problem: 'an all-day entry takes dates (YYYY-MM-DD) for start and end' };
    if (end < start) return { ok: false, problem: 'end is before start' };
  } else {
    if (DATE_RE.test(start) || DATE_RE.test(end)) return { ok: false, problem: 'a timed entry takes instants for start and end; pass allDay for dates' };
    const [from, to] = [Date.parse(start), Date.parse(end)];
    if (Number.isNaN(from) || Number.isNaN(to)) return { ok: false, problem: 'start and end must be ISO 8601 instants' };
    if (to <= from) return { ok: false, problem: 'end must be after start' };
    start = new Date(from).toISOString();
    end = new Date(to).toISOString();
  }
  const recurrence = times.recurrence;
  if (recurrence?.weekdays && recurrence.freq !== 'weekly') return { ok: false, problem: 'weekdays belong to a weekly repeat' };
  if (recurrence?.until && recurrence.until < firstDate({ allDay, start, timeZone })) return { ok: false, problem: 'the repeat ends before the entry starts' };
  return {
    ok: true,
    times: {
      allDay,
      start,
      end,
      timeZone,
      ...(recurrence ? { recurrence: { ...recurrence, ...(recurrence.weekdays ? { weekdays: [...new Set(recurrence.weekdays)].sort((a, b) => a - b) } : {}) } } : {}),
    },
  };
}

/** The date an entry first falls on, in its own zone. */
function firstDate(entry: Pick<CalendarEntry, 'allDay' | 'start' | 'timeZone'>): string {
  return entry.allDay ? entry.start : dateInZone(new Date(entry.start), entry.timeZone);
}

// --- occurrences ----------------------------------------------------------------

/** How far a repeat is followed looking for a range, in turns: a daily entry twenty-seven years on. */
const TURNS_MAX = 10_000;

/** The dates a repeat falls on, from the entry's first date onward, in order. */
function* repeatDates(first: string, recurrence: CalendarRecurrence | undefined, notBefore: string): Generator<string> {
  if (!recurrence) {
    yield first;
    return;
  }
  const { freq, interval } = recurrence;
  if (freq === 'daily') {
    // Skip to the range: an entry set up years ago is not walked day by day.
    const skipped = Math.max(0, Math.floor(daysBetween(first, notBefore) / interval));
    for (let turn = skipped; turn < skipped + TURNS_MAX; turn++) yield nextDate(first, turn * interval);
    return;
  }
  if (freq === 'weekly') {
    // Weeks run Monday to Sunday (RFC 5545's default), counted from the entry's own week.
    const weekdays = [...(recurrence.weekdays ?? [weekdayOf(first)])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const monday = nextDate(first, -((weekdayOf(first) + 6) % 7));
    const skipped = Math.max(0, Math.floor(daysBetween(monday, notBefore) / (7 * interval)));
    for (let turn = skipped; turn < skipped + TURNS_MAX; turn++) {
      const week = nextDate(monday, turn * 7 * interval);
      for (const weekday of weekdays) {
        const date = nextDate(week, (weekday + 6) % 7);
        if (date >= first) yield date;
      }
    }
    return;
  }
  const [year, month, day] = first.split('-').map(Number) as [number, number, number];
  for (let turn = 0; turn < TURNS_MAX; turn++) {
    const at = new Date(Date.UTC(year, month - 1 + turn * interval, day));
    // A month without the day (the 31st in June) is skipped, not moved.
    if (at.getUTCDate() === day) yield at.toISOString().slice(0, 10);
  }
}

/**
 * The times an entry happens that overlap [from, to), in order. A timed
 * occurrence keeps the entry's wall-clock time in its zone and its length; an
 * all-day one covers its dates in that zone. At most `max`.
 */
export function expandOccurrences(
  entry: Pick<CalendarEntry, 'id' | 'allDay' | 'start' | 'end' | 'timeZone' | 'recurrence'>,
  from: string | Date,
  to: string | Date,
  max = 1_000,
): CalendarOccurrence[] {
  const [lower, upper] = [new Date(from).getTime(), new Date(to).getTime()];
  if (!(lower < upper)) return [];
  const zone = entry.timeZone;
  const first = firstDate(entry);
  const wallTime = entry.allDay ? '00:00:00' : timeInZone(new Date(entry.start), zone);
  const lengthMs = entry.allDay ? 0 : Date.parse(entry.end) - Date.parse(entry.start);
  const lengthDays = entry.allDay ? daysBetween(entry.start, entry.end) : Math.ceil(lengthMs / 86_400_000);
  // The first date worth looking at: one that could still reach into the range.
  const notBefore = nextDate(dateInZone(new Date(lower), zone), -lengthDays - 1);
  const out: CalendarOccurrence[] = [];
  for (const date of repeatDates(first, entry.recurrence, notBefore)) {
    if (entry.recurrence?.until && date > entry.recurrence.until) break;
    let startsAt: number;
    let endsAt: number;
    let occurrence: CalendarOccurrence;
    if (entry.allDay) {
      const last = nextDate(date, lengthDays);
      startsAt = zonedToUtc(`${date}T00:00:00`, zone).getTime();
      endsAt = zonedToUtc(`${nextDate(last)}T00:00:00`, zone).getTime();
      occurrence = { entryId: entry.id, start: date, end: last };
    } else {
      // The entry itself keeps its exact instant; later turns keep its wall-clock time.
      startsAt = date === first ? Date.parse(entry.start) : zonedToUtc(`${date}T${wallTime}`, zone).getTime();
      endsAt = startsAt + lengthMs;
      occurrence = { entryId: entry.id, start: new Date(startsAt).toISOString(), end: new Date(endsAt).toISOString() };
    }
    if (startsAt >= upper) break;
    if (endsAt > lower) {
      out.push(occurrence);
      if (out.length >= max) break;
    }
  }
  return out;
}

// --- in words ---------------------------------------------------------------------

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "daily", "every 2 weeks on Mon, Wed", "every weekday", "monthly on day 15", each with "until Dec 31" when it ends. */
export function describeRecurrence(entry: Pick<CalendarEntry, 'allDay' | 'start' | 'timeZone' | 'recurrence'>): string | undefined {
  const recurrence = entry.recurrence;
  if (!recurrence) return undefined;
  const { freq, interval } = recurrence;
  const first = firstDate(entry);
  let text: string;
  if (freq === 'daily') text = interval === 1 ? 'daily' : `every ${interval} days`;
  else if (freq === 'weekly') {
    const weekdays = [...(recurrence.weekdays ?? [weekdayOf(first)])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const workweek = weekdays.length === 5 && [1, 2, 3, 4, 5].every((d) => weekdays.includes(d));
    if (workweek && interval === 1) text = 'every weekday';
    else text = `${interval === 1 ? 'weekly' : `every ${interval} weeks`} on ${weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ')}`;
  } else {
    text = `${interval === 1 ? 'monthly' : `every ${interval} months`} on day ${Number(first.slice(8))}`;
  }
  if (recurrence.until) {
    const until = new Date(`${recurrence.until}T12:00:00Z`);
    text += ` until ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(until)}`;
  }
  return text;
}

/**
 * An entry's time in words, in `timeZone` (its own by default): "Mon, Nov 30,
 * 9:00 – 9:30 AM PST", "Mon, Nov 30 – Wed, Dec 2" for all-day, then how it
 * repeats. The year is named when it is not `now`'s.
 */
export function describeCalendarWhen(entry: CalendarTimes, opts: { timeZone?: string; now?: Date } = {}): string {
  const zone = opts.timeZone ?? entry.timeZone;
  const thisYear = dateInZone(opts.now ?? new Date(), zone).slice(0, 4);
  const day = (at: Date, timeZone: string): string =>
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(dateInZone(at, timeZone).slice(0, 4) === thisYear ? {} : { year: 'numeric' }),
    }).format(at);
  let when: string;
  if (entry.allDay) {
    const [start, end] = [new Date(`${entry.start}T12:00:00Z`), new Date(`${entry.end}T12:00:00Z`)];
    when = entry.start === entry.end ? day(start, 'UTC') : `${day(start, 'UTC')} – ${day(end, 'UTC')}`;
  } else {
    const [start, end] = [new Date(entry.start), new Date(entry.end)];
    // Intl puts a narrow no-break space before AM/PM; a plain one reads the same and matches what people type.
    const time = (at: Date): string => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(at).replace(/\u202f/g, ' ');
    const zoneName =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', timeZoneName: 'short' }).formatToParts(start).find((p) => p.type === 'timeZoneName')?.value ?? zone;
    const sameDay = dateInZone(start, zone) === dateInZone(end, zone);
    const sameHalf = sameDay && time(start).slice(-2) === time(end).slice(-2);
    when = sameDay
      ? `${day(start, zone)}, ${sameHalf ? time(start).replace(/\s?[AP]M$/, '') : time(start)} – ${time(end)} ${zoneName}`
      : `${day(start, zone)}, ${time(start)} – ${day(end, zone)}, ${time(end)} ${zoneName}`;
  }
  const repeats = describeRecurrence(entry);
  return repeats ? `${when}, ${repeats}` : when;
}
