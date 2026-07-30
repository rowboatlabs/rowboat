/**
 * Minimal PPTX reader built directly on jszip + fast-xml-parser.
 *
 * Scope is deliberately narrow: enough of DrawingML to lay out and render a
 * slide read-only. Anything we recognize but can't draw becomes a
 * PlaceholderShape rather than being dropped, so a deck never renders as a
 * silently empty canvas.
 *
 * The XML is parsed with `preserveOrder` so shapes keep document order (which
 * is z-order) and so every shape can record an index path back to its own node
 * for Phase B write-back.
 */

import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type {
  ImageShape,
  NodePath,
  Paragraph,
  PlaceholderKind,
  PlaceholderShape,
  RectEmu,
  Shape,
  Slide,
  SlideDeck,
  TextAlign,
  TextRun,
  TextShape,
} from './types'

const ATTRS = ':@'
const ATTR_PREFIX = '@_'

/** A node is `{ <tag>: children[], ':@'?: attrs }`, or `{ '#text': string }`. */
export type XmlNode = Record<string, unknown>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  preserveOrder: true,
  // Runs carry significant whitespace, and ids/values must stay strings.
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
})

export function parseXml(xml: string): XmlNode[] {
  return parser.parse(xml) as XmlNode[]
}

/** Strips the namespace prefix: `p:sp` -> `sp`. Prefixes are not guaranteed. */
function local(name: string): string {
  const i = name.indexOf(':')
  return i >= 0 ? name.slice(i + 1) : name
}

export function tagNameOf(node: XmlNode): string | null {
  for (const k of Object.keys(node)) {
    if (k !== ATTRS && k !== '#text') return k
  }
  return null
}

export function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagNameOf(node)
  if (!tag) return []
  const kids = node[tag]
  return Array.isArray(kids) ? (kids as XmlNode[]) : []
}

function attrsOf(node: XmlNode): Record<string, string> {
  return (node[ATTRS] as Record<string, string> | undefined) ?? {}
}

function attr(node: XmlNode, name: string): string | undefined {
  const a = attrsOf(node)
  const direct = a[ATTR_PREFIX + name]
  if (direct !== undefined) return String(direct)
  // Fall back to a local-name match so unusual prefixes still resolve.
  for (const [k, v] of Object.entries(a)) {
    if (local(k.slice(ATTR_PREFIX.length)) === local(name)) return String(v)
  }
  return undefined
}

/**
 * Reads a namespaced attribute by local name, ignoring unprefixed ones. Needed
 * where an element carries both (e.g. `<p:sldId id="256" r:id="rId2"/>`).
 */
function prefixedAttr(node: XmlNode, name: string): string | undefined {
  for (const [k, v] of Object.entries(attrsOf(node))) {
    const raw = k.slice(ATTR_PREFIX.length)
    if (raw.includes(':') && local(raw) === name) return String(v)
  }
  return undefined
}

function childByLocal(nodes: XmlNode[], name: string): XmlNode | undefined {
  return nodes.find((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === name
  })
}

function childrenByLocal(nodes: XmlNode[], name: string): XmlNode[] {
  return nodes.filter((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === name
  })
}

/** Follows a chain of local names down from a node. */
function descend(node: XmlNode, ...path: string[]): XmlNode | undefined {
  let current: XmlNode | undefined = node
  for (const step of path) {
    if (!current) return undefined
    current = childByLocal(childrenOf(current), step)
  }
  return current
}

/**
 * Decodes numeric character references (`&#8217;` / `&#x2019;`) that
 * fast-xml-parser leaves as literal text (it only decodes the five named XML
 * entities). Only code points valid in XML 1.0 are decoded; anything else
 * stays literal. Write-back for untouched runs is unaffected — it copies the
 * original bytes, never this decoded form.
 */
function decodeNumericRefs(s: string): string {
  if (!s.includes('&#')) return s
  return s.replace(/&#(x[0-9a-fA-F]+|\d+);/g, (match, code: string) => {
    const cp = code[0] === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)
    const valid =
      cp === 0x9 ||
      cp === 0xa ||
      cp === 0xd ||
      (cp >= 0x20 && cp <= 0xd7ff) ||
      (cp >= 0xe000 && cp <= 0xfffd) ||
      (cp >= 0x10000 && cp <= 0x10ffff)
    return valid ? String.fromCodePoint(cp) : match
  })
}

function textOf(node: XmlNode): string {
  let out = ''
  for (const child of childrenOf(node)) {
    const t = child['#text']
    if (typeof t === 'string') out += t
  }
  return decodeNumericRefs(out)
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function isTruthyAttr(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

// ---------------------------------------------------------------- zip paths

function dirNameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

/** Resolves a relationship Target against the directory owning the .rels file. */
export function resolveRelTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const segments = (baseDir ? baseDir.split('/') : []).concat(target.split('/'))
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** `ppt/slides/slide1.xml` -> `ppt/slides/_rels/slide1.xml.rels` */
function relsPathFor(partPath: string): string {
  const dir = dirNameOf(partPath)
  const file = partPath.slice(dir.length + 1)
  return `${dir}/_rels/${file}.rels`
}

interface Relationship {
  target: string
  type: string
}

async function readRels(zip: JSZip, partPath: string): Promise<Map<string, Relationship>> {
  const map = new Map<string, Relationship>()
  const file = zip.file(relsPathFor(partPath))
  if (!file) return map
  const doc = parseXml(await file.async('string'))
  const root = childByLocal(doc, 'Relationships')
  if (!root) return map
  const baseDir = dirNameOf(partPath)
  for (const rel of childrenByLocal(childrenOf(root), 'Relationship')) {
    const id = attr(rel, 'Id')
    const target = attr(rel, 'Target')
    // External targets (linked images, web video) have no part in the package.
    if (!id || !target || attr(rel, 'TargetMode') === 'External') continue
    map.set(id, { target: resolveRelTarget(baseDir, target), type: attr(rel, 'Type') ?? '' })
  }
  return map
}

function relTargetOfType(rels: Map<string, Relationship>, suffix: string): string | undefined {
  for (const rel of rels.values()) {
    if (rel.type.endsWith(suffix)) return rel.target
  }
  return undefined
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

// -------------------------------------------------------------- geometry

const ZERO_RECT: RectEmu = { x: 0, y: 0, w: 0, h: 0 }

function rectFromXfrm(xfrm: XmlNode | undefined): RectEmu {
  if (!xfrm) return { ...ZERO_RECT }
  const kids = childrenOf(xfrm)
  const off = childByLocal(kids, 'off')
  const ext = childByLocal(kids, 'ext')
  return {
    x: (off && num(attr(off, 'x'))) ?? 0,
    y: (off && num(attr(off, 'y'))) ?? 0,
    w: (ext && num(attr(ext, 'cx'))) ?? 0,
    h: (ext && num(attr(ext, 'cy'))) ?? 0,
  }
}

/** `a:xfrm` sits under `spPr`/`grpSpPr` for shapes, but directly on graphicFrame. */
function rectOfShapeNode(node: XmlNode): RectEmu {
  const xfrm =
    descend(node, 'spPr', 'xfrm') ??
    descend(node, 'grpSpPr', 'xfrm') ??
    childByLocal(childrenOf(node), 'xfrm')
  return rectFromXfrm(xfrm)
}

function isEmptyRect(r: RectEmu): boolean {
  return r.w === 0 && r.h === 0
}

/**
 * Placeholder geometry inherited from a slide's layout, and the layout's master.
 *
 * PowerPoint omits `a:xfrm` on title/body placeholders and expects the reader to
 * inherit it, so without this nearly every real deck lays out at 0x0.
 */
interface InheritedRects {
  byIdx: Map<string, RectEmu>
  byType: Map<string, RectEmu>
}

function phKeyOf(node: XmlNode): { idx?: string; type?: string } | null {
  const ph = descend(node, 'nvSpPr', 'nvPr', 'ph')
  if (!ph) return null
  return { idx: attr(ph, 'idx'), type: attr(ph, 'type') }
}

/** Title variants address the same slot; normalize so a lookup finds either. */
function normalizePhType(type: string | undefined): string {
  if (!type) return 'body'
  if (type === 'ctrTitle') return 'title'
  return type
}

function collectPlaceholderRects(doc: XmlNode[], into: InheritedRects): void {
  const spTree = (() => {
    const root = childByLocal(doc, 'sldLayout') ?? childByLocal(doc, 'sldMaster')
    return root ? descend(root, 'cSld', 'spTree') : undefined
  })()
  if (!spTree) return
  for (const node of childrenOf(spTree)) {
    const tag = tagNameOf(node)
    if (!tag || local(tag) !== 'sp') continue
    const key = phKeyOf(node)
    if (!key) continue
    const rect = rectOfShapeNode(node)
    if (isEmptyRect(rect)) continue
    if (key.idx !== undefined) into.byIdx.set(key.idx, rect)
    into.byType.set(normalizePhType(key.type), rect)
  }
}

/** Walks slide -> layout -> master, letting the nearer part win. */
async function loadInheritedRects(
  zip: JSZip,
  slideRels: Map<string, Relationship>,
): Promise<InheritedRects> {
  const out: InheritedRects = { byIdx: new Map(), byType: new Map() }
  const layoutPath = relTargetOfType(slideRels, '/slideLayout')
  if (!layoutPath) return out

  const layoutFile = zip.file(layoutPath)
  if (!layoutFile) return out
  const layoutDoc = parseXml(await layoutFile.async('string'))

  // Master first so the layout's own values overwrite it.
  const layoutRels = await readRels(zip, layoutPath)
  const masterPath = relTargetOfType(layoutRels, '/slideMaster')
  const masterFile = masterPath ? zip.file(masterPath) : null
  if (masterFile) collectPlaceholderRects(parseXml(await masterFile.async('string')), out)
  collectPlaceholderRects(layoutDoc, out)
  return out
}

function shapeIdOf(node: XmlNode, fallbackIndex: number): string {
  for (const nv of ['nvSpPr', 'nvPicPr', 'nvGraphicFramePr', 'nvGrpSpPr']) {
    const cNvPr = descend(node, nv, 'cNvPr')
    const id = cNvPr && attr(cNvPr, 'id')
    if (id) return id
  }
  return `idx:${fallbackIndex}`
}

// ------------------------------------------------------------------ text

function parseRunProps(rPr: XmlNode | undefined): Omit<TextRun, 'text'> {
  if (!rPr) return {}
  const out: Omit<TextRun, 'text'> = {}
  if (isTruthyAttr(attr(rPr, 'b'))) out.bold = true
  if (isTruthyAttr(attr(rPr, 'i'))) out.italic = true
  const u = attr(rPr, 'u')
  if (u && u !== 'none') out.underline = true
  const sz = num(attr(rPr, 'sz'))
  // sz is in hundredths of a point.
  if (sz !== undefined) out.sizePt = sz / 100
  // Only literal colors resolve here; theme colors (a:schemeClr) need the
  // theme part and are left to inherit.
  const srgb = descend(rPr, 'solidFill', 'srgbClr')
  const val = srgb && attr(srgb, 'val')
  if (val) out.colorHex = val.toUpperCase()
  return out
}

export function parseParagraph(p: XmlNode): Paragraph {
  const kids = childrenOf(p)
  const pPr = childByLocal(kids, 'pPr')
  const algn = pPr ? attr(pPr, 'algn') : undefined
  const runs: TextRun[] = []

  for (const child of kids) {
    const tag = tagNameOf(child)
    if (!tag) continue
    const name = local(tag)
    if (name === 'r' || name === 'fld') {
      // a:fld is a generated field (slide number, date) but carries a:t like a run.
      const t = childByLocal(childrenOf(child), 't')
      const text = t ? textOf(t) : ''
      if (text === '') continue
      runs.push({ text, ...parseRunProps(childByLocal(childrenOf(child), 'rPr')) })
    } else if (name === 'br') {
      runs.push({ text: '\n' })
    }
  }

  const para: Paragraph = { runs }
  if (algn === 'l' || algn === 'ctr' || algn === 'r' || algn === 'just') {
    para.align = algn as TextAlign
  }
  return para
}

// ------------------------------------------------------------- shape kinds

const GRAPHIC_URI_KINDS: Array<[string, PlaceholderKind]> = [
  ['/table', 'table'],
  ['/chart', 'chart'],
  ['/diagram', 'smartart'],
]

function graphicFrameKind(node: XmlNode): PlaceholderKind {
  const data = descend(node, 'graphic', 'graphicData')
  const uri = data ? attr(data, 'uri') : undefined
  if (uri) {
    for (const [needle, kind] of GRAPHIC_URI_KINDS) {
      if (uri.includes(needle)) return kind
    }
  }
  return 'unknown'
}

/** A `p:pic` whose nvPr carries a video/media reference is a movie, not a still. */
function isVideoPic(node: XmlNode): boolean {
  const nvPr = descend(node, 'nvPicPr', 'nvPr')
  if (!nvPr) return false
  return childrenOf(nvPr).some((c) => {
    const t = tagNameOf(c)
    if (!t) return false
    const n = local(t)
    return n === 'videoFile' || n === 'media'
  })
}

// ------------------------------------------------------------------ walk

interface ShapeContext {
  slideXmlPath: string
  rels: Map<string, Relationship>
  inherited: InheritedRects
  zip: JSZip
  blobUrls: string[]
}

/** Falls back to the layout/master slot when the shape carries no geometry. */
function resolveRect(node: XmlNode, ctx: ShapeContext): RectEmu {
  const own = rectOfShapeNode(node)
  if (!isEmptyRect(own)) return own
  const key = phKeyOf(node)
  if (!key) return own
  if (key.idx !== undefined) {
    const byIdx = ctx.inherited.byIdx.get(key.idx)
    if (byIdx) return { ...byIdx }
  }
  const byType = ctx.inherited.byType.get(normalizePhType(key.type))
  return byType ? { ...byType } : own
}

async function shapeFromNode(
  node: XmlNode,
  nodePath: NodePath,
  index: number,
  ctx: ShapeContext,
): Promise<Shape | null> {
  const tag = tagNameOf(node)
  if (!tag) return null
  const name = local(tag)

  const base = {
    id: shapeIdOf(node, index),
    slideXmlPath: ctx.slideXmlPath,
    nodePath,
    xfrmEmu: resolveRect(node, ctx),
  }

  if (name === 'sp') {
    const txBody = childByLocal(childrenOf(node), 'txBody')
    if (!txBody) {
      // A shape with geometry but no text — an arrow, a divider, a background box.
      return { ...base, type: 'placeholder', kind: 'unknown' } satisfies PlaceholderShape
    }
    const paragraphs = childrenByLocal(childrenOf(txBody), 'p').map(parseParagraph)
    return { ...base, type: 'text', paragraphs } satisfies TextShape
  }

  if (name === 'pic') {
    if (isVideoPic(node)) {
      return { ...base, type: 'placeholder', kind: 'video' } satisfies PlaceholderShape
    }
    const blip = descend(node, 'blipFill', 'blip')
    const embed = blip && attr(blip, 'embed')
    const mediaPath = embed ? ctx.rels.get(embed)?.target : undefined
    const file = mediaPath ? ctx.zip.file(mediaPath) : null
    if (!file || !mediaPath) {
      // Linked-but-absent media, or an external relationship we skipped.
      return { ...base, type: 'placeholder', kind: 'unknown' } satisfies PlaceholderShape
    }
    // Copy into a plain ArrayBuffer-backed view: jszip's output is typed as
    // possibly shared-buffer-backed, which Blob does not accept.
    const bytes = new Uint8Array(await file.async('uint8array'))
    const blob = new Blob([bytes], { type: mimeFor(mediaPath) })
    const blobUrl = URL.createObjectURL(blob)
    ctx.blobUrls.push(blobUrl)
    return { ...base, type: 'image', blobUrl, mediaPath } satisfies ImageShape
  }

  if (name === 'graphicFrame') {
    return { ...base, type: 'placeholder', kind: graphicFrameKind(node) } satisfies PlaceholderShape
  }

  if (name === 'grpSp') {
    return { ...base, type: 'placeholder', kind: 'group' } satisfies PlaceholderShape
  }

  if (name === 'cxnSp') {
    // Connectors (lines/arrows) have geometry but nothing we draw yet.
    return { ...base, type: 'placeholder', kind: 'unknown' } satisfies PlaceholderShape
  }

  return null
}

async function parseSlide(
  zip: JSZip,
  xmlPath: string,
  xml: string,
  blobUrls: string[],
): Promise<Slide> {
  const doc = parseXml(xml)
  const rels = await readRels(zip, xmlPath)
  const inherited = await loadInheritedRects(zip, rels)
  const ctx: ShapeContext = { slideXmlPath: xmlPath, rels, inherited, zip, blobUrls }

  const sldIndex = doc.findIndex((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === 'sld'
  })
  const shapes: Shape[] = []
  if (sldIndex < 0) return { id: xmlPath, xmlPath, shapes }

  const sld = doc[sldIndex]
  const cSldKids = childrenOf(sld)
  const cSldIndex = cSldKids.findIndex((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === 'cSld'
  })
  if (cSldIndex < 0) return { id: xmlPath, xmlPath, shapes }

  const spTreeKids = childrenOf(cSldKids[cSldIndex])
  const spTreeIndex = spTreeKids.findIndex((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === 'spTree'
  })
  if (spTreeIndex < 0) return { id: xmlPath, xmlPath, shapes }

  const children = childrenOf(spTreeKids[spTreeIndex])
  for (let i = 0; i < children.length; i++) {
    const nodePath: NodePath = [sldIndex, cSldIndex, spTreeIndex, i]
    const shape = await shapeFromNode(children[i], nodePath, i, ctx)
    if (shape) shapes.push(shape)
  }

  return { id: xmlPath, xmlPath, shapes }
}

// ------------------------------------------------------------------ entry

/** Default 4:3 deck, used only when presentation.xml omits or corrupts sldSz. */
const FALLBACK_SIZE = { w: 9144000, h: 6858000 }

export async function parsePptx(bytes: Uint8Array): Promise<SlideDeck> {
  const zip = await JSZip.loadAsync(bytes)

  const presFile = zip.file('ppt/presentation.xml')
  if (!presFile) throw new Error('Not a PowerPoint package: ppt/presentation.xml is missing')
  const presDoc = parseXml(await presFile.async('string'))
  const pres = childByLocal(presDoc, 'presentation')
  if (!pres) throw new Error('Malformed presentation.xml: no p:presentation element')

  const sldSz = childByLocal(childrenOf(pres), 'sldSz')
  const slideSizeEmu = {
    w: (sldSz && num(attr(sldSz, 'cx'))) ?? FALLBACK_SIZE.w,
    h: (sldSz && num(attr(sldSz, 'cy'))) ?? FALLBACK_SIZE.h,
  }

  // Slide order comes from sldIdLst, resolved through the presentation's rels.
  const presRels = await readRels(zip, 'ppt/presentation.xml')
  const sldIdLst = childByLocal(childrenOf(pres), 'sldIdLst')
  const slidePaths: string[] = []
  if (sldIdLst) {
    for (const sldId of childrenByLocal(childrenOf(sldIdLst), 'sldId')) {
      // sldId carries both a plain numeric `id` and the `r:id` we want, so match
      // on a *prefixed* attribute whose local name is `id`.
      const rid = prefixedAttr(sldId, 'id')
      const target = rid ? presRels.get(rid)?.target : undefined
      if (target) slidePaths.push(target)
    }
  }
  if (slidePaths.length === 0) {
    // No usable sldIdLst — fall back to whatever slide parts exist, in name order.
    const found = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0)
        const nb = Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0)
        return na - nb
      })
    slidePaths.push(...found)
  }

  const blobUrls: string[] = []
  const slideXml: Record<string, string> = {}
  const slides: Slide[] = []
  for (const path of slidePaths) {
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async('string')
    slideXml[path] = xml
    slides.push(await parseSlide(zip, path, xml, blobUrls))
  }

  return { slideSizeEmu, slides, source: { zip, slideXml } }
}

/**
 * Walks a shape's `nodePath` back to its node in a freshly parsed slide tree.
 * This is the read half of the Phase B write-back contract: re-parse the raw
 * XML, resolve the path, mutate that node, re-serialize only this slide.
 */
export function resolveNodePath(doc: XmlNode[], path: NodePath): XmlNode | undefined {
  let nodes = doc
  let node: XmlNode | undefined
  for (const index of path) {
    node = nodes[index]
    if (!node) return undefined
    nodes = childrenOf(node)
  }
  return node
}

/** Releases the object URLs held by a deck's image shapes. */
export function disposeDeck(deck: SlideDeck): void {
  for (const slide of deck.slides) {
    for (const shape of slide.shapes) {
      if (shape.type === 'image') URL.revokeObjectURL(shape.blobUrl)
    }
  }
}
