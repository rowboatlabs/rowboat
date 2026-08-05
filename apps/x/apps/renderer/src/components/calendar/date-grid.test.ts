import { describe, expect, it } from 'vitest'

import type { UpcomingEvent } from '@/lib/calendar-events'
import { buildMonthGrid, eventsByDayKey, eventSpansMultipleDays, layoutDayColumns, startOfWeek } from './date-grid'

function evt(overrides: Partial<UpcomingEvent> & { start: Date }): UpcomingEvent {
  return {
    id: overrides.id ?? `${overrides.start.toISOString()}-${overrides.summary ?? 'event'}`,
    summary: 'event',
    end: null,
    isAllDay: false,
    location: null,
    description: null,
    htmlLink: null,
    conferenceLink: null,
    creator: null,
    organizer: null,
    attendees: [],
    recurringEventId: null,
    calendarId: 'primary',
    color: null,
    readOnly: false,
    source: 'calendar_sync/test.json',
    rawStart: undefined,
    rawEnd: undefined,
    dateKey: '',
    ...overrides,
  }
}

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min)

describe('startOfWeek', () => {
  it('snaps to the preceding Sunday', () => {
    // 2026-07-01 is a Wednesday.
    expect(startOfWeek(day(2026, 7, 1)).getTime()).toBe(day(2026, 6, 28).getTime())
  })

  it('is a fixed point on Sundays', () => {
    expect(startOfWeek(day(2026, 6, 28)).getTime()).toBe(day(2026, 6, 28).getTime())
  })
})

describe('buildMonthGrid', () => {
  it('covers July 2026 in 5 Sunday-started weeks', () => {
    const weeks = buildMonthGrid(day(2026, 7, 15))
    expect(weeks).toHaveLength(5)
    expect(weeks[0][0].getTime()).toBe(day(2026, 6, 28).getTime())
    expect(weeks[4][6].getTime()).toBe(day(2026, 8, 1).getTime())
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('covers February 2026 (starts on a Sunday) in exactly 4 weeks', () => {
    const weeks = buildMonthGrid(day(2026, 2, 10))
    expect(weeks).toHaveLength(4)
    expect(weeks[0][0].getTime()).toBe(day(2026, 2, 1).getTime())
    expect(weeks[3][6].getTime()).toBe(day(2026, 2, 28).getTime())
  })

  it('covers August 2026 in 6 weeks', () => {
    const weeks = buildMonthGrid(day(2026, 8, 1))
    expect(weeks).toHaveLength(6)
    expect(weeks[0][0].getTime()).toBe(day(2026, 7, 26).getTime())
  })
})

describe('eventSpansMultipleDays', () => {
  it('is false for a single all-day event (exclusive end on the next day)', () => {
    expect(eventSpansMultipleDays(evt({ start: day(2026, 7, 1), end: day(2026, 7, 2), isAllDay: true }))).toBe(false)
  })

  it('is true for a two-day all-day event', () => {
    expect(eventSpansMultipleDays(evt({ start: day(2026, 7, 1), end: day(2026, 7, 3), isAllDay: true }))).toBe(true)
  })

  it('is false for a timed event ending exactly at midnight', () => {
    expect(eventSpansMultipleDays(evt({ start: at(2026, 7, 1, 22), end: day(2026, 7, 2) }))).toBe(false)
  })

  it('is true for a timed event crossing midnight', () => {
    expect(eventSpansMultipleDays(evt({ start: at(2026, 7, 1, 22), end: at(2026, 7, 2, 1) }))).toBe(true)
  })
})

describe('eventsByDayKey', () => {
  const range = { start: day(2026, 7, 1), end: day(2026, 7, 8) }

  it('buckets a two-day all-day event onto both covered days only', () => {
    const map = eventsByDayKey(
      [evt({ start: day(2026, 7, 1), end: day(2026, 7, 3), isAllDay: true })],
      range.start,
      range.end,
    )
    expect([...map.keys()].sort()).toEqual(['2026-07-01', '2026-07-02'])
  })

  it('keeps a timed event ending exactly at midnight off the next day', () => {
    const map = eventsByDayKey(
      [evt({ start: at(2026, 7, 1, 22), end: day(2026, 7, 2) })],
      range.start,
      range.end,
    )
    expect([...map.keys()]).toEqual(['2026-07-01'])
  })

  it('clamps events partially outside the range', () => {
    const map = eventsByDayKey(
      [evt({ start: day(2026, 6, 29), end: day(2026, 7, 3), isAllDay: true })],
      range.start,
      range.end,
    )
    expect([...map.keys()].sort()).toEqual(['2026-07-01', '2026-07-02'])
  })

  it('sorts banner events before timed events within a day', () => {
    const timed = evt({ id: 'timed', start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 10) })
    const allDay = evt({ id: 'allday', start: day(2026, 7, 1), end: day(2026, 7, 2), isAllDay: true })
    const map = eventsByDayKey([timed, allDay], range.start, range.end)
    expect(map.get('2026-07-01')?.map((e) => e.id)).toEqual(['allday', 'timed'])
  })
})

describe('layoutDayColumns', () => {
  it('gives non-overlapping events full width in separate clusters', () => {
    const a = evt({ id: 'a', start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 10) })
    const b = evt({ id: 'b', start: at(2026, 7, 1, 11), end: at(2026, 7, 1, 12) })
    const laid = layoutDayColumns([a, b])
    expect(laid.map((p) => ({ id: p.event.id, col: p.col, cols: p.cols }))).toEqual([
      { id: 'a', col: 0, cols: 1 },
      { id: 'b', col: 0, cols: 1 },
    ])
  })

  it('splits overlapping events side by side', () => {
    const a = evt({ id: 'a', start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 10) })
    const b = evt({ id: 'b', start: at(2026, 7, 1, 9, 30), end: at(2026, 7, 1, 10, 30) })
    const laid = layoutDayColumns([a, b])
    expect(laid.map((p) => ({ id: p.event.id, col: p.col, cols: p.cols }))).toEqual([
      { id: 'a', col: 0, cols: 2 },
      { id: 'b', col: 1, cols: 2 },
    ])
  })

  it('reuses a freed column inside a chained cluster and shares its width', () => {
    const a = evt({ id: 'a', start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 10) })
    const b = evt({ id: 'b', start: at(2026, 7, 1, 9, 30), end: at(2026, 7, 1, 10, 30) })
    const c = evt({ id: 'c', start: at(2026, 7, 1, 10), end: at(2026, 7, 1, 11) })
    const laid = layoutDayColumns([a, b, c])
    expect(laid.map((p) => ({ id: p.event.id, col: p.col, cols: p.cols }))).toEqual([
      { id: 'a', col: 0, cols: 2 },
      { id: 'b', col: 1, cols: 2 },
      { id: 'c', col: 0, cols: 2 },
    ])
  })

  it('treats an event with no end as 30 minutes for overlap', () => {
    const a = evt({ id: 'a', start: at(2026, 7, 1, 9) })
    const b = evt({ id: 'b', start: at(2026, 7, 1, 9, 15), end: at(2026, 7, 1, 10) })
    const laid = layoutDayColumns([a, b])
    expect(laid.every((p) => p.cols === 2)).toBe(true)
  })
})
