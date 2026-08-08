/**
 * Deterministic deck synthesis from an AI-generated outline. No model calls
 * here — the outline is already fixed; this turns it into .pptx bytes using
 * the same machinery the editor's save path uses: newDeckPptx for the base
 * package, planNewSlide/parseAddedSlide to instantiate layout placeholders,
 * and ONE writeDeck call composing every added slide and text edit together.
 *
 * The first outline slide reuses the base package's title slide (always the
 * Title Slide layout); the rest are added on the layout their `layout` field
 * names. Fails closed: any error throws before anything is written to disk.
 */

import type { deck as deckShared } from '@x/shared'
import { parseAddedSlide, parsePptx } from './parse'
import { planNewSlide } from './add-slide'
import { writeDeck, type NewSlidePart, type SlideEdit, type EditedParagraph } from './serialize'
import { newDeckPptx, type DeckPalette } from './new-deck'
import type { Slide, TextShape } from './types'

type DeckOutline = deckShared.DeckOutline
type DeckOutlineSlide = deckShared.DeckOutlineSlide

const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

/** Which built-in layout an outline slide maps to. */
const LAYOUT_PART: Record<DeckOutlineSlide['layout'], string> = {
  title: 'ppt/slideLayouts/slideLayout1.xml',
  'title-body': 'ppt/slideLayouts/slideLayout2.xml',
}

/** A synthetic slide .rels naming one layout, so planNewSlide clones it. */
function relsForLayout(layoutPart: string): string {
  return (
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../${layoutPart.slice(4)}"/>` +
    '</Relationships>'
  )
}

/** The body lines an outline slide contributes, in paragraph order. */
function bodyLines(slide: DeckOutlineSlide): string[] {
  if (slide.bullets && slide.bullets.length > 0) {
    return slide.bullets.map((b) => b.trim()).filter((b) => b.length > 0)
  }
  if (slide.body && slide.body.trim()) {
    return slide.body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }
  return []
}

/**
 * A text edit that replaces a placeholder's paragraphs with `lines` (one per
 * paragraph). srcPara/srcRun anchor to the shape's first original paragraph so
 * every new paragraph inherits its run/paragraph properties; srcRun is only
 * set when that paragraph actually has a run to inherit from (a freshly-seeded
 * placeholder is empty, and pointing at a non-existent run there is wrong).
 */
function textEdit(shape: TextShape, lines: string[]): SlideEdit | null {
  if (lines.length === 0) return null
  const hasSourceRun = (shape.paragraphs[0]?.runs.length ?? 0) > 0
  const next: EditedParagraph[] = lines.map((text) => ({
    srcPara: 0,
    runs: [{ text, srcPara: 0, ...(hasSourceRun ? { srcRun: 0 } : {}) }],
  }))
  return { kind: 'text', nodePath: shape.nodePath, original: shape.paragraphs, next }
}

/** Heading → shape[0]; body/bullets → shape[1]. Skips missing shapes/empties. */
function slideTextEdits(slide: Slide, outline: DeckOutlineSlide): SlideEdit[] {
  const edits: SlideEdit[] = []
  const heading = outline.heading.trim()
  const titleShape = slide.shapes[0]
  if (heading && titleShape?.type === 'text') {
    const edit = textEdit(titleShape as TextShape, [heading])
    if (edit) edits.push(edit)
  }
  const bodyShape = slide.shapes[1]
  if (bodyShape?.type === 'text') {
    const edit = textEdit(bodyShape as TextShape, bodyLines(outline))
    if (edit) edits.push(edit)
  }
  return edits
}

export interface DeckSynthesisResult {
  bytes: Uint8Array
  slideCount: number
  /** True when any outline slide carried speakerNotes, which are dropped. */
  droppedSpeakerNotes: boolean
}

/**
 * Turns an outline into a .pptx. Throws on any failure before producing bytes,
 * so a caller that only writes on success never persists a partial deck.
 */
export async function synthesizeDeckFromOutline(
  outline: DeckOutline,
  palette: DeckPalette,
): Promise<DeckSynthesisResult> {
  if (outline.slides.length === 0) {
    throw new Error('Outline has no slides')
  }

  // Base package: docProps + title slide seeded with the deck title.
  const base = await parsePptx(await newDeckPptx({ title: outline.title, palette }))
  const editsBySlide = new Map<string, SlideEdit[]>()
  const addSlides: NewSlidePart[] = []

  // First outline slide reuses the base title slide (slide1, Title layout).
  const firstSlide = base.slides[0]
  if (!firstSlide) throw new Error('Base deck has no title slide to seed')
  const firstEdits = slideTextEdits(firstSlide, outline.slides[0])
  if (firstEdits.length > 0) editsBySlide.set(firstSlide.xmlPath, firstEdits)

  // Remaining slides: instantiate the named layout, chained after the previous.
  let anchorPath = firstSlide.xmlPath
  for (let i = 1; i < outline.slides.length; i++) {
    const outlineSlide = outline.slides[i]
    const layoutPart = LAYOUT_PART[outlineSlide.layout]
    const plan = await planNewSlide(
      base,
      anchorPath,
      relsForLayout(layoutPart),
      addSlides.map((a) => a.path),
    )
    const parsed = await parseAddedSlide(base, plan.path, plan.xml, plan.relsXml)
    addSlides.push(plan)
    const edits = slideTextEdits(parsed, outlineSlide)
    if (edits.length > 0) editsBySlide.set(plan.path, edits)
    anchorPath = plan.path
  }

  const bytes = await writeDeck(base, editsBySlide, { addSlides })
  return {
    bytes,
    slideCount: outline.slides.length,
    droppedSpeakerNotes: outline.slides.some((s) => Boolean(s.speakerNotes?.trim())),
  }
}
