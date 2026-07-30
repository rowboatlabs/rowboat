/**
 * The DOM <-> model bridge for the contentEditable text overlay.
 *
 * Every run is rendered as a span carrying:
 *  - `data-cp` / `data-cr`: where the run sits in the CURRENT model.
 *  - `data-op` / `data-or`: where it came from in the ORIGINAL parse. The
 *    serializer needs these to reuse rPr bytes and to address formatting.
 *  - `data-b/-i/-u/-pt/-c`: the authoritative run properties. Inline style is
 *    presentation only; reading these back avoids a px->pt float round-trip.
 *
 * When a browser splits a span or block on Enter it clones the attributes onto
 * both halves, which is exactly the inheritance we want.
 */

import type { EditedParagraph, EditedTextRun, RunFormatOverrides } from '@/lib/pptx/serialize'
import type {
  Paragraph,
  ParagraphDisplay,
  ResolvedRunStyle,
  TextAlign,
  TextRun,
  TextShape,
} from '@/lib/pptx/types'
import { autoNumText } from '@/lib/pptx/textstyle'
import { EMU_PER_PT } from './edit-model'

export const DEFAULT_TEXT_PT = 18

/**
 * The style a run renders with: explicit rPr props first, then the resolved
 * inheritance cascade (looked up by ORIGINAL indices via the run's provenance,
 * so styling survives text edits), then hard defaults.
 */
export function displayRunStyle(
  shape: TextShape,
  paraIndex: number,
  runIndex: number,
  run: TextRun,
): ResolvedRunStyle {
  const er = run as EditedTextRun
  const dp = shape.display?.paragraphs[er.srcPara ?? paraIndex]
  const dr = dp?.runs[er.srcRun ?? runIndex] ?? dp?.defaultRun ?? shape.display?.defaultRun
  return {
    sizePt: run.sizePt ?? dr?.sizePt ?? DEFAULT_TEXT_PT,
    bold: run.bold ?? dr?.bold ?? false,
    italic: run.italic ?? dr?.italic ?? false,
    underline: run.underline ?? dr?.underline ?? false,
    colorHex: run.colorHex ?? dr?.colorHex ?? '000000',
  }
}

/** Resolved paragraph alignment: the paragraph's own, else the cascade's. */
export function displayAlign(
  shape: TextShape,
  paraIndex: number,
  para: Paragraph,
): TextAlign | undefined {
  if (para.align) return para.align
  const ep = para as EditedParagraph
  return shape.display?.paragraphs[ep.srcPara ?? paraIndex]?.align
}

export interface TextOverlayHandle {
  root: HTMLDivElement
  scale: number
  shape: TextShape
}

export function alignToCss(align: string | undefined): 'left' | 'center' | 'right' | 'justify' {
  return align === 'ctr' ? 'center' : align === 'r' ? 'right' : align === 'just' ? 'justify' : 'left'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function runCss(style: ResolvedRunStyle, scale: number): string {
  return (
    `font-weight:${style.bold ? 700 : 400};` +
    `font-style:${style.italic ? 'italic' : 'normal'};` +
    `text-decoration:${style.underline ? 'underline' : 'none'};` +
    `font-size:${style.sizePt * EMU_PER_PT * scale}px;` +
    `color:#${style.colorHex};` +
    `line-height:1.2`
  )
}

function runDataAttrs(run: TextRun): string {
  return (
    ` data-b="${run.bold ? 1 : 0}" data-i="${run.italic ? 1 : 0}" data-u="${run.underline ? 1 : 0}"` +
    ` data-pt="${run.sizePt ?? ''}" data-c="${run.colorHex ?? ''}"`
  )
}

/**
 * The paragraph's bullet, styled exactly as `TextShapeView` draws it. Marked
 * `contenteditable="false"` and `data-bullet` so it is inert to typing and
 * skipped by `extractParagraphs` — it is layout, never content.
 */
function bulletHtml(
  shape: TextShape,
  para: Paragraph,
  dp: ParagraphDisplay | undefined,
  indentPx: number,
  scale: number,
  counters: Record<number, number>,
): string {
  if (!dp || !para.runs.some((r) => r.text.trim() !== '')) return ''
  let text: string
  if (dp.bullet.kind === 'char') {
    text = dp.bullet.char
  } else if (dp.bullet.kind === 'auto') {
    for (const k of Object.keys(counters)) {
      if (Number(k) > dp.level) delete counters[Number(k)]
    }
    counters[dp.level] = (counters[dp.level] ?? dp.bullet.startAt - 1) + 1
    text = autoNumText(dp.bullet.scheme, counters[dp.level])
  } else {
    return ''
  }
  const style = dp.defaultRun ?? shape.display?.defaultRun
  const css =
    'display:inline-block;text-indent:0;' +
    (indentPx < 0 ? `min-width:${-indentPx}px;` : 'margin-right:0.35em;') +
    `font-size:${(style?.sizePt ?? DEFAULT_TEXT_PT) * EMU_PER_PT * scale}px;` +
    `color:#${style?.colorHex ?? '000000'};line-height:1.2`
  return `<span data-bullet="1" contenteditable="false" style="${css}">${escapeHtml(text)}</span>`
}

/**
 * Builds the overlay's initial HTML. Provenance already on the shape (from an
 * uncommitted edit) wins, so re-opening a box still points at the source runs.
 */
export function buildEditableHtml(shape: TextShape, scale: number): string {
  // Auto-number counters accumulate down the shape, exactly as the rendered
  // view does, so the editable shows the same numbers.
  const counters: Record<number, number> = {}
  return shape.paragraphs
    .map((para, pi) => {
      const ep = para as EditedParagraph
      const paraSrc = ep.srcPara ?? pi
      const inner = para.runs
        .map((run, ri) => {
          const er = run as EditedTextRun
          const srcPara = er.srcPara ?? pi
          const srcRun = er.srcRun ?? ri
          const prov = ` data-op="${srcPara}" data-or="${srcRun}"`
          if (run.text === '\n') return `<br data-cp="${pi}" data-cr="${ri}"${prov}>`
          // Visual CSS is the RESOLVED style; the data attributes stay raw so
          // extraction never bakes inherited values into write-back edits.
          return (
            `<span data-cp="${pi}" data-cr="${ri}"${prov}${runDataAttrs(run)}` +
            ` style="${runCss(displayRunStyle(shape, pi, ri, run), scale)}">${escapeHtml(run.text)}</span>`
          )
        })
        .join('')
      const align = displayAlign(shape, pi, para)
      // Mirror the rendered paragraph box exactly — padding, indent and the
      // bullet. The bullet is an inline box that takes real horizontal space,
      // so leaving it out reflows every line and the point the user clicked
      // stops mapping to the word they clicked.
      const dp = shape.display?.paragraphs[paraSrc]
      const marLPx = (dp?.marLEmu ?? 0) * scale
      const indentPx = (dp?.indentEmu ?? 0) * scale
      const boxCss =
        (marLPx > 0 ? `padding-left:${marLPx}px;` : '') +
        (indentPx !== 0 ? `text-indent:${indentPx}px;` : '')
      return (
        `<div data-cp="${pi}" data-op="${paraSrc}" data-algn="${para.align ?? ''}"` +
        ` style="margin:0;${boxCss}text-align:${alignToCss(align)}">` +
        bulletHtml(shape, para, dp, indentPx, scale, counters) +
        `${inner || '<br>'}</div>`
      )
    })
    .join('')
}

// ------------------------------------------------------------- DOM reading

function numAttr(el: Element, name: string): number | undefined {
  const v = el.getAttribute(name)
  if (v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function rgbToHex(css: string): string | undefined {
  const rgb = css.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((c) => Number(c).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  const hex = css.match(/^#([0-9a-fA-F]{6})$/)
  return hex ? hex[1].toUpperCase() : undefined
}

/**
 * Run properties for a span: the data attributes when present, otherwise the
 * inline style (which is what pasted markup arrives with).
 */
function propsOfSpan(el: HTMLElement, scale: number): Omit<TextRun, 'text'> {
  const out: Omit<TextRun, 'text'> = {}
  const st = el.style

  const dataB = el.getAttribute('data-b')
  if (dataB !== null) {
    if (dataB === '1') out.bold = true
  } else if (st.fontWeight) {
    const w = st.fontWeight
    if (w === 'bold' || w === 'bolder' || Number(w) >= 600) out.bold = true
  }

  const dataI = el.getAttribute('data-i')
  if (dataI !== null) {
    if (dataI === '1') out.italic = true
  } else if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') {
    out.italic = true
  }

  const dataU = el.getAttribute('data-u')
  if (dataU !== null) {
    if (dataU === '1') out.underline = true
  } else if ((st.textDecorationLine || st.textDecoration || '').includes('underline')) {
    out.underline = true
  }

  const dataPt = el.getAttribute('data-pt')
  if (dataPt !== null) {
    if (dataPt !== '') {
      const pt = Number(dataPt)
      if (Number.isFinite(pt) && pt > 0) out.sizePt = pt
    }
  } else if (st.fontSize.endsWith('px')) {
    const px = parseFloat(st.fontSize)
    if (px > 0 && scale > 0) out.sizePt = Math.round((px / (EMU_PER_PT * scale)) * 10) / 10
  }

  const dataC = el.getAttribute('data-c')
  if (dataC !== null) {
    if (dataC !== '') out.colorHex = dataC.toUpperCase()
  } else if (st.color) {
    const hex = rgbToHex(st.color)
    // Plain black is the render default, not an authored color.
    if (hex && hex !== '000000') out.colorHex = hex
  }

  return out
}

const NBSP = String.fromCharCode(0x00a0)
const INVISIBLE_RE = new RegExp(`[${String.fromCharCode(0x200b)}${String.fromCharCode(0xfeff)}]`, 'g')

/** contentEditable output -> model text. NBSP/CRLF normalized, zero-widths dropped. */
function normText(s: string): string {
  return s.split(NBSP).join(' ').replace(/\r\n?/g, '\n').replace(INVISIBLE_RE, '')
}

const isRunSpan = (n: Node): n is HTMLElement =>
  n instanceof HTMLElement && n.tagName === 'SPAN' && n.getAttribute('data-cr') !== null

/** Reads the committed paragraphs back out of the overlay's DOM. */
export function extractParagraphs(
  root: HTMLElement,
  shape: TextShape,
  scale: number,
): EditedParagraph[] {
  const paras: EditedParagraph[] = []
  let loose: EditedTextRun[] = []

  const flushLoose = () => {
    if (loose.length) paras.push({ runs: loose })
    loose = []
  }

  const runFromSpan = (el: HTMLElement): EditedTextRun | null => {
    const text = normText(el.textContent ?? '')
    if (!text) return null
    return {
      text,
      ...propsOfSpan(el, scale),
      srcPara: numAttr(el, 'data-op'),
      srcRun: numAttr(el, 'data-or'),
    }
  }

  const collectInline = (container: Node, into: EditedTextRun[]) => {
    container.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = normText(n.nodeValue ?? '')
        if (t) into.push({ text: t })
      } else if (n instanceof Element) {
        // Bullets are drawn for layout only; they are not part of the text.
        if (n.hasAttribute('data-bullet')) return
        if (n.tagName === 'BR') {
          into.push({ text: '\n', srcPara: numAttr(n, 'data-op'), srcRun: numAttr(n, 'data-or') })
        } else if (isRunSpan(n)) {
          const r = runFromSpan(n)
          if (r) into.push(r)
        } else {
          // Pasted markup or a browser-inserted wrapper: keep the text.
          collectInline(n, into)
        }
      }
    })
  }

  root.childNodes.forEach((n) => {
    if (n instanceof HTMLElement && (n.tagName === 'DIV' || n.tagName === 'P')) {
      flushLoose()
      const runs: EditedTextRun[] = []
      collectInline(n, runs)

      // `<div><br></div>` is contentEditable's empty paragraph.
      const onlyBr =
        n.childNodes.length === 1 && n.firstChild instanceof Element && n.firstChild.tagName === 'BR'
      let finalRuns = onlyBr ? [] : runs
      // Browsers keep a placeholder <br> at the end of non-empty blocks.
      if (!onlyBr && finalRuns.length > 1) {
        const lastRun = finalRuns[finalRuns.length - 1]
        const lastChild = n.lastChild
        if (
          lastRun.text === '\n' &&
          lastRun.srcRun === undefined &&
          lastChild instanceof Element &&
          lastChild.tagName === 'BR' &&
          lastChild.getAttribute('data-cr') === null
        ) {
          finalRuns = finalRuns.slice(0, -1)
        }
      }

      const cp = numAttr(n, 'data-cp')
      const declared = n.getAttribute('data-algn')
      const align = (declared || shape.paragraphs[cp ?? -1]?.align) as TextAlign | undefined
      paras.push({ align: align || undefined, runs: finalRuns, srcPara: numAttr(n, 'data-op') })
    } else if (n.nodeType === Node.TEXT_NODE) {
      const t = normText(n.nodeValue ?? '')
      if (t) loose.push({ text: t })
    } else if (n instanceof Element) {
      if (n.hasAttribute('data-bullet')) return
      if (n.tagName === 'BR') {
        loose.push({ text: '\n', srcPara: numAttr(n, 'data-op'), srcRun: numAttr(n, 'data-or') })
      } else if (isRunSpan(n)) {
        const r = runFromSpan(n)
        if (r) loose.push(r)
      } else {
        collectInline(n, loose)
      }
    }
  })
  flushLoose()

  // Everything replaced by unanchored content (select-all + type): keep the
  // first original paragraph's identity rather than none at all.
  if (paras.length > 0 && paras.every((p) => p.srcPara === undefined) && shape.paragraphs.length > 0) {
    paras[0] = { ...paras[0], srcPara: 0, align: paras[0].align ?? shape.paragraphs[0].align }
  }
  if (paras.length === 0) {
    paras.push({ align: shape.paragraphs[0]?.align, runs: [], srcPara: 0 })
  }
  return paras
}

// ------------------------------------------------------------ caret placing

interface CaretSpot {
  node: Node
  offset: number
}

/**
 * Caret spot for a viewport point. `caretPositionFromPoint` is the standard
 * API; `caretRangeFromPoint` is the deprecated WebKit-era one Blink still
 * carries, kept as the fallback.
 */
function caretSpotAt(x: number, y: number): CaretSpot | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y)
    if (pos) return { node: pos.offsetNode, offset: pos.offset }
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y)
    if (range) return { node: range.startContainer, offset: range.startOffset }
  }
  return null
}

/**
 * Closest character position inside `root` to a viewport point, measured
 * against the text's own rects. This is what keeps a near-miss — the click
 * landed in a paragraph's indent, or in the empty band a vertically centered
 * text block leaves above and below itself — from collapsing to the start of
 * the box instead of the word next to the pointer.
 */
function nearestTextSpot(root: HTMLElement, x: number, y: number): CaretSpot | null {
  const walker = textWalker(root)
  const probe = document.createRange()
  let best: CaretSpot | null = null
  let bestDist = Infinity
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text
    for (let i = 0; i < text.length; i++) {
      probe.setStart(text, i)
      probe.setEnd(text, i + 1)
      const rect = probe.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
      const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        // Land on whichever side of the glyph the pointer is nearer.
        best = { node: text, offset: x > (rect.left + rect.right) / 2 ? i + 1 : i }
      }
    }
  }
  return best
}

/** Where a click should leave the caret when the editor opens. */
export interface CaretTarget {
  /** Viewport coordinates of the click. */
  x: number
  y: number
  /** Double-click: select the word under the pointer rather than collapse. */
  selectWord: boolean
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

/** Walks editable text only — bullets are layout, never a caret target. */
function textWalker(root: Node): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('[data-bullet]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
}

/** Text nodes of the paragraph block holding `node`, in document order. */
function paragraphTextNodes(root: HTMLElement, node: Text): Text[] {
  const block = node.parentElement?.closest<HTMLElement>('div[data-cp]') ?? root
  const walker = textWalker(block)
  const out: Text[] = []
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n as Text)
  return out
}

/**
 * The word around a spot, as a range. Spans run boundaries, because PowerPoint
 * splits runs mid-word freely (language tags, spell-check state), and a
 * double-click should still take the whole word.
 */
function wordRangeAt(root: HTMLElement, node: Text, offset: number): Range | null {
  const nodes = paragraphTextNodes(root, node)
  const home = nodes.indexOf(node)
  if (home < 0) return null
  const starts: number[] = []
  let flat = ''
  for (const n of nodes) {
    starts.push(flat.length)
    flat += n.data
  }
  const at = starts[home] + offset
  let from = at
  let to = at
  while (from > 0 && WORD_CHAR.test(flat[from - 1])) from--
  while (to < flat.length && WORD_CHAR.test(flat[to])) to++
  // Landed on a space or punctuation: there is no word to take.
  if (from === to) return null
  const locate = (i: number): [Text, number] => {
    for (let k = nodes.length - 1; k >= 0; k--) {
      if (i >= starts[k]) return [nodes[k], i - starts[k]]
    }
    return [nodes[0], 0]
  }
  const [startNode, startOffset] = locate(from)
  const [endNode, endOffset] = locate(to)
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

/**
 * Resolves a click into a selection inside `root` — the word for a
 * double-click, otherwise a caret.
 *
 * Call this BEFORE focusing the editable. `focus()` scrolls the element into
 * view, and the canvas frame it lives in is a scrollable `overflow:hidden`
 * box, so focusing first slides the text out from under the coordinates the
 * click was captured at; the hit test then misses the glyphs and collapses to
 * the very start of the box.
 */
export function caretSelectionAtPoint(root: HTMLElement, target: CaretTarget): Range | null {
  const { x, y } = target
  let spot = caretSpotAt(x, y)
  // A hit test that misses the glyphs answers with the containing element, and
  // taking that offset verbatim is the other way the caret ends up at 0. A hit
  // on the bullet is no good either — it is inert.
  const inBullet = (n: Node) =>
    ((n instanceof Element ? n : n.parentElement)?.closest('[data-bullet]') ?? null) !== null
  if (
    spot === null ||
    !root.contains(spot.node) ||
    spot.node.nodeType !== Node.TEXT_NODE ||
    inBullet(spot.node)
  ) {
    spot = nearestTextSpot(root, x, y)
  }
  if (spot === null || !root.contains(spot.node)) return null
  const text = spot.node as Text
  const offset = Math.min(spot.offset, text.length)
  if (target.selectWord) {
    const word = wordRangeAt(root, text, offset)
    if (word !== null) return word
  }
  const range = document.createRange()
  range.setStart(text, offset)
  range.collapse(true)
  return range
}

// ------------------------------------------------------------ DOM writing

/** Spans intersecting the current selection, or all of them when collapsed. */
export function selectedRunSpans(root: HTMLElement): HTMLElement[] {
  const spans = Array.from(root.querySelectorAll<HTMLElement>('span[data-cr]'))
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return spans
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return spans
  if (range.collapsed) {
    const anchor = sel.anchorNode
    const span = anchor
      ? (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>(
          'span[data-cr]',
        )
      : null
    return span ? [span] : spans
  }
  const hit = spans.filter((s) => range.intersectsNode(s))
  return hit.length > 0 ? hit : spans
}

/** Paragraph blocks intersecting the current selection. */
export function selectedParagraphBlocks(root: HTMLElement): HTMLElement[] {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('div[data-cp]'))
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return blocks
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return blocks
  if (range.collapsed) {
    const anchor = sel.anchorNode
    const block = anchor
      ? (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>(
          'div[data-cp]',
        )
      : null
    return block ? [block] : blocks
  }
  const hit = blocks.filter((b) => range.intersectsNode(b))
  return hit.length > 0 ? hit : blocks
}

/** Applies formatting to whole runs (run granularity), in the DOM only. */
export function applyFormatToSpans(
  spans: readonly HTMLElement[],
  set: RunFormatOverrides,
  scale: number,
): void {
  for (const el of spans) {
    if (set.bold !== undefined) {
      el.setAttribute('data-b', set.bold ? '1' : '0')
      el.style.fontWeight = set.bold ? '700' : '400'
    }
    if (set.italic !== undefined) {
      el.setAttribute('data-i', set.italic ? '1' : '0')
      el.style.fontStyle = set.italic ? 'italic' : 'normal'
    }
    if (set.underline !== undefined) {
      el.setAttribute('data-u', set.underline ? '1' : '0')
      el.style.textDecoration = set.underline ? 'underline' : 'none'
    }
    if (set.sizePt !== undefined) {
      el.setAttribute('data-pt', String(set.sizePt))
      el.style.fontSize = `${set.sizePt * EMU_PER_PT * scale}px`
    }
    if (set.colorHex !== undefined) {
      el.setAttribute('data-c', set.colorHex)
      el.style.color = `#${set.colorHex}`
    }
  }
}

export function applyAlignToBlocks(blocks: readonly HTMLElement[], align: TextAlign): void {
  for (const el of blocks) {
    el.setAttribute('data-algn', align)
    el.style.textAlign = alignToCss(align)
  }
}

function aggregate(
  items: ReadonlyArray<Omit<TextRun, 'text'>>,
): RunFormatOverrides {
  if (items.length === 0) return {}
  let bold = Boolean(items[0].bold)
  let italic = Boolean(items[0].italic)
  let underline = Boolean(items[0].underline)
  let sizePt: number | undefined = items[0].sizePt ?? DEFAULT_TEXT_PT
  let colorHex: string | undefined = items[0].colorHex ?? '000000'
  for (const p of items.slice(1)) {
    bold = bold && Boolean(p.bold)
    italic = italic && Boolean(p.italic)
    underline = underline && Boolean(p.underline)
    if ((p.sizePt ?? DEFAULT_TEXT_PT) !== sizePt) sizePt = undefined
    if ((p.colorHex ?? '000000') !== colorHex) colorHex = undefined
  }
  return { bold, italic, underline, sizePt, colorHex }
}

/** Aggregate formatting of a set of spans, for reflecting toolbar state. */
export function aggregateFormat(
  spans: readonly HTMLElement[],
  scale: number,
): RunFormatOverrides {
  return aggregate(spans.map((s) => propsOfSpan(s, scale)))
}

/** Aggregate formatting of model runs, for when nothing is being edited. */
export function aggregateFormatOfParagraphs(paras: readonly Paragraph[]): RunFormatOverrides {
  return aggregate(paras.flatMap((p) => p.runs).filter((r) => r.text !== '\n'))
}
