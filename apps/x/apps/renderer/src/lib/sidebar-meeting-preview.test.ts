import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareMeetingStarts, formatMeetingTime } from './sidebar-meeting-preview'

afterEach(() => vi.useRealTimers())

describe('meeting sidebar preview', () => {
  it('chooses the earliest event instead of prioritizing a later all-day event', () => {
    const timed = { start: new Date(2026, 7, 31, 9) }
    const allDay = { start: new Date(2026, 8, 9) }

    expect([allDay, timed].sort(compareMeetingStarts)).toEqual([timed, allDay])
  })

  it('qualifies future all-day events with their date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 28, 12))
    const start = new Date(2026, 8, 9)
    const date = start.toLocaleDateString([], { month: 'numeric', day: 'numeric' })

    expect(formatMeetingTime({ start, isAllDay: true })).toBe(`${date} · All day`)
  })
})
