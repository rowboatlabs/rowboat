/**
 * Planning a NEW slide: a synthesized part + .rels that instantiate the
 * anchor slide's layout, the way PowerPoint's "New Slide" does — one empty
 * `p:sp` per layout placeholder (title/body/…, skipping the footer/date/number
 * chrome), each referencing its slot via `p:ph`, so geometry and text style
 * inherit through the existing cascade and the editor shows the familiar
 * "Add text" boxes.
 *
 * Only strings are produced here. Nothing is written and no existing bytes
 * are touched — `writeDeck` owns splicing the package parts, and the editor
 * owns rendering the plan. Fail closed on anything surprising.
 */

import JSZip from 'jszip'
import {
  attr,
  childByLocal,
  childrenByLocal,
  childrenOf,
  descend,
  localNameOf,
  parseXml,
  relsPathFor,
  tagNameOf,
} from './parse'
import type { SlideDeck } from './types'

const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** Everything writeDeck needs to add one slide to the package. */
export interface NewSlidePlan {
  /** New part path, e.g. `ppt/slides/slide18.xml`. Guaranteed unused. */
  path: string
  /** Complete synthesized slide XML. */
  xml: string
  /** Complete synthesized .rels (the slide's layout reference). */
  relsXml: string
  /** The slide this one follows; '' inserts at the front of the deck. */
  afterPath: string
}

function fail(msg: string): never {
  throw new Error(`pptx add-slide: ${msg}`)
}

/** Placeholder types that are slide chrome, not content — never instantiated. */
const SKIPPED_PH_TYPES = new Set(['ftr', 'dt', 'sldNum'])

/** `title` -> `Title 1`-style shape name, purely cosmetic. */
function placeholderName(type: string | undefined, ordinal: number): string {
  const base = type === 'title' || type === 'ctrTitle' ? 'Title' : type === 'subTitle' ? 'Subtitle' : 'Content Placeholder'
  return `${base} ${ordinal}`
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
  ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

/** The `p:ph` slots of a layout worth instantiating, in document order. */
function layoutPlaceholders(layoutXml: string): Array<{ type?: string; idx?: string }> {
  const doc = parseXml(layoutXml)
  const root = childByLocal(doc, 'sldLayout')
  const spTree = root ? descend(root, 'cSld', 'spTree') : undefined
  if (!spTree) return []
  const out: Array<{ type?: string; idx?: string }> = []
  for (const node of childrenOf(spTree)) {
    const tag = tagNameOf(node)
    if (!tag || localNameOf(tag) !== 'sp') continue
    const ph = descend(node, 'nvSpPr', 'nvPr', 'ph')
    if (!ph) continue
    const type = attr(ph, 'type')
    if (type && SKIPPED_PH_TYPES.has(type)) continue
    out.push({ type, idx: attr(ph, 'idx') })
  }
  return out
}

function placeholderSp(ph: { type?: string; idx?: string }, id: number, ordinal: number): string {
  const phAttrs =
    (ph.type ? ` type="${ph.type}"` : '') + (ph.idx !== undefined ? ` idx="${ph.idx}"` : '')
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${placeholderName(ph.type, ordinal)}"/>` +
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    `<p:nvPr><p:ph${phAttrs}/></p:nvPr></p:nvSpPr><p:spPr/>` +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>'
  )
}

function slideXmlFor(placeholders: Array<{ type?: string; idx?: string }>): string {
  const shapes = placeholders.map((ph, i) => placeholderSp(ph, i + 2, i + 1)).join('')
  return (
    XML_HEAD +
    `<p:sld ${NS}><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    shapes +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  )
}

function relsXmlFor(layoutPath: string): string {
  // Slides live in ppt/slides, so any ppt/… layout is one directory up.
  if (!layoutPath.startsWith('ppt/')) fail(`unexpected layout location ${layoutPath}`)
  return (
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../${layoutPath.slice(4)}"/>` +
    '</Relationships>'
  )
}

/** First unused `ppt/slides/slideN.xml`, also dodging pending added paths. */
function nextSlidePath(zip: JSZip, usedPaths: readonly string[]): string {
  let max = 0
  const consider = (p: string): void => {
    const m = p.match(/^ppt\/slides\/slide(\d+)\.xml$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  Object.keys(zip.files).forEach(consider)
  usedPaths.forEach(consider)
  return `ppt/slides/slide${max + 1}.xml`
}

/** The slideLayout Target of a .rels document, resolved to a package path. */
function layoutTargetOf(relsXml: string): string | undefined {
  const root = childByLocal(parseXml(relsXml), 'Relationships')
  if (!root) return undefined
  for (const rel of childrenByLocal(childrenOf(root), 'Relationship')) {
    const type = attr(rel, 'Type') ?? ''
    const target = attr(rel, 'Target')
    if (!type.endsWith('/slideLayout') || !target) continue
    // Targets are relative to ppt/slides; normalize `../x` to `ppt/x`.
    return target.startsWith('../') ? `ppt/${target.slice(3)}` : target.replace(/^\//, '')
  }
  return undefined
}

/**
 * Plans one new slide after `afterPath`, on the same layout as the anchor.
 * `anchorRelsXml` supplies the anchor's rels when the anchor is itself a
 * pending added slide (its part is not in the zip yet); `usedPaths` are the
 * part names already claimed by pending adds.
 */
export async function planNewSlide(
  deck: SlideDeck,
  afterPath: string,
  anchorRelsXml: string | undefined,
  usedPaths: readonly string[],
): Promise<NewSlidePlan> {
  const zip = deck.source.zip

  let relsXml = anchorRelsXml
  if (relsXml === undefined) {
    const file = zip.file(relsPathFor(afterPath))
    if (!file) fail(`slide ${afterPath} has no relationships part — cannot determine its layout`)
    relsXml = await file.async('string')
  }
  const layoutPath = layoutTargetOf(relsXml) ?? fail(`slide ${afterPath} references no layout`)

  const layoutFile = zip.file(layoutPath) ?? fail(`layout ${layoutPath} is missing from the package`)
  const placeholders = layoutPlaceholders(await layoutFile.async('string'))

  return {
    path: nextSlidePath(zip, usedPaths),
    xml: slideXmlFor(placeholders),
    relsXml: relsXmlFor(layoutPath),
    afterPath,
  }
}
