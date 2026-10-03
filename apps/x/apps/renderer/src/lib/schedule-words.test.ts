import { describe, expect, it } from 'vitest'
import { cronWords, isPlanner, scheduleWords } from './schedule-words'

// A task's timing in plain words (Baarali, 02/10/2026), on the instance's
// clock: GMT.

describe('cronWords', () => {
  it('says the common shapes in words', () => {
    expect(cronWords('0 7 * * *')).toBe('Every day at 07:00 GMT')
    expect(cronWords('30 18 * * 1-5')).toBe('Weekdays at 18:30 GMT')
    expect(cronWords('0 8 * * 1')).toBe('Every Monday at 08:00 GMT')
    expect(cronWords('0 9 * * 0')).toBe('Every Sunday at 09:00 GMT')
    expect(cronWords('0 9 * * 7')).toBe('Every Sunday at 09:00 GMT')
    expect(cronWords('*/15 * * * *')).toBe('Every 15 minutes')
    expect(cronWords('0 * * * *')).toBe('Every hour')
    expect(cronWords('0 */6 * * *')).toBe('Every 6 hours')
  })

  it('gives up on the rest, and the expression is shown as written', () => {
    expect(cronWords('0 9 1 * *')).toBeNull()
    expect(scheduleWords({ cronExpr: '0 9 1 * *' })).toEqual(['0 9 1 * *'])
  })
})

describe('scheduleWords', () => {
  it('says every trigger, or that the task runs only by hand', () => {
    expect(scheduleWords({ windows: [{ startTime: '06:30', endTime: '09:30' }] })).toEqual(['Every day between 06:30 and 09:30 GMT'])
    expect(scheduleWords({ cronExpr: '0 7 * * *', eventMatchCriteria: 'a meeting ends' })).toEqual(['Every day at 07:00 GMT', 'When something it watches for happens'])
    expect(scheduleWords(undefined)).toEqual(['Only when you run it'])
  })
})

describe('isPlanner', () => {
  it('knows the seeded morning planner, in either language', () => {
    expect(isPlanner({ slug: 'morning-planner', name: 'Morning planner' })).toBe(true)
    expect(isPlanner({ slug: 'x', name: 'Planificateur du matin' })).toBe(true)
    expect(isPlanner({ slug: 'resume', name: 'Résumé du matin' })).toBe(false)
  })
})
