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
  ResolvedRunStyle,
  TextAlign,
  TextRun,
  TextShape,
} from '@/lib/pptx/types'
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
 * Builds the overlay's initial HTML. Provenance already on the shape (from an
 * uncommitted edit) wins, so re-opening a box still points at the source runs.
 */
export function buildEditableHtml(shape: TextShape, scale: number): string {
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
      return (
        `<div data-cp="${pi}" data-op="${paraSrc}" data-algn="${para.align ?? ''}"` +
        ` style="margin:0;text-align:${alignToCss(align)}">${inner || '<br>'}</div>`
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
