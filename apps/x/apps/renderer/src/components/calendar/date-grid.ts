import { addDays, localDateKey, startOfDay, type UpcomingEvent } from '@/lib/calendar-events'

// Sunday, matching Google Calendar's default.
export const WEEK_STARTS_ON = 0

const MINUTE_MS = 60 * 1000
const DEFAULT_DURATION_MINUTES = 30
const MIN_VISUAL_MINUTES = 15

export function startOfWeek(d: Date): Date {
  const day = startOfDay(d)
  return addDays(day, -((day.getDay() - WEEK_STARTS_ON + 7) % 7))
}

// Weeks (rows of 7 local-midnight Dates) covering the anchor's month,
// including leading/trailing out-of-month days to fill each week.
export function buildMonthGrid(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const weeks: Date[][] = []
  let cursor = startOfWeek(first)
  while (cursor <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)))
    cursor = addDays(cursor, 7)
  }
  return weeks
}

// Exclusive end used for day-coverage. Google's all-day ends are already
// exclusive; an all-day event without one covers a single day, and a timed
// event without one counts as an instant (so it never bleeds into the next
// day — nor does a timed event ending exactly at midnight).
function coverageEnd(ev: UpcomingEvent): Date {
  if (ev.end) return ev.end
  if (ev.isAllDay) return addDays(ev.start, 1)
  return new Date(ev.start.getTime() + 1)
}

export function eventSpansMultipleDays(ev: UpcomingEvent): boolean {
  return coverageEnd(ev) > addDays(startOfDay(ev.start), 1)
}

// Buckets events by every local day they overlap within [rangeStart, rangeEnd).
// Both bounds must be local midnights. Each day's list puts banner events
// (all-day / multi-day) first, then timed events by start.
export function eventsByDayKey(events: UpcomingEvent[], rangeStart: Date, rangeEnd: Date): Map<string, UpcomingEvent[]> {
  const byKey = new Map<string, UpcomingEvent[]>()
  for (const ev of events) {
    const end = coverageEnd(ev)
    if (end <= rangeStart || ev.start >= rangeEnd) continue
    let day = startOfDay(ev.start)
    if (day < rangeStart) day = new Date(rangeStart)
    while (day < rangeEnd && day < end) {
      const key = localDateKey(day)
      const list = byKey.get(key)
      if (list) list.push(ev)
      else byKey.set(key, [ev])
      day = addDays(day, 1)
    }
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => {
      const aBanner = a.isAllDay || eventSpansMultipleDays(a)
      const bBanner = b.isAllDay || eventSpansMultipleDays(b)
      if (aBanner !== bBanner) return aBanner ? -1 : 1
      return a.start.getTime() - b.start.getTime()
    })
  }
  return byKey
}

export type PositionedEvent = {
  event: UpcomingEvent
  col: number
  cols: number
}

// End used for visual sizing/overlap: missing ends get a default duration and
// nothing renders shorter than MIN_VISUAL_MINUTES.
export function visualEndMs(ev: UpcomingEvent): number {
  const startMs = ev.start.getTime()
  const rawEnd = ev.end ? ev.end.getTime() : startMs + DEFAULT_DURATION_MINUTES * MINUTE_MS
  return Math.max(rawEnd, startMs + MIN_VISUAL_MINUTES * MINUTE_MS)
}

// Side-by-side layout for one day's timed events: sort by start (longer first
// on ties), greedily place each event in the lowest-index column that has
// ended, and partition into overlap clusters — every member of a cluster
// shares that cluster's column count so widths line up.
export function layoutDayColumns(events: UpcomingEvent[]): PositionedEvent[] {
  const sorted = [...events].sort((a, b) => {
    const startDiff = a.start.getTime() - b.start.getTime()
    if (startDiff !== 0) return startDiff
    return visualEndMs(b) - visualEndMs(a)
  })

  const result: PositionedEvent[] = []
  let cluster: Array<{ event: UpcomingEvent; col: number }> = []
  let colEnds: number[] = []
  let clusterMaxEnd = -Infinity

  const flush = () => {
    const cols = colEnds.length
    for (const item of cluster) result.push({ event: item.event, col: item.col, cols })
    cluster = []
    colEnds = []
    clusterMaxEnd = -Infinity
  }

  for (const ev of sorted) {
    const startMs = ev.start.getTime()
    const endMs = visualEndMs(ev)
    if (cluster.length > 0 && startMs >= clusterMaxEnd) flush()
    let col = colEnds.findIndex((end) => end <= startMs)
    if (col === -1) {
      col = colEnds.length
      colEnds.push(endMs)
    } else {
      colEnds[col] = endMs
    }
    cluster.push({ event: ev, col })
    clusterMaxEnd = Math.max(clusterMaxEnd, endMs)
  }
  flush()
  return result
}
