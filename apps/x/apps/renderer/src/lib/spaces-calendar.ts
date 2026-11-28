import { useSyncExternalStore } from 'react'
import { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// The space calendar in the renderer (2026-11-28, harbor spec §7 The space
// calendar). Entries live in one module store per space, fed three ways: a
// range read when the grid shows new dates, the answer of a write, and the
// `calendar_entry` event every member's client gets. The grid and every card
// read the same store, so an event dragged in one window moves in the other
// and its card in the thread follows. Occurrences are never stored: the grid
// computes them from the entries with the protocol's `expandOccurrences`,
// the same function Harbor answers a range with.

type Entry = spaces.CalendarEntry

const bySpace = new Map<string, Map<string, Entry>>()
const snapshots = new Map<string, Entry[]>()
const listeners = new Set<() => void>()
const EMPTY: Entry[] = []

const keyOf = (orgId: string, spaceId: string): string => `${orgId}/${spaceId}`

/** When an entry last changed. A delete is its last change; a new entry's is its creation. */
function stampOf(entry: Entry): string {
    return entry.deletedAt ?? entry.updatedAt ?? entry.createdAt
}

/**
 * The newer of two copies of one entry. A card's copy can be older than the
 * store's (the message was read before the entry moved) or newer (the store
 * only knows what the grid last asked for). Getting its thread does not
 * stamp an entry, so on a tie the copy that knows the thread wins.
 */
export function newerEntry(a: Entry, b: Entry): Entry {
    const [x, y] = [stampOf(a), stampOf(b)]
    if (x !== y) return x > y ? a : b
    return b.threadRoot && !a.threadRoot ? b : a
}

/** Fold entries into the store, keeping the newer copy of each. */
export function noteCalendarEntries(orgId: string, spaceId: string, entries: readonly Entry[]): void {
    if (entries.length === 0) return
    const key = keyOf(orgId, spaceId)
    const known = bySpace.get(key) ?? new Map<string, Entry>()
    let changed = false
    for (const entry of entries) {
        const current = known.get(entry.id)
        const next = current ? newerEntry(current, entry) : entry
        if (next !== current) {
            known.set(entry.id, next)
            changed = true
        }
    }
    if (!changed) return
    bySpace.set(key, known)
    snapshots.delete(key)
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
    wire()
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

function snapshot(orgId: string, spaceId: string): Entry[] {
    const key = keyOf(orgId, spaceId)
    let list = snapshots.get(key)
    if (!list) {
        list = [...(bySpace.get(key)?.values() ?? [])]
        snapshots.set(key, list)
    }
    return list.length > 0 ? list : EMPTY
}

let wired = false
function wire(): void {
    if (wired) return
    wired = true
    subscribeSpacesFeed((event) => {
        if (!('frame' in event) || event.frame.kind !== 'event' || event.frame.event.type !== 'calendar_entry') return
        noteCalendarEntries(event.orgId, event.frame.spaceId, [event.frame.event.entry])
    })
}

/** Every entry of the space the store knows, deleted ones included. */
export function useCalendarEntries(orgId: string, spaceId: string): Entry[] {
    return useSyncExternalStore(subscribe, () => snapshot(orgId, spaceId))
}

/** A card's entry as it stands: the store's copy when it is newer than the message's. */
export function useCalendarEntry(orgId: string | undefined, entry: Entry): Entry {
    const known = useSyncExternalStore(subscribe, () => (orgId ? bySpace.get(keyOf(orgId, entry.spaceId))?.get(entry.id) : undefined))
    return known ? newerEntry(known, entry) : entry
}

/**
 * What a range read says about the store: the entries it answered are
 * folded in, and an entry the store still shows in that range which the read
 * left out was deleted while nobody here was listening, so it goes. Anything
 * stamped after the read was asked for stays: it arrived live in between.
 */
export function reconcileCalendarRange(orgId: string, spaceId: string, from: Date, to: Date, askedAt: string, entries: readonly Entry[]): void {
    noteCalendarEntries(orgId, spaceId, entries)
    const key = keyOf(orgId, spaceId)
    const known = bySpace.get(key)
    if (!known) return
    const answered = new Set(entries.map((e) => e.id))
    let dropped = false
    for (const entry of [...known.values()]) {
        if (entry.deletedAt || answered.has(entry.id) || stampOf(entry) >= askedAt) continue
        if (spaces.expandOccurrences(entry, from, to, 1).length === 0) continue
        known.delete(entry.id)
        dropped = true
    }
    if (!dropped) return
    snapshots.delete(key)
    for (const listener of listeners) listener()
}

/** Forget everything: tests, and nothing else. */
export function resetCalendarStore(): void {
    bySpace.clear()
    snapshots.clear()
}

// --- the grid --------------------------------------------------------------------

/** One block on the grid: an occurrence of an entry, in what the grid library takes. */
export interface GridEvent {
    /** Unique per occurrence, so a repeat's turns are separate blocks. */
    id: string
    title: string
    start: string
    /** For an all-day block, the day after its last: the library's ends are exclusive. */
    end: string
    allDay: boolean
    /** The entry, and this turn of it in the entry's own shape: an all-day `end` is its last day. */
    extendedProps: { entry: Entry; occurrence: spaces.CalendarOccurrence }
}

/** The live entries' occurrences in [from, to), as grid blocks. */
export function gridEvents(entries: readonly Entry[], from: Date, to: Date): GridEvent[] {
    const out: GridEvent[] = []
    for (const entry of entries) {
        if (entry.deletedAt) continue
        for (const occurrence of spaces.expandOccurrences(entry, from, to)) {
            out.push({
                id: `${entry.id}@${occurrence.start}`,
                title: entry.title,
                start: occurrence.start,
                end: entry.allDay ? spaces.nextDate(occurrence.end) : occurrence.end,
                allDay: entry.allDay,
                extendedProps: { entry, occurrence },
            })
        }
    }
    return out
}

// --- the form ----------------------------------------------------------------------

export type RepeatChoice = 'none' | 'daily' | 'weekly' | 'weekdays' | 'monthly'

/** What the event dialog edits: dates and times as the viewer's own clock shows them. */
export interface EventDraft {
    title: string
    description: string
    allDay: boolean
    /** YYYY-MM-DD; for an all-day event `endDate` is its last day. */
    startDate: string
    endDate: string
    /** HH:MM. Ignored when all-day. */
    startTime: string
    endTime: string
    repeat: RepeatChoice
    /** YYYY-MM-DD, or empty for a repeat that never ends. */
    until: string
    attendees: string[]
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** A Date's own calendar date, in the viewer's zone. */
export const localDate = (at: Date): string => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
const localTime = (at: Date): string => `${pad(at.getHours())}:${pad(at.getMinutes())}`

/** The viewer's IANA zone, which a new event's times are meant in. */
export function viewerTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

const WORKWEEK = [1, 2, 3, 4, 5]

function repeatOf(recurrence: spaces.CalendarRecurrence | undefined): RepeatChoice {
    if (!recurrence) return 'none'
    if (recurrence.freq === 'weekly') {
        const days = recurrence.weekdays ?? []
        return days.length === 5 && WORKWEEK.every((d) => days.includes(d)) ? 'weekdays' : 'weekly'
    }
    return recurrence.freq
}

/** A draft for a new event over a stretch of the grid. An all-day stretch's `end` is the day after its last, as the grid gives it. */
export function draftForRange(start: Date, end: Date, allDay: boolean, self: string | undefined): EventDraft {
    const last = allDay ? new Date(end.getTime() - 86_400_000) : end
    return {
        title: '',
        description: '',
        allDay,
        startDate: localDate(start),
        endDate: localDate(last < start ? start : last),
        startTime: allDay ? '09:00' : localTime(start),
        endTime: allDay ? '10:00' : localTime(end),
        repeat: 'none',
        until: '',
        attendees: self ? [self] : [],
    }
}

/** A draft holding an entry as it stands, its times on the viewer's clock. */
export function draftFromEntry(entry: Entry): EventDraft {
    const [start, end] = entry.allDay ? [new Date(`${entry.start}T00:00:00`), new Date(`${entry.end}T00:00:00`)] : [new Date(entry.start), new Date(entry.end)]
    return {
        title: entry.title,
        description: entry.description ?? '',
        allDay: entry.allDay,
        startDate: entry.allDay ? entry.start : localDate(start),
        endDate: entry.allDay ? entry.end : localDate(end),
        startTime: entry.allDay ? '09:00' : localTime(start),
        endTime: entry.allDay ? '10:00' : localTime(end),
        repeat: repeatOf(entry.recurrence),
        until: entry.recurrence?.until ?? '',
        attendees: [...entry.attendees],
    }
}

/** What a draft asks Harbor for, or why it cannot be saved. `previous` keeps a repeat's own interval and weekdays when its kind is unchanged. */
export function draftTimes(draft: EventDraft, previous?: Entry): { ok: true; allDay: boolean; start: string; end: string; recurrence: spaces.CalendarRecurrence | null } | { ok: false; problem: string } {
    let start: string
    let end: string
    if (draft.allDay) {
        if (!draft.startDate || !draft.endDate) return { ok: false, problem: 'Pick a date' }
        if (draft.endDate < draft.startDate) return { ok: false, problem: 'The end is before the start' }
        start = draft.startDate
        end = draft.endDate
    } else {
        const [from, to] = [new Date(`${draft.startDate}T${draft.startTime}`), new Date(`${draft.endDate}T${draft.endTime}`)]
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { ok: false, problem: 'Pick a date and time' }
        if (to <= from) return { ok: false, problem: 'The end must be after the start' }
        start = from.toISOString()
        end = to.toISOString()
    }
    if (draft.repeat !== 'none' && draft.until && draft.until < draft.startDate) return { ok: false, problem: 'The repeat ends before the event starts' }
    const until = draft.until ? { until: draft.until } : {}
    let recurrence: spaces.CalendarRecurrence | null = null
    if (draft.repeat === 'weekdays') recurrence = { freq: 'weekly', interval: 1, weekdays: WORKWEEK, ...until }
    else if (draft.repeat !== 'none') {
        // Unchanged in kind, a repeat keeps what the dialog does not show: an agent's "every 2 weeks on Mon and Thu" survives a retitle.
        const kept = previous?.recurrence && repeatOf(previous.recurrence) === draft.repeat ? previous.recurrence : undefined
        // Its weekdays too, unless the event now starts on a day they leave out: the form says "Weekly on Wednesday".
        const weekdays = kept?.weekdays?.includes(new Date(`${draft.startDate}T12:00:00`).getDay()) ? kept.weekdays : undefined
        recurrence = { freq: draft.repeat, interval: kept?.interval ?? 1, ...(weekdays ? { weekdays } : {}), ...until }
    }
    return { ok: true, allDay: draft.allDay, start, end, recurrence }
}

/**
 * Where an entry lands when one of its blocks is dragged or stretched on
 * the grid. The whole series moves with it: its first start shifts by what
 * the block moved, and a weekly repeat's weekdays turn by the same days, or
 * the block would spring back to a day the repeat still names.
 */
export function movedTimes(
    entry: Entry,
    was: { start: Date; end: Date },
    now: { start: Date; end: Date },
): { start: string; end: string; recurrence?: spaces.CalendarRecurrence } {
    const days = Math.round((new Date(localDate(now.start)).getTime() - new Date(localDate(was.start)).getTime()) / 86_400_000)
    let start: string
    let end: string
    if (entry.allDay) {
        // The grid's all-day ends are exclusive; an entry's `end` is its last day.
        const lengthWas = Math.round((was.end.getTime() - was.start.getTime()) / 86_400_000)
        const lengthNow = Math.round((now.end.getTime() - now.start.getTime()) / 86_400_000)
        start = spaces.nextDate(entry.start, days)
        end = spaces.nextDate(entry.end, days + (lengthNow - lengthWas))
    } else {
        start = new Date(Date.parse(entry.start) + (now.start.getTime() - was.start.getTime())).toISOString()
        end = new Date(Date.parse(entry.end) + (now.end.getTime() - was.end.getTime())).toISOString()
    }
    const weekdays = entry.recurrence?.weekdays
    if (!entry.recurrence || !weekdays || days % 7 === 0) return { start, end }
    return { start, end, recurrence: { ...entry.recurrence, weekdays: weekdays.map((d) => (((d + days) % 7) + 7) % 7).sort((a, b) => a - b) } }
}

/** "9:00 AM", or "9 AM" on the hour: what a block on the grid has room for. */
export function shortTime(at: Date): string {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', ...(at.getMinutes() ? { minute: '2-digit' } : {}) }).format(at).replace(/\u202f/g, ' ')
}
