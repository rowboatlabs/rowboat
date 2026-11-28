import {
  CALENDAR_RANGE_DAYS_MAX,
  expandOccurrences,
  nextDate,
  normalizeCalendarTimes,
  type CalendarEntry,
  type CalendarEntryPatch,
  type CalendarOccurrence,
  type CalendarTimes,
  type Invocation,
  type Message,
  type NewCalendarEntry,
  type Routes,
  type Space,
} from '@rowboat/spaces-protocol';
import type { z } from 'zod';
import { HarborError } from '../errors.js';
import { calendarAddedBody, calendarCancelledBody, calendarCardBody, calendarMovedBody } from './calendar-card.js';
import type { Feed, NewMessage, PostBatch } from './feed.js';
import type { ActorCtx, Kernel } from './kernel.js';

// The space calendar (2026-11-28, "channel calendar" in rowboat): entries
// members put on it, people and agents alike. It is self-reported and
// nothing enforces it; Harbor runs nothing when an entry starts. What Harbor
// does is tell: an entry that tags anyone but the member acting posts its
// card in the space as that member, mentioning them, and from then on a new
// time, a newly tagged member or a deletion is one line in the same thread.
// An entry that tags no one else is silent, so agents logging their own work
// do not fill the channel. Any member may change any entry: the content
// plane is role-flat (spec §4), and there is no rule here beyond membership.
//
// Every write that posts does so in its own transaction (Feed.postWithin),
// so an entry and the message about it land together or not at all, and two
// members posting an entry's first update at once start one thread.

export type DeleteCalendarEntryInput = z.infer<Routes['deleteCalendarEntry']['request']>;

/** What a calendar write answers: the entry, and the message Harbor posted about it, if any. */
export interface CalendarWrite {
  entry: CalendarEntry;
  message?: Message;
  invocations: Invocation[];
}

/** How the member acts, as a message Harbor posts for them carries it. */
type Acting = Pick<NewMessage, 'actingMode' | 'agentName'>;

function actingOf(input: Acting): Acting {
  return { actingMode: input.actingMode, ...(input.agentName ? { agentName: input.agentName } : {}) };
}

function timesOf(times: CalendarTimes): CalendarTimes {
  const normal = normalizeCalendarTimes(times);
  if (!normal.ok) throw new HarborError('invalid_request', normal.problem);
  return normal.times;
}

function sameTimes(a: CalendarTimes, b: CalendarTimes): boolean {
  const [x, y] = [a.recurrence, b.recurrence];
  return (
    a.allDay === b.allDay &&
    a.start === b.start &&
    a.end === b.end &&
    a.timeZone === b.timeZone &&
    x?.freq === y?.freq &&
    x?.interval === y?.interval &&
    x?.until === y?.until &&
    (x?.weekdays ?? []).join() === (y?.weekdays ?? []).join()
  );
}

export class Calendar {
  constructor(
    private readonly k: Kernel,
    private readonly feed: Feed,
  ) {}

  /** The entries that happen in [from, to) and each time they do. */
  async list(ctx: ActorCtx, spaceId: string, range: { from: string; to: string }): Promise<{ entries: CalendarEntry[]; occurrences: CalendarOccurrence[] }> {
    await this.k.requireReadableSpace(ctx, spaceId);
    const [from, to] = [new Date(range.from), new Date(range.to)];
    if (!(from.getTime() < to.getTime())) throw new HarborError('invalid_request', 'to must be after from');
    if (to.getTime() - from.getTime() > CALENDAR_RANGE_DAYS_MAX * 86_400_000) {
      throw new HarborError('invalid_request', `a calendar read spans at most ${CALENDAR_RANGE_DAYS_MAX} days`);
    }
    // The store cuts by date with two days to spare either side: an entry's
    // dates are in its own zone, and no zone is more than a day from UTC.
    const candidates = await this.k.store.listCalendarEntries(spaceId, nextDate(from.toISOString().slice(0, 10), -2), nextDate(to.toISOString().slice(0, 10), 2));
    const entries: CalendarEntry[] = [];
    const occurrences: CalendarOccurrence[] = [];
    for (const entry of candidates) {
      const times = expandOccurrences(entry, from, to);
      if (times.length === 0) continue;
      entries.push(entry);
      occurrences.push(...times);
    }
    occurrences.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    return { entries, occurrences };
  }

  async create(ctx: ActorCtx, spaceId: string, input: NewCalendarEntry): Promise<CalendarWrite> {
    const space = await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    const acting = actingOf(input);
    const times = timesOf({ allDay: input.allDay ?? false, start: input.start, end: input.end, timeZone: input.timeZone, ...(input.recurrence ? { recurrence: input.recurrence } : {}) });

    const batch = this.feed.newBatch();
    const result = await this.k.lockedAs(ctx, spaceId, async () => {
      const attendees = await this.taggable(spaceId, input.attendees ?? [], []);
      // The thread the entry was asked for in becomes its own; a reply names its root.
      const root = input.threadRoot ? await this.feed.resolveRoot(spaceId, input.threadRoot) : undefined;
      const at = this.k.now();
      let entry: CalendarEntry = {
        id: this.k.ulid(),
        spaceId,
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...times,
        attendees,
        ...(root ? { threadRoot: root.id } : {}),
        createdBy: by,
        createdAt: at,
      };
      const told = attendees.filter((id) => id !== ctx.memberId);
      const posted = told.length > 0 ? await this.postCard(ctx, space, entry, told, acting, batch, root?.id) : undefined;
      if (posted && !root) entry = { ...entry, threadRoot: posted.message.id };
      await this.k.store.putCalendarEntry(entry);
      await this.k.appendNext(spaceId, at, { type: 'calendar_entry', entry, action: 'created', by });
      return this.written(entry, posted);
    });
    this.feed.settle(space, batch);
    return result;
  }

  async update(ctx: ActorCtx, spaceId: string, entryId: string, input: CalendarEntryPatch): Promise<CalendarWrite> {
    const space = await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    const acting = actingOf(input);

    const batch = this.feed.newBatch();
    const result = await this.k.lockedAs(ctx, spaceId, async () => {
      const current = await this.k.store.getCalendarEntry(spaceId, entryId);
      if (!current) throw new HarborError('not_found', 'no such calendar entry');
      if (current.deletedAt) throw new HarborError('invalid_request', 'this calendar entry was deleted');

      const recurrence = input.recurrence === null ? undefined : (input.recurrence ?? current.recurrence);
      const times = timesOf({
        allDay: input.allDay ?? current.allDay,
        start: input.start ?? current.start,
        end: input.end ?? current.end,
        timeZone: input.timeZone ?? current.timeZone,
        ...(recurrence ? { recurrence } : {}),
      });
      const title = input.title ?? current.title;
      const description = input.description === undefined ? current.description : input.description || undefined;
      const attendees = input.attendees ? await this.taggable(spaceId, input.attendees, current.attendees) : current.attendees;

      const moved = !sameTimes(current, times);
      const added = attendees.filter((id) => !current.attendees.includes(id));
      if (!moved && title === current.title && description === current.description && attendees.join('\n') === current.attendees.join('\n')) {
        return { entry: current, invocations: [] }; // idempotent, no event
      }

      const at = this.k.now();
      const { description: _description, recurrence: _recurrence, ...kept } = current;
      let entry: CalendarEntry = { ...kept, title, ...(description ? { description } : {}), ...times, attendees, updatedBy: by, updatedAt: at };
      // A new time concerns everyone it tags; new tags alone concern only them.
      const told = (moved ? attendees : added).filter((id) => id !== ctx.memberId);
      let posted: { message: Message; invocations: Invocation[] } | undefined;
      if (told.length > 0) {
        if (entry.threadRoot) {
          const nameOf = await this.namesOf(told);
          const body = moved ? calendarMovedBody(entry, told, nameOf) : calendarAddedBody(entry, told, nameOf);
          posted = await this.feed.postWithin(ctx, space, { body, threadRoot: entry.threadRoot, ...acting }, {}, batch);
        } else {
          posted = await this.postCard(ctx, space, entry, told, acting, batch);
          entry = { ...entry, threadRoot: posted.message.id };
        }
      }
      await this.k.store.putCalendarEntry(entry);
      await this.k.appendNext(spaceId, at, { type: 'calendar_entry', entry, action: 'updated', by });
      return this.written(entry, posted);
    });
    this.feed.settle(space, batch);
    return result;
  }

  async delete(ctx: ActorCtx, spaceId: string, entryId: string, input: DeleteCalendarEntryInput): Promise<CalendarWrite> {
    const space = await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    const acting = actingOf(input);

    const batch = this.feed.newBatch();
    const result = await this.k.lockedAs(ctx, spaceId, async () => {
      const current = await this.k.store.getCalendarEntry(spaceId, entryId);
      if (!current) throw new HarborError('not_found', 'no such calendar entry');
      if (current.deletedAt) return { entry: current, invocations: [] }; // idempotent, no event
      const at = this.k.now();
      const entry: CalendarEntry = { ...current, deletedAt: at, updatedBy: by, updatedAt: at };
      const told = entry.attendees.filter((id) => id !== ctx.memberId);
      const posted =
        told.length > 0 && entry.threadRoot
          ? await this.feed.postWithin(ctx, space, { body: calendarCancelledBody(entry, told, await this.namesOf(told)), threadRoot: entry.threadRoot, ...acting }, {}, batch)
          : undefined;
      await this.k.store.putCalendarEntry(entry);
      await this.k.appendNext(spaceId, at, { type: 'calendar_entry', entry, action: 'deleted', by });
      return this.written(entry, posted);
    });
    this.feed.settle(space, batch);
    return result;
  }

  /**
   * A message about an entry (NewMessage.calendarEntryId): a reply in the
   * entry's thread. An entry with none gets its card first, posted by the
   * same member and telling no one, since the reply that follows is the
   * news. A deleted entry's thread still takes replies; a deleted entry that
   * never had one does not start one.
   */
  async post(ctx: ActorCtx, spaceId: string, input: NewMessage & { calendarEntryId: string }): Promise<{ message: Message; invocations: Invocation[] }> {
    const { calendarEntryId, ...message } = input;
    if (message.threadRoot) throw new HarborError('invalid_request', 'pass calendarEntryId or threadRoot, not both');
    if (message.session || message.anchorChangeSetId) throw new HarborError('invalid_request', "a message about a calendar entry is a reply in the entry's thread");
    const space = await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    const acting = actingOf(input);

    const batch = this.feed.newBatch();
    const result = await this.k.lockedAs(ctx, spaceId, async () => {
      const entry = await this.k.store.getCalendarEntry(spaceId, calendarEntryId);
      if (!entry) throw new HarborError('not_found', 'no such calendar entry');
      let threadRoot = entry.threadRoot;
      if (!threadRoot) {
        if (entry.deletedAt) throw new HarborError('invalid_request', 'this calendar entry was deleted');
        const card = await this.postCard(ctx, space, entry, [], acting, batch, undefined, true);
        threadRoot = card.message.id;
        const threaded: CalendarEntry = { ...entry, threadRoot };
        await this.k.store.putCalendarEntry(threaded);
        await this.k.appendNext(spaceId, this.k.now(), { type: 'calendar_entry', entry: threaded, action: 'updated', by });
      }
      return this.feed.postWithin(ctx, space, { ...message, threadRoot }, {}, batch);
    });
    this.feed.settle(space, batch);
    return result;
  }

  /** The entry's card, as a new root or a reply in the thread it was asked for in. */
  private async postCard(
    ctx: ActorCtx,
    space: Space,
    entry: CalendarEntry,
    told: string[],
    acting: Acting,
    batch: PostBatch,
    threadRoot?: string,
    quiet = false,
  ): Promise<{ message: Message; invocations: Invocation[] }> {
    const body = calendarCardBody(entry, told, await this.namesOf(entry.attendees));
    return this.feed.postWithin(ctx, space, { body, ...(threadRoot ? { threadRoot } : {}), ...acting }, { calendarEntry: entry, quiet }, batch);
  }

  /** The answer of a write: the message carries the entry as it ended up, thread and all. */
  private written(entry: CalendarEntry, posted: { message: Message; invocations: Invocation[] } | undefined): CalendarWrite {
    if (!posted) return { entry, invocations: [] };
    const message = posted.message.calendarEntry ? { ...posted.message, calendarEntry: entry } : posted.message;
    return { entry, message, invocations: posted.invocations };
  }

  /**
   * The members an entry tags, once each, in the order given. A member newly
   * tagged must be in the space, as a mention must (spec §5); one already
   * tagged stays after leaving it, as their name stays on what they wrote.
   */
  private async taggable(spaceId: string, ids: readonly string[], already: readonly string[]): Promise<string[]> {
    const attendees = [...new Set(ids)];
    for (const id of attendees) {
      if (already.includes(id)) continue;
      if (!(await this.k.store.getMembership(spaceId, id))) throw new HarborError('invalid_request', `${id} is not a member of this space`);
    }
    return attendees;
  }

  private async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const id of ids) {
      const member = await this.k.store.getMember(id);
      if (member) names.set(id, member.displayName);
    }
    return names;
  }
}
