import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: () => () => {} }))

import {
    draftForRange, draftFromEntry, draftTimes, gridEvents, localDate, movedTimes, newerEntry, noteCalendarEntries, reconcileCalendarRange, resetCalendarStore, useCalendarEntries,
} from './spaces-calendar'

// The calendar store and the arithmetic between the grid, the form and what
// Harbor keeps (2026-11-28). Times in these tests are built on the machine's
// own clock, as the form builds them, so they hold in any zone.

const base: spaces.CalendarEntry = {
    id: '01HZZZZZZZZZZZZZZZZZZZZZZA',
    spaceId: 'S1',
    title: 'Triage',
    allDay: false,
    start: '2026-12-01T17:00:00.000Z',
    end: '2026-12-01T17:30:00.000Z',
    timeZone: 'UTC',
    attendees: ['me'],
    createdBy: { memberId: 'me', actingMode: 'direct' },
    createdAt: '2026-11-28T10:00:00.000Z',
}
const entry = (patch: Partial<spaces.CalendarEntry> = {}): spaces.CalendarEntry => ({ ...base, ...patch })

beforeEach(resetCalendarStore)

describe('which copy of an entry is current', () => {
    it('is the one changed last, and a delete is a change', () => {
        const moved = entry({ start: '2026-12-02T17:00:00.000Z', updatedAt: '2026-11-28T11:00:00.000Z' })
        expect(newerEntry(base, moved)).toBe(moved)
        expect(newerEntry(moved, base)).toBe(moved)
        const deleted = entry({ deletedAt: '2026-11-28T12:00:00.000Z', updatedAt: '2026-11-28T12:00:00.000Z' })
        expect(newerEntry(moved, deleted)).toBe(deleted)
    })

    it('on a tie, is the one that knows the thread', () => {
        const threaded = entry({ threadRoot: '01HZZZZZZZZZZZZZZZZZZZZZZR' })
        expect(newerEntry(base, threaded)).toBe(threaded)
        expect(newerEntry(threaded, base)).toBe(threaded)
    })
})

/** What the store holds for a space, read the way a component reads it. */
function stored(orgId: string, spaceId: string): spaces.CalendarEntry[] {
    const { result, unmount } = renderHook(() => useCalendarEntries(orgId, spaceId))
    const entries = result.current
    unmount()
    return entries
}

describe('the store', () => {
    it('keeps the newer copy of each entry, whatever order they arrive in', () => {
        const moved = entry({ start: '2026-12-02T17:00:00.000Z', updatedAt: '2026-11-28T11:00:00.000Z' })
        noteCalendarEntries('org', 'S1', [moved])
        noteCalendarEntries('org', 'S1', [base])
        expect(stored('org', 'S1')).toEqual([moved])
        expect(stored('org', 'S2')).toEqual([])
    })

    it('a range read drops an entry it left out of its range, but not one that changed after the read was asked for', () => {
        const stale = entry({ id: '01HZZZZZZZZZZZZZZZZZZZZZZB' })
        const fresh = entry({ id: '01HZZZZZZZZZZZZZZZZZZZZZZC', createdAt: '2026-11-28T10:00:05.000Z' })
        const elsewhere = entry({ id: '01HZZZZZZZZZZZZZZZZZZZZZZD', start: '2027-03-01T17:00:00.000Z', end: '2027-03-01T18:00:00.000Z' })
        noteCalendarEntries('org', 'S1', [stale, fresh, elsewhere])
        reconcileCalendarRange('org', 'S1', new Date('2026-12-01T00:00:00Z'), new Date('2026-12-08T00:00:00Z'), '2026-11-28T10:00:01.000Z', [base])
        expect(stored('org', 'S1').map((e) => e.id).sort()).toEqual([base.id, fresh.id, elsewhere.id].sort())
    })
})

describe('blocks on the grid', () => {
    it('draws each turn of a repeat, leaves deleted entries out, and ends an all-day block the day after its last', () => {
        const daily = entry({ recurrence: { freq: 'daily', interval: 1 } })
        const offsite = entry({ id: '01HZZZZZZZZZZZZZZZZZZZZZZB', title: 'Offsite', allDay: true, start: '2026-12-02', end: '2026-12-03' })
        const gone = entry({ id: '01HZZZZZZZZZZZZZZZZZZZZZZC', deletedAt: '2026-11-28T12:00:00.000Z' })
        const blocks = gridEvents([daily, offsite, gone], new Date('2026-12-01T00:00:00Z'), new Date('2026-12-04T00:00:00Z'))
        expect(blocks.filter((b) => b.extendedProps.entry.id === daily.id).map((b) => b.start)).toEqual(['2026-12-01T17:00:00.000Z', '2026-12-02T17:00:00.000Z', '2026-12-03T17:00:00.000Z'])
        expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length)
        expect(blocks.find((b) => b.title === 'Offsite')).toMatchObject({ allDay: true, start: '2026-12-02', end: '2026-12-04', extendedProps: { occurrence: { start: '2026-12-02', end: '2026-12-03' } } })
        expect(blocks.some((b) => b.extendedProps.entry.id === gone.id)).toBe(false)
    })
})

describe('the event form', () => {
    it('a stretch of the grid becomes a draft for it, tagged with the person creating it', () => {
        const start = new Date(2026, 11, 1, 9, 0)
        const timed = draftForRange(start, new Date(2026, 11, 1, 10, 30), false, 'me')
        expect(timed).toMatchObject({ allDay: false, startDate: '2026-12-01', endDate: '2026-12-01', startTime: '09:00', endTime: '10:30', repeat: 'none', attendees: ['me'] })
        // The grid's all-day end is the day after the last.
        const days = draftForRange(new Date(2026, 11, 1), new Date(2026, 11, 4), true, undefined)
        expect(days).toMatchObject({ allDay: true, startDate: '2026-12-01', endDate: '2026-12-03', attendees: [] })
    })

    it('a draft becomes what Harbor is asked for, or says why it cannot', () => {
        const draft = draftForRange(new Date(2026, 11, 1, 9, 0), new Date(2026, 11, 1, 10, 0), false, 'me')
        expect(draftTimes(draft)).toEqual({ ok: true, allDay: false, start: new Date(2026, 11, 1, 9, 0).toISOString(), end: new Date(2026, 11, 1, 10, 0).toISOString(), recurrence: null })
        expect(draftTimes({ ...draft, endTime: '08:00' })).toEqual({ ok: false, problem: 'The end must be after the start' })
        expect(draftTimes({ ...draft, allDay: true, endDate: '2026-11-30' })).toEqual({ ok: false, problem: 'The end is before the start' })
        expect(draftTimes({ ...draft, repeat: 'daily', until: '2026-11-30' })).toMatchObject({ ok: false })
        expect(draftTimes({ ...draft, repeat: 'weekdays', until: '2026-12-31' })).toMatchObject({ recurrence: { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5], until: '2026-12-31' } })
        expect(draftTimes({ ...draft, repeat: 'monthly' })).toMatchObject({ recurrence: { freq: 'monthly', interval: 1 } })
    })

    it('editing keeps what the form does not show of a repeat, until its start leaves the days it names', () => {
        // An agent's "every 2 weeks on Tue and Thu"; 2026-12-01 is a Tuesday.
        const start = new Date(2026, 11, 1, 9, 0)
        const fortnightly = entry({ start: start.toISOString(), end: new Date(2026, 11, 1, 10, 0).toISOString(), recurrence: { freq: 'weekly', interval: 2, weekdays: [2, 4] } })
        const draft = draftFromEntry(fortnightly)
        expect(draft).toMatchObject({ repeat: 'weekly', startDate: '2026-12-01', startTime: '09:00', attendees: ['me'] })
        expect(draftTimes({ ...draft, title: 'Renamed' }, fortnightly)).toMatchObject({ recurrence: { freq: 'weekly', interval: 2, weekdays: [2, 4] } })
        // Moved to a Wednesday, which the repeat does not name: it is weekly on the new day.
        const moved = draftTimes({ ...draft, startDate: '2026-12-02', endDate: '2026-12-02' }, fortnightly)
        expect(moved).toMatchObject({ recurrence: { freq: 'weekly', interval: 2 } })
        expect(moved.ok && moved.recurrence?.weekdays).toBeUndefined()
        expect(draftFromEntry(entry({ recurrence: { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] } })).repeat).toBe('weekdays')
    })
})

describe('a block dragged on the grid', () => {
    const at = (day: number, hour: number, minute = 0) => new Date(2026, 11, day, hour, minute)

    it('moves a timed entry by what the block moved, and changes its length when stretched', () => {
        const timed = entry({ start: at(1, 9).toISOString(), end: at(1, 10).toISOString() })
        expect(movedTimes(timed, { start: at(1, 9), end: at(1, 10) }, { start: at(3, 14), end: at(3, 15) })).toEqual({ start: at(3, 14).toISOString(), end: at(3, 15).toISOString() })
        expect(movedTimes(timed, { start: at(1, 9), end: at(1, 10) }, { start: at(1, 9), end: at(1, 11, 30) })).toEqual({ start: at(1, 9).toISOString(), end: at(1, 11, 30).toISOString() })
    })

    it('moves the whole series from any of its turns, and turns a weekly repeat’s days with it', () => {
        // Mon, Wed, Fri from Mon Nov 30; its Wed Dec 9 turn is dragged to Thu Dec 10.
        const series = entry({ start: new Date(2026, 10, 30, 9).toISOString(), end: new Date(2026, 10, 30, 10).toISOString(), recurrence: { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] } })
        const moved = movedTimes(series, { start: at(9, 9), end: at(9, 10) }, { start: at(10, 9), end: at(10, 10) })
        expect(localDate(new Date(moved.start))).toBe('2026-12-01')
        expect(moved.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [2, 4, 6] })
        // A week later to the day, the days it names still hold.
        expect(movedTimes(series, { start: at(9, 9), end: at(9, 10) }, { start: at(16, 9), end: at(16, 10) }).recurrence).toBeUndefined()
    })

    it('moves an all-day entry by days, its last day following a stretch', () => {
        const offsite = entry({ allDay: true, start: '2026-12-09', end: '2026-12-11' })
        // The grid's block: Dec 9 to Dec 12 exclusive, dropped two days later.
        expect(movedTimes(offsite, { start: at(9, 0), end: at(12, 0) }, { start: at(11, 0), end: at(14, 0) })).toEqual({ start: '2026-12-11', end: '2026-12-13' })
        expect(movedTimes(offsite, { start: at(9, 0), end: at(12, 0) }, { start: at(9, 0), end: at(13, 0) })).toEqual({ start: '2026-12-09', end: '2026-12-12' })
    })
})
