import { describeCalendarWhen, mentionToken, mentionsAsText, type CalendarEntry } from '@rowboat/spaces-protocol';

// What Harbor writes about a calendar entry (2026-11-28, "channel calendar"
// in rowboat): the card's text, which agents read and clients that cannot
// show the card render, and the lines that tell an entry's thread it moved,
// tagged someone new, or was cancelled. A member Harbor is telling is written
// as a mention token, which notifies a person and invokes an agent; everyone
// else is a plain name, so the member who acted is never told of their own
// act. The title and description are flattened: a token someone typed into
// either would otherwise tell a member the entry does not tag.

const plain = (text: string): string => mentionsAsText(text, new Map());

function names(ids: readonly string[], told: readonly string[], nameOf: ReadonlyMap<string, string>): string {
  return ids.map((id) => (told.includes(id) ? mentionToken({ kind: 'member', id, label: nameOf.get(id) ?? id }) : `@${nameOf.get(id) ?? id}`)).join(' ');
}

const title = (entry: CalendarEntry): string => `**${plain(entry.title).replace(/\s+/g, ' ').trim()}**`;

/** The card: the entry, who it is for, and that it is a record and not a trigger. */
export function calendarCardBody(entry: CalendarEntry, told: readonly string[], nameOf: ReadonlyMap<string, string>): string {
  const parts = [`📅 ${title(entry)} · ${describeCalendarWhen(entry)}`];
  if (entry.attendees.length > 0) parts.push(`For ${names(entry.attendees, told, nameOf)}`);
  if (entry.description) parts.push(plain(entry.description));
  parts.push('_A calendar entry is a record of the plan: nothing runs and no one is reminded when it starts._');
  return parts.join('\n\n');
}

/** The entry has a new time. */
export function calendarMovedBody(entry: CalendarEntry, told: readonly string[], nameOf: ReadonlyMap<string, string>): string {
  return `📅 ${title(entry)} moved to ${describeCalendarWhen(entry)} · ${names(told, told, nameOf)}`;
}

/** The entry tags members it did not before. */
export function calendarAddedBody(entry: CalendarEntry, told: readonly string[], nameOf: ReadonlyMap<string, string>): string {
  return `📅 ${names(told, told, nameOf)} added to ${title(entry)} · ${describeCalendarWhen(entry)}`;
}

/** The entry was deleted. */
export function calendarCancelledBody(entry: CalendarEntry, told: readonly string[], nameOf: ReadonlyMap<string, string>): string {
  return `📅 ${title(entry)} was cancelled (it was ${describeCalendarWhen(entry)}) · ${names(told, told, nameOf)}`;
}
