import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import type { deck as deckShared } from '@x/shared'
import { parsePptx } from '@x/shared/dist/pptx/parse.js'
import { DECK_PALETTES } from '@x/shared/dist/pptx/new-deck.js'
import { synthesizeDeckFromOutline } from '@x/shared/dist/pptx/generate.js'
import { disposeOutlinePreview, synthesizeOutlineDeck } from './preview'
import type { Shape, SlideDeck, TextShape } from '@x/shared/dist/pptx/types.js'

const NAVY = DECK_PALETTES[0]
const WARM = DECK_PALETTES[1]

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

function fillHex(shape: Shape): string | undefined {
  const fill = shape.visual?.fill
  return fill?.kind === 'solid' ? fill.hex : undefined
}

function slideTexts(slide: { shapes: readonly Shape[] }): string[] {
  return slide.shapes.flatMap((s) =>
    s.type === 'text' ? (s as TextShape).paragraphs.map((p) => p.runs.map((r) => r.text).join('')) : [],
  )
}

const OUTLINE: deckShared.DeckOutline = {
  title: 'Preview Deck',
  suggestedPalette: 'navy',
  slides: [
    { layout: 'title', pattern: 'title', heading: 'Preview Deck', body: 'Subtitle' },
    { layout: 'title-body', pattern: 'bullets', heading: 'Facts', bullets: ['a', 'b', 'c'] },
    {
      layout: 'title-body', pattern: 'two-column', heading: 'Compare',
      columns: [{ heading: 'L', lines: ['l1'] }, { heading: 'R', lines: ['r1'] }],
    },
    { layout: 'title-body', pattern: 'big-number', heading: 'Metric', stat: { value: '9x', caption: 'faster' } },
    { layout: 'title-body', pattern: 'section', heading: 'Part two' },
    { layout: 'title-body', pattern: 'closing', heading: 'Thanks' },
  ],
}

describe('synthesizeOutlineDeck', () => {
  it('renders one slide per outline entry with the right headings and shape counts', async () => {
    const preview = await synthesizeOutlineDeck(OUTLINE, NAVY)
    expect(preview.deck).not.toBeNull()
    expect(preview.slides).toHaveLength(6)
    expect(preview.slides.every((s) => s !== null)).toBe(true)

    // Headings land per slide.
    expect(slideTexts(preview.slides[0]!)).toContain('Preview Deck')
    expect(slideTexts(preview.slides[1]!)).toContain('Facts')
    expect(slideTexts(preview.slides[1]!)).toEqual(expect.arrayContaining(['a', 'b', 'c']))

    // Pattern shape-counts match the synthesizer's shapes.
    expect(preview.slides[2]!.shapes).toHaveLength(5) // two-column: heading + 2 bg + 2 text
    expect(preview.slides[3]!.shapes).toHaveLength(3) // big-number: eyebrow + stat + caption
    expect(preview.slides[4]!.shapes).toHaveLength(3) // section: bg + bar + heading
    // Section background resolves to the palette accent.
    expect(preview.slides[4]!.shapes.map(fillHex)).toContain(NAVY.scheme.accent1)
  })

  it('re-resolves fills when the palette switches (including a new palette)', async () => {
    const ocean = DECK_PALETTES.find((p) => p.id === 'ocean')!
    const navy = await synthesizeOutlineDeck(OUTLINE, NAVY)
    const warm = await synthesizeOutlineDeck(OUTLINE, WARM)
    const cool = await synthesizeOutlineDeck(OUTLINE, ocean)
    expect(navy.slides[4]!.shapes.map(fillHex)).toContain(NAVY.scheme.accent1)
    expect(warm.slides[4]!.shapes.map(fillHex)).toContain(WARM.scheme.accent1)
    expect(cool.slides[4]!.shapes.map(fillHex)).toContain(ocean.scheme.accent1)
    expect(new Set([NAVY.scheme.accent1, WARM.scheme.accent1, ocean.scheme.accent1]).size).toBe(3)
  })

  it('is by construction what Create writes: preview equals the re-parsed bytes', async () => {
    const preview = await synthesizeOutlineDeck(OUTLINE, NAVY)
    const { bytes } = await synthesizeDeckFromOutline(OUTLINE, NAVY)
    const written = await parsePptx(bytes)

    expect(preview.deck!.slides).toHaveLength(written.slides.length)
    for (let i = 0; i < written.slides.length; i++) {
      const p = preview.deck!.slides[i]
      const w = written.slides[i]
      expect(p.shapes.length, `slide ${i} shape count`).toBe(w.shapes.length)
      for (let j = 0; j < w.shapes.length; j++) {
        expect(p.shapes[j].type, `slide ${i} shape ${j} type`).toBe(w.shapes[j].type)
        expect(p.shapes[j].xfrmEmu, `slide ${i} shape ${j} rect`).toEqual(w.shapes[j].xfrmEmu)
      }
      expect(slideTexts(p), `slide ${i} texts`).toEqual(slideTexts(w))
    }
  })

  it('isolates a slide whose payload breaks synthesis; the rest still preview', async () => {
    const broken: deckShared.DeckOutline = {
      ...OUTLINE,
      slides: [
        OUTLINE.slides[0],
        OUTLINE.slides[1],
        // A payload that throws inside the author (heading is not a string).
        { layout: 'title-body', pattern: 'section', heading: null as unknown as string },
        OUTLINE.slides[5],
      ],
    }
    const preview = await synthesizeOutlineDeck(broken, NAVY)
    expect(preview.deck).not.toBeNull()
    expect(preview.slides).toHaveLength(4)
    expect(preview.slides[2]).toBeNull()
    expect(preview.slides[0]).not.toBeNull()
    expect(preview.slides[1]).not.toBeNull()
    expect(preview.slides[3]).not.toBeNull()
    expect(slideTexts(preview.slides[3]!)).toContain('Thanks')
  })

  it('disposal revokes the preview deck blob URLs', () => {
    const revoke = vi.fn()
    URL.revokeObjectURL = revoke as typeof URL.revokeObjectURL
    try {
      // A minimal deck carrying one image shape; disposeOutlinePreview must
      // revoke its blob URL (outline decks are text-only today, but the
      // dispose contract is what the dialog's replace flow relies on).
      const deck = {
        slideSizeEmu: { w: 1, h: 1 },
        slides: [
          {
            id: 's', xmlPath: 'ppt/slides/slide1.xml', spTreePath: [0, 0, 0],
            shapes: [
              { type: 'image', id: '2', slideXmlPath: 'ppt/slides/slide1.xml', nodePath: [0, 0, 0, 2], xfrmEmu: { x: 0, y: 0, w: 1, h: 1 }, blobUrl: 'blob:preview/1' },
            ],
          },
        ],
        source: { zip: {}, slideXml: {} },
      } as unknown as SlideDeck
      disposeOutlinePreview({ deck, slides: [] })
      expect(revoke).toHaveBeenCalledWith('blob:preview/1')
      disposeOutlinePreview(null) // tolerates empty
    } finally {
      URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
    }
  })

  it('rebuild cost for a 12-slide outline', async () => {
    const twelve: deckShared.DeckOutline = {
      title: 'Big deck',
      suggestedPalette: 'navy',
      slides: [
        { layout: 'title', pattern: 'title', heading: 'Big deck' },
        ...Array.from({ length: 10 }, (_, i): deckShared.DeckOutlineSlide => {
          const patterns: deckShared.DeckSlidePattern[] = ['bullets', 'two-column', 'big-number', 'quote', 'section']
          const pattern = patterns[i % patterns.length]
          return {
            layout: 'title-body',
            pattern,
            heading: `Slide ${i + 2}`,
            bullets: ['one', 'two', 'three'],
            columns: [{ heading: 'L', lines: ['l'] }, { heading: 'R', lines: ['r'] }],
            stat: { value: '9x', caption: 'faster' },
            quote: { text: 'Quote.', attribution: 'Someone' },
          }
        }),
        { layout: 'title-body', pattern: 'closing', heading: 'Fin' },
      ],
    }
    // Warm-up, then measure.
    await synthesizeOutlineDeck(twelve, NAVY)
    const t0 = performance.now()
    const preview = await synthesizeOutlineDeck(twelve, NAVY)
    const ms = performance.now() - t0
    expect(preview.slides).toHaveLength(12)
    expect(preview.slides.every((s) => s !== null)).toBe(true)
    // eslint-disable-next-line no-console -- the measurement the task asks for
    console.log(`[preview] 12-slide rebuild: ${ms.toFixed(1)}ms`)
    expect(ms).toBeLessThan(2000)
  })
})
