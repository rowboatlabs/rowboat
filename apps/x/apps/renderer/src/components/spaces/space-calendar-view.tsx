import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import type { CalendarRef, DateSelectInfo, DatesSetInfo, EventApi, EventClickInfo, EventDisplayInfo } from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/react/daygrid'
import interactionPlugin from '@fullcalendar/react/interaction'
import classicThemePlugin from '@fullcalendar/react/themes/classic'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import '@fullcalendar/react/skeleton.css'
import '@fullcalendar/react/themes/classic/theme.css'
import { ChevronLeft, ChevronRight, Loader2, MessageSquare, Pencil, Plus, Send } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { MemberAvatar, Segmented } from '@/components/spaces/atoms'
import { CalendarEventDialog, DeleteEventButton } from '@/components/spaces/calendar-event-dialog'
import { EventSummary } from '@/components/spaces/calendar-card'
import { useMemberNames } from '@/components/spaces/member-text'
import { useSpaceLive } from '@/hooks/use-spaces'
import {
    draftForRange, draftFromEntry, draftTimes, gridEvents, localDate, movedTimes, noteCalendarEntries, reconcileCalendarRange, shortTime,
    useCalendarEntries, viewerTimeZone, type EventDraft,
} from '@/lib/spaces-calendar'
import { invokeSpace } from '@/lib/spaces-invoke'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// The Calendar tab (2026-11-28, harbor spec §7 The space calendar): what is
// planned in a space, on a month, week or day grid, the way a shared Google
// calendar reads. People and agents put events on it themselves. Click or
// drag an empty stretch to add one, drag an event to move it, drag its edge
// to change its length, click it for what it is and its thread. The grid is
// FullCalendar; everything it draws comes from the calendar store, so a
// change made anywhere, by anyone, shows without asking Harbor again.

type Entry = spaces.CalendarEntry
type GridView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'

const VIEWS: Array<{ value: GridView; label: string }> = [
    { value: 'dayGridMonth', label: 'Month' },
    { value: 'timeGridWeek', label: 'Week' },
    { value: 'timeGridDay', label: 'Day' },
]
/** The view a person last chose, kept on the device: someone who plans by week opens every space's calendar by week. */
const VIEW_KEY = 'rowboat:spaces:calendar-view'
const PLUGINS = [classicThemePlugin, dayGridPlugin, timeGridPlugin, interactionPlugin]

function storedView(): GridView {
    try {
        const stored = localStorage.getItem(VIEW_KEY)
        if (VIEWS.some((v) => v.value === stored)) return stored as GridView
    } catch { /* storage is off: the default view */ }
    return 'dayGridMonth'
}

/** The entry behind a block on the grid. */
const entryOf = (event: EventApi): Entry => (event.extendedProps as { entry: Entry }).entry

/** A block's end: the library leaves it out when it is the default length. */
function endOf(event: EventApi): Date {
    if (event.end) return event.end
    const start = event.start ?? new Date()
    return new Date(start.getTime() + (event.allDay ? 86_400_000 : 3_600_000))
}

/** What a block shows: whose it is, when it starts, and its title. */
function EventBlock({ info }: { info: EventDisplayInfo }) {
    const names = useMemberNames()
    const entry = (info.event.extendedProps as { entry?: Entry }).entry
    // The stretch being selected is drawn as a block too, with no entry behind it yet: only its times.
    if (!entry) {
        return (
            <span className="space-calendar-event">
                {!info.event.allDay && info.event.start && <span className="space-calendar-event-time">{shortTime(info.event.start)} – {shortTime(endOf(info.event))}</span>}
            </span>
        )
    }
    // An event is its first tagged member's; one that tags no one is its creator's.
    const owner = entry.attendees[0] ?? entry.createdBy.memberId
    const more = entry.attendees.length - 1
    return (
        <span data-entry={entry.id} className="space-calendar-event">
            <MemberAvatar id={owner} name={names.get(owner) ?? owner} size="sm" className="size-4 rounded-[3px] text-[8px]" />
            {more > 0 && <span className="space-calendar-event-more">+{more}</span>}
            {!info.event.allDay && info.event.start && info.isStart && <span className="space-calendar-event-time">{shortTime(info.event.start)}</span>}
            <span className="space-calendar-event-title">{info.event.title}</span>
        </span>
    )
}

interface Details { entry: Entry; occurrence?: spaces.CalendarOccurrence; rect: DOMRect }

/**
 * Where an event's popover hangs: beside the click, at the block's height.
 * A block in the day view is as wide as the grid, and a popover anchored to
 * the whole of it has nowhere to go but over the sidebar.
 */
function beside(block: DOMRect, clickX?: number): DOMRect {
    const x = clickX && clickX >= block.left && clickX <= block.right ? clickX : block.left + Math.min(block.width, 180)
    return new DOMRect(x, block.top, 0, block.height)
}

export function SpaceCalendarView({ orgId, space, spaceLabel, members, selfMemberId, writable, entryId, onOpenThread, onShown }: {
    orgId: string
    space: spaces.Space
    /** "#launch", or the other person's name in a DM. */
    spaceLabel: string
    members: readonly spaces.Member[]
    selfMemberId: string | undefined
    /** A member of a space that is not archived: everyone else reads. */
    writable: boolean
    /** The event to open on, from its card. */
    entryId?: string
    onOpenThread: (rootMessageId: string) => void
    /** The event asked for was shown: the selection drops it, so going back to the tab is the plain calendar. */
    onShown?: () => void
}) {
    const calendar = useRef<CalendarRef>(null)
    const entries = useCalendarEntries(orgId, space.id)
    const names = useMemberNames()
    const [view, setView] = useState<GridView>(storedView)
    const [title, setTitle] = useState('')
    const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)
    const [loaded, setLoaded] = useState(false)
    const [dialog, setDialog] = useState<{ draft: EventDraft; editing?: Entry } | null>(null)
    const [details, setDetails] = useState<Details | null>(null)
    const [update, setUpdate] = useState('')
    const [posting, setPosting] = useState(false)

    // --- reading -----------------------------------------------------------------
    const load = useCallback((from: Date, to: Date) => {
        const askedAt = new Date().toISOString()
        invokeSpace('spaces:listCalendar', { orgId, spaceId: space.id, from: from.toISOString(), to: to.toISOString() }).then(
            (read) => { reconcileCalendarRange(orgId, space.id, from, to, askedAt, read.entries); setLoaded(true) },
            (err: unknown) => { setLoaded(true); toast(err instanceof Error ? err.message : 'Could not load the calendar', 'error') },
        )
    }, [orgId, space.id])
    useEffect(() => {
        if (range) load(range.start, range.end)
    }, [range, load])
    // A socket that came back missed whatever changed meanwhile: ask again.
    const seenSubscribed = useRef(false)
    useSpaceLive(orgId, space.id, (frame) => {
        if (frame.kind !== 'subscribed') return
        if (seenSubscribed.current && range) load(range.start, range.end)
        seenSubscribed.current = true
    })

    const events = useMemo(() => (range ? gridEvents(entries, range.start, range.end) : []), [entries, range])
    const hasEvents = useMemo(() => entries.some((e) => !e.deletedAt), [entries])

    const onDatesSet = (info: DatesSetInfo) => {
        setTitle(info.view.title)
        setRange((current) => (current && current.start.getTime() === info.start.getTime() && current.end.getTime() === info.end.getTime() ? current : { start: info.start, end: info.end }))
    }
    const chooseView = (next: GridView) => {
        setView(next)
        calendar.current?.getApi().changeView(next)
        try { localStorage.setItem(VIEW_KEY, next) } catch { /* storage is off: the choice lasts the session */ }
    }

    // --- opening on one event (its card's "Open in calendar") -----------------------
    const wanted = entryId ? entries.find((e) => e.id === entryId) : undefined
    useEffect(() => {
        if (!wanted || wanted.deletedAt) return
        const api = calendar.current?.getApi()
        if (!api) return
        api.gotoDate(wanted.allDay ? `${wanted.start}T00:00:00` : wanted.start)
        // The grid draws the new dates on its own turn; the block is there a frame or two later.
        let tries = 0
        const timer = setInterval(() => {
            const block = document.querySelector<HTMLElement>(`.space-calendar [data-entry="${wanted.id}"]`)
            if (block) setDetails({ entry: wanted, rect: beside(block.getBoundingClientRect()) })
            if (block || ++tries > 20) { clearInterval(timer); onShown?.() }
        }, 50)
        return () => clearInterval(timer)
        // Once per event asked for: the entry changing under an open popover must not reopen it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wanted?.id])

    // --- writing -----------------------------------------------------------------
    const told = (written: spaces.SpacesCalendarWrite, done: string) => {
        noteCalendarEntries(orgId, space.id, [written.entry])
        // Harbor posted for the people the event tags: say so, or the message appears in the stream unexplained.
        toast(written.message ? `${done} · posted in ${spaceLabel}` : done, 'success')
    }

    const save = async (draft: EventDraft, editing?: Entry) => {
        const times = draftTimes(draft, editing)
        if (!times.ok) throw new Error(times.problem)
        const description = draft.description.trim()
        if (editing) {
            told(await invokeSpace('spaces:updateCalendarEntry', {
                orgId, spaceId: space.id, entryId: editing.id,
                title: draft.title.trim(), description: description || null,
                allDay: times.allDay, start: times.start, end: times.end, recurrence: times.recurrence,
                attendees: draft.attendees,
            }), 'Event saved')
        } else {
            told(await invokeSpace('spaces:createCalendarEntry', {
                orgId, spaceId: space.id,
                title: draft.title.trim(), ...(description ? { description } : {}),
                allDay: times.allDay, start: times.start, end: times.end, timeZone: viewerTimeZone(),
                ...(times.recurrence ? { recurrence: times.recurrence } : {}),
                attendees: draft.attendees,
            }), 'Event created')
        }
    }

    const remove = async (entry: Entry) => {
        told(await invokeSpace('spaces:deleteCalendarEntry', { orgId, spaceId: space.id, entryId: entry.id }), 'Event deleted')
        setDetails(null)
    }

    /** A block was dragged or stretched: the entry, and for a repeat the whole series, moves with it. */
    const onMoved = (info: { event: EventApi; oldEvent: EventApi; revert: () => void }) => {
        const entry = entryOf(info.event)
        const [was, now] = [{ start: info.oldEvent.start ?? new Date(), end: endOf(info.oldEvent) }, { start: info.event.start ?? new Date(), end: endOf(info.event) }]
        let patch: { allDay?: boolean; start: string; end: string; recurrence?: spaces.CalendarRecurrence }
        if (info.event.allDay === entry.allDay) patch = movedTimes(entry, was, now)
        // Dropped from the all-day row onto an hour, or the other way: it takes the kind of where it landed.
        else if (info.event.allDay) patch = { allDay: true, start: localDate(now.start), end: localDate(new Date(now.end.getTime() - 86_400_000)) }
        else patch = { allDay: false, start: now.start.toISOString(), end: now.end.toISOString() }
        invokeSpace('spaces:updateCalendarEntry', { orgId, spaceId: space.id, entryId: entry.id, ...patch }).then(
            (written) => told(written, 'Event moved'),
            (err: unknown) => { info.revert(); toast(err instanceof Error ? err.message : 'Could not move the event', 'error') },
        )
    }

    const onSelect = (info: DateSelectInfo) => {
        const oneDay = info.end.getTime() - info.start.getTime() <= 86_400_000
        // A day clicked in the month is where a meeting goes, not an all-day event: nine o'clock, as a start.
        if (info.allDay && oneDay && info.view.type === 'dayGridMonth') {
            const start = new Date(info.start)
            start.setHours(9, 0, 0, 0)
            setDialog({ draft: draftForRange(start, new Date(start.getTime() + 3_600_000), false, selfMemberId) })
        } else {
            setDialog({ draft: draftForRange(info.start, info.end, info.allDay, selfMemberId) })
        }
    }

    const newEvent = () => {
        // The next full hour, on the day the grid is showing when that is not today.
        const shown = calendar.current?.getApi().getDate() ?? new Date()
        const start = new Date()
        if (view === 'timeGridDay') start.setFullYear(shown.getFullYear(), shown.getMonth(), shown.getDate())
        start.setHours(start.getHours() + 1, 0, 0, 0)
        setDialog({ draft: draftForRange(start, new Date(start.getTime() + 3_600_000), false, selfMemberId) })
    }

    const onEventClick = (info: EventClickInfo) => {
        info.jsEvent.preventDefault()
        setUpdate('')
        setDetails({ entry: entryOf(info.event), occurrence: (info.event.extendedProps as { occurrence: spaces.CalendarOccurrence }).occurrence, rect: beside(info.el.getBoundingClientRect(), info.jsEvent.clientX) })
    }

    // The popover shows the entry as the store has it now, so an edit made while it is open shows in it.
    const shown = details ? entries.find((e) => e.id === details.entry.id) ?? details.entry : null
    const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => details?.rect ?? new DOMRect() } }), [details])

    const postUpdate = async (entry: Entry) => {
        const body = update.trim()
        if (!body || posting) return
        setPosting(true)
        try {
            const { message } = await invokeSpace('spaces:postMessage', { orgId, spaceId: space.id, calendarEntryId: entry.id, body })
            setDetails(null)
            setUpdate('')
            if (message.threadRoot) onOpenThread(message.threadRoot)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not post the update', 'error')
        } finally {
            setPosting(false)
        }
    }

    return (
        <div className="space-calendar flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-12 flex-wrap items-center gap-2 px-5 py-2">
                <Button variant="outline" size="sm" onClick={() => calendar.current?.getApi().today()}>Today</Button>
                <div className="flex items-center">
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Previous" onClick={() => calendar.current?.getApi().prev()}><ChevronLeft className="size-[18px]" /></Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Next" onClick={() => calendar.current?.getApi().next()}><ChevronRight className="size-[18px]" /></Button>
                </div>
                <h2 aria-live="polite" className="min-w-0 truncate text-[17px] font-semibold">{title}</h2>
                {!loaded && <Loader2 aria-label="Loading" className="size-3.5 animate-spin text-muted-foreground" />}
                {loaded && !hasEvents && writable && <span className="hidden text-xs text-muted-foreground md:inline">Click or drag on the calendar to add an event.</span>}
                <div className="min-w-0 flex-1" />
                <Segmented value={view} options={VIEWS} onChange={chooseView} />
                {writable && <Button size="sm" onClick={newEvent}><Plus className="size-3.5" />New event</Button>}
            </div>

            <div className="min-h-0 flex-1 px-5 pb-4">
                <FullCalendar
                    ref={calendar}
                    plugins={PLUGINS}
                    initialView={view}
                    headerToolbar={false}
                    height="100%"
                    events={events}
                    eventContent={(info: EventDisplayInfo) => <EventBlock info={info} />}
                    eventClass={(info: EventDisplayInfo) => cn('space-calendar-block', info.event.allDay ? 'is-all-day' : 'is-timed', info.isPast && 'is-past')}
                    datesSet={onDatesSet}
                    nowIndicator
                    dayMaxEvents
                    scrollTime="08:00:00"
                    selectable={writable}
                    selectMirror
                    editable={writable}
                    select={onSelect}
                    eventClick={onEventClick}
                    eventDrop={onMoved}
                    eventResize={onMoved}
                />
            </div>

            <Popover open={shown !== null} onOpenChange={(open) => { if (!open) setDetails(null) }}>
                <PopoverAnchor virtualRef={anchor} />
                {shown && (
                    <PopoverContent side="right" align="start" collisionPadding={12} className="w-[340px] rounded-xl p-4" aria-label={shown.title}>
                        <EventSummary entry={shown} {...(details?.occurrence && shown.recurrence ? { occurrence: details.occurrence } : {})} />
                        <p className="mt-3 text-xs text-muted-foreground">Added by {names.get(shown.createdBy.memberId) ?? shown.createdBy.memberId}</p>
                        {shown.threadRoot ? (
                            <Button variant="outline" size="sm" className="mt-3 w-full justify-center" onClick={() => { const root = shown.threadRoot!; setDetails(null); onOpenThread(root) }}>
                                <MessageSquare className="size-3.5" />Open thread
                            </Button>
                        ) : writable && !shown.deletedAt ? (
                            // No thread yet: the first update starts it, with the event's card as its first message.
                            <form className="mt-3 flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void postUpdate(shown) }}>
                                <Input value={update} aria-label="Post an update" placeholder="Post an update…" className="h-8 text-sm" onChange={(e) => setUpdate(e.target.value)} />
                                <Button type="submit" size="icon" className="size-8 shrink-0" aria-label="Post" disabled={!update.trim() || posting}>
                                    {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                                </Button>
                            </form>
                        ) : null}
                        {writable && !shown.deletedAt && (
                            <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
                                <Button variant="ghost" size="sm" onClick={() => { setDetails(null); setDialog({ draft: draftFromEntry(shown), editing: shown }) }}><Pencil className="size-3.5" />Edit</Button>
                                <DeleteEventButton repeats={shown.recurrence !== undefined}
                                    onDelete={() => remove(shown).catch((err: unknown) => toast(err instanceof Error ? err.message : 'Could not delete the event', 'error'))} />
                            </div>
                        )}
                    </PopoverContent>
                )}
            </Popover>

            {dialog && (
                <CalendarEventDialog
                    orgId={orgId} spaceLabel={spaceLabel} members={members} selfMemberId={selfMemberId}
                    initial={dialog.draft} {...(dialog.editing ? { editing: dialog.editing } : {})}
                    onClose={() => { setDialog(null); calendar.current?.getApi().unselect() }}
                    onSave={(draft) => save(draft, dialog.editing)}
                    {...(dialog.editing ? { onDelete: () => remove(dialog.editing!) } : {})}
                />
            )}
        </div>
    )
}
