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
import {
  DEFAULT_LINE_HEIGHT,
  type DrawingShape,
  type Fill,
  type GroupShape,
  type ImageShape,
  type LineSpacing,
  type NodePath,
  type Paragraph,
  type ParagraphDisplay,
  type PlaceholderKind,
  type PlaceholderShape,
  type RectEmu,
  type ResolvedRunStyle,
  type Shape,
  type Slide,
  type SlideDeck,
  type TextAlign,
  type TextDisplay,
  type TextRun,
  type TextShape,
} from './types'
import { DEFAULT_THEME, clrMapOfMaster, parseTheme, schemeColorHex, type Theme } from './theme'
import {
  cssFontFamily,
  keptRunNodesOf,
  layersOf,
  levelStyleFromPPr,
  mergeLevelStyles,
  parseListStyle,
  runLayerFromRPr,
  txStyleKindFor,
  type ParsedListStyle,
  type SpacingSpec,
} from './textstyle'
import { backgroundFillOf, shapeStyleSnapshotOf, shapeVisualOf } from './geometry'

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
export function localNameOf(name: string): string {
  const i = name.indexOf(':')
  return i >= 0 ? name.slice(i + 1) : name
}
const local = localNameOf

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

/**
 * Attribute value, with numeric character references decoded — the parser
 * leaves them literal in attributes just as it does in text, so `buChar
 * char="&#x2022;"` would otherwise render as that markup instead of a bullet.
 * Read-only: the serializer scans raw bytes and never reads attributes through
 * here, so write-back is unaffected.
 */
export function attr(node: XmlNode, name: string): string | undefined {
  const a = attrsOf(node)
  const direct = a[ATTR_PREFIX + name]
  if (direct !== undefined) return decodeNumericRefs(String(direct))
  // Fall back to a local-name match so unusual prefixes still resolve.
  for (const [k, v] of Object.entries(a)) {
    if (local(k.slice(ATTR_PREFIX.length)) === local(name)) {
      return decodeNumericRefs(String(v))
    }
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

export function childByLocal(nodes: XmlNode[], name: string): XmlNode | undefined {
  return nodes.find((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === name
  })
}

export function childrenByLocal(nodes: XmlNode[], name: string): XmlNode[] {
  return nodes.filter((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === name
  })
}

/** Follows a chain of local names down from a node. */
export function descend(node: XmlNode, ...path: string[]): XmlNode | undefined {
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

export function num(value: string | undefined): number | undefined {
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

/**
 * `ppt/slides/slide1.xml` -> `ppt/slides/_rels/slide1.xml.rels`
 * Exported for the serializer: deleting a slide removes its rels part too.
 */
export function relsPathFor(partPath: string): string {
  const dir = dirNameOf(partPath)
  const file = partPath.slice(dir.length + 1)
  return `${dir}/_rels/${file}.rels`
}

interface Relationship {
  target: string
  type: string
}

/** Parses a .rels document, resolving Targets against the owning part's dir. */
function parseRelsXml(relsXml: string, baseDir: string): Map<string, Relationship> {
  const map = new Map<string, Relationship>()
  const doc = parseXml(relsXml)
  const root = childByLocal(doc, 'Relationships')
  if (!root) return map
  for (const rel of childrenByLocal(childrenOf(root), 'Relationship')) {
    const id = attr(rel, 'Id')
    const target = attr(rel, 'Target')
    // External targets (linked images, web video) have no part in the package.
    if (!id || !target || attr(rel, 'TargetMode') === 'External') continue
    map.set(id, { target: resolveRelTarget(baseDir, target), type: attr(rel, 'Type') ?? '' })
  }
  return map
}

async function readRels(zip: JSZip, partPath: string): Promise<Map<string, Relationship>> {
  const file = zip.file(relsPathFor(partPath))
  if (!file) return new Map()
  return parseRelsXml(await file.async('string'), dirNameOf(partPath))
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
 * Axis-aligned affine from a group's child coordinate space to slide space:
 * `slide = t + child · s`, per axis. Rotation/flip on groups is out of scope —
 * the group walk renders unrotated.
 */
interface GroupXform {
  sx: number
  sy: number
  tx: number
  ty: number
}

const IDENTITY_XFORM: GroupXform = { sx: 1, sy: 1, tx: 0, ty: 0 }

function mapRect(r: RectEmu, t: GroupXform): RectEmu {
  if (t === IDENTITY_XFORM) return r
  return {
    x: Math.round(t.tx + r.x * t.sx),
    y: Math.round(t.ty + r.y * t.sy),
    w: Math.round(r.w * t.sx),
    h: Math.round(r.h * t.sy),
  }
}

/**
 * Composes a group's own transform under an outer one. A child coordinate `c`
 * maps to `off + (c - chOff) · ext/chExt` in the group's parent space, then
 * through `outer` — nested groups multiply through. Missing chOff/chExt
 * default to off/ext (identity mapping), per CT_GroupTransform2D.
 */
function childXformOf(xfrm: XmlNode | undefined, outer: GroupXform): GroupXform {
  if (!xfrm) return outer
  const kids = childrenOf(xfrm)
  const at = (name: string, key: string): number | undefined => {
    const node = childByLocal(kids, name)
    return node ? num(attr(node, key)) : undefined
  }
  const offX = at('off', 'x') ?? 0
  const offY = at('off', 'y') ?? 0
  const extW = at('ext', 'cx') ?? 0
  const extH = at('ext', 'cy') ?? 0
  const chOffX = at('chOff', 'x') ?? offX
  const chOffY = at('chOff', 'y') ?? offY
  const chExtW = at('chExt', 'cx') ?? extW
  const chExtH = at('chExt', 'cy') ?? extH
  const sx = outer.sx * (chExtW !== 0 ? extW / chExtW : 1)
  const sy = outer.sy * (chExtH !== 0 ? extH / chExtH : 1)
  return {
    sx,
    sy,
    tx: outer.tx + outer.sx * offX - sx * chOffX,
    ty: outer.ty + outer.sy * offY - sy * chOffY,
  }
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

/** Placeholder list styles collected from a layout or master part. */
interface PhListStyles {
  byIdx: Map<string, ParsedListStyle>
  byType: Map<string, ParsedListStyle>
}

/** Everything a slide inherits from its layout/master/theme chain. */
interface SlideStyleContext {
  rects: InheritedRects
  theme: Theme
  layoutPh: PhListStyles
  masterPh: PhListStyles
  masterTx: { title?: ParsedListStyle; body?: ParsedListStyle; other?: ParsedListStyle }
  presDefault?: ParsedListStyle
  /** Page background from the layout, or the master when the layout has none. */
  background?: Fill
  /** Non-placeholder decoration shapes from the master's spTree. Render-only. */
  masterUnderlay: Shape[]
  /** Non-placeholder decoration shapes from the layout's spTree. Render-only. */
  layoutUnderlay: Shape[]
  /** `p:sldLayout@showMasterSp` — false hides master decorations entirely. */
  layoutShowsMaster: boolean
}

/** The `p:bg` of a slide/layout/master part, or undefined when not declared. */
function bgNodeOf(doc: XmlNode[], rootLocal: string): XmlNode | undefined {
  const root = childByLocal(doc, rootLocal)
  const cSld = root ? childByLocal(childrenOf(root), 'cSld') : undefined
  return cSld ? childByLocal(childrenOf(cSld), 'bg') : undefined
}

function emptyPhListStyles(): PhListStyles {
  return { byIdx: new Map(), byType: new Map() }
}

function collectPlaceholderListStyles(doc: XmlNode[], theme: Theme, into: PhListStyles): void {
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
    const lstStyle = descend(node, 'txBody', 'lstStyle')
    if (!lstStyle) continue
    const parsed = parseListStyle(lstStyle, theme)
    if (key.idx !== undefined) into.byIdx.set(key.idx, parsed)
    into.byType.set(normalizePhType(key.type), parsed)
  }
}

/**
 * Walks slide -> layout -> master -> theme, letting the nearer part win.
 * Cached per layout path: decks reuse a handful of layouts across many slides.
 */
async function loadSlideContext(
  zip: JSZip,
  slideRels: Map<string, Relationship>,
  presDefaultNode: XmlNode | undefined,
  cache: Map<string, SlideStyleContext>,
  blobUrls: string[],
): Promise<SlideStyleContext> {
  const layoutPath = relTargetOfType(slideRels, '/slideLayout') ?? ''
  const cached = cache.get(layoutPath)
  if (cached) return cached

  const out: SlideStyleContext = {
    rects: { byIdx: new Map(), byType: new Map() },
    theme: DEFAULT_THEME,
    layoutPh: emptyPhListStyles(),
    masterPh: emptyPhListStyles(),
    masterTx: {},
    masterUnderlay: [],
    layoutUnderlay: [],
    layoutShowsMaster: true,
  }

  const layoutFile = layoutPath ? zip.file(layoutPath) : null
  if (layoutFile) {
    const layoutDoc = parseXml(await layoutFile.async('string'))
    const layoutRels = await readRels(zip, layoutPath)
    const masterPath = relTargetOfType(layoutRels, '/slideMaster')
    const masterFile = masterPath ? zip.file(masterPath) : null
    let masterDoc: XmlNode[] | null = null
    let masterRels = new Map<string, Relationship>()
    if (masterFile && masterPath) {
      masterDoc = parseXml(await masterFile.async('string'))

      // Theme first: every list style below resolves colors against it.
      masterRels = await readRels(zip, masterPath)
      const themePath = relTargetOfType(masterRels, '/theme')
      const themeFile = themePath ? zip.file(themePath) : null
      if (themeFile) out.theme = parseTheme(parseXml(await themeFile.async('string')))
      const clrMap = clrMapOfMaster(masterDoc)
      if (clrMap) out.theme = { ...out.theme, clrMap }
    }

    if (masterDoc) {
      // Master first so the layout's own values overwrite the rects.
      collectPlaceholderRects(masterDoc, out.rects)
      collectPlaceholderListStyles(masterDoc, out.theme, out.masterPh)
      const master = childByLocal(masterDoc, 'sldMaster')
      const txStyles = master ? childByLocal(childrenOf(master), 'txStyles') : undefined
      if (txStyles) {
        const kids = childrenOf(txStyles)
        out.masterTx = {
          title: parseListStyle(childByLocal(kids, 'titleStyle'), out.theme),
          body: parseListStyle(childByLocal(kids, 'bodyStyle'), out.theme),
          other: parseListStyle(childByLocal(kids, 'otherStyle'), out.theme),
        }
      }
    }
    collectPlaceholderRects(layoutDoc, out.rects)
    collectPlaceholderListStyles(layoutDoc, out.theme, out.layoutPh)

    // Background cascade below the slide: layout wins, then master.
    const bgNode =
      bgNodeOf(layoutDoc, 'sldLayout') ?? (masterDoc ? bgNodeOf(masterDoc, 'sldMaster') : undefined)
    if (bgNode) out.background = backgroundFillOf(bgNode, out.theme)

    // Decoration underlay: real content (photos, panels, footers) that decks
    // — Canva exports especially — author on the layout/master rather than the
    // slide. Placeholder slots are templates, not content, and are skipped.
    // Media resolves against the owning part's own rels.
    const layoutRoot = childByLocal(layoutDoc, 'sldLayout')
    out.layoutShowsMaster = !layoutRoot || attr(layoutRoot, 'showMasterSp') !== '0'
    if (masterDoc && masterPath && out.layoutShowsMaster) {
      out.masterUnderlay = await collectDecorations(
        masterDoc, 'sldMaster', masterPath, masterRels, out, zip, blobUrls,
      )
    }
    out.layoutUnderlay = await collectDecorations(
      layoutDoc, 'sldLayout', layoutPath, layoutRels, out, zip, blobUrls,
    )
  }

  if (presDefaultNode) out.presDefault = parseListStyle(presDefaultNode, out.theme)

  cache.set(layoutPath, out)
  return out
}

const NV_PR_LOCALS = ['nvSpPr', 'nvPicPr', 'nvGraphicFramePr', 'nvGrpSpPr', 'nvCxnSpPr']

/**
 * The model's shape id: `p:cNvPr@id` when present, else the synthesized
 * ordinal form. Exported so the serializer can replay this exact derivation on
 * a re-parsed node and cross-check a deletion against the model's target.
 */
export function shapeIdOf(node: XmlNode, fallbackIndex: number): string {
  for (const nv of NV_PR_LOCALS) {
    const cNvPr = descend(node, nv, 'cNvPr')
    const id = cNvPr && attr(cNvPr, 'id')
    if (id) return id
  }
  return `idx:${fallbackIndex}`
}

/** True when the node is a placeholder slot (`p:ph`), whatever its shape kind. */
function isPlaceholderNode(node: XmlNode): boolean {
  return NV_PR_LOCALS.some((nv) => descend(node, nv, 'nvPr', 'ph') !== undefined)
}

/**
 * Parses a layout/master part's non-placeholder spTree shapes for the render
 * underlay. The nodePaths produced here index into the OWNING PART's spTree,
 * not the slide — underlay shapes are render-only and must never be handed to
 * the serializer.
 */
async function collectDecorations(
  doc: XmlNode[],
  rootLocal: string,
  partPath: string,
  rels: Map<string, Relationship>,
  styles: SlideStyleContext,
  zip: JSZip,
  blobUrls: string[],
): Promise<Shape[]> {
  const root = childByLocal(doc, rootLocal)
  const spTree = root ? descend(root, 'cSld', 'spTree') : undefined
  if (!spTree) return []
  const ctx: ShapeContext = { slideXmlPath: partPath, rels, styles, zip, blobUrls }
  const out: Shape[] = []
  const kids = childrenOf(spTree)
  for (let i = 0; i < kids.length; i++) {
    const tag = tagNameOf(kids[i])
    if (!tag || !GROUP_CHILD_LOCALS.includes(local(tag))) continue
    if (isPlaceholderNode(kids[i])) continue
    const shape = await shapeFromNode(kids[i], [i], i, ctx)
    if (shape) out.push(shape)
  }
  return out
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
  // Verbatim: a `+mn-lt` token stays a token here. Display resolution maps it
  // through the theme; this model stays anchored to what the bytes say.
  const latin = childByLocal(childrenOf(rPr), 'latin')
  const typeface = latin && attr(latin, 'typeface')
  if (typeface) out.latinFont = typeface
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
  styles: SlideStyleContext
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
    const byIdx = ctx.styles.rects.byIdx.get(key.idx)
    if (byIdx) return { ...byIdx }
  }
  const byType = ctx.styles.rects.byType.get(normalizePhType(key.type))
  return byType ? { ...byType } : own
}

// ------------------------------------------------------------ text display

const HARD_DEFAULT_SIZE_PT = 18

/** spcPts is absolute; spcPct is a fraction of the paragraph's text size. */
function spacingPt(spec: SpacingSpec | undefined, sizePt: number): number {
  if (!spec) return 0
  if (spec.pt !== undefined) return spec.pt
  return (spec.pct ?? 0) * sizePt
}

/**
 * Resolves the display styling for one text shape: run rPr -> paragraph
 * defRPr -> shape lstStyle -> layout placeholder -> master placeholder ->
 * master txStyles (by placeholder type) -> presentation default. Display
 * only — the model paragraphs the serializer validates are untouched.
 */
function resolveTextDisplay(
  spNode: XmlNode,
  txBody: XmlNode,
  ctx: ShapeContext,
): TextDisplay {
  const { theme } = ctx.styles
  const key = phKeyOf(spNode)
  const phType = key ? normalizePhType(key.type) : undefined

  const shapeLst = parseListStyle(childByLocal(childrenOf(txBody), 'lstStyle'), theme)
  const layoutPh =
    (key?.idx !== undefined ? ctx.styles.layoutPh.byIdx.get(key.idx) : undefined) ??
    (phType ? ctx.styles.layoutPh.byType.get(phType) : undefined)
  const masterPh =
    (key?.idx !== undefined ? ctx.styles.masterPh.byIdx.get(key.idx) : undefined) ??
    (phType ? ctx.styles.masterPh.byType.get(phType) : undefined)
  const masterTx = ctx.styles.masterTx[txStyleKindFor(key?.type, key !== null)]

  const fallbackColor = schemeColorHex(theme, 'tx1')

  const resolveLevel = (own: ReturnType<typeof levelStyleFromPPr>, lvl: number) =>
    mergeLevelStyles([
      own,
      ...layersOf(shapeLst, lvl),
      ...layersOf(layoutPh, lvl),
      ...layersOf(masterPh, lvl),
      ...layersOf(masterTx, lvl),
      ...layersOf(ctx.styles.presDefault, lvl),
    ])

  const runStyleOf = (
    explicit: ReturnType<typeof runLayerFromRPr>,
    merged: ReturnType<typeof mergeLevelStyles>,
  ): ResolvedRunStyle => {
    const style: ResolvedRunStyle = {
      sizePt: explicit.sizePt ?? merged.sizePt ?? HARD_DEFAULT_SIZE_PT,
      bold: explicit.bold ?? merged.bold ?? false,
      italic: explicit.italic ?? merged.italic ?? false,
      underline: explicit.underline ?? merged.underline ?? false,
      colorHex: explicit.colorHex ?? merged.colorHex ?? fallbackColor,
    }
    const latin = explicit.latinFont ?? merged.latinFont
    const fontFamily = cssFontFamily(
      latin,
      explicit.eaFont ?? merged.eaFont,
      explicit.csFont ?? merged.csFont,
    )
    if (fontFamily) style.fontFamily = fontFamily
    if (latin) style.latinFont = latin
    const spc = explicit.letterSpacingPt ?? merged.letterSpacingPt
    if (spc !== undefined && spc !== 0) style.letterSpacingPt = spc
    return style
  }

  const paragraphs: ParagraphDisplay[] = []
  for (const pNode of childrenByLocal(childrenOf(txBody), 'p')) {
    const pPr = childByLocal(childrenOf(pNode), 'pPr')
    const level = Math.min(8, Math.max(0, num(pPr ? attr(pPr, 'lvl') : undefined) ?? 0))
    const merged = resolveLevel(levelStyleFromPPr(pPr, theme), level)
    const defaultRun = runStyleOf({}, merged)
    const runs = keptRunNodesOf(pNode).map((item) =>
      item.kind === 'br' ? defaultRun : runStyleOf(runLayerFromRPr(item.rPr, theme), merged),
    )
    // spcPct scales the 1.2 base so an explicit 100% renders like the default.
    const lineHeight: LineSpacing =
      merged.lnSpc?.pt !== undefined
        ? { kind: 'pt', pt: merged.lnSpc.pt }
        : { kind: 'mult', value: (merged.lnSpc?.pct ?? 1) * DEFAULT_LINE_HEIGHT }
    paragraphs.push({
      level,
      marLEmu: merged.marLEmu ?? 0,
      indentEmu: merged.indentEmu ?? 0,
      align: merged.align,
      bullet: merged.bullet ?? { kind: 'none' },
      lineHeight,
      spaceBeforePt: spacingPt(merged.spcBef, defaultRun.sizePt),
      spaceAfterPt: spacingPt(merged.spcAft, defaultRun.sizePt),
      runs,
      defaultRun,
    })
  }

  // Vertical anchor: the shape's own bodyPr, else the OOXML default (top).
  // `just`/`dist` justify content across the height; top is the nearest draw.
  const bodyPr = childByLocal(childrenOf(txBody), 'bodyPr')
  const rawAnchor = bodyPr ? attr(bodyPr, 'anchor') : undefined
  const anchor = rawAnchor === 'ctr' || rawAnchor === 'b' ? rawAnchor : 't'

  const out: TextDisplay = { paragraphs, defaultRun: runStyleOf({}, resolveLevel({}, 0)), anchor }

  // normAutofit: PowerPoint precomputes the shrink factors and stores them on
  // the shape's own bodyPr; they scale rendered sizes, never the model.
  const autofit = bodyPr ? childByLocal(childrenOf(bodyPr), 'normAutofit') : undefined
  if (autofit) {
    // Clamped: these only ever shrink, and a corrupt 0 would render the whole
    // shape's text invisible rather than merely mis-sized.
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    out.autofit = {
      fontScale: clamp((num(attr(autofit, 'fontScale')) ?? 100000) / 100000, 0.01, 1),
      lnSpcReduction: clamp((num(attr(autofit, 'lnSpcReduction')) ?? 0) / 100000, 0, 0.99),
    }
  }
  return out
}

/** grpSp children we walk; anything else inside a group is silently skipped. */
const GROUP_CHILD_LOCALS = ['sp', 'pic', 'grpSp', 'cxnSp', 'graphicFrame']

async function shapeFromNode(
  node: XmlNode,
  nodePath: NodePath,
  index: number,
  ctx: ShapeContext,
  xform: GroupXform = IDENTITY_XFORM,
): Promise<Shape | null> {
  const tag = tagNameOf(node)
  if (!tag) return null
  const name = local(tag)

  const base = {
    id: shapeIdOf(node, index),
    slideXmlPath: ctx.slideXmlPath,
    nodePath,
    xfrmEmu: mapRect(resolveRect(node, ctx), xform),
  }

  if (name === 'sp') {
    const visual = shapeVisualOf(node, ctx.styles.theme)
    const style = shapeStyleSnapshotOf(node)
    const txBody = childByLocal(childrenOf(node), 'txBody')
    if (!txBody) {
      // A shape with geometry but no text — an arrow, a divider, a colored box.
      return { ...base, type: 'drawing', visual, style } satisfies DrawingShape
    }
    const paragraphs = childrenByLocal(childrenOf(txBody), 'p').map(parseParagraph)
    const display = resolveTextDisplay(node, txBody, ctx)
    return { ...base, type: 'text', paragraphs, visual, display, style } satisfies TextShape
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
    const visual = shapeVisualOf(node, ctx.styles.theme)
    return { ...base, type: 'image', blobUrl, mediaPath, visual } satisfies ImageShape
  }

  if (name === 'graphicFrame') {
    return { ...base, type: 'placeholder', kind: graphicFrameKind(node) } satisfies PlaceholderShape
  }

  if (name === 'grpSp') {
    // Walk the children instead of stubbing the group. Each child's rect maps
    // through this group's chOff/chExt transform composed under any outer
    // groups, so every descendant lands in final slide-space EMU. Children are
    // read-only — see GroupShape.
    const inner = childXformOf(descend(node, 'grpSpPr', 'xfrm'), xform)
    const kids = childrenOf(node)
    const children: Shape[] = []
    for (let i = 0; i < kids.length; i++) {
      const childTag = tagNameOf(kids[i])
      if (!childTag || !GROUP_CHILD_LOCALS.includes(local(childTag))) continue
      const child = await shapeFromNode(kids[i], [...nodePath, i], i, ctx, inner)
      if (child) children.push(child)
    }
    return { ...base, type: 'group', children } satisfies GroupShape
  }

  if (name === 'cxnSp') {
    // Connectors: lines/arrows with real stroke styling.
    const visual = shapeVisualOf(node, ctx.styles.theme)
    if (!visual.geom) visual.geom = { preset: 'straightConnector1', adj: {} }
    return { ...base, type: 'drawing', visual, style: shapeStyleSnapshotOf(node) } satisfies DrawingShape
  }

  return null
}

async function parseSlide(
  zip: JSZip,
  xmlPath: string,
  xml: string,
  blobUrls: string[],
  presDefaultNode: XmlNode | undefined,
  styleCache: Map<string, SlideStyleContext>,
  /** For parts not (yet) in the zip — a freshly synthesized slide's rels. */
  relsOverride?: Map<string, Relationship>,
): Promise<Slide> {
  const doc = parseXml(xml)
  const rels = relsOverride ?? (await readRels(zip, xmlPath))
  const styles = await loadSlideContext(zip, rels, presDefaultNode, styleCache, blobUrls)
  const ctx: ShapeContext = { slideXmlPath: xmlPath, rels, styles, zip, blobUrls }

  const sldIndex = doc.findIndex((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === 'sld'
  })
  const shapes: Shape[] = []
  if (sldIndex < 0) return { id: xmlPath, xmlPath, shapes, spTreePath: [] }

  const sld = doc[sldIndex]
  const cSldKids = childrenOf(sld)
  const cSldIndex = cSldKids.findIndex((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === 'cSld'
  })
  if (cSldIndex < 0) return { id: xmlPath, xmlPath, shapes, spTreePath: [] }

  const spTreeKids = childrenOf(cSldKids[cSldIndex])
  const spTreeIndex = spTreeKids.findIndex((n) => {
    const t = tagNameOf(n)
    return t !== null && local(t) === 'spTree'
  })
  if (spTreeIndex < 0) return { id: xmlPath, xmlPath, shapes, spTreePath: [] }

  const children = childrenOf(spTreeKids[spTreeIndex])
  for (let i = 0; i < children.length; i++) {
    const nodePath: NodePath = [sldIndex, cSldIndex, spTreeIndex, i]
    const shape = await shapeFromNode(children[i], nodePath, i, ctx)
    if (shape) shapes.push(shape)
  }

  // Page background: the slide's own p:bg wins over the layout/master's.
  const ownBg = childByLocal(spTreeKids, 'bg')
  const background = ownBg ? backgroundFillOf(ownBg, styles.theme) : styles.background

  // Layout/master decoration beneath the slide's own shapes. `p:sld` can opt
  // out of the master's with showMasterSp="0"; the layout's always paint.
  const showMaster = attr(sld, 'showMasterSp') !== '0'
  const underlay = [...(showMaster ? styles.masterUnderlay : []), ...styles.layoutUnderlay]

  const slide: Slide = {
    id: xmlPath,
    xmlPath,
    shapes,
    spTreePath: [sldIndex, cSldIndex, spTreeIndex],
  }
  if (background !== undefined) slide.background = background
  if (underlay.length > 0) slide.underlay = underlay
  return slide
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

  const presDefaultNode = childByLocal(childrenOf(pres), 'defaultTextStyle')
  const styleCache = new Map<string, SlideStyleContext>()
  const blobUrls: string[] = []
  const slideXml: Record<string, string> = {}
  const slides: Slide[] = []
  for (const path of slidePaths) {
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async('string')
    slideXml[path] = xml
    slides.push(await parseSlide(zip, path, xml, blobUrls, presDefaultNode, styleCache))
  }

  const deck: SlideDeck = { slideSizeEmu, slides, source: { zip, slideXml } }
  const firstCtx = styleCache.values().next().value as SlideStyleContext | undefined
  if (firstCtx) {
    deck.themeColors = {
      accent1: schemeColorHex(firstCtx.theme, 'accent1'),
      tx1: schemeColorHex(firstCtx.theme, 'tx1'),
    }
  }
  return deck
}

/**
 * Parses a slide that exists only in the edit set — a freshly added slide
 * whose part and .rels are synthesized strings, not zip entries yet. Renders
 * through the exact pipeline real slides use (layout underlay, placeholder
 * geometry, style cascade), so an added slide looks right before its first
 * save. The returned Slide's nodePaths index into `xml`, which is what the
 * serializer applies this slide's edits against.
 */
export async function parseAddedSlide(
  deck: SlideDeck,
  xmlPath: string,
  xml: string,
  relsXml: string,
): Promise<Slide> {
  const zip = deck.source.zip
  const rels = parseRelsXml(relsXml, dirNameOf(xmlPath))
  // The presentation-level default text style, re-read since parsePptx's
  // local doesn't survive parsing.
  const presFile = zip.file('ppt/presentation.xml')
  const presDoc = presFile ? parseXml(await presFile.async('string')) : []
  const pres = childByLocal(presDoc, 'presentation')
  const presDefaultNode = pres ? childByLocal(childrenOf(pres), 'defaultTextStyle') : undefined
  const blobUrls: string[] = []
  return parseSlide(zip, xmlPath, xml, blobUrls, presDefaultNode, new Map(), rels)
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

/** Releases the object URLs held by a deck's image shapes, groups included. */
export function disposeDeck(deck: SlideDeck): void {
  const revoke = (shape: Shape): void => {
    if (shape.type === 'image') URL.revokeObjectURL(shape.blobUrl)
    else if (shape.type === 'group') shape.children.forEach(revoke)
  }
  for (const slide of deck.slides) {
    slide.shapes.forEach(revoke)
    // Underlay arrays are shared across slides on the same layout; revoking an
    // already-revoked URL is a harmless no-op.
    slide.underlay?.forEach(revoke)
  }
}
