import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type { deck as deckShared } from '@x/shared'
import { parsePptx } from './parse'
import { DECK_PALETTES, BODY_LAYOUT_RECTS, TITLE_LAYOUT_RECTS } from './new-deck'
import { synthesizeDeckFromOutline } from './generate'
import type { TextShape } from './types'

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

const OUTLINE: deckShared.DeckOutline = {
  title: 'Q3 Business Review',
  suggestedPalette: 'navy',
  slides: [
    { layout: 'title', heading: 'Q3 Business Review', body: 'How we grew and what is next' },
    {
      layout: 'title-body',
      heading: 'Revenue grew 40% quarter over quarter',
      bullets: ['New pricing tier landed', 'Enterprise pipeline doubled', 'Churn held flat'],
    },
    {
      layout: 'title-body',
      heading: 'The team shipped three flagship features',
      bullets: ['Realtime sync', 'Offline mode', 'SSO'],
      speakerNotes: 'Call out the sync milestone specifically.',
    },
    { layout: 'title-body', heading: 'Next quarter: double down on onboarding' },
  ],
}

/** Flatten a text shape's paragraph run text into one string per paragraph. */
function paraTexts(shape: TextShape): string[] {
  return shape.paragraphs.map((p) => p.runs.map((r) => r.text).join(''))
}

describe('synthesizeDeckFromOutline', () => {
  it('produces one slide per outline entry with the right headings and bullets', async () => {
    const { bytes, slideCount, droppedSpeakerNotes } = await synthesizeDeckFromOutline(OUTLINE, NAVY)
    expect(slideCount).toBe(4)
    expect(droppedSpeakerNotes).toBe(true)

    const deck = await parsePptx(bytes)
    expect(deck.slides).toHaveLength(4)

    // Slide 1 — reused title slide: heading in ctrTitle, subtitle from body.
    const s1 = deck.slides[0].shapes as TextShape[]
    expect(paraTexts(s1[0])).toEqual(['Q3 Business Review'])
    expect(s1[0].xfrmEmu).toEqual(TITLE_LAYOUT_RECTS.ctrTitle)
    expect(paraTexts(s1[1])).toEqual(['How we grew and what is next'])
    expect(s1[1].xfrmEmu).toEqual(TITLE_LAYOUT_RECTS.subTitle)

    // Slide 2 — title+body: heading in title, one paragraph per bullet.
    const s2 = deck.slides[1].shapes as TextShape[]
    expect(paraTexts(s2[0])).toEqual(['Revenue grew 40% quarter over quarter'])
    expect(s2[0].xfrmEmu).toEqual(BODY_LAYOUT_RECTS.title)
    expect(paraTexts(s2[1])).toEqual([
      'New pricing tier landed',
      'Enterprise pipeline doubled',
      'Churn held flat',
    ])
    expect(s2[1].xfrmEmu).toEqual(BODY_LAYOUT_RECTS.body)

    // Slide 3 — bullets present, speakerNotes silently dropped.
    const s3 = deck.slides[2].shapes as TextShape[]
    expect(paraTexts(s3[1])).toEqual(['Realtime sync', 'Offline mode', 'SSO'])
    // No speaker-notes part is emitted (dropped for now).
    const zipNames = Object.keys((deck.source.zip as { files: Record<string, unknown> }).files)
    expect(zipNames.some((n) => n.includes('notesSlide'))).toBe(false)

    // Slide 4 — heading only; body placeholder stays empty.
    const s4 = deck.slides[3].shapes as TextShape[]
    expect(paraTexts(s4[0])).toEqual(['Next quarter: double down on onboarding'])
    expect(s4[1].paragraphs.every((p) => p.runs.length === 0)).toBe(true)
  })

  it('applies the chosen palette to the generated theme', async () => {
    const warm = DECK_PALETTES[1]
    const { bytes } = await synthesizeDeckFromOutline(OUTLINE, warm)
    const zip = await (await import('jszip')).default.loadAsync(bytes)
    const theme = await zip.files['ppt/theme/theme1.xml'].async('string')
    expect(theme).toContain(`val="${warm.scheme.accent1}"`)
  })

  it('reports no dropped notes when the outline carries none', async () => {
    const clean: deckShared.DeckOutline = {
      title: 'T',
      suggestedPalette: 'mono',
      slides: [
        { layout: 'title', heading: 'T' },
        { layout: 'title-body', heading: 'One', bullets: ['a'] },
      ],
    }
    const { droppedSpeakerNotes, slideCount } = await synthesizeDeckFromOutline(clean, DECK_PALETTES[2])
    expect(slideCount).toBe(2)
    expect(droppedSpeakerNotes).toBe(false)
  })

  it('throws (writing nothing) when the outline has no slides', async () => {
    const empty = { title: 'T', suggestedPalette: 'navy', slides: [] } as unknown as deckShared.DeckOutline
    await expect(synthesizeDeckFromOutline(empty, NAVY)).rejects.toThrow(/no slides/)
  })
})
