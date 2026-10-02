import { describe, expect, it } from 'vitest'
import { sessionResetText, timeLeft, weekResetText } from './usage-reset'

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
    expect(weekResetText('2026-10-06T01:45:00Z')).toBe('Renews mardi 6 oct. at 01:45 GMT')
    expect(weekResetText(undefined)).toBeUndefined()
  })
})
