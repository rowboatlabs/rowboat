import type { ConnectorPlatform } from '../platforms.js';
import {
  dateInZone,
  formatWhen,
  IntegrationError,
  integrationPlatform,
  nextDate,
  requestJson,
  UsageError,
  zonedToUtc,
  type Command,
  type Integration,
} from '../commands.js';

// The Cal.com integration (spec §8 Integrations, 2026-10-03): an agent on a
// Cal.com API key (`cal_live_…`), acting as the key's owner, in their time
// zone. API v2; each endpoint pins the cal-api-version its docs name
// (checked 2026-10-03).

export const CAL_API = 'https://api.cal.com/v2';
const VERSIONS = { bookings: '2026-05-01', createBooking: '2026-02-25', cancel: '2026-02-25', eventTypes: '2024-06-14', slots: '2024-09-04' };

interface Me {
  id: number;
  username: string | null;
  email: string;
  timeZone: string;
}
interface Booking {
  uid: string;
  title: string;
  start: string;
  end?: string;
  status?: string;
  location?: string | null;
  attendees?: { name?: string; email?: string }[];
}
interface EventType {
  id: number;
  slug: string;
  title: string;
  lengthInMinutes?: number;
}

export class CalApi {
  private me?: Promise<Me>;

  constructor(
    private readonly key: string,
    private readonly base: string = CAL_API,
  ) {}

  private call(path: string, version: string | undefined, init: RequestInit = {}): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' };
    if (version) headers['cal-api-version'] = version;
    return requestJson(`${this.base}${path}`, { ...init, headers }).then((body) => (body as { data?: unknown })?.data);
  }

  profile(): Promise<Me> {
    this.me ??= (this.call('/me', undefined) as Promise<Me>).catch((err) => {
      this.me = undefined;
      throw err;
    });
    return this.me;
  }

  async bookings(query: { status?: string; afterStart?: string; beforeEnd?: string; limit?: number }): Promise<Booking[]> {
    const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return ((await this.call(`/bookings?${q}`, VERSIONS.bookings)) as Booking[] | undefined) ?? [];
  }

  async eventTypes(): Promise<EventType[]> {
    const me = await this.profile();
    const q = me.username ? `?username=${encodeURIComponent(me.username)}` : '';
    return ((await this.call(`/event-types${q}`, VERSIONS.eventTypes)) as EventType[] | undefined) ?? [];
  }

  async eventType(slug: string): Promise<EventType> {
    const types = await this.eventTypes();
    const found = types.find((t) => t.slug.toLowerCase() === slug.toLowerCase());
    if (!found) throw new UsageError(`There's no event type "${slug}". Yours: ${types.map((t) => t.slug).join(', ') || 'none'}.`);
    return found;
  }

  async slots(eventTypeId: number, start: string, end: string, timeZone: string): Promise<Record<string, { start: string }[]>> {
    const q = new URLSearchParams({ eventTypeId: String(eventTypeId), start, end, timeZone });
    return ((await this.call(`/slots?${q}`, VERSIONS.slots)) as Record<string, { start: string }[]> | undefined) ?? {};
  }

  async book(input: { eventTypeId: number; start: string; attendee: { name: string; email: string; timeZone: string } }): Promise<Booking> {
    return (await this.call('/bookings', VERSIONS.createBooking, { method: 'POST', body: JSON.stringify(input) })) as Booking;
  }

  async cancel(uid: string, reason?: string): Promise<void> {
    await this.call(`/bookings/${encodeURIComponent(uid)}/cancel`, VERSIONS.cancel, {
      method: 'POST',
      body: JSON.stringify(reason ? { cancellationReason: reason } : {}),
    });
  }
}

function bookingLine(b: Booking, timeZone: string): string {
  const who = (b.attendees ?? []).map((a) => a.name || a.email).filter(Boolean).join(', ');
  const where = b.location && /^https?:\/\//.test(b.location) ? ` · [join](${b.location})` : '';
  return `- **${formatWhen(b.start, timeZone)}**: ${b.title}${who ? ` with ${who}` : ''}${where} · \`${b.uid}\``;
}

/** The bookings starting on these dates (YYYY-MM-DD, in the owner's zone), soonest first. */
async function bookingsOn(api: CalApi, from: string, toExclusive: string, empty: string, heading: string): Promise<string> {
  const me = await api.profile();
  const afterStart = zonedToUtc(`${from}T00:00:00`, me.timeZone).toISOString();
  const beforeEnd = zonedToUtc(`${toExclusive}T00:00:00`, me.timeZone).toISOString();
  const bookings = (await api.bookings({ status: 'upcoming', afterStart, beforeEnd, limit: 50 }))
    .filter((b) => b.start < beforeEnd)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (bookings.length === 0) return empty;
  return [heading, ...bookings.slice(0, 20).map((b) => bookingLine(b, me.timeZone))].join('\n');
}

const today = (tz: string) => dateInZone(new Date(), tz);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const commands: Command<CalApi>[] = [
  {
    name: 'today',
    summary: "today's bookings",
    async run(api) {
      const { timeZone } = await api.profile();
      const d = today(timeZone);
      return bookingsOn(api, d, nextDate(d), 'Nothing booked today.', 'Today:');
    },
  },
  {
    name: 'tomorrow',
    summary: "tomorrow's bookings",
    async run(api) {
      const { timeZone } = await api.profile();
      const d = nextDate(today(timeZone));
      return bookingsOn(api, d, nextDate(d), 'Nothing booked tomorrow.', 'Tomorrow:');
    },
  },
  {
    name: 'upcoming',
    aliases: ['week'],
    summary: 'bookings in the next 7 days',
    async run(api) {
      const { timeZone } = await api.profile();
      const d = today(timeZone);
      return bookingsOn(api, d, nextDate(d, 7), 'Nothing booked in the next 7 days.', 'Next 7 days:');
    },
  },
  {
    name: 'links',
    aliases: ['types'],
    summary: 'your event types and their booking links',
    async run(api) {
      const [me, types] = await Promise.all([api.profile(), api.eventTypes()]);
      if (types.length === 0) return 'No event types yet.';
      return types
        .map((t) => `- **${t.title}** (\`${t.slug}\`${t.lengthInMinutes ? `, ${t.lengthInMinutes} min` : ''})${me.username ? `: https://cal.com/${me.username}/${t.slug}` : ''}`)
        .join('\n');
    },
  },
  {
    name: 'slots',
    aliases: ['free', 'availability'],
    args: '<event type> [YYYY-MM-DD]',
    summary: 'open times for an event type on a day (default today)',
    async run(api, args) {
      const [slug, date] = args.split(' ').filter(Boolean);
      if (!slug) throw new UsageError('Which event type? `links` lists them.');
      const { timeZone } = await api.profile();
      const day = date ?? today(timeZone);
      if (!DATE.test(day)) throw new UsageError(`"${day}" isn't a date like 2026-10-05.`);
      const type = await api.eventType(slug);
      const slots = await api.slots(type.id, day, nextDate(day), timeZone);
      const times = Object.values(slots).flat().filter((s) => dateInZone(new Date(s.start), timeZone) === day);
      if (times.length === 0) return `No open times for ${type.title} on ${day}.`;
      const shown = times.slice(0, 24).map((s) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(s.start)));
      return `**${type.title}** on ${day} (${timeZone}): ${shown.join(', ')}${times.length > 24 ? ', …' : ''}`;
    },
  },
  {
    name: 'book',
    args: '<event type> <YYYY-MM-DDTHH:MM> <email> [name]',
    summary: "book someone in (the time is in the key owner's time zone unless it names its own)",
    async run(api, args) {
      const [slug, when, email, ...name] = args.split(' ').filter(Boolean);
      if (!slug || !when || !email) throw new UsageError('I need the event type, the time and the attendee’s email.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UsageError(`"${email}" isn't an email address.`);
      const { timeZone } = await api.profile();
      const own = /(Z|[+-]\d{2}:?\d{2})$/i.test(when);
      const start = own ? new Date(when) : zonedToUtc(when.length === 16 ? `${when}:00` : when, timeZone);
      if (Number.isNaN(start.getTime())) throw new UsageError(`"${when}" isn't a time like 2026-10-05T15:00.`);
      const type = await api.eventType(slug);
      const booking = await api.book({
        eventTypeId: type.id,
        start: start.toISOString(),
        attendee: { name: name.join(' ') || email.split('@')[0]!, email, timeZone },
      });
      return `Booked: **${booking.title ?? type.title}**, ${formatWhen(booking.start ?? start.toISOString(), timeZone)} with ${email} · \`${booking.uid}\``;
    },
  },
  {
    name: 'cancel',
    args: '<booking id> [reason]',
    summary: 'cancel a booking (its id is in `today` and `upcoming`)',
    async run(api, args) {
      const [uid, ...reason] = args.split(' ').filter(Boolean);
      if (!uid) throw new UsageError('Which booking?');
      await api.cancel(uid.replace(/`/g, ''), reason.join(' ') || undefined);
      return `Cancelled \`${uid.replace(/`/g, '')}\`.`;
    },
  },
];

const TRIGGERS: Record<string, string> = {
  BOOKING_CREATED: '📅 New booking',
  BOOKING_REQUESTED: '🙋 Booking request',
  BOOKING_RESCHEDULED: '🔁 Rescheduled',
  BOOKING_CANCELLED: '❌ Cancelled',
  BOOKING_REJECTED: '🚫 Declined',
  BOOKING_PAID: '💳 Paid',
  BOOKING_NO_SHOW_UPDATED: '👻 No-show',
  MEETING_STARTED: '▶️ Meeting started',
  MEETING_ENDED: '⏹️ Meeting ended',
};

/**
 * A Cal.com webhook (checked against its payload reference, 2026-10-03):
 * `{ triggerEvent, payload }`, except the MEETING_* triggers, whose booking
 * fields sit at the top level. PING is the "test" button in Cal.com's
 * webhook settings.
 */
export function calAlert(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const trigger = typeof b.triggerEvent === 'string' ? b.triggerEvent : undefined;
  if (!trigger) return undefined;
  if (trigger === 'PING') return '✅ Cal.com is connected: bookings will show up here.';
  const p = (b.payload && typeof b.payload === 'object' ? b.payload : b) as Record<string, unknown>;
  const organizer = (p.organizer && typeof p.organizer === 'object' ? p.organizer : {}) as { timeZone?: string };
  const attendees = Array.isArray(p.attendees) ? (p.attendees as { name?: string; email?: string }[]) : [];
  const who = attendees.map((a) => a.name || a.email).filter(Boolean).join(', ');
  const title = typeof p.title === 'string' ? p.title : 'a booking';
  const when = typeof p.startTime === 'string' ? formatWhen(p.startTime, organizer.timeZone) : undefined;
  const label = TRIGGERS[trigger] ?? trigger.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const lines = [`${label}: **${title}**${when ? `, ${when}` : ''}${who ? ` with ${who}` : ''}`];
  const reason = p.cancellationReason ?? p.rejectionReason;
  if (typeof reason === 'string' && reason) lines.push(`> ${reason.slice(0, 500)}`);
  return lines.join('\n');
}

export function calIntegration(base = CAL_API): Integration<CalApi> {
  return {
    label: 'Cal.com',
    client: (secret) => new CalApi(secret.trim(), base),
    async check(api) {
      const me = await api.profile();
      if (!me?.timeZone) throw new IntegrationError('Cal.com returned no profile for this key');
    },
    commands,
    alert: calAlert,
  };
}

export function calPlatform(base = CAL_API): ConnectorPlatform {
  return integrationPlatform(calIntegration(base));
}
