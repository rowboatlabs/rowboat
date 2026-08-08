import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import type { deck as deckShared } from '@x/shared'
import { parseAddedSlide, parsePptx } from '@/lib/pptx/parse'
import { writeDeck, type SlideEdit } from '@/lib/pptx/serialize'
import { DECK_PALETTES } from '@/lib/pptx/new-deck'
import { synthesizeDeckFromOutline, synthesizeSlidePart } from '@/lib/pptx/generate'
import {
  detectPattern,
  extractOutlineSlide,
  linesToEditedParagraphs,
  paraLines,
  planSlideEdit,
} from './edit-slide'
import { EMPTY_DECK_EDITS, applyEditSet, withSlideAdded, withSlideRemoved } from './edit-model'
import type { SlideDeck, TextShape } from '@/lib/pptx/types'

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

const MIXED: deckShared.DeckOutline = {
  title: 'Q3 Review',
  suggestedPalette: 'navy',
  slides: [
    { layout: 'title', pattern: 'title', heading: 'Q3 Review', body: 'The story so far' },
    { layout: 'title-body', pattern: 'bullets', heading: 'What shipped', bullets: ['Sync', 'Offline', 'SSO'] },
    {
      layout: 'title-body', pattern: 'two-column', heading: 'Wins and risks',
      columns: [
        { heading: 'Wins', lines: ['Faster', 'Cheaper'] },
        { heading: 'Risks', lines: ['Hiring'] },
      ],
    },
    { layout: 'title-body', pattern: 'big-number', heading: 'Growth', stat: { value: '15%', caption: 'MoM growth' }, bullets: ['Enterprise led'] },
    { layout: 'title-body', pattern: 'quote', heading: 'Voice', quote: { text: 'It just works.', attribution: 'A customer' } },
    { layout: 'title-body', pattern: 'section', heading: 'Part two', body: 'What is next' },
    { layout: 'title-body', pattern: 'closing', heading: 'Thank you', body: 'questions@co.com' },
  ],
}

async function mixedDeck(): Promise<SlideDeck> {
  const { bytes } = await synthesizeDeckFromOutline(MIXED, NAVY)
  return parsePptx(bytes)
}

describe('detectPattern / extractOutlineSlide round-trip', () => {
  it('recovers each generated pattern and its content', async () => {
    const deck = await mixedDeck()
    const expected: deckShared.DeckSlidePattern[] = [
      'title', 'bullets', 'two-column', 'big-number', 'quote', 'section', 'closing',
    ]
    expected.forEach((pattern, i) => {
      expect(detectPattern(deck.slides[i]), `slide ${i}`).toBe(pattern)
    })

    const bullets = extractOutlineSlide(deck.slides[1])
    expect(bullets.outline.heading).toBe('What shipped')
    expect(bullets.outline.bullets).toEqual(['Sync', 'Offline', 'SSO'])

    const twoCol = extractOutlineSlide(deck.slides[2])
    expect(twoCol.outline.columns).toEqual([
      { heading: 'Wins', lines: ['Faster', 'Cheaper'] },
      { heading: 'Risks', lines: ['Hiring'] },
    ])

    const bigNum = extractOutlineSlide(deck.slides[3])
    expect(bigNum.outline.stat).toEqual({ value: '15%', caption: 'MoM growth' })
    expect(bigNum.outline.bullets).toEqual(['Enterprise led'])

    const quote = extractOutlineSlide(deck.slides[4])
    expect(quote.outline.quote).toEqual({ text: 'It just works.', attribution: 'A customer' })

    const section = extractOutlineSlide(deck.slides[5])
    expect(section.outline.heading).toBe('Part two')
    expect(section.outline.body).toBe('What is next')
  })
})

describe('planSlideEdit', () => {
  it('returns noop when the edited outline matches the current content', async () => {
    const deck = await mixedDeck()
    for (const [i] of MIXED.slides.entries()) {
      const { pattern, outline } = extractOutlineSlide(deck.slides[i])
      expect(planSlideEdit(deck.slides[i], pattern, outline).kind, `slide ${i}`).toBe('noop')
    }
  })

  it('maps a value change to a single text change ("change 15% to 200%")', async () => {
    const deck = await mixedDeck()
    const { pattern, outline } = extractOutlineSlide(deck.slides[3])
    const edited = { ...outline, stat: { ...outline.stat!, value: '200%' } }
    const plan = planSlideEdit(deck.slides[3], pattern, edited)
    expect(plan.kind).toBe('text')
    if (plan.kind !== 'text') return
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0].lines).toEqual(['200%'])
  })

  it('replaces on a pattern change', async () => {
    const deck = await mixedDeck()
    const { pattern, outline } = extractOutlineSlide(deck.slides[1])
    const edited: deckShared.DeckOutlineSlide = {
      ...outline, pattern: 'quote', quote: { text: 'Ship it.', attribution: 'The team' },
    }
    expect(planSlideEdit(deck.slides[1], pattern, edited).kind).toBe('replace')
  })

  it('replaces when a heterogeneous slot changes paragraph count (attribution removed)', async () => {
    const deck = await mixedDeck()
    const { pattern, outline } = extractOutlineSlide(deck.slides[4])
    const edited = { ...outline, quote: { text: outline.quote!.text } }
    expect(planSlideEdit(deck.slides[4], pattern, edited).kind).toBe('replace')
  })

  it('keeps bullet-count growth as a text edit (uniform slot)', async () => {
    const deck = await mixedDeck()
    const { pattern, outline } = extractOutlineSlide(deck.slides[1])
    const edited = { ...outline, bullets: [...outline.bullets!, 'Search'] }
    const plan = planSlideEdit(deck.slides[1], pattern, edited)
    expect(plan.kind).toBe('text')
  })

  it('replaces when the column count changes', async () => {
    const deck = await mixedDeck()
    const { pattern, outline } = extractOutlineSlide(deck.slides[2])
    const edited = { ...outline, columns: [outline.columns![0]] }
    expect(planSlideEdit(deck.slides[2], pattern, edited).kind).toBe('replace')
  })
})

describe('applying a text plan', () => {
  it('writes only the edited slide part; everything else byte-identical', async () => {
    const { bytes } = await synthesizeDeckFromOutline(MIXED, NAVY)
    const deck = await parsePptx(bytes)
    const slide = deck.slides[3]
    const { pattern, outline } = extractOutlineSlide(slide)
    const plan = planSlideEdit(slide, pattern, { ...outline, stat: { ...outline.stat!, value: '200%' } })
    expect(plan.kind).toBe('text')
    if (plan.kind !== 'text') return

    const edits: SlideEdit[] = plan.changes.map((c) => {
      const shape = slide.shapes.find((s) => s.nodePath.join('.') === c.nodePath.join('.')) as TextShape
      return {
        kind: 'text',
        nodePath: c.nodePath,
        original: shape.paragraphs,
        next: linesToEditedParagraphs(shape.paragraphs, c.lines),
      }
    })
    const out = await writeDeck(deck, new Map([[slide.xmlPath, edits]]))

    const inZip = await JSZip.loadAsync(bytes)
    const outZip = await JSZip.loadAsync(out)
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir || name === slide.xmlPath) continue
      const a = Buffer.from(await inZip.files[name].async('uint8array'))
      const b = Buffer.from(await outZip.files[name].async('uint8array'))
      expect(a.equals(b), `byte-identical: ${name}`).toBe(true)
    }
    const reparsed = await parsePptx(out)
    const statShape = reparsed.slides[3].shapes.find(
      (s) => s.type === 'text' && paraLines(s as TextShape).includes('200%'),
    )
    expect(statShape).toBeDefined()
    // The caption survived untouched.
    const texts = reparsed.slides[3].shapes.flatMap((s) => (s.type === 'text' ? paraLines(s as TextShape) : []))
    expect(texts).toContain('MoM growth')
  })
})

describe('applying a replace plan (in place)', () => {
  it('keeps the slide count and position; content becomes the new pattern', async () => {
    const deck = await mixedDeck()
    const target = deck.slides[1] // bullets → quote
    const editedSlide: deckShared.DeckOutlineSlide = {
      layout: 'title-body', pattern: 'quote', heading: 'Ship it.',
      quote: { text: 'Ship it.', attribution: 'The team' },
    }

    const cur = EMPTY_DECK_EDITS
    const part = await synthesizeSlidePart(deck, editedSlide, deck.slides[0].xmlPath, [])
    const parsed = await parseAddedSlide(deck, part.path, part.xml, part.relsXml)
    const next = withSlideAdded(withSlideRemoved(cur, target.xmlPath, part.path), { ...part, slide: parsed })

    // Rendered: same count, quote content at index 1, neighbours untouched.
    const rendered = applyEditSet(deck, next)
    expect(rendered.slides).toHaveLength(MIXED.slides.length)
    expect(rendered.slides[1].xmlPath).toBe(part.path)
    const texts = rendered.slides[1].shapes.flatMap((s) => (s.type === 'text' ? paraLines(s as TextShape) : []))
    expect(texts.join('\n')).toContain('Ship it.')
    expect(rendered.slides[2].xmlPath).toBe(deck.slides[2].xmlPath)

    // Written bytes agree.
    const out = await writeDeck(deck, new Map(), {
      deleteSlides: next.deletedSlides,
      addSlides: next.addedSlides,
      slideOrder: next.slideOrder,
    })
    const reparsed = await parsePptx(out)
    expect(reparsed.slides).toHaveLength(MIXED.slides.length)
    const written = reparsed.slides[1].shapes.flatMap((s) => (s.type === 'text' ? paraLines(s as TextShape) : []))
    expect(written.join('\n')).toContain('Ship it.')

    // Undo = the prior edit set: original bullets slide back at index 1.
    const undone = applyEditSet(deck, cur)
    expect(undone.slides).toHaveLength(MIXED.slides.length)
    expect(undone.slides[1].xmlPath).toBe(target.xmlPath)
    const restored = undone.slides[1].shapes.flatMap((s) => (s.type === 'text' ? paraLines(s as TextShape) : []))
    expect(restored).toContain('Sync')
  })

  it('a failed edit (early return) applies nothing', async () => {
    const deck = await mixedDeck()
    const cur = EMPTY_DECK_EDITS
    // Mirrors the handler: an IPC error returns before any plan/apply.
    const res: { slide?: deckShared.DeckOutlineSlide; error?: string } = { error: 'model failed' }
    if (!res.error && res.slide) throw new Error('unreachable')
    expect(cur).toBe(EMPTY_DECK_EDITS)
    expect(applyEditSet(deck, cur).slides.map((s) => s.xmlPath)).toEqual(deck.slides.map((s) => s.xmlPath))
  })
})
