import { CalendarDays, Repeat } from 'lucide-react'
import { spaces } from '@x/shared'
import { MemberAvatar } from '@/components/spaces/atoms'
import { useMemberNames } from '@/components/spaces/member-text'
import { useSpaceNav, useSpaceRefs } from '@/components/spaces/space-nav'
import { noteCalendarEntries, useCalendarEntry, viewerTimeZone } from '@/lib/spaces-calendar'
import { cn } from '@/lib/utils'

// A calendar event as people read it (2026-11-28, harbor spec §7 The space
// calendar): its day as a tile, its title, when, how it repeats, who it is
// for. One summary drawn in two places, the card on the message Harbor
// posted for the event and the popover that opens from the grid, so an event
// looks the same wherever it is met. Times are shown on the reader's own
// clock; the text Harbor wrote on the message names them in the event's zone,
// and is what agents and older clients read instead of this.

type Entry = spaces.CalendarEntry

/** The day an entry first falls on, on the reader's clock. */
function firstDay(entry: Entry): Date {
    return entry.allDay ? new Date(`${entry.start}T12:00:00`) : new Date(entry.start)
}

/** The event's time in words, without its repeat (which has a line of its own), on the reader's clock. */
function eventWhen(entry: Entry): string {
    return spaces.describeCalendarWhen({ allDay: entry.allDay, start: entry.start, end: entry.end, timeZone: entry.timeZone }, { timeZone: viewerTimeZone() })
}

function DayTile({ entry, muted }: { entry: Entry; muted: boolean }) {
    const day = firstDay(entry)
    return (
        <div aria-hidden="true" className={cn('flex h-11 w-11 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-background', muted && 'opacity-60')}>
            <span className="text-[10px] font-semibold uppercase leading-none tracking-wide text-[var(--stream-link)]">{day.toLocaleDateString(undefined, { month: 'short' })}</span>
            <span className="mt-0.5 text-[17px] font-semibold leading-none tabular-nums">{day.getDate()}</span>
        </div>
    )
}

/**
 * Title, time, repeat, description and the members it is for. With an
 * `occurrence`, one turn of a repeat clicked on the grid, the day and time
 * shown are that turn's, not the first's.
 */
export function EventSummary({ entry: whole, occurrence }: { entry: Entry; occurrence?: spaces.CalendarOccurrence }) {
    const names = useMemberNames()
    const entry = occurrence ? { ...whole, start: occurrence.start, end: occurrence.end } : whole
    const cancelled = entry.deletedAt !== undefined
    const repeats = spaces.describeRecurrence(whole)
    return (
        <div className="flex min-w-0 gap-3">
            <DayTile entry={entry} muted={cancelled} />
            <div className="min-w-0 flex-1">
                <div className={cn('text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]', cancelled && 'text-muted-foreground line-through')}>{entry.title}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                    {cancelled ? <span className="font-medium text-foreground/80">Cancelled · </span> : null}
                    {eventWhen(entry)}
                </div>
                {repeats && !cancelled && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Repeat aria-hidden="true" className="size-3 shrink-0" />Repeats {repeats}</div>
                )}
                {entry.description && !cancelled && (
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">{entry.description}</p>
                )}
                {entry.attendees.length > 0 && (
                    <ul aria-label="For" className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {entry.attendees.map((id) => (
                            <li key={id} className="flex min-w-0 items-center gap-1.5 text-[13px]">
                                <MemberAvatar id={id} name={names.get(id) ?? id} size="sm" />
                                <span className="truncate">{names.get(id) ?? id}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}

/** The card on the message Harbor posted for an event. It replaces the body, which is the card's text for agents and older clients. */
export function CalendarCard({ entry: posted }: { entry: Entry }) {
    const refs = useSpaceRefs()
    const nav = useSpaceNav()
    // The entry as it stands: a card posted last week shows today's time.
    const entry = useCalendarEntry(refs?.orgId, posted)
    return (
        <div data-calendar-card className="mt-1 w-full max-w-md rounded-lg border border-border bg-muted/40 px-3.5 py-3">
            <EventSummary entry={entry} />
            {nav?.onOpenCalendar && !entry.deletedAt && (
                <button type="button" onClick={() => {
                    // The calendar opens on this event's day: it has to know the event before it has asked for any range.
                    if (refs?.orgId) noteCalendarEntries(refs.orgId, entry.spaceId, [entry])
                    nav.onOpenCalendar?.(entry.id)
                }}
                    className="mt-2.5 inline-flex min-h-7 items-center gap-1.5 text-xs font-medium text-[var(--stream-link)] hover:underline">
                    <CalendarDays aria-hidden="true" className="size-3.5" />Open in calendar
                </button>
            )}
        </div>
    )
}
