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
  relsPathFor,
  resolveNodePath,
  resolveRelTarget,
  shapeIdOf,
  tagNameOf,
  type XmlNode,
} from './parse'
import { normalizeShapeStyle, shapeStyleSnapshotOf, type ShapeStyleSnapshot } from './geometry'
import { newPictureXml, newShapeXml, type NewShapeSpec, type XmlPrefixes } from './shape-xml'
import type { NodePath, Paragraph, Shape, SlideDeck, TextAlign, TextRun } from './types'

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
  /**
   * Latin typeface. Unlike the others this is a CHILD ELEMENT of rPr
   * (`<a:latin typeface="…"/>`), not an attribute: an existing one is spliced
   * at the attribute level, an absent one is inserted at its schema position.
   */
  latinFont?: string
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

/**
 * Removes one shape's entire element range from its slide. The edit carries
 * what the editor believed about the target — its model kind, its id, and for
 * text shapes its as-parsed paragraphs — and all of it is re-derived from the
 * retained bytes and compared before anything is spliced.
 */
export interface DeleteShapeEdit {
  kind: 'deleteShape'
  nodePath: NodePath
  /** The model's shape kind; constrains which element names may sit there. */
  shapeType: Shape['type']
  /** The model's shape id (`p:cNvPr@id`, or the synthesized `idx:<n>`). */
  shapeId: string
  /** Text shapes only: as-parsed paragraphs, revalidated before removal. */
  original?: Paragraph[]
}

/**
 * Recolours a shape's fill and/or outline. Only `p:sp` and `p:cxnSp` qualify
 * (a connector has no fill), and the edit carries the shape's identity plus
 * its as-parsed spPr style so both are re-derived and compared before any
 * splice — images, graphicFrames and groups are rejected outright.
 */
export interface SetShapeStyleEdit {
  kind: 'setShapeStyle'
  nodePath: NodePath
  /** The model's shape kind; only text/drawing can be restyled. */
  shapeType: Shape['type']
  /** The model's shape id (`p:cNvPr@id`, or the synthesized `idx:<n>`). */
  shapeId: string
  /** The shape's as-parsed spPr fill/line; the fail-closed anchor. */
  original: ShapeStyleSnapshot
  /** Six-digit RRGGBB for the shape fill. */
  fillHex?: string
  /** Six-digit RRGGBB for the outline. */
  lineHex?: string
}

/**
 * Adds a wholly new shape to a slide, spliced immediately before
 * `</p:spTree>` so it lands on top of the z-order. The element's `p:cNvPr@id`
 * is assigned at write time from the slide's existing ids plus every other
 * pending insert; a picture additionally claims a media part and a
 * relationship, which `writeDeck` splices into that slide's .rels.
 */
export interface InsertShapeEdit {
  kind: 'insertShape'
  spec: NewShapeSpec
}

export type SlideEdit =
  | ShapeTextEdit
  | InsertShapeEdit
  | SetShapeStyleEdit
  | FormatRunsEdit
  | ParagraphAlignEdit
  | ShapeGeometryEdit
  | DeleteShapeEdit

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
        latinFont: r.latinFont,
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
    a.colorHex === b.colorHex &&
    a.latinFont === b.latinFont
  )
}

// ------------------------------------------------------------------ escaping

/**
 * Escapes a value for a double-quoted XML attribute. Font family names are
 * arbitrary user/OS strings, so unlike the enum and integer attributes
 * elsewhere in this module they genuinely need escaping.
 */
function escapeXmlAttr(s: string): string {
  return (
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // eslint-disable-next-line no-control-regex -- stripping them is the point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  )
}

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

/**
 * rPr children the schema orders AFTER `a:latin`, per CT_TextCharacterProperties
 * (ln, fill, effects, highlight, underline fill/line, latin, ea, cs, sym,
 * hlink*, rtl, extLst). A synthesized `a:latin` goes before the first of these.
 */
const AFTER_LATIN_LOCALS = ['ea', 'cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst']

const hasOverride = (set: RunFormatOverrides): boolean =>
  set.bold !== undefined ||
  set.italic !== undefined ||
  set.underline !== undefined ||
  set.sizePt !== undefined ||
  set.colorHex !== undefined ||
  set.latinFont !== undefined

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

function latinXml(prefix: string, typeface: string): string {
  const t = (n: string): string => (prefix ? `${prefix}:${n}` : n)
  return `<${t('latin')} typeface="${escapeXmlAttr(typeface)}"/>`
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

  const prefix = prefixOf(rPr.name)
  const fill = set.colorHex !== undefined ? solidFillXml(prefix, set.colorHex) : ''
  const wantsLatin = set.latinFont !== undefined

  // Attributes only: nothing inside the element moves.
  if (!fill && !wantsLatin) {
    if (attrInserts) ops.push({ start: info.closeStart, end: info.closeStart, insert: attrInserts })
    return ops
  }

  if (rPr.selfClosing) {
    // `<a:rPr .../>` must reopen to hold children; fold the new attributes and
    // every child into ONE op, in schema order, so nothing overlaps.
    const inner = fill + (wantsLatin ? latinXml(prefix, set.latinFont as string) : '')
    ops.push({
      start: info.closeStart,
      end: rPr.end,
      insert: `${attrInserts}>${inner}</${rPr.name}>`,
    })
    return ops
  }

  if (attrInserts) ops.push({ start: info.closeStart, end: info.closeStart, insert: attrInserts })
  const children = childElemsOf(s, rPr)

  // Zero-length inserts are merged per offset: two children inserted at the
  // same point as separate ops would tie in applySplices, which resolves ties
  // by array order rather than schema order.
  const inserts = new Map<number, string>()
  const addInsert = (at: number, xml: string): void => {
    inserts.set(at, (inserts.get(at) ?? '') + xml)
  }

  if (fill) {
    const existingFill = children.find((c) => FILL_LOCALS.includes(localOf(c.name)))
    if (existingFill) {
      ops.push({ start: existingFill.start, end: existingFill.end, insert: fill })
    } else {
      const ln = children.find((c) => localOf(c.name) === 'ln')
      addInsert(ln ? ln.end : rPr.contentStart, fill)
    }
  }

  if (wantsLatin) {
    const existingLatin = children.find((c) => localOf(c.name) === 'latin')
    if (existingLatin) {
      // Attribute-level splice: every other byte of the element — and of its
      // neighbours — is left exactly as authored.
      ops.push(...setAttrOps(s, existingLatin, [['typeface', escapeXmlAttr(set.latinFont as string)]]))
    } else {
      const after = children.find((c) => AFTER_LATIN_LOCALS.includes(localOf(c.name)))
      addInsert(after ? after.start : rPr.contentEnd, latinXml(prefix, set.latinFont as string))
    }
  }

  for (const [at, xml] of inserts) ops.push({ start: at, end: at, insert: xml })
  return ops
}

/** A fresh rPr for a run that had none. `prefix` is the run element's own. */
function synthesizedRPr(prefix: string, set: RunFormatOverrides): string {
  const t = (n: string): string => (prefix ? `${prefix}:${n}` : n)
  const attrs = attrPairsFor(set)
    .map(([n, v]) => ` ${n}="${v}"`)
    .join('')
  // Children in schema order: the fill group precedes a:latin.
  const children =
    (set.colorHex !== undefined ? solidFillXml(prefix, set.colorHex) : '') +
    (set.latinFont !== undefined ? latinXml(prefix, set.latinFont) : '')
  if (!children) return `<${t('rPr')}${attrs}/>`
  return `<${t('rPr')}${attrs}>${children}</${t('rPr')}>`
}

/**
 * The run properties a rebuilt run must carry in its own rPr: everything that
 * differs from the run it derives from. A run with no provenance has no
 * original, so every property it carries is its own.
 */
function runOverridesOf(nr: EditedTextRun, origRun: TextRun | undefined): RunFormatOverrides {
  const set: RunFormatOverrides = {}
  if (Boolean(nr.bold) !== Boolean(origRun?.bold)) set.bold = Boolean(nr.bold)
  if (Boolean(nr.italic) !== Boolean(origRun?.italic)) set.italic = Boolean(nr.italic)
  if (Boolean(nr.underline) !== Boolean(origRun?.underline)) set.underline = Boolean(nr.underline)
  if (nr.sizePt !== undefined && nr.sizePt !== origRun?.sizePt) set.sizePt = nr.sizePt
  if (nr.colorHex !== undefined && nr.colorHex !== origRun?.colorHex) set.colorHex = nr.colorHex
  if (nr.latinFont !== undefined && nr.latinFont !== origRun?.latinFont) set.latinFont = nr.latinFont
  return set
}

/**
 * Donor rPr bytes with a run's own overrides applied on top, reusing the very
 * same transform the in-place formatting path uses — so a rebuilt run ends up
 * with exactly the rPr an in-place edit would have produced. Without this a
 * structurally-new run silently lost every property the user had set on it.
 */
function rPrWithOverrides(prefix: string, donorBytes: string, set: RunFormatOverrides): string {
  if (!hasOverride(set)) return donorBytes
  if (!donorBytes) return synthesizedRPr(prefix, set)
  const rPr = childElementsIn(donorBytes, 0, donorBytes.length)[0]
  if (!rPr || localOf(rPr.name) !== 'rPr') return synthesizedRPr(prefix, set)
  return applySplices(donorBytes, transformRPrOps(donorBytes, rPr, set))
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

  /**
   * rPr bytes to inherit from when a run has none of its own. A paragraph the
   * user created (Enter) has no source, so without walking to a NEIGHBOURING
   * paragraph the run would be written bare — and a bare run takes the
   * shape's cascade default, which for a title placeholder is routinely white
   * on a light slide. That is the "typing does nothing" report.
   */
  const donorRPrFor = (paraIndex: number): string => {
    const firstRPrOf = (rp: RawParagraph | undefined): string | undefined => {
      const item = rp?.items.find((it) => it.kind !== 'br' && it.rPr)
      return item?.rPr ? slice(item.rPr) : undefined
    }
    // Nearest preceding paragraph with a source, then nearest following.
    for (let i = paraIndex; i >= 0; i--) {
      const got = firstRPrOf(srcParaOf(next[i]?.srcPara))
      if (got) return got
    }
    for (let i = paraIndex + 1; i < next.length; i++) {
      const got = firstRPrOf(srcParaOf(next[i]?.srcPara))
      if (got) return got
    }
    // Nothing in this edit has a source: fall back to the shape's own bytes.
    for (const rp of rawParas) {
      const got = firstRPrOf(rp)
      if (got) return got
    }
    return ''
  }

  const buildRun = (nr: EditedTextRun, para: EditedParagraph, paraIndex: number): string => {
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
    // bytes we have (own provenance, else the source paragraph's first run's,
    // else a neighbouring paragraph's).
    let rPrBytes = ''
    if (item?.rPr) rPrBytes = slice(item.rPr)
    else {
      const fallbackPara = srcP ?? srcParaOf(para.srcPara)
      const donor = fallbackPara?.items.find((it) => it.kind !== 'br' && it.rPr)
      rPrBytes = donor?.rPr ? slice(donor.rPr) : donorRPrFor(paraIndex)
    }
    // Then the run's OWN properties on top of whatever it inherited.
    rPrBytes = rPrWithOverrides(prefix, rPrBytes, runOverridesOf(nr, origRun))

    // Embedded newlines become <a:br/> between text segments.
    return nr.text
      .split('\n')
      .map((seg) =>
        seg === '' ? '' : `<${tag('r')}>${rPrBytes}${tOpen(tag, seg)}${escapeXmlText(seg)}</${tag('t')}></${tag('r')}>`,
      )
      .join(`<${tag('br')}/>`)
  }

  return next
    .map((np, pi) => {
      const srcP = srcParaOf(np.srcPara)
      const pPr = srcP?.pPr ? slice(srcP.pPr) : ''
      const endPr = srcP?.endParaRPr ? slice(srcP.endParaRPr) : ''
      const runs = np.runs.map((r) => buildRun(r, np, pi)).join('')
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
  /** The `p:spTree` element; inserts append just inside its close tag. */
  spTreeElem: Elem
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
  if (set.latinFont !== undefined) {
    // The value reaches an attribute, so it is escaped on the way out; an
    // empty typeface is meaningless and would write an unusable a:latin.
    const typeface = set.latinFont.trim()
    if (!typeface) fail('latinFont must not be empty')
    if (typeface.length > 64) fail(`latinFont is implausibly long (${typeface.length} chars)`)
    set = { ...set, latinFont: typeface }
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

/** Element names each model shape kind can occupy in the spTree. */
const DELETE_TAGS: Record<Shape['type'], readonly string[]> = {
  text: ['sp'],
  drawing: ['sp', 'cxnSp'],
  image: ['pic'],
  // Chart/table/diagram placeholders are graphicFrames; video (and missing
  // media) placeholders are p:pic.
  placeholder: ['graphicFrame', 'pic'],
  group: ['grpSp'],
}

function deleteShapeOps(ctx: SlideCtx, edit: DeleteShapeEdit): SpliceOp[] {
  const allowed = DELETE_TAGS[edit.shapeType] ?? fail(`unknown shape type "${edit.shapeType}"`)
  const { node, elem } = locateShape(ctx, edit.nodePath, allowed)

  // Replay the model's id derivation on the re-parsed node. A mismatch means
  // the path no longer points at the shape the user deleted.
  const derivedId = shapeIdOf(node, edit.nodePath[edit.nodePath.length - 1])
  if (derivedId !== edit.shapeId) {
    fail(`delete target mismatch: edit names shape "${edit.shapeId}", slide XML has "${derivedId}"`)
  }

  // Text shapes carry their content; re-derive it from the bytes and compare.
  if (edit.shapeType === 'text') {
    if (!edit.original) fail('deleting a text shape requires its original paragraphs')
    validateTextShape(ctx, node, elem, edit.original)
  }

  // Exactly the element's own byte range: whitespace between siblings sits
  // outside [start, end) and survives untouched.
  return [{ start: elem.start, end: elem.end, insert: '' }]
}

/**
 * spPr children the schema orders AFTER the fill group, per
 * CT_ShapeProperties (xfrm, geometry, fill, ln, effects, 3-D, extLst). A
 * synthesized fill goes before the first of these — i.e. after prstGeom /
 * custGeom and before a:ln.
 */
const AFTER_FILL_LOCALS = ['ln', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst']
/** And the same for a:ln itself, which sits between the fill and the effects. */
const AFTER_LN_LOCALS = ['effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst']

function setShapeStyleOps(ctx: SlideCtx, edit: SetShapeStyleEdit): SpliceOp[] {
  if (edit.fillHex === undefined && edit.lineHex === undefined) return []
  for (const hex of [edit.fillHex, edit.lineHex]) {
    if (hex !== undefined && !/^[0-9A-Fa-f]{6}$/.test(hex)) {
      fail(`shape style colors must be RRGGBB (got "${hex}")`)
    }
  }
  // Only shapes the model calls text or drawing can be restyled; that maps to
  // p:sp and p:cxnSp, so images / graphicFrames / groups never get this far.
  if (edit.shapeType !== 'text' && edit.shapeType !== 'drawing') {
    fail(`shape type "${edit.shapeType}" cannot be restyled`)
  }
  const { node, elem } = locateShape(ctx, edit.nodePath, ['sp', 'cxnSp'])

  const derivedId = shapeIdOf(node, edit.nodePath[edit.nodePath.length - 1])
  if (derivedId !== edit.shapeId) {
    fail(`style target mismatch: edit names shape "${edit.shapeId}", slide XML has "${derivedId}"`)
  }
  // A connector carries no fill of its own.
  if (edit.fillHex !== undefined && localOf(elem.name) === 'cxnSp') {
    fail('a connector (p:cxnSp) has no fill — only its outline can be set')
  }

  // Re-derive the shape's own spPr style from the retained bytes; if it does
  // not match what the editor believed, the splice ranges below are not the
  // ones the user was looking at.
  const derived = shapeStyleSnapshotOf(node)
  if (normalizeShapeStyle(derived) !== normalizeShapeStyle(edit.original)) {
    fail(
      `shape style does not match the slide XML for shape "${edit.shapeId}" ` +
        `(expected ${normalizeShapeStyle(edit.original)}, found ${normalizeShapeStyle(derived)})`,
    )
  }

  const spPr = childElemByLocal(ctx.s, elem, 'spPr') ?? fail('shape has no spPr')
  const aPfx = drawingPrefixOf(ctx.s, ctx.sldElem)
  const t = (n: string): string => (aPfx ? `${aPfx}:${n}` : n)
  const ops: SpliceOp[] = []

  // Everything below reopens spPr at most once; collect what a self-closing
  // spPr must be reopened with, in schema order.
  let reopen = ''
  const spPrKids = spPr.selfClosing ? [] : childElemsOf(ctx.s, spPr)

  // Zero-length inserts merged per offset. A fill and a synthesized a:ln both
  // land at spPr.contentEnd, and as two separate ops applySplices would break
  // the tie by processing order — emitting a:ln BEFORE the fill, which is
  // invalid CT_ShapeProperties order.
  const inserts = new Map<number, string>()
  const addInsert = (at: number, xml: string): void => {
    inserts.set(at, (inserts.get(at) ?? '') + xml)
  }

  if (edit.fillHex !== undefined) {
    const fillXml = solidFillXml(aPfx, edit.fillHex.toUpperCase())
    const existing = spPrKids.find((c) => FILL_LOCALS.includes(localOf(c.name)))
    if (existing) {
      // Replace the ENTIRE fill element — solidFill, gradFill or noFill alike.
      // Its whole range goes, so a gradient's stop list cannot survive as
      // orphaned children of the new solid fill.
      ops.push({ start: existing.start, end: existing.end, insert: fillXml })
    } else if (spPr.selfClosing) {
      reopen += fillXml
    } else {
      const after = spPrKids.find((c) => AFTER_FILL_LOCALS.includes(localOf(c.name)))
      addInsert(after ? after.start : spPr.contentEnd, fillXml)
    }
  }

  if (edit.lineHex !== undefined) {
    const lineFillXml = solidFillXml(aPfx, edit.lineHex.toUpperCase())
    const ln = spPr.selfClosing ? undefined : spPrKids.find((c) => localOf(c.name) === 'ln')
    if (!ln) {
      // No outline authored: a minimal a:ln holding just the colour, so the
      // shape gains a stroke without inventing a width or a dash.
      const lnXml = `<${t('ln')}>${lineFillXml}</${t('ln')}>`
      if (spPr.selfClosing) {
        reopen += lnXml
      } else {
        const after = spPrKids.find((c) => AFTER_LN_LOCALS.includes(localOf(c.name)))
        addInsert(after ? after.start : spPr.contentEnd, lnXml)
      }
    } else if (ln.selfClosing) {
      // `<a:ln w="12700"/>`: reopen it, keeping its attributes (w, cap, cmpd).
      const info = openTagInfo(ctx.s, ln)
      ops.push({ start: info.closeStart, end: ln.end, insert: `>${lineFillXml}</${ln.name}>` })
    } else {
      const lnKids = childElemsOf(ctx.s, ln)
      const existing = lnKids.find((c) => FILL_LOCALS.includes(localOf(c.name)))
      if (existing) {
        // Only the fill child moves; a:ln's own w/cap/cmpd attributes and its
        // prstDash / join / head-tail children are all outside this range.
        ops.push({ start: existing.start, end: existing.end, insert: lineFillXml })
      } else {
        // CT_LineProperties puts the fill group first.
        ops.push({ start: ln.contentStart, end: ln.contentStart, insert: lineFillXml })
      }
    }
  }

  for (const [at, xml] of inserts) ops.push({ start: at, end: at, insert: xml })
  if (reopen) {
    const info = openTagInfo(ctx.s, spPr)
    ops.push({ start: info.closeStart, end: spPr.end, insert: `>${reopen}</${spPr.name}>` })
  }
  return ops
}

// ------------------------------------------------------------ inserting

/** Namespace prefix bound to a URI on the slide root, for synthesized XML. */
function prefixForNs(s: string, sldElem: Elem, uri: string, fallback: string): string {
  for (const a of openTagInfo(s, sldElem).attrs) {
    if (a.value === uri && a.name.startsWith('xmlns:')) return a.name.slice(6)
    if (a.value === uri && a.name === 'xmlns') return ''
  }
  return fallback
}

const PML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const OREL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function prefixesOf(ctx: SlideCtx): XmlPrefixes {
  return {
    p: prefixForNs(ctx.s, ctx.sldElem, PML_NS, prefixOf(ctx.spTreeElem.name)),
    a: prefixForNs(ctx.s, ctx.sldElem, DML_NS, drawingPrefixOf(ctx.s, ctx.sldElem)),
    r: prefixForNs(ctx.s, ctx.sldElem, OREL_NS, 'r'),
  }
}

/**
 * The highest `p:cNvPr@id` anywhere in the slide. Scanned over the raw bytes
 * rather than the shape list, because ids must be unique across the WHOLE
 * part — group children and the spTree's own nvGrpSpPr included.
 */
function maxShapeIdIn(s: string): number {
  let max = 0
  for (const m of s.matchAll(/<[^<>]*?cNvPr\b[^<>]*?\bid="(\d+)"/g)) {
    const n = Number(m[1])
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return max
}

/**
 * ALL inserts for a slide, as ONE op at the end of spTree. Emitting one op per
 * insert would tie at the same offset, and applySplices breaks ties by
 * processing order — which would silently reverse the z-order the user chose.
 */
function insertShapeOps(
  ctx: SlideCtx,
  inserts: readonly InsertShapeEdit[],
  rIdFor: (edit: InsertShapeEdit) => string,
): SpliceOp[] {
  if (inserts.length === 0) return []
  if (ctx.spTreeElem.selfClosing) fail('slide has an empty <p:spTree/>')
  const px = prefixesOf(ctx)
  let nextId = maxShapeIdIn(ctx.s)

  let xml = ''
  for (const edit of inserts) {
    const id = ++nextId
    xml +=
      edit.spec.kind === 'image'
        ? newPictureXml(edit.spec, id, rIdFor(edit), px)
        : newShapeXml(edit.spec, id, px)
  }
  const at = ctx.spTreeElem.contentEnd
  return [{ start: at, end: at, insert: xml }]
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
export interface UpdateSlideOptions {
  /**
   * Relationship id for an image insert. `writeDeck` supplies this after
   * claiming the media part and splicing the slide's .rels; a caller that
   * inserts no images never needs it.
   */
  rIdFor?: (edit: InsertShapeEdit) => string | undefined
}

export function updateSlideXml(
  slideXmlRaw: string,
  edits: readonly SlideEdit[],
  options?: UpdateSlideOptions,
): string {
  if (edits.length === 0) return slideXmlRaw

  const buildCtx = (s: string): SlideCtx => {
    // Scanner view of the same document, cross-validated per edit.
    const rootElems = childElementsIn(s, 0, s.length)
    const sldElem = rootElems.find((e) => localOf(e.name) === 'sld') ?? fail('no <p:sld> element')
    const cSldElem = childElemByLocal(s, sldElem, 'cSld') ?? fail('no <p:cSld> element')
    const spTreeElem = childElemByLocal(s, cSldElem, 'spTree') ?? fail('no <p:spTree> element')
    return {
      s,
      doc: parseXml(s),
      sldElem,
      spTreeElem,
      spTreeShapes: childElemsOf(s, spTreeElem),
    }
  }

  // Inserts run in their OWN pass, first. Every other edit addresses a shape
  // by node path, and a shape inserted in this same save does not exist in
  // the base bytes — so its path would not resolve. Applying inserts first
  // and re-scanning makes an inserted shape addressable exactly like any
  // other, which is what "inserted shapes are ordinary shapes" has to mean.
  const inserts = edits.filter((e): e is InsertShapeEdit => e.kind === 'insertShape')
  let working = slideXmlRaw
  if (inserts.length > 0) {
    const insertOps = insertShapeOps(buildCtx(working), inserts, (edit) => {
      const rId = options?.rIdFor?.(edit)
      if (!rId) fail('an image insert reached the writer with no relationship id')
      return rId
    })
    if (insertOps.length > 0) working = applySplices(working, insertOps)
  }

  const rest = edits.filter((e) => e.kind !== 'insertShape')
  if (rest.length === 0) return working

  const ctx = buildCtx(working)
  const ops: SpliceOp[] = []
  for (const edit of rest) {
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
      case 'setShapeStyle':
        ops.push(...setShapeStyleOps(ctx, edit))
        break
      case 'shapeGeometry':
        ops.push(...shapeGeometryOps(ctx, edit))
        break
      case 'deleteShape':
        ops.push(...deleteShapeOps(ctx, edit))
        break
    }
  }

  if (ops.length === 0) return working
  return applySplices(working, ops)
}

// ------------------------------------------- slide addition / deletion

const PRESENTATION_PATH = 'ppt/presentation.xml'
const PRESENTATION_RELS_PATH = 'ppt/_rels/presentation.xml.rels'
const CONTENT_TYPES_PATH = '[Content_Types].xml'
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** A synthesized slide to add to the package (see lib/pptx/add-slide.ts). */
export interface NewSlidePart {
  /** New part path; must not collide with any existing entry. */
  path: string
  /** Complete slide XML; slide edits addressed at `path` apply on top of it. */
  xml: string
  /** Complete .rels for the part. */
  relsXml: string
  /** Existing or previously-added slide this one follows; '' = deck front. */
  afterPath: string
}

/** Attribute value from a scanned open tag, by exact raw name. */
function rawAttrOf(info: OpenTagInfo, name: string): string | undefined {
  return info.attrs.find((a) => a.name === name)?.value
}

/**
 * The prefixed attribute whose local name matches, mirroring the parser's
 * `prefixedAttr`: `p:sldId` carries both a plain `id` and the `r:id` we want.
 */
function rawPrefixedAttrOf(info: OpenTagInfo, localName: string): string | undefined {
  const a = info.attrs.find((x) => x.name.includes(':') && localOf(x.name) === localName)
  return a?.value
}

async function requiredPart(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) fail(`package part ${path} is missing`)
  return file.async('string')
}

/**
 * The three package-part rewrites slide addition and deletion force, computed
 * as element-range splices (removals) and point insertions so every byte
 * outside the touched elements is untouched:
 *
 *  - `ppt/_rels/presentation.xml.rels`: a deleted slide's `<Relationship>`
 *    goes (resolving its Target is how the slide's `r:id` is found); an added
 *    slide appends one with a freshly assigned unique `rId`;
 *  - `ppt/presentation.xml`: the `<p:sldId>` carrying that `r:id` goes /
 *    a new one is inserted right after its anchor's, with a unique numeric id;
 *  - `[Content_Types].xml`: the per-part `<Override>` goes when one exists /
 *    a new one is appended, typed like the existing slide Overrides.
 *
 * Every lookup must resolve to exactly one element or the save fails closed.
 */
async function packageReplacements(
  zip: JSZip,
  deletions: readonly string[],
  adds: readonly NewSlidePart[],
  order: readonly string[] | undefined,
): Promise<Map<string, string>> {
  const relsRaw = await requiredPart(zip, PRESENTATION_RELS_PATH)
  const relsRoot = childElementsIn(relsRaw, 0, relsRaw.length).find(
    (e) => localOf(e.name) === 'Relationships',
  )
  if (!relsRoot) fail(`no <Relationships> element in ${PRESENTATION_RELS_PATH}`)
  if (relsRoot.selfClosing) fail(`empty <Relationships/> in ${PRESENTATION_RELS_PATH}`)
  const relElems = childElemsOf(relsRaw, relsRoot).filter((e) => localOf(e.name) === 'Relationship')

  /** Slide part path -> its relationship's rId, for every slide Relationship. */
  const rIdBySlidePath = new Map<string, string>()
  let maxRelNum = 0
  for (const e of relElems) {
    const info = openTagInfo(relsRaw, e)
    const rId = rawAttrOf(info, 'Id')
    if (!rId) continue
    const m = rId.match(/^rId(\d+)$/)
    if (m) maxRelNum = Math.max(maxRelNum, Number(m[1]))
    const target = rawAttrOf(info, 'Target')
    const type = rawAttrOf(info, 'Type') ?? ''
    if (target !== undefined && type.endsWith('/slide')) {
      rIdBySlidePath.set(resolveRelTarget('ppt', target), rId)
    }
  }

  const relOps: SpliceOp[] = []
  const deletedRIds: string[] = []
  for (const slidePath of deletions) {
    const matches = relElems.filter((e) => {
      const info = openTagInfo(relsRaw, e)
      const target = rawAttrOf(info, 'Target')
      const type = rawAttrOf(info, 'Type') ?? ''
      return (
        target !== undefined &&
        type.endsWith('/slide') &&
        resolveRelTarget('ppt', target) === slidePath
      )
    })
    if (matches.length !== 1) {
      fail(`expected exactly one slide relationship for ${slidePath}, found ${matches.length}`)
    }
    const rId = rawAttrOf(openTagInfo(relsRaw, matches[0]), 'Id') ?? fail('slide relationship has no Id')
    deletedRIds.push(rId)
    relOps.push({ start: matches[0].start, end: matches[0].end, insert: '' })
  }

  const presRaw = await requiredPart(zip, PRESENTATION_PATH)
  const presRoot = childElementsIn(presRaw, 0, presRaw.length).find(
    (e) => localOf(e.name) === 'presentation',
  )
  if (!presRoot) fail('no <p:presentation> element in presentation.xml')
  const sldIdLst = childElemByLocal(presRaw, presRoot, 'sldIdLst') ?? fail('presentation.xml has no sldIdLst')
  if (adds.length > 0 && sldIdLst.selfClosing) fail('presentation.xml has an empty <p:sldIdLst/>')
  const sldIds = sldIdLst.selfClosing
    ? []
    : childElemsOf(presRaw, sldIdLst).filter((e) => localOf(e.name) === 'sldId')

  const presOps: SpliceOp[] = []
  for (const rId of deletedRIds) {
    const matches = sldIds.filter((e) => rawPrefixedAttrOf(openTagInfo(presRaw, e), 'id') === rId)
    if (matches.length !== 1) {
      fail(`expected exactly one p:sldId with r:id ${rId}, found ${matches.length}`)
    }
    // sldIdLst is not the only place a slide can be referenced: custom shows
    // (p:custShowLst) carry their own r:id lists. Removing only the sldId
    // would write a dangling reference, so any extra occurrence of the rId
    // anywhere in presentation.xml refuses the save.
    const refs = presRaw.split(`"${rId}"`).length - 1
    if (refs !== 1) {
      fail(
        `slide relationship ${rId} is referenced ${refs} times in presentation.xml ` +
          '(custom shows?) — refusing to delete',
      )
    }
    presOps.push({ start: matches[0].start, end: matches[0].end, insert: '' })
  }

  const typesRaw = await requiredPart(zip, CONTENT_TYPES_PATH)
  const typesRoot = childElementsIn(typesRaw, 0, typesRaw.length).find(
    (e) => localOf(e.name) === 'Types',
  )
  if (!typesRoot) fail('no <Types> element in [Content_Types].xml')
  if (typesRoot.selfClosing) fail('empty <Types/> in [Content_Types].xml')
  const overrides = childElemsOf(typesRaw, typesRoot).filter((e) => localOf(e.name) === 'Override')

  const typeOps: SpliceOp[] = []
  for (const slidePath of deletions) {
    const matches = overrides.filter(
      (e) => rawAttrOf(openTagInfo(typesRaw, e), 'PartName') === `/${slidePath}`,
    )
    // Absence is fine — the part may be typed via a Default — but duplicate
    // Overrides mean a package we don't understand well enough to edit.
    if (matches.length > 1) fail(`duplicate [Content_Types].xml Override for /${slidePath}`)
    if (matches.length === 1) {
      typeOps.push({ start: matches[0].start, end: matches[0].end, insert: '' })
    }
  }

  // ---- additions and reordering --------------------------------------------

  if (adds.length > 0 || order !== undefined) {
    // New sldIds copy the anchor list's element prefix; the r: prefix comes
    // from whatever the root binds to the officeDocument relationship NS.
    const pPfx = prefixOf(sldIdLst.name)
    let rPfx = 'r'
    for (const a of openTagInfo(presRaw, presRoot).attrs) {
      if (a.value === OFFICE_REL_NS && a.name.startsWith('xmlns:')) rPfx = a.name.slice(6)
    }

    // A new part must be typed like the slides already in the package.
    const slideOverride = overrides.find((e) =>
      (rawAttrOf(openTagInfo(typesRaw, e), 'PartName') ?? '').startsWith('/ppt/slides/'),
    )
    const slideContentType = slideOverride
      ? rawAttrOf(openTagInfo(typesRaw, slideOverride), 'ContentType')
      : undefined
    if (adds.length > 0 && !slideContentType) {
      fail('no existing slide Override in [Content_Types].xml to type the new slide after')
    }

    let nextSldIdNum = 255
    for (const e of sldIds) {
      const n = Number(rawAttrOf(openTagInfo(presRaw, e), 'id'))
      if (Number.isFinite(n)) nextSldIdNum = Math.max(nextSldIdNum, n)
    }

    const relInserts: string[] = []
    const typeInserts: string[] = []
    /** Mints one added slide's sldId element, recording its rel and Override. */
    const mint = (a: NewSlidePart): string => {
      if (!a.path.startsWith('ppt/')) fail(`unexpected added slide location ${a.path}`)
      const rId = `rId${++maxRelNum}`
      relInserts.push(
        `<Relationship Id="${rId}" Type="${OFFICE_REL_NS}/slide" Target="${a.path.slice(4)}"/>`,
      )
      typeInserts.push(`<Override PartName="/${a.path}" ContentType="${slideContentType}"/>`)
      const sldTag = pPfx ? `${pPfx}:sldId` : 'sldId'
      const rAttr = rPfx ? `${rPfx}:id` : 'id'
      return `<${sldTag} id="${++nextSldIdNum}" ${rAttr}="${rId}"/>`
    }

    if (order === undefined) {
      // No explicit order: place each add after its anchor. Insertion offsets
      // group by the nearest BASE anchor (an added anchor shares its parent's
      // offset and simply follows it), so each offset gets ONE insert op with
      // the chain concatenated in order.
      const addsByAnchor = new Map<string, NewSlidePart[]>()
      for (const a of adds) {
        const list = addsByAnchor.get(a.afterPath) ?? []
        list.push(a)
        addsByAnchor.set(a.afterPath, list)
      }
      const groups = new Map<number, string[]>()
      const placed = new Set<string>()
      const emit = (anchorPath: string, offset: number): void => {
        for (const a of addsByAnchor.get(anchorPath) ?? []) {
          if (placed.has(a.path)) fail(`added slide ${a.path} appears twice`)
          placed.add(a.path)
          const group = groups.get(offset) ?? []
          group.push(mint(a))
          groups.set(offset, group)
          emit(a.path, offset)
        }
      }
      emit('', sldIdLst.contentStart)
      for (const [slidePath, rId] of rIdBySlidePath) {
        if (!addsByAnchor.has(slidePath)) continue
        const anchor = sldIds.find((e) => rawPrefixedAttrOf(openTagInfo(presRaw, e), 'id') === rId)
        if (!anchor) fail(`anchor slide ${slidePath} has no p:sldId`)
        emit(slidePath, anchor.end)
      }
      for (const a of adds) {
        if (!placed.has(a.path)) fail(`added slide ${a.path} has an unknown anchor ${a.afterPath}`)
      }
      for (const [offset, inserts] of groups) {
        presOps.push({ start: offset, end: offset, insert: inserts.join('') })
      }
    } else {
      // Explicit order: the surviving p:sldId elements are SLOTS, and the
      // order decides which element's bytes occupy each one. Reordering is
      // therefore a permutation of exact element slices — every element keeps
      // its own bytes (and its id/r:id), and the whitespace BETWEEN slots is
      // never touched, because each op replaces exactly one element's range.
      const deletedSet = new Set(deletions)
      const survivorSlots: Array<{ path: string; elem: Elem }> = []
      for (const [slidePath, rId] of rIdBySlidePath) {
        if (deletedSet.has(slidePath)) continue
        const elem = sldIds.find((e) => rawPrefixedAttrOf(openTagInfo(presRaw, e), 'id') === rId)
        if (!elem) fail(`slide ${slidePath} has no p:sldId`)
        survivorSlots.push({ path: slidePath, elem })
      }
      survivorSlots.sort((a, b) => a.elem.start - b.elem.start)
      const bytesOfBase = new Map(
        survivorSlots.map((s) => [s.path, presRaw.slice(s.elem.start, s.elem.end)]),
      )

      // The order must be an exact permutation of survivors + adds.
      const addPaths = adds.map((a) => a.path)
      const expected = [...survivorSlots.map((s) => s.path), ...addPaths]
      const seen = new Set<string>()
      for (const p of order) {
        if (seen.has(p)) fail(`slide order lists ${p} more than once`)
        seen.add(p)
      }
      if (order.length !== expected.length || expected.some((p) => !seen.has(p))) {
        fail(
          `slide order must be an exact permutation of the ${expected.length} surviving and added ` +
            `slides (got ${order.length})`,
        )
      }

      // Walk the order, filling one slot per base slide and folding any adds
      // that follow it into the SAME op. Folding rather than emitting separate
      // zero-length inserts is what keeps ops from colliding at a slot
      // boundary, which applySplices would (correctly) reject as overlapping.
      const addByPath = new Map(adds.map((a) => [a.path, a]))
      const fills: string[] = survivorSlots.map(() => '')
      let slotIdx = -1
      let leading = ''
      for (const p of order) {
        const add = addByPath.get(p)
        if (add) {
          const xml = mint(add)
          if (slotIdx < 0) leading += xml
          else fills[slotIdx] += xml
          continue
        }
        slotIdx += 1
        const bytes = bytesOfBase.get(p) ?? fail(`slide order references unknown slide ${p}`)
        fills[slotIdx] = bytes + fills[slotIdx]
      }
      fills[0] = leading + fills[0]

      for (let i = 0; i < survivorSlots.length; i++) {
        const slot = survivorSlots[i]
        const original = presRaw.slice(slot.elem.start, slot.elem.end)
        // Unchanged slots emit nothing, so an order equal to the document
        // order leaves presentation.xml byte-identical.
        if (fills[i] === original) continue
        presOps.push({ start: slot.elem.start, end: slot.elem.end, insert: fills[i] })
      }
    }

    if (relInserts.length > 0) {
      relOps.push({
        start: relsRoot.contentEnd,
        end: relsRoot.contentEnd,
        insert: relInserts.join(''),
      })
      typeOps.push({
        start: typesRoot.contentEnd,
        end: typesRoot.contentEnd,
        insert: typeInserts.join(''),
      })
    }
  }

  const replacements = new Map<string, string>()
  replacements.set(PRESENTATION_RELS_PATH, applySplices(relsRaw, relOps))
  replacements.set(PRESENTATION_PATH, applySplices(presRaw, presOps))
  if (typeOps.length > 0) replacements.set(CONTENT_TYPES_PATH, applySplices(typesRaw, typeOps))
  return replacements
}

/** Base64 -> bytes, for media parts handed in from the renderer. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

interface MediaPlan {
  /** New media part path -> its bytes. */
  parts: Map<string, Uint8Array>
  /** Slide path -> its rewritten .rels XML. */
  relsXml: Map<string, string>
  /** Per-edit relationship id, keyed by edit object identity. */
  rIdByEdit: Map<InsertShapeEdit, string>
}

/**
 * Claims a media part and a relationship for every image insert.
 *
 * Media names are unique across the WHOLE package plus everything claimed in
 * this same save; relationship ids are unique within the owning slide's .rels.
 * Each slide's Relationships element gets exactly one insertion, immediately
 * before its close tag, so no existing relationship byte moves.
 */
async function planInsertedMedia(
  zip: JSZip,
  editsBySlide: ReadonlyMap<string, readonly SlideEdit[]>,
  addedRels: ReadonlyMap<string, string>,
): Promise<MediaPlan> {
  const plan: MediaPlan = { parts: new Map(), relsXml: new Map(), rIdByEdit: new Map() }

  let maxMedia = 0
  for (const name of Object.keys(zip.files)) {
    const m = name.match(/^ppt\/media\/image(\d+)\./i)
    if (m) maxMedia = Math.max(maxMedia, Number(m[1]))
  }

  for (const [slidePath, edits] of editsBySlide) {
    const images = edits.filter(
      (e): e is InsertShapeEdit => e.kind === 'insertShape' && e.spec.kind === 'image',
    )
    if (images.length === 0) continue

    const relsPath = relsPathFor(slidePath)
    let relsRaw = addedRels.get(slidePath)
    if (relsRaw === undefined) {
      const file = zip.file(relsPath)
      relsRaw =
        (await file?.async('string')) ??
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    }

    const root = childElementsIn(relsRaw, 0, relsRaw.length).find(
      (e) => localOf(e.name) === 'Relationships',
    )
    if (!root) fail(`no <Relationships> element in ${relsPath}`)

    let maxRel = 0
    const existingIds = new Set<string>()
    if (!root.selfClosing) {
      for (const e of childElemsOf(relsRaw, root)) {
        const id = rawAttrOf(openTagInfo(relsRaw, e), 'Id')
        if (!id) continue
        existingIds.add(id)
        const m = id.match(/^rId(\d+)$/)
        if (m) maxRel = Math.max(maxRel, Number(m[1]))
      }
    }

    let additions = ''
    for (const edit of images) {
      const spec = edit.spec as Extract<NewShapeSpec, { kind: 'image' }>
      const ext = spec.ext.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!ext) fail('an inserted image has no usable file extension')
      const mediaPath = `ppt/media/image${++maxMedia}.${ext}`
      if (zip.file(mediaPath) || plan.parts.has(mediaPath)) {
        fail(`media part ${mediaPath} already exists`)
      }
      const rId = `rId${++maxRel}`
      if (existingIds.has(rId)) fail(`relationship ${rId} already exists in ${relsPath}`)
      existingIds.add(rId)

      plan.parts.set(mediaPath, base64ToBytes(spec.dataBase64))
      plan.rIdByEdit.set(edit, rId)
      additions +=
        `<Relationship Id="${rId}" Type="${OFFICE_REL_NS}/image" ` +
        `Target="../media/image${maxMedia}.${ext}"/>`
    }

    if (root.selfClosing) {
      const info = openTagInfo(relsRaw, root)
      plan.relsXml.set(
        slidePath,
        applySplices(relsRaw, [
          { start: info.closeStart, end: root.end, insert: `>${additions}</${root.name}>` },
        ]),
      )
    } else {
      plan.relsXml.set(
        slidePath,
        applySplices(relsRaw, [
          { start: root.contentEnd, end: root.contentEnd, insert: additions },
        ]),
      )
    }
  }
  return plan
}

const MEDIA_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

/**
 * [Content_Types].xml with a `<Default>` for every inserted media extension
 * that lacks one. Without this, inserting (say) a .webp into a deck that has
 * never held one produces an untyped part — a package PowerPoint refuses to
 * open. `current` may already carry this save's slide-add/delete rewrites;
 * the Defaults splice on top of it.
 */
function withMediaDefaults(current: string, exts: ReadonlySet<string>): string {
  const root = childElementsIn(current, 0, current.length).find((e) => localOf(e.name) === 'Types')
  if (!root) fail('no <Types> element in [Content_Types].xml')
  if (root.selfClosing) fail('empty <Types/> in [Content_Types].xml')

  const present = new Set<string>()
  for (const e of childElemsOf(current, root)) {
    if (localOf(e.name) !== 'Default') continue
    const ext = rawAttrOf(openTagInfo(current, e), 'Extension')
    if (ext) present.add(ext.toLowerCase())
  }

  let additions = ''
  for (const ext of [...exts].sort()) {
    if (present.has(ext)) continue
    const mime = MEDIA_MIME[ext] ?? fail(`no known content type for inserted media ".${ext}"`)
    additions += `<Default Extension="${ext}" ContentType="${mime}"/>`
  }
  if (!additions) return current
  return applySplices(current, [
    { start: root.contentEnd, end: root.contentEnd, insert: additions },
  ])
}

// ------------------------------------------------------------------ writeDeck

export interface WriteDeckOptions {
  /**
   * Slide part paths (e.g. `ppt/slides/slide2.xml`) to remove. The slide part
   * and its own .rels are dropped; presentation.xml, its rels and any per-part
   * Content_Types Override are spliced. Media referenced only by a removed
   * slide stays in the package — orphaned media is valid OOXML.
   */
  deleteSlides?: readonly string[]
  /**
   * Synthesized slides to add, in order. Each contributes its part + .rels and
   * an inserted sldId / Relationship / Override; edits addressed at an added
   * path apply against its synthesized XML.
   */
  addSlides?: readonly NewSlidePart[]
  /**
   * Explicit final slide order as part paths. Must be an exact permutation of
   * the surviving slides plus `addSlides`. When given it governs `sldIdLst`
   * placement (existing elements are moved, added ones inserted at their
   * positions) and `addSlides[].afterPath` is ignored.
   */
  slideOrder?: readonly string[]
}

/**
 * Produces the full .pptx bytes with edits applied. Every entry except the
 * edited slides is copied byte-for-byte from the source archive (raw bytes,
 * never re-encoded); entry order, dates, permissions and comments carry over.
 */
export async function writeDeck(
  deck: SlideDeck,
  editsBySlide: ReadonlyMap<string, readonly SlideEdit[]>,
  options?: WriteDeckOptions,
): Promise<Uint8Array> {
  const adds = options?.addSlides ?? []
  const addByPath = new Map(adds.map((a) => [a.path, a]))
  if (addByPath.size !== adds.length) fail('duplicate added slide paths')

  for (const slidePath of editsBySlide.keys()) {
    if (deck.source.slideXml[slidePath] === undefined && !addByPath.has(slidePath)) {
      fail(`edits reference unknown slide ${slidePath}`)
    }
  }

  const deletions = [...new Set(options?.deleteSlides ?? [])]
  for (const slidePath of deletions) {
    if (deck.source.slideXml[slidePath] === undefined) {
      fail(`cannot delete unknown slide ${slidePath}`)
    }
    if ((editsBySlide.get(slidePath)?.length ?? 0) > 0) {
      fail(`slide ${slidePath} is both edited and marked deleted`)
    }
  }
  if (deletions.length > 0 && deletions.length >= deck.slides.length) {
    fail('cannot delete every slide in the deck')
  }

  const deleted = new Set(deletions)
  for (const a of adds) {
    if (deck.source.zip.file(a.path) || deck.source.slideXml[a.path] !== undefined) {
      fail(`added slide ${a.path} collides with an existing part`)
    }
    if (deleted.has(a.path)) fail(`added slide ${a.path} is also marked deleted`)
    if (deleted.has(a.afterPath)) {
      fail(`added slide ${a.path} is anchored to ${a.afterPath}, which is being deleted`)
    }
    // With an explicit order the anchor no longer places anything, so it only
    // has to be meaningful when there is no order.
    const anchorKnown =
      options?.slideOrder !== undefined ||
      a.afterPath === '' ||
      deck.source.slideXml[a.afterPath] !== undefined ||
      addByPath.has(a.afterPath)
    if (!anchorKnown) fail(`added slide ${a.path} has an unknown anchor ${a.afterPath}`)
  }

  const order = options?.slideOrder
  // Image inserts claim media parts and relationships before anything is
  // written, so the p:pic elements can reference ids that are already fixed.
  const mediaPlan = await planInsertedMedia(
    deck.source.zip,
    editsBySlide,
    new Map(adds.map((a) => [a.path, a.relsXml])),
  )
  const rIdFor = (edit: InsertShapeEdit): string | undefined => mediaPlan.rIdByEdit.get(edit)
  const removedParts = new Set(deletions.flatMap((p) => [p, relsPathFor(p)]))
  const replacements =
    deletions.length > 0 || adds.length > 0 || order !== undefined
      ? await packageReplacements(deck.source.zip, deletions, adds, order)
      : new Map<string, string>()

  // Inserted media must be typed: add missing Defaults on top of whatever the
  // slide add/delete path already did to [Content_Types].xml.
  if (mediaPlan.parts.size > 0) {
    const exts = new Set(
      [...mediaPlan.parts.keys()].map((p) => p.slice(p.lastIndexOf('.') + 1).toLowerCase()),
    )
    const currentCt =
      replacements.get(CONTENT_TYPES_PATH) ?? (await requiredPart(deck.source.zip, CONTENT_TYPES_PATH))
    const nextCt = withMediaDefaults(currentCt, exts)
    if (nextCt !== currentCt) replacements.set(CONTENT_TYPES_PATH, nextCt)
  }

  const out = new JSZip()
  const files = deck.source.zip.files
  for (const name of Object.keys(files)) {
    const entry = files[name]
    if (entry.dir || removedParts.has(name)) continue
    const meta = {
      date: entry.date,
      comment: entry.comment ?? undefined,
      unixPermissions: entry.unixPermissions ?? undefined,
      dosPermissions: entry.dosPermissions ?? undefined,
      createFolders: false,
    }
    const edits = editsBySlide.get(name)
    const replaced = replacements.get(name)
    const newRels = [...mediaPlan.relsXml].find(([slide]) => relsPathFor(slide) === name)?.[1]
    if (edits && edits.length > 0) {
      out.file(name, updateSlideXml(deck.source.slideXml[name], edits, { rIdFor }), meta)
    } else if (newRels !== undefined) {
      out.file(name, newRels, meta)
    } else if (replaced !== undefined) {
      out.file(name, replaced, meta)
    } else {
      out.file(name, await entry.async('uint8array'), { ...meta, binary: true })
    }
  }
  // Added slides: brand-new parts, with any of their own edits applied against
  // the synthesized XML they were parsed from.
  for (const a of adds) {
    const edits = editsBySlide.get(a.path)
    out.file(
      a.path,
      edits && edits.length > 0 ? updateSlideXml(a.xml, edits, { rIdFor }) : a.xml,
      { createFolders: false },
    )
    // An image inserted onto an added slide rewrites that slide's synthesized
    // rels string rather than a part on disk.
    out.file(relsPathFor(a.path), mediaPlan.relsXml.get(a.path) ?? a.relsXml, {
      createFolders: false,
    })
  }
  // Brand-new media parts.
  for (const [mediaPath, bytes] of mediaPlan.parts) {
    out.file(mediaPath, bytes, { createFolders: false, binary: true })
  }
  return out.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
