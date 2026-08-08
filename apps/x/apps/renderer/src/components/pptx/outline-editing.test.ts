import { describe, expect, it } from 'vitest'
import type { deck as deckShared } from '@x/shared'
import {
  addSlide,
  blankSlide,
  bulletsToText,
  clarifyComplete,
  clarifyRequest,
  deleteSlide,
  moveSlide,
  updateBullets,
  updateHeading,
} from './outline-editing'

const SLIDES: deckShared.DeckOutlineSlide[] = [
  { layout: 'title', heading: 'A' },
  { layout: 'title-body', heading: 'B', bullets: ['b1', 'b2'] },
  { layout: 'title-body', heading: 'C', body: 'narrative' },
]

describe('outline row edits', () => {
  it('moves a slide up and down within bounds, no-ops at the edges', () => {
    expect(moveSlide(SLIDES, 1, -1).map((s) => s.heading)).toEqual(['B', 'A', 'C'])
    expect(moveSlide(SLIDES, 1, 1).map((s) => s.heading)).toEqual(['A', 'C', 'B'])
    expect(moveSlide(SLIDES, 0, -1).map((s) => s.heading)).toEqual(['A', 'B', 'C'])
    expect(moveSlide(SLIDES, 2, 1).map((s) => s.heading)).toEqual(['A', 'B', 'C'])
  })

  it('deletes a row', () => {
    expect(deleteSlide(SLIDES, 1).map((s) => s.heading)).toEqual(['A', 'C'])
    expect(deleteSlide(SLIDES, 9)).toHaveLength(3)
  })

  it('appends a blank title-body row', () => {
    const next = addSlide(SLIDES)
    expect(next).toHaveLength(4)
    expect(next[3]).toEqual(blankSlide())
  })

  it('edits heading immutably', () => {
    const next = updateHeading(SLIDES, 0, 'A2')
    expect(next[0].heading).toBe('A2')
    expect(SLIDES[0].heading).toBe('A')
  })

  it('renders bullets or body as textarea text', () => {
    expect(bulletsToText(SLIDES[1])).toBe('b1\nb2')
    expect(bulletsToText(SLIDES[2])).toBe('narrative')
    expect(bulletsToText(SLIDES[0])).toBe('')
  })

  it('parses textarea text into trimmed bullets and drops any prior body', () => {
    const next = updateBullets(SLIDES, 2, '  x \n\n y ')
    expect(next[2].bullets).toEqual(['x', 'y'])
    expect(next[2].body).toBeUndefined()
  })
})

describe('clarify round-trip', () => {
  it('is complete only when every question has a non-empty answer', () => {
    const qs = ['Who is the audience?', 'How long is the talk?']
    expect(clarifyComplete(qs, [])).toBe(false)
    expect(clarifyComplete(qs, ['execs'])).toBe(false)
    expect(clarifyComplete(qs, ['execs', ' '])).toBe(false)
    expect(clarifyComplete(qs, ['execs', '10 min'])).toBe(true)
    expect(clarifyComplete(undefined, [])).toBe(true)
    expect(clarifyComplete([], [])).toBe(true)
  })

  it('builds a re-request carrying the original options plus trimmed answers', () => {
    const base: deckShared.GenerateDeckOutlineRequest = {
      prompt: 'pitch deck for our API',
      slideCount: 8,
      tone: 'Persuasive',
    }
    const req = clarifyRequest(base, [' executives ', 'ten minutes', ''])
    expect(req.prompt).toBe('pitch deck for our API')
    expect(req.slideCount).toBe(8)
    expect(req.tone).toBe('Persuasive')
    expect(req.answers).toEqual(['executives', 'ten minutes'])
  })
})
