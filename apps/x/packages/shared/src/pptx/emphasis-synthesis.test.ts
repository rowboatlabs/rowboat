import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type * as deckShared from '../deck.js'
import { parsePptx } from './parse.js'
import { DECK_PALETTES } from './new-deck.js'
import { synthesizeDeckFromOutline, synthesizeSlidePart } from './generate.js'
import { writeDeck } from './serialize.js'
import type { TextShape } from './types.js'

// FIX for markdown leaking into slides as literal asterisks: emphasis markers
// in outline text must synthesize into styled runs on every path that turns
// outline strings into paragraphs — the placeholder text-edit path
// (synthesizeDeckFromOutline's bullets), the authored patterns, and the baked
// single-slide path (synthesizeSlidePart). All assertions run on RE-PARSED
// written bytes, so they prove the .pptx itself carries the formatting.

const NAVY = DECK_PALETTES[0]

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
beforeAll(() => {
  URL.createObjectURL = (() => 'blob:mock/0') as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
})
afterAll(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

async function synthesize(slide: deckShared.DeckOutlineSlide) {
  const outline: deckShared.DeckOutline = {
    title: 'Deck',
    suggestedPalette: 'navy',
    slides: [{ layout: 'title', pattern: 'title', heading: 'Deck' }, slide],
  }
  const { bytes } = await synthesizeDeckFromOutline(outline, NAVY)
  const deck = await parsePptx(bytes)
  return deck.slides[1]
}

const runsOf = (shape: TextShape, para: number) =>
  shape.paragraphs[para].runs.map((r) => ({ text: r.text, bold: Boolean(r.bold), italic: Boolean(r.italic) }))

describe('inline emphasis at the synthesis boundary', () => {
  it('a bullet with bold mid-sentence becomes three runs, and the bytes re-parse with the bold run', async () => {
    const slide = await synthesize({
      layout: 'title-body',
      pattern: 'bullets',
      heading: 'Momentum',
      bullets: ['Growth **doubled** in Q3', 'Churn held flat'],
    })
    const body = slide.shapes[1] as TextShape
    expect(runsOf(body, 0)).toEqual([
      { text: 'Growth ', bold: false, italic: false },
      { text: 'doubled', bold: true, italic: false },
      { text: ' in Q3', bold: false, italic: false },
    ])
    // The plain bullet stays a single unstyled run.
    expect(runsOf(body, 1)).toEqual([{ text: 'Churn held flat', bold: false, italic: false }])
  })

  it('a lone asterisk stays literal', async () => {
    const slide = await synthesize({
      layout: 'title-body',
      pattern: 'bullets',
      heading: 'Math',
      bullets: ['Capacity: 5 * 3 = 15 pods'],
    })
    const body = slide.shapes[1] as TextShape
    expect(runsOf(body, 0)).toEqual([{ text: 'Capacity: 5 * 3 = 15 pods', bold: false, italic: false }])
  })

  it('authored patterns style emphasis too (two-column card line, italic)', async () => {
    const slide = await synthesize({
      layout: 'title-body',
      pattern: 'two-column',
      heading: 'Before and after',
      columns: [
        { heading: 'Before', lines: ['Deploys took *days*'] },
        { heading: 'After', lines: ['Minutes'] },
      ],
    })
    const texts = slide.shapes.filter((s): s is TextShape => s.type === 'text')
    const runs = texts.flatMap((t) => t.paragraphs.flatMap((p) => p.runs))
    const italicRun = runs.find((r) => r.text === 'days')
    expect(italicRun?.italic).toBe(true)
    // No literal asterisks anywhere on the slide.
    expect(runs.map((r) => r.text).join('')).not.toContain('*')
  })

  it('backticks are stripped, never rendered', async () => {
    const slide = await synthesize({
      layout: 'title-body',
      pattern: 'bullets',
      heading: 'Rollout',
      bullets: ['Run `migrate --all` before the deploy'],
    })
    const body = slide.shapes[1] as TextShape
    expect(runsOf(body, 0)[0].text).toBe('Run migrate --all before the deploy')
  })

  it('the baked single-slide path (deck-add-slide) styles emphasis as well', async () => {
    const { bytes } = await synthesizeDeckFromOutline(
      { title: 'Deck', suggestedPalette: 'navy', slides: [{ layout: 'title', pattern: 'title', heading: 'Deck' }] },
      NAVY,
    )
    const base = await parsePptx(bytes)
    const part = await synthesizeSlidePart(
      base,
      { layout: 'title-body', pattern: 'bullets', heading: 'New slide', bullets: ['We are **hiring** now'] },
      base.slides[0].xmlPath,
      [],
    )
    const withSlide = await writeDeck(base, new Map(), { addSlides: [part] })
    const reparsed = await parsePptx(withSlide)
    const body = reparsed.slides[1].shapes[1] as TextShape
    expect(runsOf(body, 0)).toEqual([
      { text: 'We are ', bold: false, italic: false },
      { text: 'hiring', bold: true, italic: false },
      { text: ' now', bold: false, italic: false },
    ])
  })
})
