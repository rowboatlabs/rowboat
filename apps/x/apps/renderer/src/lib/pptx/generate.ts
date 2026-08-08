/**
 * Deterministic deck synthesis from an AI-generated outline. No model calls
 * here — the outline is already fixed; this turns it into .pptx bytes using
 * the same machinery the editor's save path uses: newDeckPptx for the base
 * package, planNewSlide to allocate/anchor added slides, text edits for
 * placeholder patterns, and ONE writeDeck call composing everything.
 *
 * PATTERN LIBRARY. Each outline slide maps to a visual pattern. Two patterns
 * ('title', 'bullets') reuse the layout placeholders and set their text with
 * ordinary text edits. The richer patterns ('two-column', 'big-number',
 * 'quote', 'section', 'closing') AUTHOR a complete slide-XML string — the same
 * string-synthesis approach add-slide.ts and new-deck.ts use — because a
 * shape inserted within a single writeDeck has no parsed node to carry text or
 * a restyle, and the whole deck must compose in one writeDeck.
 *
 * Every colour is a THEME TOKEN (schemeClr accent/tx1/bg1, optionally with
 * lumMod/lumOff tints) — never a hardcoded hex — so a later "change theme"
 * recolours all of it, and the shapes round-trip through parsePptx and render
 * in PowerPoint (validated against the full-scaffolding package).
 *
 * Fails closed: any error throws before bytes are produced.
 */

import type { deck as deckShared } from '@x/shared'
import { parseAddedSlide, parsePptx } from './parse'
import { planNewSlide } from './add-slide'
import { writeDeck, type NewSlidePart, type SlideEdit, type EditedParagraph } from './serialize'
import { newDeckPptx, type DeckPalette } from './new-deck'
import type { Slide, TextShape } from './types'

type DeckOutline = deckShared.DeckOutline
type DeckOutlineSlide = deckShared.DeckOutlineSlide
type DeckSlidePattern = deckShared.DeckSlidePattern

const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
  ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

const LAYOUT_TITLE = 'ppt/slideLayouts/slideLayout1.xml'
const LAYOUT_BODY = 'ppt/slideLayouts/slideLayout2.xml'

// ---------------------------------------------------------------- geometry

const SLIDE_W = 12192000
const SLIDE_H = 6858000
const EMU_PER_IN = 914400
/** Consistent outer margin shared by every pattern (~0.6in). */
const MARGIN = Math.round(0.6 * EMU_PER_IN)
const CONTENT_W = SLIDE_W - 2 * MARGIN
/** Accent bars: ~5pt tall. */
const BAR_H = Math.round(0.07 * EMU_PER_IN)

const IN = (n: number): number => Math.round(n * EMU_PER_IN)

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// ---------------------------------------------------------- xml primitives

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;')
}

/** A theme colour token with optional lumMod/lumOff tint transforms. */
interface SchemeColor {
  /** 'accent1'..'accent6' | 'tx1' | 'bg1' | 'dk1' | 'lt1' … */
  val: string
  /** e.g. { lumMod: 20000, lumOff: 80000 } for "lighter 80%". */
  lumMod?: number
  lumOff?: number
}

function schemeClrXml(c: SchemeColor): string {
  const transforms =
    (c.lumMod !== undefined ? `<a:lumMod val="${c.lumMod}"/>` : '') +
    (c.lumOff !== undefined ? `<a:lumOff val="${c.lumOff}"/>` : '')
  return transforms
    ? `<a:schemeClr val="${c.val}">${transforms}</a:schemeClr>`
    : `<a:schemeClr val="${c.val}"/>`
}

const solidFillXml = (c: SchemeColor): string => `<a:solidFill>${schemeClrXml(c)}</a:solidFill>`

function xfrmXml(rect: Rect): string {
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const cx = Math.max(1, Math.round(rect.w))
  const cy = Math.max(1, Math.round(rect.h))
  return `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
}

const prstGeomXml = (preset: string): string => `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`

interface Run {
  text: string
  /** Points; written as hundredths in the sz attribute. */
  sizePt: number
  bold?: boolean
  italic?: boolean
  color?: SchemeColor
}

interface Para {
  runs: Run[]
  align?: 'l' | 'ctr' | 'r'
}

function runXml(r: Run): string {
  const attrs = `lang="en-US" sz="${Math.round(r.sizePt * 100)}"${r.bold ? ' b="1"' : ''}${
    r.italic ? ' i="1"' : ''
  }`
  const rPr = r.color ? `<a:rPr ${attrs}>${solidFillXml(r.color)}</a:rPr>` : `<a:rPr ${attrs}/>`
  return `<a:r>${rPr}<a:t>${esc(r.text)}</a:t></a:r>`
}

function paraXml(p: Para): string {
  const pPr = p.align ? `<a:pPr algn="${p.align}"/>` : ''
  if (p.runs.length === 0) return `<a:p>${pPr}<a:endParaRPr lang="en-US"/></a:p>`
  return `<a:p>${pPr}${p.runs.map(runXml).join('')}</a:p>`
}

function txBodyXml(paras: Para[], anchor?: 't' | 'ctr' | 'b'): string {
  const body = paras.length > 0 ? paras.map(paraXml).join('') : '<a:p><a:endParaRPr lang="en-US"/></a:p>'
  return (
    `<p:txBody><a:bodyPr wrap="square" rtlCol="0"${anchor ? ` anchor="${anchor}"` : ''}/>` +
    `<a:lstStyle/>${body}</p:txBody>`
  )
}

let shapeIdCounter = 2
function nextId(): number {
  return shapeIdCounter++
}

/** A filled/outlined shape, optionally with text (cards, bars, backgrounds). */
function shapeXml(opts: {
  name: string
  rect: Rect
  preset?: 'rect' | 'roundRect'
  fill?: SchemeColor
  paras?: Para[]
  anchor?: 't' | 'ctr' | 'b'
}): string {
  const id = nextId()
  const spPr =
    `<p:spPr>${xfrmXml(opts.rect)}${prstGeomXml(opts.preset ?? 'rect')}` +
    `${opts.fill ? solidFillXml(opts.fill) : ''}</p:spPr>`
  const txBody = opts.paras ? txBodyXml(opts.paras, opts.anchor) : ''
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escAttr(opts.name)} ${id}"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr>${spPr}${txBody}</p:sp>`
  )
}

/** A borderless text box (no fill), for headings and captions. */
function textBoxXml(opts: { name: string; rect: Rect; paras: Para[]; anchor?: 't' | 'ctr' | 'b' }): string {
  const id = nextId()
  const spPr =
    `<p:spPr>${xfrmXml(opts.rect)}${prstGeomXml('rect')}<a:noFill/></p:spPr>`
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escAttr(opts.name)} ${id}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>${spPr}${txBodyXml(opts.paras, opts.anchor)}</p:sp>`
  )
}

function slideEnvelope(shapes: string): string {
  const SP_TREE_HEAD =
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
  return (
    XML_HEAD +
    `<p:sld ${NS}><p:cSld><p:spTree>${SP_TREE_HEAD}${shapes}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  )
}

// ---------------------------------------------------------- shared tokens

/** Card / panel tint: the accent lightened to ~80% so dark text stays legible. */
const tintOf = (val: string): SchemeColor => ({ val, lumMod: 20000, lumOff: 80000 })
const TX1: SchemeColor = { val: 'tx1' }
const BG1: SchemeColor = { val: 'bg1' }
const ACCENT1: SchemeColor = { val: 'accent1' }
const ACCENT2: SchemeColor = { val: 'accent2' }

/** Invented type ramp (master styles give title 44 / body 18; these fill the gaps). */
const SIZE = {
  sectionHeading: 54,
  bigNumber: 140,
  patternHeading: 32,
  titleHeading: 44,
  caption: 24,
  cardHeading: 20,
  lead: 20,
  body: 16,
  eyebrow: 14,
} as const

function trimmed(s: string): string {
  return s.trim()
}

function lines(list: readonly string[] | undefined, limit: number): string[] {
  return (list ?? []).map((l) => l.trim()).filter((l) => l.length > 0).slice(0, limit)
}

/** Body/bullets an outline slide contributes when it has no structured field. */
function fallbackLines(slide: DeckOutlineSlide, limit: number): string[] {
  if (slide.bullets && slide.bullets.length > 0) return lines(slide.bullets, limit)
  if (slide.body && slide.body.trim()) return lines(slide.body.split('\n'), limit)
  return []
}

// ------------------------------------------------------- authored patterns

function authorTwoColumn(slide: DeckOutlineSlide): string {
  const shapes: string[] = []
  const headingY = IN(0.5)
  shapes.push(
    textBoxXml({
      name: 'Heading',
      rect: { x: MARGIN, y: headingY, w: CONTENT_W, h: IN(1.0) },
      paras: [{ runs: [{ text: trimmed(slide.heading), sizePt: SIZE.patternHeading, bold: true, color: TX1 }] }],
      anchor: 't',
    }),
  )

  // Prefer explicit columns; otherwise split the slide's lines into two cards.
  let cols = (slide.columns ?? []).slice(0, 2)
  if (cols.length === 0) {
    const all = fallbackLines(slide, 8)
    const mid = Math.ceil(all.length / 2)
    cols = [
      { heading: '', lines: all.slice(0, mid) },
      { heading: '', lines: all.slice(mid) },
    ].filter((c) => c.lines.length > 0)
  }

  const gap = IN(0.4)
  const cardW = Math.round((CONTENT_W - gap) / 2)
  const cardY = IN(1.8)
  // Inner padding so text never touches the card edge. Our canvas doesn't
  // apply OOXML text insets, so the card is a fill-only background with a
  // SEPARATE text box inset on top — text and box then stay aligned in both
  // this editor and PowerPoint, rather than the text hugging the border.
  const pad = IN(0.35)
  // Size the card to its content (heading + lines) so a short column isn't a
  // big empty box; both cards share the taller height so they stay aligned.
  const lineH = IN(0.4)
  const headH = IN(0.5)
  const colContentH = (col: { heading: string; lines: string[] }): number =>
    (col.heading.trim() ? headH : 0) + lines(col.lines, 4).length * lineH
  const contentH = Math.max(IN(0.8), ...cols.map(colContentH))
  const cardH = Math.min(IN(4.4), Math.max(IN(1.7), contentH + 2 * pad))
  const accents = [ACCENT1, ACCENT2]
  cols.forEach((col, i) => {
    const cardX = MARGIN + i * (cardW + gap)
    const cardRect: Rect = { x: cardX, y: cardY, w: cardW, h: cardH }
    // Fill-only rounded background.
    shapes.push(
      shapeXml({
        name: `Card ${i + 1} Background`,
        rect: cardRect,
        preset: 'roundRect',
        fill: tintOf(accents[i].val),
      }),
    )
    // Text box inset within the card.
    const paras: Para[] = []
    if (col.heading.trim()) {
      paras.push({ runs: [{ text: col.heading.trim(), sizePt: SIZE.cardHeading, bold: true, color: accents[i] }] })
    }
    for (const line of lines(col.lines, 4)) {
      paras.push({ runs: [{ text: line, sizePt: SIZE.body, color: TX1 }] })
    }
    if (paras.length === 0) paras.push({ runs: [] })
    shapes.push(
      textBoxXml({
        name: `Card ${i + 1} Text`,
        rect: { x: cardX + pad, y: cardY + pad, w: cardW - 2 * pad, h: cardH - 2 * pad },
        paras,
        anchor: 't',
      }),
    )
  })
  return slideEnvelope(shapes.join(''))
}

function authorBigNumber(slide: DeckOutlineSlide): string {
  const shapes: string[] = []
  shapes.push(
    textBoxXml({
      name: 'Eyebrow',
      rect: { x: MARGIN, y: IN(0.6), w: CONTENT_W, h: IN(0.6) },
      paras: [{ runs: [{ text: trimmed(slide.heading), sizePt: SIZE.eyebrow, bold: true, color: ACCENT1 }] }],
      anchor: 't',
    }),
  )
  const value = slide.stat?.value?.trim() || trimmed(slide.heading)
  shapes.push(
    textBoxXml({
      name: 'Stat',
      rect: { x: MARGIN, y: IN(1.4), w: CONTENT_W, h: IN(2.4) },
      paras: [{ runs: [{ text: value, sizePt: SIZE.bigNumber, bold: true, color: ACCENT1 }] }],
      anchor: 't',
    }),
  )
  const caption = slide.stat?.caption?.trim()
  if (caption) {
    shapes.push(
      textBoxXml({
        name: 'Caption',
        rect: { x: MARGIN, y: IN(3.9), w: CONTENT_W, h: IN(0.8) },
        paras: [{ runs: [{ text: caption, sizePt: SIZE.caption, color: TX1 }] }],
        anchor: 't',
      }),
    )
  }
  const support = fallbackLines(slide, 3)
  if (support.length > 0) {
    shapes.push(
      textBoxXml({
        name: 'Support',
        rect: { x: MARGIN, y: IN(4.8), w: CONTENT_W, h: IN(1.4) },
        paras: support.map((l) => ({ runs: [{ text: l, sizePt: SIZE.body, color: TX1 }] })),
        anchor: 't',
      }),
    )
  }
  return slideEnvelope(shapes.join(''))
}

function authorQuote(slide: DeckOutlineSlide): string {
  const shapes: string[] = []
  const panel: Rect = { x: IN(0.4), y: IN(0.6), w: SLIDE_W - 2 * IN(0.4), h: SLIDE_H - 2 * IN(0.6) }
  shapes.push(
    shapeXml({ name: 'Quote Panel', rect: panel, preset: 'roundRect', fill: tintOf('accent1') }),
  )
  const text = slide.quote?.text?.trim() || slide.body?.trim() || trimmed(slide.heading)
  const paras: Para[] = [
    { runs: [{ text: `“${text}”`, sizePt: SIZE.patternHeading, italic: true, color: TX1 }], align: 'ctr' },
  ]
  const attribution = slide.quote?.attribution?.trim()
  if (attribution) {
    paras.push({ runs: [{ text: `— ${attribution}`, sizePt: SIZE.lead, color: ACCENT1 }], align: 'ctr' })
  }
  shapes.push(
    textBoxXml({
      name: 'Quote',
      rect: { x: IN(1.2), y: IN(1.4), w: SLIDE_W - 2 * IN(1.2), h: SLIDE_H - 2 * IN(1.4) },
      paras,
      anchor: 'ctr',
    }),
  )
  return slideEnvelope(shapes.join(''))
}

function authorSection(slide: DeckOutlineSlide): string {
  const shapes: string[] = []
  // Full-bleed accent background.
  shapes.push(shapeXml({ name: 'Section Background', rect: { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }, fill: ACCENT1 }))
  // Thin accent2 underline bar beneath the heading.
  shapes.push(
    shapeXml({ name: 'Underline', rect: { x: MARGIN, y: IN(4.1), w: IN(2.2), h: BAR_H }, fill: ACCENT2 }),
  )
  const paras: Para[] = [
    { runs: [{ text: trimmed(slide.heading), sizePt: SIZE.sectionHeading, bold: true, color: BG1 }] },
  ]
  const sub = slide.body?.trim() || (fallbackLines(slide, 1)[0] ?? '')
  if (sub) paras.push({ runs: [{ text: sub, sizePt: SIZE.lead, color: BG1 }] })
  shapes.push(
    textBoxXml({
      name: 'Section Heading',
      rect: { x: MARGIN, y: IN(2.2), w: CONTENT_W, h: IN(1.8) },
      paras,
      anchor: 'b',
    }),
  )
  return slideEnvelope(shapes.join(''))
}

function authorClosing(slide: DeckOutlineSlide): string {
  const shapes: string[] = []
  shapes.push(
    shapeXml({ name: 'Accent Bar', rect: { x: MARGIN, y: IN(2.5), w: IN(2.2), h: BAR_H }, fill: ACCENT1 }),
  )
  shapes.push(
    textBoxXml({
      name: 'Closing Heading',
      rect: { x: MARGIN, y: IN(2.9), w: CONTENT_W, h: IN(1.4) },
      paras: [{ runs: [{ text: trimmed(slide.heading), sizePt: SIZE.titleHeading, bold: true, color: TX1 }] }],
      anchor: 't',
    }),
  )
  const line = slide.body?.trim() || (fallbackLines(slide, 1)[0] ?? '')
  if (line) {
    shapes.push(
      textBoxXml({
        name: 'Closing Line',
        rect: { x: MARGIN, y: IN(4.2), w: CONTENT_W, h: IN(0.8) },
        paras: [{ runs: [{ text: line, sizePt: SIZE.lead, color: TX1 }] }],
        anchor: 't',
      }),
    )
  }
  return slideEnvelope(shapes.join(''))
}

function authorTitle(slide: DeckOutlineSlide): string {
  const shapes: string[] = []
  const paras: Para[] = [
    { runs: [{ text: trimmed(slide.heading), sizePt: SIZE.titleHeading, bold: true, color: TX1 }], align: 'ctr' },
  ]
  const sub = slide.body?.trim() || (fallbackLines(slide, 1)[0] ?? '')
  if (sub) paras.push({ runs: [{ text: sub, sizePt: SIZE.lead, color: TX1 }], align: 'ctr' })
  shapes.push(
    textBoxXml({
      name: 'Title',
      rect: { x: MARGIN, y: IN(2.6), w: CONTENT_W, h: IN(1.8) },
      paras,
      anchor: 'ctr',
    }),
  )
  shapes.push(
    shapeXml({ name: 'Accent Bar', rect: { x: (SLIDE_W - IN(2.2)) / 2, y: IN(4.3), w: IN(2.2), h: BAR_H }, fill: ACCENT1 }),
  )
  return slideEnvelope(shapes.join(''))
}

/** The authored (non-placeholder) patterns, keyed by name. */
const AUTHORED: Partial<Record<DeckSlidePattern, (slide: DeckOutlineSlide) => string>> = {
  'two-column': authorTwoColumn,
  'big-number': authorBigNumber,
  quote: authorQuote,
  section: authorSection,
  closing: authorClosing,
  title: authorTitle,
}

// -------------------------------------------------------- placeholder text

/**
 * A text edit that replaces a placeholder's paragraphs with `contentLines`.
 * srcPara/srcRun anchor to the shape's first original paragraph so every new
 * paragraph inherits its run/paragraph properties; srcRun is only set when
 * that paragraph actually has a run to inherit from.
 */
function textEdit(shape: TextShape, contentLines: string[]): SlideEdit | null {
  if (contentLines.length === 0) return null
  const hasSourceRun = (shape.paragraphs[0]?.runs.length ?? 0) > 0
  const next: EditedParagraph[] = contentLines.map((text) => ({
    srcPara: 0,
    runs: [{ text, srcPara: 0, ...(hasSourceRun ? { srcRun: 0 } : {}) }],
  }))
  return { kind: 'text', nodePath: shape.nodePath, original: shape.paragraphs, next }
}

/** Heading → shape[0]; bullets/body (capped) → shape[1]. */
function placeholderEdits(slide: Slide, outline: DeckOutlineSlide, bulletLimit: number): SlideEdit[] {
  const edits: SlideEdit[] = []
  const heading = outline.heading.trim()
  const titleShape = slide.shapes[0]
  if (heading && titleShape?.type === 'text') {
    const e = textEdit(titleShape as TextShape, [heading])
    if (e) edits.push(e)
  }
  const bodyShape = slide.shapes[1]
  if (bodyShape?.type === 'text') {
    const e = textEdit(bodyShape as TextShape, fallbackLines(outline, bulletLimit))
    if (e) edits.push(e)
  }
  return edits
}

// ------------------------------------------------------------- resolution

/**
 * The pattern to render for a slide. An explicit, known pattern wins; a
 * missing one derives from the layout; anything not renderable falls back to
 * 'bullets' (forward compatibility with patterns this build doesn't know).
 */
function resolvePattern(slide: DeckOutlineSlide): DeckSlidePattern {
  const p = slide.pattern
  if (p === 'bullets' || p === 'title') return p
  if (p && AUTHORED[p]) return p
  if (p) return 'bullets' // known-to-schema but not renderable here → fall back
  return slide.layout === 'title' ? 'title' : 'bullets'
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

// ----------------------------------------------------------------- entry

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
  shapeIdCounter = 2

  // Base package: docProps + title slide seeded with the deck title.
  const base = await parsePptx(await newDeckPptx({ title: outline.title, palette }))
  const editsBySlide = new Map<string, SlideEdit[]>()
  const addSlides: NewSlidePart[] = []

  // First slide reuses the base title slide (slide1, Title layout).
  const firstSlide = base.slides[0]
  if (!firstSlide) throw new Error('Base deck has no title slide to seed')
  const firstEdits = placeholderEdits(firstSlide, outline.slides[0], 2)
  if (firstEdits.length > 0) editsBySlide.set(firstSlide.xmlPath, firstEdits)

  // Remaining slides: one per outline entry, in their pattern's shape.
  let anchorPath = firstSlide.xmlPath
  for (let i = 1; i < outline.slides.length; i++) {
    const outlineSlide = outline.slides[i]
    const pattern = resolvePattern(outlineSlide)
    const layoutPart = pattern === 'title' ? LAYOUT_TITLE : LAYOUT_BODY
    const plan = await planNewSlide(
      base,
      anchorPath,
      relsForLayout(layoutPart),
      addSlides.map((a) => a.path),
    )

    const author = AUTHORED[pattern]
    if (author) {
      // Reuse planNewSlide's path/rels/anchor; author the slide body ourselves.
      addSlides.push({ ...plan, xml: author(outlineSlide) })
    } else {
      // 'bullets' (and any fallback): placeholders + text edits.
      const parsed = await parseAddedSlide(base, plan.path, plan.xml, plan.relsXml)
      addSlides.push(plan)
      const edits = placeholderEdits(parsed, outlineSlide, 5)
      if (edits.length > 0) editsBySlide.set(plan.path, edits)
    }
    anchorPath = plan.path
  }

  const bytes = await writeDeck(base, editsBySlide, { addSlides })
  return {
    bytes,
    slideCount: outline.slides.length,
    droppedSpeakerNotes: outline.slides.some((s) => Boolean(s.speakerNotes?.trim())),
  }
}
