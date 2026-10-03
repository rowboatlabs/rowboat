import { describe, expect, it } from 'vitest'
import { sessionCountdown, sessionResetText, timeLeft, usageHeadline, weekResetText } from './usage-reset'

// 2 Oct 2026, 16:34 GMT — whatever the test machine's own time zone.
const NOW = Date.parse('2026-10-02T16:34:00Z')

describe('usage reset times', () => {
  it('counts down in hours and minutes', () => {
    expect(timeLeft(3 * 3600_000 + 8 * 60_000)).toBe('3 h 08')
    expect(timeLeft(45 * 60_000)).toBe('45 min')
    expect(timeLeft(10_000)).toBe('1 min')
  })

  it('tells the end of the session in West Africa time', () => {
    expect(sessionResetText('2026-10-02T19:42:00Z', NOW)).toBe('Resets at 19:42 GMT (in 3 h 08)')
  })

  it('says a session not open yet starts with the next message', () => {
    expect(sessionResetText(undefined, NOW)).toBe('Starts with your next message')
    expect(sessionResetText('2026-10-02T10:00:00Z', NOW)).toBe('Starts with your next message')
  })

  it('names the day the week renews', () => {
    expect(weekResetText('2026-10-06T01:45:00Z', NOW)).toBe('Renews mardi 6 oct. at 01:45 GMT (in 3 d 9 h)')
    expect(weekResetText(undefined)).toBeUndefined()
  })
})

describe('the sidebar countdown', () => {
  it('says how long the session still runs, or that it has not started', () => {
    expect(sessionCountdown('2026-10-02T19:42:00Z', NOW)).toBe('Resets in 3 h 08')
    expect(sessionCountdown(undefined, NOW)).toBe('Starts with your next message')
    expect(sessionCountdown('2026-10-02T16:00:00Z', NOW)).toBe('Starts with your next message')
  })
})

describe('the usage panel', () => {
  it('counts days and hours once a day is left', () => {
    expect(timeLeft((2 * 24 + 5) * 3600_000 + 12 * 60_000)).toBe('2 d 5 h')
    expect(timeLeft(23 * 3600_000 + 59 * 60_000)).toBe('23 h 59')
  })

  it('says what is left in one sentence', () => {
    expect(usageHeadline(36, 79, true)).toBe('You have 36% of your session and 79% of your week left.')
    expect(usageHeadline(100, 79, false)).toBe('Your session starts with your next message. 79% of your week is left.')
  })
})
