import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type * as deckShared from '../deck.js'
import { parsePptx } from './parse.js'
import { DECK_PALETTES, BODY_LAYOUT_RECTS, TITLE_LAYOUT_RECTS } from './new-deck.js'
import { synthesizeDeckFromOutline } from './generate.js'
import type { Shape, TextShape } from './types.js'

const NAVY = DECK_PALETTES[0]

/** The solid fill hex a shape resolves to, or undefined for none/unfilled. */
function fillHex(shape: Shape): string | undefined {
  const fill = shape.visual?.fill
  return fill?.kind === 'solid' ? fill.hex : undefined
}

/** All run text across a slide's shapes, concatenated (for presence checks). */
function slideText(shapes: readonly Shape[]): string {
  return shapes
    .map((s) => (s.type === 'text' ? (s as TextShape).paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : ''))
    .join('\n')
}

/** A one-slide-per-pattern outline: title opener + the pattern under test. */
async function renderPattern(slide: deckShared.DeckOutlineSlide) {
  const outline: deckShared.DeckOutline = {
    title: 'Deck',
    suggestedPalette: 'navy',
    slides: [{ layout: 'title', pattern: 'title', heading: 'Deck' }, slide],
  }
  const { bytes } = await synthesizeDeckFromOutline(outline, NAVY)
  const deck = await parsePptx(bytes)
  return deck.slides[1]
}

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

describe('slide patterns', () => {
  it('two-column: heading textbox + two accent-tinted cards, each with its text', async () => {
    const slide = await renderPattern({
      layout: 'title-body',
      pattern: 'two-column',
      heading: 'Wins and risks',
      columns: [
        { heading: 'Wins', lines: ['40% faster', 'Churn flat'] },
        { heading: 'Risks', lines: ['Hiring', 'Infra cost'] },
      ],
    })
    // heading + 2 card backgrounds + 2 card text boxes.
    expect(slide.shapes).toHaveLength(5)
    // The two card backgrounds are solid-filled (accent tints); text boxes are not.
    const filled = slide.shapes.filter((s) => fillHex(s) !== undefined)
    expect(filled).toHaveLength(2)
    const text = slideText(slide.shapes)
    for (const t of ['Wins and risks', 'Wins', '40% faster', 'Risks', 'Infra cost']) {
      expect(text).toContain(t)
    }
  })

  it('big-number: the stat value and caption render, unfilled', async () => {
    const slide = await renderPattern({
      layout: 'title-body',
      pattern: 'big-number',
      heading: 'Growth',
      stat: { value: '312%', caption: 'YoY revenue growth' },
      bullets: ['Driven by enterprise'],
    })
    // eyebrow + stat + caption + support.
    expect(slide.shapes).toHaveLength(4)
    expect(slide.shapes.every((s) => fillHex(s) === undefined)).toBe(true)
    const text = slideText(slide.shapes)
    expect(text).toContain('312%')
    expect(text).toContain('YoY revenue growth')
    expect(text).toContain('Driven by enterprise')
  })

  it('quote: a tinted panel behind a centered quote and attribution', async () => {
    const slide = await renderPattern({
      layout: 'title-body',
      pattern: 'quote',
      heading: 'Voice of the customer',
      quote: { text: 'This changed how our team ships.', attribution: 'VP Eng, Acme' },
    })
    // panel + quote textbox.
    expect(slide.shapes).toHaveLength(2)
    expect(slide.shapes.filter((s) => fillHex(s) !== undefined)).toHaveLength(1)
    const text = slideText(slide.shapes)
    expect(text).toContain('This changed how our team ships.')
    expect(text).toContain('VP Eng, Acme')
  })

  it('section: full-bleed accent1 background, accent2 underline, light heading', async () => {
    const slide = await renderPattern({
      layout: 'title-body',
      pattern: 'section',
      heading: 'Where we are',
      body: 'The story so far',
    })
    // background + underline + heading.
    expect(slide.shapes).toHaveLength(3)
    const fills = slide.shapes.map(fillHex).filter(Boolean)
    // Background resolves to accent1 exactly; the bar to accent2 exactly.
    expect(fills).toContain(NAVY.scheme.accent1)
    expect(fills).toContain(NAVY.scheme.accent2)
    expect(slideText(slide.shapes)).toContain('Where we are')
  })

  it('closing: an accent1 bar, heading and a line', async () => {
    const slide = await renderPattern({
      layout: 'title-body',
      pattern: 'closing',
      heading: 'Thank you',
      body: 'Questions? hi@co.com',
    })
    // bar + heading + line.
    expect(slide.shapes).toHaveLength(3)
    expect(slide.shapes.map(fillHex)).toContain(NAVY.scheme.accent1)
    const text = slideText(slide.shapes)
    expect(text).toContain('Thank you')
    expect(text).toContain('Questions? hi@co.com')
  })

  it('title (non-first): a centered heading and an accent bar', async () => {
    const slide = await renderPattern({
      layout: 'title',
      pattern: 'title',
      heading: 'Part Two',
      body: 'The sequel',
    })
    expect(slide.shapes).toHaveLength(2)
    expect(slide.shapes.map(fillHex)).toContain(NAVY.scheme.accent1)
    expect(slideText(slide.shapes)).toContain('Part Two')
  })

  it('bullets: caps at six paragraphs in the body placeholder (the schema cap)', async () => {
    const slide = await renderPattern({
      layout: 'title-body',
      pattern: 'bullets',
      heading: 'Seven things',
      bullets: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    })
    const body = slide.shapes[1] as TextShape
    expect(body.paragraphs.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('composes a mixed-pattern deck in one writeDeck', async () => {
    const outline: deckShared.DeckOutline = {
      title: 'Everything',
      suggestedPalette: 'navy',
      slides: [
        { layout: 'title', pattern: 'title', heading: 'Everything', body: 'A tour' },
        { layout: 'title-body', pattern: 'section', heading: 'Part one' },
        { layout: 'title-body', pattern: 'bullets', heading: 'Facts', bullets: ['x', 'y'] },
        { layout: 'title-body', pattern: 'two-column', heading: 'Sides', columns: [
          { heading: 'L', lines: ['l1'] }, { heading: 'R', lines: ['r1'] },
        ] },
        { layout: 'title-body', pattern: 'big-number', heading: 'Metric', stat: { value: '9x', caption: 'faster' } },
        { layout: 'title-body', pattern: 'quote', heading: 'Voice', quote: { text: 'Wow.', attribution: 'A user' } },
        { layout: 'title-body', pattern: 'closing', heading: 'Fin' },
      ],
    }
    const { bytes, slideCount } = await synthesizeDeckFromOutline(outline, NAVY)
    expect(slideCount).toBe(7)
    const deck = await parsePptx(bytes)
    expect(deck.slides).toHaveLength(7)
    // Spot-check that distinctive patterns landed in order.
    expect(slideText(deck.slides[1].shapes)).toContain('Part one')
    expect(slideText(deck.slides[4].shapes)).toContain('9x')
    expect(slideText(deck.slides[5].shapes)).toContain('Wow.')
    expect(slideText(deck.slides[6].shapes)).toContain('Fin')
  })

  it('midnight (dark theme) resolves inverted bg/text end to end', async () => {
    const midnight = DECK_PALETTES.find((p) => p.id === 'midnight')!
    const outline: deckShared.DeckOutline = {
      title: 'Dark deck',
      suggestedPalette: 'midnight',
      slides: [
        { layout: 'title', pattern: 'title', heading: 'Dark deck' },
        { layout: 'title-body', pattern: 'section', heading: 'A section' },
        {
          layout: 'title-body', pattern: 'two-column', heading: 'Cards',
          columns: [{ heading: 'L', lines: ['l1'] }, { heading: 'R', lines: ['r1'] }],
        },
      ],
    }
    const { bytes } = await synthesizeDeckFromOutline(outline, midnight)
    const deck = await parsePptx(bytes)

    // bg1 → lt1: the slide background is the near-black, via the master chain.
    expect(deck.slides[0].background).toMatchObject({ kind: 'solid', hex: midnight.scheme.lt1 })
    // tx1 → dk1: title text resolves to the near-white.
    const title = deck.slides[0].shapes[0] as TextShape
    expect(title.display?.paragraphs[0]?.runs[0]?.colorHex).toBe(midnight.scheme.dk1)

    // Section: luminous accent1 backdrop, bg1-coloured (near-black) heading.
    const sectionFills = deck.slides[1].shapes.map((s) => (s.visual?.fill?.kind === 'solid' ? s.visual.fill.hex : undefined))
    expect(sectionFills).toContain(midnight.scheme.accent1)
    const sectionHeading = deck.slides[1].shapes.find((s) => s.type === 'text') as TextShape
    expect(sectionHeading.display?.paragraphs[0]?.runs[0]?.colorHex).toBe(midnight.scheme.lt1)

    // Cards: the accent GLAZE (alpha), never a lightened near-white fill —
    // the fix midnight forced. Text on cards stays tx1 (near-white).
    const card = deck.slides[2].shapes.find(
      (s) => s.visual?.fill?.kind === 'solid' && s.visual.fill.hex === midnight.scheme.accent1,
    )
    expect(card, 'card background carries the accent token').toBeDefined()
    expect(card!.visual!.fill).toMatchObject({ kind: 'solid', alpha: 0.16 })
  })

  it('renders bracketed placeholders verbatim — impossible to mistake for real data', async () => {
    const slide = await renderPattern({
      layout: 'title-body',
      pattern: 'big-number',
      heading: 'Traction',
      stat: { value: '[X]%', caption: '[metric] month-over-month' },
      needsInput: ['MoM growth %'],
    })
    const text = slideText(slide.shapes)
    expect(text).toContain('[X]%')
    expect(text).toContain('[metric] month-over-month')
  })

  it('falls back to bullets for a missing or unknown pattern', async () => {
    // Missing pattern on a title-body slide → bullets placeholders.
    const missing = await renderPattern({ layout: 'title-body', heading: 'No pattern', bullets: ['one', 'two'] })
    expect((missing.shapes[1] as TextShape).paragraphs.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['one', 'two'])

    // A future/unknown pattern value → also bullets (forward compatibility).
    const unknown = await renderPattern({
      layout: 'title-body',
      pattern: 'timeline' as deckShared.DeckSlidePattern,
      heading: 'Future',
      bullets: ['later'],
    })
    expect(slideText(unknown.shapes)).toContain('Future')
    expect(slideText(unknown.shapes)).toContain('later')
  })
})
