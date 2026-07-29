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
  /** The shape's node path, from the parsed model. */
  nodePath: NodePath
  /** The shape's paragraphs as originally parsed from the retained XML. */
  original: Paragraph[]
  /** The committed replacement. */
  next: EditedParagraph[]
}

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
 */
function isTextOnlyEdit(original: Paragraph[], next: EditedParagraph[]): boolean {
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

// -------------------------------------------------------------- updateSlideXml

/**
 * Applies text edits to one slide's raw XML. Returns the raw string unchanged
 * when there is nothing to change. Throws (leaving the caller's file
 * untouched) on any inconsistency between the model, the edit, and the raw
 * bytes.
 */
export function updateSlideXml(slideXmlRaw: string, edits: readonly ShapeTextEdit[]): string {
  if (edits.length === 0) return slideXmlRaw

  const doc = parseXml(slideXmlRaw)

  // Scanner view of the same document, cross-validated below.
  const rootElems = childElementsIn(slideXmlRaw, 0, slideXmlRaw.length)
  const sldElem = rootElems.find((e) => localOf(e.name) === 'sld') ?? fail('no <p:sld> element')
  const cSldElem = childElemByLocal(slideXmlRaw, sldElem, 'cSld') ?? fail('no <p:cSld> element')
  const spTreeElem = childElemByLocal(slideXmlRaw, cSldElem, 'spTree') ?? fail('no <p:spTree> element')
  const spTreeShapes = childElemsOf(slideXmlRaw, spTreeElem)

  const ops: SpliceOp[] = []

  for (const edit of edits) {
    if (edit.next.length === 0) fail('a text shape must keep at least one paragraph')

    // --- model side: resolve the shape node and re-derive its paragraphs.
    const node = resolveNodePath(doc, edit.nodePath) ?? fail('node path no longer resolves')
    const nodeTag = tagNameOf(node) ?? fail('node path resolves to a text node')
    if (localOf(nodeTag) !== 'sp') fail(`not a text shape (<${nodeTag}>)`)

    const modelParas = modelParagraphsOfSp(node) ?? fail('shape has no txBody')
    if (normalizeParagraphs(modelParas) !== normalizeParagraphs(edit.original)) {
      fail('edit original does not match the retained slide XML — refusing to write')
    }

    // --- locate the same shape in the raw bytes, by element ordinal.
    const parent = resolveNodePath(doc, edit.nodePath.slice(0, -1)) ?? fail('spTree path broken')
    const siblings = childrenOf(parent)
    const last = edit.nodePath[edit.nodePath.length - 1]
    let ordinal = 0
    for (let j = 0; j < last; j++) if (tagNameOf(siblings[j]) !== null) ordinal++

    const shapeElem = spTreeShapes[ordinal] ?? fail('shape ordinal out of range in raw XML')
    if (localOf(shapeElem.name) !== 'sp') {
      fail(`raw XML disagrees with model at shape ordinal ${ordinal} (<${shapeElem.name}>)`)
    }
    const txBodyElem =
      childElemByLocal(slideXmlRaw, shapeElem, 'txBody') ?? fail('raw shape has no txBody')
    const rawParas = rawParagraphsOf(slideXmlRaw, txBodyElem)

    // --- cross-validate scanner structure against the model.
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

    // --- choose strategy.
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
        insert: rebuildParagraphs(slideXmlRaw, rawParas, edit.original, edit.next),
      })
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
  editsBySlide: ReadonlyMap<string, readonly ShapeTextEdit[]>,
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
