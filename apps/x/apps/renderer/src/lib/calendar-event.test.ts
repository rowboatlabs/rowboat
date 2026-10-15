import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  extractConferenceLink,
  isSameLocalDay,
  formatMeetingTime,
  sortUpcomingMeetings,
} from './calendar-event'

describe('calendar-event (issue #932)', () => {
  const baseDate = new Date('2026-08-28T10:00:00')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(baseDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('isSameLocalDay', () => {
    it('returns true for same date in different hours', () => {
      const a = new Date('2026-08-28T09:00:00')
      const b = new Date('2026-08-28T22:30:00')
      expect(isSameLocalDay(a, b)).toBe(true)
    })

    it('returns false for different dates', () => {
      const a = new Date('2026-08-28T23:59:00')
      const b = new Date('2026-08-29T00:01:00')
      expect(isSameLocalDay(a, b)).toBe(false)
    })
  })

  describe('formatMeetingTime', () => {
    it('returns "All day" for an all-day event happening today', () => {
      const todayAllDay = {
        start: new Date('2026-08-28T00:00:00'),
        isAllDay: true,
      }
      expect(formatMeetingTime(todayAllDay)).toBe('All day')
    })

    it('returns "Tmrw · All day" for an all-day event happening tomorrow', () => {
      const tomorrowAllDay = {
        start: new Date('2026-08-29T00:00:00'),
        isAllDay: true,
      }
      expect(formatMeetingTime(tomorrowAllDay)).toBe('Tmrw · All day')
    })

    it('returns date qualifier with "All day" for future all-day events', () => {
      const futureAllDay = {
        start: new Date('2026-09-09T00:00:00'),
        isAllDay: true,
      }
      const expectedDate = new Date('2026-09-09T00:00:00').toLocaleDateString([], {
        month: 'numeric',
        day: 'numeric',
      })
      expect(formatMeetingTime(futureAllDay)).toBe(`${expectedDate} · All day`)
    })

    it('returns formatted time for timed event today', () => {
      const todayTimed = {
        start: new Date('2026-08-28T14:30:00'),
        isAllDay: false,
      }
      const expectedTime = new Date('2026-08-28T14:30:00').toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
      expect(formatMeetingTime(todayTimed)).toBe(expectedTime)
    })

    it('returns "Tmrw <time>" for timed event tomorrow', () => {
      const tomorrowTimed = {
        start: new Date('2026-08-29T14:30:00'),
        isAllDay: false,
      }
      const expectedTime = new Date('2026-08-29T14:30:00').toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
      expect(formatMeetingTime(tomorrowTimed)).toBe(`Tmrw ${expectedTime}`)
    })

    it('returns formatted date for future timed event', () => {
      const futureTimed = {
        start: new Date('2026-09-02T14:30:00'),
        isAllDay: false,
      }
      const expectedDate = new Date('2026-09-02T14:30:00').toLocaleDateString([], {
        month: 'numeric',
        day: 'numeric',
      })
      expect(formatMeetingTime(futureTimed)).toBe(expectedDate)
    })
  })

  describe('sortUpcomingMeetings', () => {
    it('orders a nearer timed event ahead of a far-future all-day event (issue #932)', () => {
      const nearerTimed = {
        id: 'aug31',
        summary: 'DATASCI',
        start: new Date('2026-08-31T14:00:00'),
        isAllDay: false,
      }
      const futureAllDay = {
        id: 'sept9',
        summary: 'Wedding Anniversary',
        start: new Date('2026-09-09T00:00:00'),
        isAllDay: true,
      }

      const items = [futureAllDay, nearerTimed]
      sortUpcomingMeetings(items)

      expect(items[0].id).toBe('aug31')
      expect(items[1].id).toBe('sept9')
    })

    it('keeps all-day first when start times are identical', () => {
      const sameTimeTimed = {
        id: 'timed',
        start: new Date('2026-08-29T00:00:00'),
        isAllDay: false,
      }
      const sameTimeAllDay = {
        id: 'allday',
        start: new Date('2026-08-29T00:00:00'),
        isAllDay: true,
      }

      const items = [sameTimeTimed, sameTimeAllDay]
      sortUpcomingMeetings(items)

      expect(items[0].id).toBe('allday')
      expect(items[1].id).toBe('timed')
    })
  })

  describe('extractConferenceLink', () => {
    it('extracts Google Meet URL from description', () => {
      const raw = { description: 'Join here: https://meet.google.com/abc-defg-hij' }
      expect(extractConferenceLink(raw)).toBe('https://meet.google.com/abc-defg-hij')
    })
  })
})
