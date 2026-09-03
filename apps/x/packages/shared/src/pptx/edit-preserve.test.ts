import JSZip from 'jszip'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type * as deckShared from '../deck.js'
import { parsePptx } from './parse.js'
import { DECK_PALETTES } from './new-deck.js'
import { synthesizeDeckFromOutline } from './generate.js'
import { detectPattern, extractOutlineSlide, linesToEditedParagraphs, planSlideEdit } from './edit-slide.js'
import { writeDeck, type SlideEdit } from './serialize.js'
import type { SlideDeck, TextShape } from './types.js'

// FIX for deck-edit-slide wiping hand-applied formatting: the apply is
// PARAGRAPH-DIFFED. Within an edited shape, a paragraph whose text the model
// returned verbatim keeps its original runs byte-for-byte — a phrase the user
// bolded in the editor survives the assistant rewording a different bullet.
// These tests drive the exact pipeline the tool runs (detectPattern →
// planSlideEdit → linesToEditedParagraphs → writeDeck) and compare RAW SLIDE
// XML across the write.

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
  title: 'Board Update',
  suggestedPalette: 'navy',
  slides: [
    { layout: 'title', pattern: 'title', heading: 'Board Update' },
    {
      layout: 'title-body',
      pattern: 'bullets',
      heading: 'Where we are',
      bullets: ['Shipped beta', 'We grew 2x YoY', 'Churn held flat'],
    },
  ],
}

/**
 * A deck whose slide 2 has a HAND-BOLDED phrase: paragraph 2 of the body is
 * split into three runs with "2x" bold, committed the way the editor's
 * selection-bold does (a ShapeTextEdit whose untouched runs keep provenance).
 */
async function deckWithHandBold(): Promise<Uint8Array> {
  const { bytes } = await synthesizeDeckFromOutline(OUTLINE, NAVY)
  const parsed = await parsePptx(bytes)
  const body = parsed.slides[1].shapes[1] as TextShape
  const keep = (i: number) => ({
    align: body.paragraphs[i].align,
    srcPara: i,
    runs: body.paragraphs[i].runs.map((r, j) => ({ ...r, srcPara: i, srcRun: j })),
  })
  const edit: SlideEdit = {
    kind: 'text',
    nodePath: body.nodePath,
    original: body.paragraphs,
    next: [
      keep(0),
      {
        align: body.paragraphs[1].align,
        srcPara: 1,
        runs: [
          { text: 'We grew ', srcPara: 1, srcRun: 0 },
          { text: '2x', srcPara: 1, bold: true },
          { text: ' YoY', srcPara: 1, srcRun: 0 },
        ],
      },
      keep(2),
    ],
  }
  return writeDeck(parsed, new Map([[parsed.slides[1].xmlPath, [edit]]]))
}

/** Raw XML of one slide part. */
async function slideXml(bytes: Uint8Array, xmlPath: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file(xmlPath)
  if (!file) throw new Error(`missing part: ${xmlPath}`)
  return file.async('string')
}

/** The `<a:p>…</a:p>` block containing `needle`. */
function paragraphBlock(xml: string, needle: string): string {
  const at = xml.indexOf(needle)
  if (at === -1) throw new Error(`needle not found: ${needle}`)
  const start = xml.lastIndexOf('<a:p>', at)
  const end = xml.indexOf('</a:p>', at)
  if (start === -1 || end === -1) throw new Error('needle is not inside a paragraph')
  return xml.slice(start, end + '</a:p>'.length)
}

/** The `<p:sp>…</p:sp>` block containing `needle`. */
function shapeBlock(xml: string, needle: string): string {
  const at = xml.indexOf(needle)
  if (at === -1) throw new Error(`needle not found: ${needle}`)
  const start = xml.lastIndexOf('<p:sp>', at)
  const end = xml.indexOf('</p:sp>', at)
  return xml.slice(start, end + '</p:sp>'.length)
}

/** Exactly what deck-edit-slide's text path does for one edited outline. */
async function applyToolEdit(parsed: SlideDeck, slideIndex: number, edited: deckShared.DeckOutlineSlide): Promise<Uint8Array> {
  const target = parsed.slides[slideIndex]
  const plan = planSlideEdit(target, detectPattern(target), edited)
  if (plan.kind !== 'text') throw new Error(`expected a text plan, got ${plan.kind}`)
  const edits: SlideEdit[] = plan.changes.map((change) => {
    const shape = target.shapes.find(
      (s): s is TextShape => s.type === 'text' && JSON.stringify(s.nodePath) === JSON.stringify(change.nodePath),
    )
    if (!shape) throw new Error('planned edit targets an unknown shape')
    return { kind: 'text', nodePath: change.nodePath, original: shape.paragraphs, next: linesToEditedParagraphs(shape.paragraphs, change.lines) }
  })
  return writeDeck(parsed, new Map([[target.xmlPath, edits]]))
}

describe('deck-edit-slide preserves hand-applied formatting', () => {
  it('editing paragraph 1 leaves the hand-bolded paragraph 2 byte-identical', async () => {
    const bytes = await deckWithHandBold()
    const parsed = await parsePptx(bytes)
    const slidePath = parsed.slides[1].xmlPath
    const before = await slideXml(bytes, slidePath)
    // Sanity: the hand-bold really is in the bytes.
    expect(paragraphBlock(before, '2x')).toContain('b="1"')

    const { outline } = extractOutlineSlide(parsed.slides[1])
    const after = await applyToolEdit(parsed, 1, {
      ...outline,
      bullets: ['Shipped GA', 'We grew 2x YoY', 'Churn held flat'],
    })

    const afterXml = await slideXml(after, slidePath)
    // The changed bullet changed…
    expect(afterXml).toContain('Shipped GA')
    expect(afterXml).not.toContain('Shipped beta')
    // …and the bolded paragraph's bytes are IDENTICAL, not merely equivalent.
    expect(paragraphBlock(afterXml, '2x')).toBe(paragraphBlock(before, '2x'))

    // The re-parsed deck still shows three runs with the bold middle.
    const reparsed = await parsePptx(after)
    const body = reparsed.slides[1].shapes[1] as TextShape
    expect(body.paragraphs[1].runs.map((r) => ({ text: r.text, bold: Boolean(r.bold) }))).toEqual([
      { text: 'We grew ', bold: false },
      { text: '2x', bold: true },
      { text: ' YoY', bold: false },
    ])
  })

  it('a heading-only edit leaves the body shape byte-identical', async () => {
    const bytes = await deckWithHandBold()
    const parsed = await parsePptx(bytes)
    const slidePath = parsed.slides[1].xmlPath
    const before = await slideXml(bytes, slidePath)

    const { outline } = extractOutlineSlide(parsed.slides[1])
    const after = await applyToolEdit(parsed, 1, { ...outline, heading: 'Where we stand today' })

    const afterXml = await slideXml(after, slidePath)
    expect(afterXml).toContain('Where we stand today')
    expect(shapeBlock(afterXml, 'We grew ')).toBe(shapeBlock(before, 'We grew '))
  })

  it('a pattern change still plans a full replace (formatting reset is the documented cost)', async () => {
    const bytes = await deckWithHandBold()
    const parsed = await parsePptx(bytes)
    const target = parsed.slides[1]
    const plan = planSlideEdit(target, detectPattern(target), {
      layout: 'title-body',
      pattern: 'big-number',
      heading: 'Growth',
      stat: { value: '2x', caption: 'YoY' },
    })
    expect(plan.kind).toBe('replace')
  })

  it('a changed line with emphasis markers lands as styled runs, not asterisks', async () => {
    const bytes = await deckWithHandBold()
    const parsed = await parsePptx(bytes)
    const { outline } = extractOutlineSlide(parsed.slides[1])
    const after = await applyToolEdit(parsed, 1, {
      ...outline,
      bullets: ['Shipped **GA** worldwide', 'We grew 2x YoY', 'Churn held flat'],
    })
    const reparsed = await parsePptx(after)
    const body = reparsed.slides[1].shapes[1] as TextShape
    expect(body.paragraphs[0].runs.map((r) => ({ text: r.text, bold: Boolean(r.bold) }))).toEqual([
      { text: 'Shipped ', bold: false },
      { text: 'GA', bold: true },
      { text: ' worldwide', bold: false },
    ])
  })
})
