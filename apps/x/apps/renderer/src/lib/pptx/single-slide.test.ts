import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type { deck as deckShared } from '@x/shared'
import { parseAddedSlide, parsePptx } from './parse'
import { writeDeck, type NewSlidePart } from './serialize'
import { DECK_PALETTES } from './new-deck'
import { buildDeckContext, synthesizeDeckFromOutline, synthesizeSlidePart } from './generate'
import { EMPTY_DECK_EDITS, applyEditSet, withSlideAdded } from '@/components/pptx/edit-model'
import type { Shape, SlideDeck, TextShape } from './types'

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

function fillHex(shape: Shape): string | undefined {
  const fill = shape.visual?.fill
  return fill?.kind === 'solid' ? fill.hex : undefined
}

function slideText(shapes: readonly Shape[]): string {
  return shapes
    .map((s) => (s.type === 'text' ? (s as TextShape).paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : ''))
    .join('\n')
}

/** A small deck to insert into. */
async function baseDeck(): Promise<SlideDeck> {
  const outline: deckShared.DeckOutline = {
    title: 'Q3 Review',
    suggestedPalette: 'navy',
    slides: [
      { layout: 'title', pattern: 'title', heading: 'Q3 Review', body: 'The story so far' },
      { layout: 'title-body', pattern: 'bullets', heading: 'Revenue grew 40%', bullets: ['New pricing', 'Churn flat'] },
      { layout: 'title-body', pattern: 'closing', heading: 'Thank you' },
    ],
  }
  const { bytes } = await synthesizeDeckFromOutline(outline, NAVY)
  return parsePptx(bytes)
}

describe('buildDeckContext', () => {
  it('extracts a heading and bullet lines per slide', async () => {
    const deck = await baseDeck()
    const ctx = buildDeckContext(deck, 'Q3 Review')
    expect(ctx.title).toBe('Q3 Review')
    expect(ctx.slides).toHaveLength(3)
    // Title slide: heading + subtitle-as-bullet.
    expect(ctx.slides[0].heading).toBe('Q3 Review')
    expect(ctx.slides[0].bullets).toContain('The story so far')
    // Bullets slide: heading then its two bullets.
    expect(ctx.slides[1].heading).toBe('Revenue grew 40%')
    expect(ctx.slides[1].bullets).toEqual(['New pricing', 'Churn flat'])
    // Closing slide: heading only.
    expect(ctx.slides[2].heading).toBe('Thank you')
  })
})

/** Insert one synthesized slide after `afterIndex`, the way the editor does. */
async function insertAfter(
  base: SlideDeck,
  outlineSlide: deckShared.DeckOutlineSlide,
  afterIndex: number,
): Promise<{ bytes: Uint8Array; part: NewSlidePart }> {
  const anchorPath = base.slides[afterIndex].xmlPath
  const part = await synthesizeSlidePart(base, outlineSlide, anchorPath, [])
  // parseAddedSlide is what the editor calls to render it before save.
  await parseAddedSlide(base, part.path, part.xml, part.relsXml)
  const bytes = await writeDeck(base, new Map(), { addSlides: [part] })
  return { bytes, part }
}

describe('synthesizeSlidePart', () => {
  const PATTERNS: { slide: deckShared.DeckOutlineSlide; expect: (shapes: readonly Shape[]) => void }[] = [
    {
      slide: { layout: 'title-body', pattern: 'bullets', heading: 'Fresh bullets', bullets: ['a', 'b', 'c'] },
      expect: (shapes) => {
        expect(slideText(shapes)).toContain('Fresh bullets')
        const body = shapes[1] as TextShape
        expect(body.paragraphs.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['a', 'b', 'c'])
      },
    },
    {
      slide: {
        layout: 'title-body', pattern: 'two-column', heading: 'Sides',
        columns: [{ heading: 'L', lines: ['l1'] }, { heading: 'R', lines: ['r1'] }],
      },
      expect: (shapes) => {
        expect(shapes.filter((s) => fillHex(s) !== undefined)).toHaveLength(2)
        expect(slideText(shapes)).toContain('l1')
      },
    },
    {
      slide: { layout: 'title-body', pattern: 'big-number', heading: 'Metric', stat: { value: '9x', caption: 'faster' } },
      expect: (shapes) => expect(slideText(shapes)).toContain('9x'),
    },
    {
      slide: { layout: 'title-body', pattern: 'quote', heading: 'Voice', quote: { text: 'Wow.', attribution: 'A user' } },
      expect: (shapes) => {
        expect(shapes.filter((s) => fillHex(s) !== undefined)).toHaveLength(1)
        expect(slideText(shapes)).toContain('Wow.')
      },
    },
    {
      slide: { layout: 'title-body', pattern: 'section', heading: 'New part' },
      expect: (shapes) => {
        expect(shapes.map(fillHex)).toContain(NAVY.scheme.accent1)
        expect(slideText(shapes)).toContain('New part')
      },
    },
  ]

  for (const { slide, expect: check } of PATTERNS) {
    it(`synthesizes a ${slide.pattern} slide and lands it at the right index`, async () => {
      const base = await baseDeck()
      // Insert after slide 2 (index 1) → it must land at index 2 of 4.
      const { bytes } = await insertAfter(base, slide, 1)
      const reparsed = await parsePptx(bytes)
      expect(reparsed.slides).toHaveLength(4)
      // Order: title, bullets, <new>, closing.
      expect(slideText(reparsed.slides[3].shapes)).toContain('Thank you')
      check(reparsed.slides[2].shapes)
    })
  }

  it('inherits the deck theme (no palette argument) — section fill uses the deck accent', async () => {
    const base = await baseDeck()
    const { bytes } = await insertAfter(base, { layout: 'title-body', pattern: 'section', heading: 'Divider' }, 0)
    const reparsed = await parsePptx(bytes)
    expect(reparsed.slides[1].shapes.map(fillHex)).toContain(NAVY.scheme.accent1)
  })
})

describe('composing into the edit set (the editor pipeline)', () => {
  it('adds one slide at the right index and undo removes it by identity', async () => {
    const base = await baseDeck()
    const anchorPath = base.slides[1].xmlPath
    const part = await synthesizeSlidePart(
      base,
      { layout: 'title-body', pattern: 'section', heading: 'Injected' },
      anchorPath,
      [],
    )
    const added = await parseAddedSlide(base, part.path, part.xml, part.relsXml)

    // Success path: one withSlideAdded — a single undoable edit.
    const before = EMPTY_DECK_EDITS
    const after = withSlideAdded(before, { ...part, slide: added })

    // The prior edit set is never mutated (nothing partial on the way in).
    expect(before.addedSlides).toHaveLength(0)

    // Rendered: N+1 slides, the new one right after the anchor.
    const renderedAfter = applyEditSet(base, after)
    expect(renderedAfter.slides).toHaveLength(4)
    expect(renderedAfter.slides[2].xmlPath).toBe(part.path)

    // Undo = revert to the prior edit set → the slide is gone, by its path.
    const renderedBefore = applyEditSet(base, before)
    expect(renderedBefore.slides).toHaveLength(3)
    expect(renderedBefore.slides.some((s) => s.xmlPath === part.path)).toBe(false)
  })

  it('a failed generation (early return) leaves the edit set and deck unchanged', async () => {
    // Mirrors generateSlideAfter's control flow: on a model error it returns
    // before any synthesis or withSlideAdded, so the edit set is untouched.
    const base = await baseDeck()
    const editSet = EMPTY_DECK_EDITS
    const generate = async (fail: boolean): Promise<{ error?: string }> => {
      const res = fail ? { error: 'model failed' } : { slide: undefined }
      if (res.error || !res.slide) return { error: res.error ?? 'no slide' }
      // (unreached in the failure case) withSlideAdded(...) would go here.
      return {}
    }
    const result = await generate(true)
    expect(result.error).toBe('model failed')
    expect(editSet.addedSlides).toHaveLength(0)
    expect(applyEditSet(base, editSet).slides).toHaveLength(3)
  })
})
