/**
 * Surgical write-back for text edits.
 *
 * The invariant this module exists to uphold: saving can NEVER corrupt or lose
 * content the editor doesn't understand. fast-xml-parser's XMLBuilder cannot
 * re-serialize losslessly (measured: it drops the CRLF after the XML
 * declaration, normalizes every empty element to one form, and re-escapes the
 * `&` of numeric character references it never decoded, so `&#8217;` in an
 * UNTOUCHED run becomes `&amp;#8217;` — silent corruption). It also exposes no
 * node byte positions.
 *
 * So instead of rebuilding documents, edits are applied as string splices on
 * the retained raw XML. A small quote-aware scanner locates byte ranges; its
 * view of the document is cross-validated against the fast-xml-parser tree the
 * model came from, and any disagreement throws — the save fails closed and the
 * file on disk is untouched.
 *
 * Two write strategies per edited shape:
 *  - text-only (paragraph/run structure unchanged): splice each changed run's
 *    `<a:t>` content in place. Nothing else in the file moves.
 *  - structural (paragraphs/runs added, removed, split): rebuild only the
 *    `<a:p>…</a:p>` region of that shape's txBody, reusing the original bytes
 *    of every pPr/endParaRPr/rPr — and of every unchanged run — verbatim via
 *    the srcPara/srcRun provenance the editor stamps on committed runs.
 */

import JSZip from 'jszip'
import {
  childrenOf,
  parseParagraph,
  parseXml,
  resolveNodePath,
  tagNameOf,
  type XmlNode,
} from './parse'
import type { NodePath, Paragraph, SlideDeck, TextAlign, TextRun } from './types'

// ------------------------------------------------------------------- types

/** A committed run, optionally anchored to the run it derives from. */
export interface EditedTextRun extends TextRun {
  /** Index into the ORIGINAL (as-parsed) paragraphs of this shape. */
  srcPara?: number
  /** Index into that original paragraph's runs. */
  srcRun?: number
}

export interface EditedParagraph {
  align?: TextAlign
  runs: EditedTextRun[]
  srcPara?: number
}

export interface ShapeTextEdit {
  kind: 'text'
  /** The shape's node path, from the parsed model. */
  nodePath: NodePath
  /** The shape's paragraphs as originally parsed from the retained XML. */
  original: Paragraph[]
  /** The committed replacement. */
  next: EditedParagraph[]
}

/** Addresses one run: paragraph index, then run index within it. */
export interface RunRef {
  para: number
  run: number
}

/** Formatting to apply. A field left undefined is left untouched in the rPr. */
export interface RunFormatOverrides {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  sizePt?: number
  /** Six-digit RRGGBB; replaces the run's fill with a solid color. */
  colorHex?: string
}

export interface FormatRunsEdit {
  kind: 'formatRuns'
  nodePath: NodePath
  /** The shape's paragraphs as originally parsed from the retained XML. */
  original: Paragraph[]
  targets: RunRef[]
  set: RunFormatOverrides
}

export interface ParagraphAlignEdit {
  kind: 'paragraphAlign'
  nodePath: NodePath
  /** The shape's paragraphs as originally parsed from the retained XML. */
  original: Paragraph[]
  paraIndex: number
  align: TextAlign
}

export interface ShapeGeometryEdit {
  kind: 'shapeGeometry'
  nodePath: NodePath
  /** New offset in EMU. Rounded to integers. */
  offEmu?: { x: number; y: number }
  /** New extent in EMU. Rounded to integers and clamped to >= 1. */
  extEmu?: { w: number; h: number }
}

export type SlideEdit = ShapeTextEdit | FormatRunsEdit | ParagraphAlignEdit | ShapeGeometryEdit

// -------------------------------------------------------------- normalizing

/**
 * Canonical, comparison-safe form of a paragraph list: provenance stripped,
 * absent flags dropped. Used for equality checks here and by the editor.
 */
export function normalizeParagraphs(paras: readonly Paragraph[]): string {
  return JSON.stringify(
    paras.map((p) => ({
      align: p.align,
      runs: p.runs.map((r) => ({
        text: r.text,
        bold: r.bold || undefined,
        italic: r.italic || undefined,
        underline: r.underline || undefined,
        sizePt: r.sizePt,
        colorHex: r.colorHex,
      })),
    })),
  )
}

function runPropsEqual(a: TextRun, b: TextRun): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    a.sizePt === b.sizePt &&
    a.colorHex === b.colorHex
  )
}

// ------------------------------------------------------------------ escaping

/** Escapes text for XML element content. Quotes stay literal, as Office writes them. */
function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Characters invalid in XML 1.0 (contentEditable can leak controls).
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
}

// ------------------------------------------------------- raw XML scanning

/**
 * Byte ranges of one element in the raw string. `start` is the index of `<`;
 * `end` is the index just past the final `>` (of the close tag, or of the
 * self-closing tag itself).
 */
interface Elem {
  name: string
  start: number
  end: number
  selfClosing: boolean
  /** Content bounds; -1/-1 when self-closing. */
  contentStart: number
  contentEnd: number
}

function fail(msg: string): never {
  throw new Error(`pptx write-back: ${msg}`)
}

const localOf = (name: string): string => {
  const i = name.indexOf(':')
  return i >= 0 ? name.slice(i + 1) : name
}

const prefixOf = (name: string): string => {
  const i = name.indexOf(':')
  return i >= 0 ? name.slice(0, i) : ''
}

/** Finds the `>` ending the tag opened at `lt`, respecting quoted attributes. */
function scanTagEnd(s: string, lt: number): { gt: number; selfClosing: boolean } {
  let quote: string | null = null
  for (let i = lt + 1; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '>') {
      return { gt: i, selfClosing: s[i - 1] === '/' }
    }
  }
  fail('unterminated tag')
}

/** If `lt` starts a comment/CDATA/PI/doctype, returns the index just past it. */
function skipSpecial(s: string, lt: number): number | null {
  if (s.startsWith('<!--', lt)) {
    const e = s.indexOf('-->', lt + 4)
    if (e < 0) fail('unterminated comment')
    return e + 3
  }
  if (s.startsWith('<![CDATA[', lt)) {
    const e = s.indexOf(']]>', lt + 9)
    if (e < 0) fail('unterminated CDATA')
    return e + 3
  }
  if (s.startsWith('<?', lt)) {
    const e = s.indexOf('?>', lt + 2)
    if (e < 0) fail('unterminated processing instruction')
    return e + 2
  }
  if (s.startsWith('<!', lt)) return scanTagEnd(s, lt).gt + 1
  return null
}

function tagNameAt(s: string, lt: number): string {
  let i = lt + 1
  if (s[i] === '/') i++
  let j = i
  while (j < s.length && !' \t\r\n/>'.includes(s[j])) j++
  return s.slice(i, j)
}

/** Reads the full element whose `<` is at `lt`, including all descendants. */
function readElementAt(s: string, lt: number): Elem {
  const name = tagNameAt(s, lt)
  const open = scanTagEnd(s, lt)
  if (open.selfClosing) {
    return { name, start: lt, end: open.gt + 1, selfClosing: true, contentStart: -1, contentEnd: -1 }
  }
  const contentStart = open.gt + 1
  let depth = 1
  let i = contentStart
  while (i < s.length) {
    const next = s.indexOf('<', i)
    if (next < 0) break
    const special = skipSpecial(s, next)
    if (special !== null) {
      i = special
      continue
    }
    const tag = scanTagEnd(s, next)
    if (s[next + 1] === '/') {
      depth--
      if (depth === 0) {
        return { name, start: lt, end: tag.gt + 1, selfClosing: false, contentStart, contentEnd: next }
      }
    } else if (!tag.selfClosing) {
      depth++
    }
    i = tag.gt + 1
  }
  fail(`unterminated <${name}>`)
}

/** Direct child elements within a content window, in document order. */
function childElementsIn(s: string, from: number, to: number): Elem[] {
  const out: Elem[] = []
  let i = from
  while (i >= 0 && i < to) {
    const lt = s.indexOf('<', i)
    if (lt < 0 || lt >= to) break
    const special = skipSpecial(s, lt)
    if (special !== null) {
      i = special
      continue
    }
    if (s[lt + 1] === '/') break // parent's close tag — window bounds are wrong
    const el = readElementAt(s, lt)
    out.push(el)
    i = el.end
  }
  return out
}

const childElemsOf = (s: string, el: Elem): Elem[] =>
  el.selfClosing ? [] : childElementsIn(s, el.contentStart, el.contentEnd)

const childElemByLocal = (s: string, el: Elem, name: string): Elem | undefined =>
  childElemsOf(s, el).find((c) => localOf(c.name) === name)

// ------------------------------------------- raw shape structure extraction

interface RawRunItem {
  kind: 'r' | 'fld' | 'br'
  elem: Elem
  rPr?: Elem
  /** Present (and non-empty) for kept r/fld items. */
  t?: Elem
}

interface RawParagraph {
  elem: Elem
  prefix: string
  pPr?: Elem
  endParaRPr?: Elem
  /** Kept items only, mirroring the model's skip rule (empty runs dropped). */
  items: RawRunItem[]
}

function rawParagraphsOf(s: string, txBody: Elem): RawParagraph[] {
  const out: RawParagraph[] = []
  for (const p of childElemsOf(s, txBody)) {
    if (localOf(p.name) !== 'p') continue
    const para: RawParagraph = { elem: p, prefix: prefixOf(p.name), items: [] }
    for (const kid of childElemsOf(s, p)) {
      const name = localOf(kid.name)
      if (name === 'pPr') para.pPr = kid
      else if (name === 'endParaRPr') para.endParaRPr = kid
      else if (name === 'br') para.items.push({ kind: 'br', elem: kid })
      else if (name === 'r' || name === 'fld') {
        const t = childElemByLocal(s, kid, 't')
        // The model skips runs whose text is empty; mirror it exactly so
        // model index k always pairs with kept item k.
        if (!t || t.selfClosing || t.contentEnd <= t.contentStart) continue
        para.items.push({ kind: name, elem: kid, rPr: childElemByLocal(s, kid, 'rPr'), t })
      }
    }
    out.push(para)
  }
  return out
}

// --------------------------------------------------------- model utilities

function fxpChildByLocal(nodes: XmlNode[], name: string): XmlNode | undefined {
  return nodes.find((n) => {
    const t = tagNameOf(n)
    return t !== null && localOf(t) === name
  })
}

/** Model paragraphs of a `p:sp` node, by the exact rules the parser used. */
function modelParagraphsOfSp(sp: XmlNode): Paragraph[] | null {
  const txBody = fxpChildByLocal(childrenOf(sp), 'txBody')
  if (!txBody) return null
  return childrenOf(txBody)
    .filter((n) => {
      const t = tagNameOf(n)
      return t !== null && localOf(t) === 'p'
    })
    .map(parseParagraph)
}

const isBr = (r: TextRun): boolean => r.text === '\n'

/**
 * True when the edit changes no paragraph/run structure — only text inside
 * existing runs — so it can be applied as in-place `<a:t>` splices.
 *
 * Exported because the editor must gate formatting on the SAME predicate: a
 * `formatRuns` splice lives inside the `<a:p>` range a rebuild replaces, so if
 * the editor believed formatting was still addressable while this returned
 * false, both edits would be emitted and every save would fail closed forever.
 */
export function isTextOnlyEdit(
  original: readonly Paragraph[],
  next: readonly EditedParagraph[],
): boolean {
  if (original.length !== next.length) return false
  for (let i = 0; i < original.length; i++) {
    const o = original[i]
    const n = next[i]
    if ((o.align ?? null) !== (n.align ?? null)) return false
    if (o.runs.length !== n.runs.length) return false
    for (let j = 0; j < o.runs.length; j++) {
      const or = o.runs[j]
      const nr = n.runs[j]
      if (isBr(or) !== isBr(nr)) return false
      // A newline inside replacement text means new <a:br/> structure.
      if (!isBr(nr) && nr.text.includes('\n')) return false
      if (!runPropsEqual(or, nr)) return false
    }
  }
  return true
}

// ------------------------------------------------------------------ splicing

interface SpliceOp {
  start: number
  end: number
  insert: string
}

function applySplices(s: string, ops: SpliceOp[]): string {
  const sorted = [...ops].sort((a, b) => b.start - a.start)
  let out = s
  let lastStart = Infinity
  for (const op of sorted) {
    if (op.end > lastStart) fail('internal error: overlapping splices')
    lastStart = op.start
    out = out.slice(0, op.start) + op.insert + out.slice(op.end)
  }
  return out
}

// ------------------------------------------------- open-tag attribute edits

interface OpenTagInfo {
  /** Insertion point for new attributes: index of `>`, or of the `/` in `/>`. */
  closeStart: number
  selfClosing: boolean
  attrs: Array<{ name: string; valueStart: number; valueEnd: number; value: string }>
}

function openTagInfo(s: string, elem: Elem): OpenTagInfo {
  const { gt, selfClosing } = scanTagEnd(s, elem.start)
  const closeStart = selfClosing ? gt - 1 : gt
  const attrs: OpenTagInfo['attrs'] = []
  let i = elem.start + 1 + elem.name.length
  while (i < closeStart) {
    while (i < closeStart && ' \t\r\n'.includes(s[i])) i++
    if (i >= closeStart) break
    const nameStart = i
    while (i < closeStart && !' \t\r\n=/>'.includes(s[i])) i++
    const name = s.slice(nameStart, i)
    if (!name) break
    while (i < closeStart && ' \t\r\n'.includes(s[i])) i++
    if (s[i] !== '=') fail(`malformed attribute ${name} in <${elem.name}>`)
    i++
    while (i < closeStart && ' \t\r\n'.includes(s[i])) i++
    const quote = s[i]
    if (quote !== '"' && quote !== "'") fail(`unquoted attribute ${name} in <${elem.name}>`)
    const valueStart = i + 1
    const valueEnd = s.indexOf(quote, valueStart)
    if (valueEnd < 0 || valueEnd >= closeStart) fail(`unterminated attribute ${name}`)
    attrs.push({ name, valueStart, valueEnd, value: s.slice(valueStart, valueEnd) })
    i = valueEnd + 1
  }
  return { closeStart, selfClosing, attrs }
}

/**
 * Ops that set attributes on one open tag: existing values replaced in place,
 * missing attributes appended (as one insert, preserving the given order)
 * before the tag close. Attribute order is insignificant in XML, so appending
 * is safe; nothing outside the open tag is touched. Values must not need
 * escaping (enums and integers only).
 */
function setAttrOps(s: string, elem: Elem, pairs: ReadonlyArray<[string, string]>): SpliceOp[] {
  const info = openTagInfo(s, elem)
  const ops: SpliceOp[] = []
  let inserts = ''
  for (const [name, value] of pairs) {
    const existing = info.attrs.find((a) => a.name === name)
    if (existing) ops.push({ start: existing.valueStart, end: existing.valueEnd, insert: value })
    else inserts += ` ${name}="${value}"`
  }
  if (inserts) ops.push({ start: info.closeStart, end: info.closeStart, insert: inserts })
  return ops
}

const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

/** Prefix bound to the DrawingML namespace on the root element; 'a' if unfound. */
function drawingPrefixOf(s: string, sldElem: Elem): string {
  for (const a of openTagInfo(s, sldElem).attrs) {
    if (a.value === DRAWINGML_NS) {
      if (a.name === 'xmlns') return ''
      if (a.name.startsWith('xmlns:')) return a.name.slice(6)
    }
  }
  return 'a'
}

// -------------------------------------------------------------- rPr rewriting

const FILL_LOCALS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']

const hasOverride = (set: RunFormatOverrides): boolean =>
  set.bold !== undefined ||
  set.italic !== undefined ||
  set.underline !== undefined ||
  set.sizePt !== undefined ||
  set.colorHex !== undefined

/** sz is hundredths of a point, schema-bounded to [1pt, 4000pt]. */
function szValue(sizePt: number): string {
  return String(Math.min(400000, Math.max(100, Math.round(sizePt * 100))))
}

function attrPairsFor(set: RunFormatOverrides): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  if (set.bold !== undefined) pairs.push(['b', set.bold ? '1' : '0'])
  if (set.italic !== undefined) pairs.push(['i', set.italic ? '1' : '0'])
  if (set.underline !== undefined) pairs.push(['u', set.underline ? 'sng' : 'none'])
  if (set.sizePt !== undefined) pairs.push(['sz', szValue(set.sizePt)])
  return pairs
}

function solidFillXml(prefix: string, colorHex: string): string {
  const t = (n: string): string => (prefix ? `${prefix}:${n}` : n)
  return `<${t('solidFill')}><${t('srgbClr')} val="${colorHex}"/></${t('solidFill')}>`
}

/**
 * Ops that rewrite an existing rPr per the overrides: overridden attributes
 * are set on the open tag, an overridden color replaces the fill-group child
 * in place (or is inserted after `a:ln`, the only child the schema orders
 * before it). Every attribute and child the override doesn't own keeps its
 * bytes.
 */
function transformRPrOps(s: string, rPr: Elem, set: RunFormatOverrides): SpliceOp[] {
  const info = openTagInfo(s, rPr)
  const ops: SpliceOp[] = []
  let attrInserts = ''
  for (const [name, value] of attrPairsFor(set)) {
    const existing = info.attrs.find((a) => a.name === name)
    if (existing) ops.push({ start: existing.valueStart, end: existing.valueEnd, insert: value })
    else attrInserts += ` ${name}="${value}"`
  }

  if (set.colorHex === undefined) {
    if (attrInserts) ops.push({ start: info.closeStart, end: info.closeStart, insert: attrInserts })
    return ops
  }

  const fill = solidFillXml(prefixOf(rPr.name), set.colorHex)
  if (rPr.selfClosing) {
    // `<a:rPr .../>` must reopen to hold the fill; fold new attributes into
    // the same op so nothing overlaps.
    ops.push({ start: info.closeStart, end: rPr.end, insert: `${attrInserts}>${fill}</${rPr.name}>` })
    return ops
  }
  if (attrInserts) ops.push({ start: info.closeStart, end: info.closeStart, insert: attrInserts })
  const children = childElemsOf(s, rPr)
  const existingFill = children.find((c) => FILL_LOCALS.includes(localOf(c.name)))
  if (existingFill) {
    ops.push({ start: existingFill.start, end: existingFill.end, insert: fill })
  } else {
    const ln = children.find((c) => localOf(c.name) === 'ln')
    const at = ln ? ln.end : rPr.contentStart
    ops.push({ start: at, end: at, insert: fill })
  }
  return ops
}

/** A fresh rPr for a run that had none. `prefix` is the run element's own. */
function synthesizedRPr(prefix: string, set: RunFormatOverrides): string {
  const t = (n: string): string => (prefix ? `${prefix}:${n}` : n)
  const attrs = attrPairsFor(set)
    .map(([n, v]) => ` ${n}="${v}"`)
    .join('')
  if (set.colorHex === undefined) return `<${t('rPr')}${attrs}/>`
  return `<${t('rPr')}${attrs}>${solidFillXml(prefix, set.colorHex)}</${t('rPr')}>`
}

// --------------------------------------------------------------- rebuilding

/** `<a:t>` open tag, adding xml:space when edge whitespace must survive. */
function tOpen(tag: (n: string) => string, seg: string): string {
  const preserve = /^\s|\s$/.test(seg) ? ' xml:space="preserve"' : ''
  return `<${tag('t')}${preserve}>`
}

function rebuildParagraphs(
  s: string,
  rawParas: RawParagraph[],
  original: Paragraph[],
  next: EditedParagraph[],
): string {
  const prefix = rawParas[0].prefix
  const tag = (n: string): string => (prefix ? `${prefix}:${n}` : n)
  const slice = (e: Elem): string => s.slice(e.start, e.end)

  const srcParaOf = (idx: number | undefined): RawParagraph | undefined =>
    idx !== undefined ? rawParas[idx] : undefined

  const buildRun = (nr: EditedTextRun, para: EditedParagraph): string => {
    const srcP = nr.srcPara !== undefined ? rawParas[nr.srcPara] : undefined
    const item = srcP && nr.srcRun !== undefined ? srcP.items[nr.srcRun] : undefined
    const origRun =
      nr.srcPara !== undefined && nr.srcRun !== undefined
        ? original[nr.srcPara]?.runs[nr.srcRun]
        : undefined

    if (nr.text === '\n') {
      // Reuse the original <a:br/> bytes when this is still that break.
      if (item?.kind === 'br') return slice(item.elem)
      return `<${tag('br')}/>`
    }

    // Unchanged run: copy its bytes verbatim, preserving entity forms, fld
    // elements, CDATA — whatever was there.
    if (item && item.kind !== 'br' && origRun && nr.text === origRun.text) {
      return slice(item.elem)
    }

    // Changed or new run: synthesize <a:r>, reusing the best-matching rPr
    // bytes we have (own provenance, else the source paragraph's first run's).
    let rPrBytes = ''
    if (item?.rPr) rPrBytes = slice(item.rPr)
    else {
      const fallbackPara = srcP ?? srcParaOf(para.srcPara)
      const donor = fallbackPara?.items.find((it) => it.kind !== 'br' && it.rPr)
      if (donor?.rPr) rPrBytes = slice(donor.rPr)
    }

    // Embedded newlines become <a:br/> between text segments.
    return nr.text
      .split('\n')
      .map((seg) =>
        seg === '' ? '' : `<${tag('r')}>${rPrBytes}${tOpen(tag, seg)}${escapeXmlText(seg)}</${tag('t')}></${tag('r')}>`,
      )
      .join(`<${tag('br')}/>`)
  }

  return next
    .map((np) => {
      const srcP = srcParaOf(np.srcPara)
      const pPr = srcP?.pPr ? slice(srcP.pPr) : ''
      const endPr = srcP?.endParaRPr ? slice(srcP.endParaRPr) : ''
      const runs = np.runs.map((r) => buildRun(r, np)).join('')
      return `<${tag('p')}>${pPr}${runs}${endPr}</${tag('p')}>`
    })
    .join('')
}

// ------------------------------------------------------------ edit dispatch

interface SlideCtx {
  /** The slide's raw XML. */
  s: string
  doc: XmlNode[]
  sldElem: Elem
  /** Element children of p:spTree, in document order. */
  spTreeShapes: Elem[]
}

/**
 * Resolves an edit's node path on both the model and the scanner view, and
 * cross-checks that they agree on what kind of shape sits there.
 */
function locateShape(
  ctx: SlideCtx,
  nodePath: NodePath,
  allowed: readonly string[],
): { node: XmlNode; elem: Elem } {
  const node = resolveNodePath(ctx.doc, nodePath) ?? fail('node path no longer resolves')
  const nodeTag = tagNameOf(node) ?? fail('node path resolves to a text node')
  if (!allowed.includes(localOf(nodeTag))) fail(`unsupported shape for this edit (<${nodeTag}>)`)

  const parent = resolveNodePath(ctx.doc, nodePath.slice(0, -1)) ?? fail('spTree path broken')
  const siblings = childrenOf(parent)
  const last = nodePath[nodePath.length - 1]
  let ordinal = 0
  for (let j = 0; j < last; j++) if (tagNameOf(siblings[j]) !== null) ordinal++

  const elem = ctx.spTreeShapes[ordinal] ?? fail('shape ordinal out of range in raw XML')
  if (localOf(elem.name) !== localOf(nodeTag)) {
    fail(`raw XML disagrees with model at shape ordinal ${ordinal} (<${elem.name}>)`)
  }
  return { node, elem }
}

/** Shared text-shape validation: original matches model, scanner matches model. */
function validateTextShape(
  ctx: SlideCtx,
  node: XmlNode,
  elem: Elem,
  original: Paragraph[],
): RawParagraph[] {
  const modelParas = modelParagraphsOfSp(node) ?? fail('shape has no txBody')
  if (normalizeParagraphs(modelParas) !== normalizeParagraphs(original)) {
    fail('edit original does not match the retained slide XML — refusing to write')
  }
  const txBodyElem = childElemByLocal(ctx.s, elem, 'txBody') ?? fail('raw shape has no txBody')
  const rawParas = rawParagraphsOf(ctx.s, txBodyElem)
  if (rawParas.length !== modelParas.length) fail('paragraph count mismatch between scanner and model')
  for (let i = 0; i < rawParas.length; i++) {
    const raw = rawParas[i]
    const model = modelParas[i]
    if (raw.items.length !== model.runs.length) fail(`run count mismatch in paragraph ${i}`)
    for (let j = 0; j < raw.items.length; j++) {
      if ((raw.items[j].kind === 'br') !== isBr(model.runs[j])) {
        fail(`run kind mismatch at paragraph ${i}, run ${j}`)
      }
    }
  }
  return rawParas
}

function textEditOps(ctx: SlideCtx, edit: ShapeTextEdit): SpliceOp[] {
  if (edit.next.length === 0) fail('a text shape must keep at least one paragraph')
  const { node, elem } = locateShape(ctx, edit.nodePath, ['sp'])
  const rawParas = validateTextShape(ctx, node, elem, edit.original)

  const ops: SpliceOp[] = []
  if (isTextOnlyEdit(edit.original, edit.next)) {
    for (let i = 0; i < edit.next.length; i++) {
      for (let j = 0; j < edit.next[i].runs.length; j++) {
        const nr = edit.next[i].runs[j]
        const or = edit.original[i].runs[j]
        if (nr.text === or.text) continue
        const t = rawParas[i].items[j].t ?? fail('changed run has no <a:t> in raw XML')
        ops.push({ start: t.contentStart, end: t.contentEnd, insert: escapeXmlText(nr.text) })
      }
    }
  } else {
    if (rawParas.length === 0) fail('cannot rebuild a txBody with no paragraphs')
    ops.push({
      start: rawParas[0].elem.start,
      end: rawParas[rawParas.length - 1].elem.end,
      insert: rebuildParagraphs(ctx.s, rawParas, edit.original, edit.next),
    })
  }
  return ops
}

function formatRunsOps(ctx: SlideCtx, edit: FormatRunsEdit): SpliceOp[] {
  if (!hasOverride(edit.set) || edit.targets.length === 0) return []
  let set = edit.set
  if (set.colorHex !== undefined) {
    if (!/^[0-9A-Fa-f]{6}$/.test(set.colorHex)) fail(`colorHex must be RRGGBB (got "${set.colorHex}")`)
    set = { ...set, colorHex: set.colorHex.toUpperCase() }
  }

  const { node, elem } = locateShape(ctx, edit.nodePath, ['sp'])
  const rawParas = validateTextShape(ctx, node, elem, edit.original)

  const seen = new Set<string>()
  const ops: SpliceOp[] = []
  for (const target of edit.targets) {
    const key = `${target.para}:${target.run}`
    if (seen.has(key)) fail(`duplicate format target ${key}`)
    seen.add(key)
    const para = edit.original[target.para] ?? fail(`format target paragraph ${target.para} out of range`)
    const run = para.runs[target.run] ?? fail(`format target run ${key} out of range`)
    if (isBr(run)) fail('cannot format a line break')
    const item = rawParas[target.para].items[target.run]
    if (item.rPr) {
      ops.push(...transformRPrOps(ctx.s, item.rPr, set))
    } else {
      // rPr is the first child of a:r / a:fld; the run always has content
      // (kept items carry a non-empty <a:t>).
      ops.push({
        start: item.elem.contentStart,
        end: item.elem.contentStart,
        insert: synthesizedRPr(prefixOf(item.elem.name), set),
      })
    }
  }
  return ops
}

function paragraphAlignOps(ctx: SlideCtx, edit: ParagraphAlignEdit): SpliceOp[] {
  const { node, elem } = locateShape(ctx, edit.nodePath, ['sp'])
  const rawParas = validateTextShape(ctx, node, elem, edit.original)
  const para = rawParas[edit.paraIndex] ?? fail(`paragraph ${edit.paraIndex} out of range`)

  // Attribute-level splice on the pPr open tag; children stay byte-identical.
  if (para.pPr) return setAttrOps(ctx.s, para.pPr, [['algn', edit.align]])

  // No pPr: synthesize one as the FIRST child of a:p (schema position).
  const t = para.prefix ? `${para.prefix}:` : ''
  const pPrXml = `<${t}pPr algn="${edit.align}"/>`
  if (!para.elem.selfClosing) {
    return [{ start: para.elem.contentStart, end: para.elem.contentStart, insert: pPrXml }]
  }
  // `<a:p/>`: reopen it.
  const info = openTagInfo(ctx.s, para.elem)
  return [{ start: info.closeStart, end: para.elem.end, insert: `>${pPrXml}</${para.elem.name}>` }]
}

function shapeGeometryOps(ctx: SlideCtx, edit: ShapeGeometryEdit): SpliceOp[] {
  if (!edit.offEmu && !edit.extEmu) return []
  const { elem } = locateShape(ctx, edit.nodePath, ['sp', 'pic', 'cxnSp'])
  const spPr = childElemByLocal(ctx.s, elem, 'spPr') ?? fail('shape has no spPr')

  const off = edit.offEmu && {
    x: String(Math.round(edit.offEmu.x)),
    y: String(Math.round(edit.offEmu.y)),
  }
  const ext = edit.extEmu && {
    cx: String(Math.max(1, Math.round(edit.extEmu.w))),
    cy: String(Math.max(1, Math.round(edit.extEmu.h))),
  }

  const xfrm = spPr.selfClosing ? undefined : childElemByLocal(ctx.s, spPr, 'xfrm')

  if (!xfrm || xfrm.selfClosing) {
    // Inherited (or empty) geometry: synthesize the transform. The schema
    // requires both off and ext, so partial input cannot be honored here.
    if (!off || !ext) {
      fail('shape has no explicit xfrm — geometry edits must provide both offEmu and extEmu')
    }
    const aPfx = drawingPrefixOf(ctx.s, ctx.sldElem)
    const t = (n: string): string => (aPfx ? `${aPfx}:${n}` : n)
    const inner = `<${t('off')} x="${off.x}" y="${off.y}"/><${t('ext')} cx="${ext.cx}" cy="${ext.cy}"/>`
    if (xfrm) {
      // `<a:xfrm/>`: reopen it; its own attributes (rot, flips) are untouched.
      const info = openTagInfo(ctx.s, xfrm)
      return [{ start: info.closeStart, end: xfrm.end, insert: `>${inner}</${xfrm.name}>` }]
    }
    const xfrmXml = `<${t('xfrm')}>${inner}</${t('xfrm')}>`
    if (!spPr.selfClosing) {
      // FIRST child of spPr — CT_ShapeProperties orders xfrm before geometry.
      return [{ start: spPr.contentStart, end: spPr.contentStart, insert: xfrmXml }]
    }
    const info = openTagInfo(ctx.s, spPr)
    return [{ start: info.closeStart, end: spPr.end, insert: `>${xfrmXml}</${spPr.name}>` }]
  }

  // Existing xfrm: numeric attribute splices only. rot/flipH/flipV live on the
  // xfrm open tag, which these ops never touch.
  const ops: SpliceOp[] = []
  const offElem = childElemByLocal(ctx.s, xfrm, 'off')
  const extElem = childElemByLocal(ctx.s, xfrm, 'ext')
  const aPfx = prefixOf(xfrm.name)
  const t = (n: string): string => (aPfx ? `${aPfx}:${n}` : n)
  let insertAtStart = ''
  if (off) {
    if (offElem) ops.push(...setAttrOps(ctx.s, offElem, [['x', off.x], ['y', off.y]]))
    else insertAtStart += `<${t('off')} x="${off.x}" y="${off.y}"/>`
  }
  if (ext) {
    if (extElem) {
      ops.push(...setAttrOps(ctx.s, extElem, [['cx', ext.cx], ['cy', ext.cy]]))
    } else if (offElem) {
      ops.push({ start: offElem.end, end: offElem.end, insert: `<${t('ext')} cx="${ext.cx}" cy="${ext.cy}"/>` })
    } else {
      insertAtStart += `<${t('ext')} cx="${ext.cx}" cy="${ext.cy}"/>`
    }
  }
  if (insertAtStart) {
    ops.push({ start: xfrm.contentStart, end: xfrm.contentStart, insert: insertAtStart })
  }
  return ops
}

// -------------------------------------------------------------- updateSlideXml

/**
 * Applies edits to one slide's raw XML. Returns the raw string unchanged when
 * there is nothing to change. Throws (leaving the caller's file untouched) on
 * any inconsistency between the model, the edit, and the raw bytes.
 */
export function updateSlideXml(slideXmlRaw: string, edits: readonly SlideEdit[]): string {
  if (edits.length === 0) return slideXmlRaw

  const doc = parseXml(slideXmlRaw)

  // Scanner view of the same document, cross-validated per edit.
  const rootElems = childElementsIn(slideXmlRaw, 0, slideXmlRaw.length)
  const sldElem = rootElems.find((e) => localOf(e.name) === 'sld') ?? fail('no <p:sld> element')
  const cSldElem = childElemByLocal(slideXmlRaw, sldElem, 'cSld') ?? fail('no <p:cSld> element')
  const spTreeElem = childElemByLocal(slideXmlRaw, cSldElem, 'spTree') ?? fail('no <p:spTree> element')
  const ctx: SlideCtx = {
    s: slideXmlRaw,
    doc,
    sldElem,
    spTreeShapes: childElemsOf(slideXmlRaw, spTreeElem),
  }

  const ops: SpliceOp[] = []
  for (const edit of edits) {
    switch (edit.kind) {
      case 'text':
        ops.push(...textEditOps(ctx, edit))
        break
      case 'formatRuns':
        ops.push(...formatRunsOps(ctx, edit))
        break
      case 'paragraphAlign':
        ops.push(...paragraphAlignOps(ctx, edit))
        break
      case 'shapeGeometry':
        ops.push(...shapeGeometryOps(ctx, edit))
        break
    }
  }

  if (ops.length === 0) return slideXmlRaw
  return applySplices(slideXmlRaw, ops)
}

// ------------------------------------------------------------------ writeDeck

/**
 * Produces the full .pptx bytes with edits applied. Every entry except the
 * edited slides is copied byte-for-byte from the source archive (raw bytes,
 * never re-encoded); entry order, dates, permissions and comments carry over.
 */
export async function writeDeck(
  deck: SlideDeck,
  editsBySlide: ReadonlyMap<string, readonly SlideEdit[]>,
): Promise<Uint8Array> {
  for (const slidePath of editsBySlide.keys()) {
    if (deck.source.slideXml[slidePath] === undefined) {
      fail(`edits reference unknown slide ${slidePath}`)
    }
  }

  const out = new JSZip()
  const files = deck.source.zip.files
  for (const name of Object.keys(files)) {
    const entry = files[name]
    if (entry.dir) continue
    const meta = {
      date: entry.date,
      comment: entry.comment ?? undefined,
      unixPermissions: entry.unixPermissions ?? undefined,
      dosPermissions: entry.dosPermissions ?? undefined,
      createFolders: false,
    }
    const edits = editsBySlide.get(name)
    if (edits && edits.length > 0) {
      out.file(name, updateSlideXml(deck.source.slideXml[name], edits), meta)
    } else {
      out.file(name, await entry.async('uint8array'), { ...meta, binary: true })
    }
  }
  return out.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
