import { describe, expect, it } from 'vitest'
import { EMPTY, ideasFor, mergeProfile, profileBlock, readSaved, shouldShow, spaceProgress } from './model'

// BAARALI(04/10/2026): the onboarding's logic, without React.

describe('readSaved', () => {
  it('keeps a well-formed record and drops what it does not know', () => {
    const raw = JSON.stringify({ step: 2, profile: { name: '  Awa ', sector: 'Legal', role: 'Pirate' }, spaceSince: 5, returning: true })
    expect(readSaved(raw)).toEqual({ step: 2, profile: { name: 'Awa', sector: 'Legal', role: null }, spaceSince: 5, returning: true })
  })

  it('starts over on anything unreadable', () => {
    expect(readSaved(null)).toEqual(EMPTY)
    expect(readSaved('{"step":9')).toEqual(EMPTY)
    expect(readSaved('{"step":7}').step).toBe(0)
  })
})

describe('shouldShow', () => {
  const saved = (step: 0 | 1 | 2, returning = false) => ({ ...EMPTY, step, returning })

  it('opens without a Baarali session, after a sign-out too', () => {
    expect(shouldShow({ upstream: false, signedIn: false, saved: saved(0) })).toBe(true)
  })

  it('keeps a new person\'s onboarding going once joined, though the instance says it was done', () => {
    expect(shouldShow({ upstream: false, signedIn: true, saved: saved(1) })).toBe(true)
  })

  it('lets someone who already had an account into the app once joined', () => {
    expect(shouldShow({ upstream: false, signedIn: true, saved: saved(1, true) })).toBe(false)
    expect(shouldShow({ upstream: false, signedIn: true, saved: saved(0) })).toBe(false)
  })
})

describe('the profile in the agent\'s notes', () => {
  const awa = { name: 'Awa', sector: 'Retail and distribution', role: 'Business owner or manager' }

  it('is told only when something was said', () => {
    expect(profileBlock({ name: '', sector: null, role: null }, 'fr')).toBe('')
    expect(profileBlock(awa, 'fr')).toContain('- Activity: Retail and distribution\n')
    expect(profileBlock(awa, 'fr')).toContain('- Language of the app: French')
  })

  it('goes first, replaces itself, and keeps the notes the agent took', () => {
    const block = profileBlock(awa, 'en')
    const notes = 'Prefers short answers.'
    const once = mergeProfile(notes, block)
    expect(once.startsWith(block)).toBe(true)
    expect(once).toContain(notes)
    const again = mergeProfile(once, profileBlock({ ...awa, name: 'Awa T.' }, 'en'))
    expect(again.match(/Told at sign-up/g)).toHaveLength(1)
    expect(again).toContain('First name: Awa T.')
    expect(again).toContain(notes)
    expect(mergeProfile(again, '')).toBe(`${notes}\n`)
  })
})

describe('first requests', () => {
  it('fit the activity, and anyone without one', () => {
    expect(ideasFor('Construction and crafts')[0].title).toBe('Plan the week on site')
    expect(ideasFor(null)).toHaveLength(3)
    expect(ideasFor('Other')).toEqual(ideasFor(null))
  })
})

describe('spaceProgress', () => {
  it('runs to 90% over about a minute, then waits; full once joined', () => {
    expect(spaceProgress(0, 0, false)).toBe(5)
    expect(spaceProgress(0, 30_000, false)).toBe(48)
    expect(spaceProgress(0, 600_000, false)).toBe(90)
    expect(spaceProgress(null, 0, true)).toBe(100)
  })
})
