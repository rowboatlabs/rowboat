/**
 * Synthesizes a complete, minimal, valid .pptx package from strings — the
 * whole-package counterpart to add-slide.ts's single-part synthesis. The
 * result is a 16:9 deck with one slide master, two layouts (Title Slide,
 * Title and Body), a theme built from a caller-chosen palette, docProps, and
 * one title slide on the Title Slide layout.
 *
 * Everything the rest of the pipeline needs is honored by construction:
 * parsePptx's part expectations, the placeholder-geometry cascade (layout
 * placeholders carry a:xfrm so slide placeholders inherit their boxes),
 * and writeDeck's fail-closed package splicing (a typed slide Override to
 * copy, a non-empty sldIdLst, rIdN relationship ids). All palette colors
 * live in theme1.xml alone, so a future "change theme" edits one part.
 *
 * Only strings are produced here (plus one JSZip serialization at the end).
 * Nothing is written to disk.
 */

import JSZip from 'jszip'

// ------------------------------------------------------------------ palettes

/** The twelve a:clrScheme slots, RRGGBB with no leading `#`. */
export interface DeckPaletteScheme {
  dk1: string
  lt1: string
  dk2: string
  lt2: string
  accent1: string
  accent2: string
  accent3: string
  accent4: string
  accent5: string
  accent6: string
  hlink: string
  folHlink: string
}

export interface DeckPalette {
  id: string
  /** Menu label, e.g. "Navy". */
  name: string
  scheme: DeckPaletteScheme
  /** Heading typeface (a:majorFont). A broadly available family. */
  majorFont: string
  /** Body typeface (a:minorFont). */
  minorFont: string
}

export const DECK_PALETTES: readonly DeckPalette[] = [
  {
    id: 'navy',
    name: 'Navy',
    scheme: {
      dk1: '10243E',
      lt1: 'FFFFFF',
      dk2: '1F3A5F',
      lt2: 'DCE6F1',
      accent1: '1F4E79',
      accent2: '2E75B6',
      accent3: '5B9BD5',
      accent4: '9DC3E6',
      accent5: '44546A',
      accent6: 'C55A11',
      hlink: '2E75B6',
      folHlink: '5A6B8C',
    },
    majorFont: 'Georgia',
    minorFont: 'Arial',
  },
  {
    id: 'warm',
    name: 'Earthy',
    scheme: {
      dk1: '3B2B20',
      lt1: 'FFFCF7',
      dk2: '6B4F3A',
      lt2: 'F0E6D8',
      accent1: 'B85C38',
      accent2: 'D9A441',
      accent3: '8A9A5B',
      accent4: 'A9714B',
      accent5: '7C6A46',
      accent6: '9C4722',
      hlink: '9C4722',
      folHlink: '7C6A46',
    },
    majorFont: 'Trebuchet MS',
    minorFont: 'Verdana',
  },
  {
    id: 'mono',
    name: 'Mono',
    scheme: {
      dk1: '1A1A1A',
      lt1: 'FFFFFF',
      dk2: '404040',
      lt2: 'F2F2F2',
      accent1: '333333',
      accent2: '595959',
      accent3: '7F7F7F',
      accent4: 'A6A6A6',
      accent5: 'BFBFBF',
      accent6: 'D9D9D9',
      hlink: '404040',
      folHlink: '7F7F7F',
    },
    majorFont: 'Arial',
    minorFont: 'Arial',
  },
]

// ----------------------------------------------------------------- geometry

/** 16:9. */
export const SLIDE_SIZE_EMU = { w: 12192000, h: 6858000 }

/** Placeholder boxes on the Title Slide layout (slideLayout1). */
export const TITLE_LAYOUT_RECTS = {
  ctrTitle: { x: 914400, y: 2286000, w: 10363200, h: 1600200 },
  subTitle: { x: 914400, y: 4114800, w: 10363200, h: 914400 },
}

/** Placeholder boxes on the Title and Body layout (slideLayout2) and master. */
export const BODY_LAYOUT_RECTS = {
  title: { x: 914400, y: 457200, w: 10363200, h: 1143000 },
  body: { x: 914400, y: 1828800, w: 10363200, h: 4114800 },
}

// -------------------------------------------------------------------- parts

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
  ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const PKG_REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_TYPE = 'http://schemas.openxmlformats.org/package/2006/relationships'

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
}

function xfrm(rect: { x: number; y: number; w: number; h: number }): string {
  return (
    `<a:xfrm><a:off x="${rect.x}" y="${rect.y}"/>` +
    `<a:ext cx="${rect.w}" cy="${rect.h}"/></a:xfrm>`
  )
}

/** The fixed spTree prelude every p:spTree starts with. */
const SP_TREE_HEAD =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'

/** One placeholder p:sp; `rect` on layouts/masters, omitted on the slide. */
function placeholderSp(opts: {
  id: number
  name: string
  phAttrs: string
  rect?: { x: number; y: number; w: number; h: number }
  paragraph?: string
}): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${opts.id}" name="${opts.name}"/>` +
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    `<p:nvPr><p:ph ${opts.phAttrs}/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${opts.rect ? xfrm(opts.rect) : ''}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${opts.paragraph ?? '<a:p><a:endParaRPr/></a:p>'}</p:txBody></p:sp>`
  )
}

function contentTypesXml(): string {
  const ct = (part: string, type: string): string =>
    `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-${type}"/>`
  return (
    XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    ct('ppt/presentation.xml', 'officedocument.presentationml.presentation.main+xml') +
    ct('ppt/slideMasters/slideMaster1.xml', 'officedocument.presentationml.slideMaster+xml') +
    ct('ppt/slideLayouts/slideLayout1.xml', 'officedocument.presentationml.slideLayout+xml') +
    ct('ppt/slideLayouts/slideLayout2.xml', 'officedocument.presentationml.slideLayout+xml') +
    ct('ppt/slides/slide1.xml', 'officedocument.presentationml.slide+xml') +
    ct('ppt/theme/theme1.xml', 'officedocument.theme+xml') +
    ct('docProps/core.xml', 'package.core-properties+xml') +
    ct('docProps/app.xml', 'officedocument.extended-properties+xml') +
    '</Types>'
  )
}

function packageRelsXml(): string {
  return (
    XML_HEAD +
    `<Relationships ${PKG_REL_NS}>` +
    `<Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="ppt/presentation.xml"/>` +
    `<Relationship Id="rId2" Type="${PKG_REL_TYPE}/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${REL_TYPE}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>'
  )
}

function presentationXml(): string {
  return (
    XML_HEAD +
    `<p:presentation ${NS}>` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
    `<p:sldSz cx="${SLIDE_SIZE_EMU.w}" cy="${SLIDE_SIZE_EMU.h}"/>` +
    '<p:notesSz cx="6858000" cy="9144000"/>' +
    '</p:presentation>'
  )
}

function presentationRelsXml(): string {
  return (
    XML_HEAD +
    `<Relationships ${PKG_REL_NS}>` +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_TYPE}/slide" Target="slides/slide1.xml"/>` +
    `<Relationship Id="rId3" Type="${REL_TYPE}/theme" Target="theme/theme1.xml"/>` +
    '</Relationships>'
  )
}

const CLR_MAP_ATTRS =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"' +
  ' accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"' +
  ' hlink="hlink" folHlink="folHlink"'

function slideMasterXml(): string {
  const titleSp = placeholderSp({
    id: 2,
    name: 'Title Placeholder 1',
    phAttrs: 'type="title"',
    rect: BODY_LAYOUT_RECTS.title,
  })
  const bodySp = placeholderSp({
    id: 3,
    name: 'Body Placeholder 2',
    phAttrs: 'type="body" idx="1"',
    rect: BODY_LAYOUT_RECTS.body,
  })
  const lvl1 = (sizeCsv: string, font: string): string =>
    `<a:lvl1pPr algn="l"><a:buNone/><a:defRPr sz="${sizeCsv}">` +
    `<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="${font}"/></a:defRPr></a:lvl1pPr>`
  return (
    XML_HEAD +
    `<p:sldMaster ${NS}><p:cSld>` +
    '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' +
    `<p:spTree>${SP_TREE_HEAD}${titleSp}${bodySp}</p:spTree></p:cSld>` +
    `<p:clrMap ${CLR_MAP_ATTRS}/>` +
    '<p:sldLayoutIdLst>' +
    '<p:sldLayoutId id="2147483649" r:id="rId1"/>' +
    '<p:sldLayoutId id="2147483650" r:id="rId2"/>' +
    '</p:sldLayoutIdLst>' +
    '<p:txStyles>' +
    `<p:titleStyle>${lvl1('4400', '+mj-lt')}</p:titleStyle>` +
    `<p:bodyStyle>${lvl1('1800', '+mn-lt')}</p:bodyStyle>` +
    `<p:otherStyle>${lvl1('1800', '+mn-lt')}</p:otherStyle>` +
    '</p:txStyles></p:sldMaster>'
  )
}

function slideMasterRelsXml(): string {
  return (
    XML_HEAD +
    `<Relationships ${PKG_REL_NS}>` +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>` +
    `<Relationship Id="rId3" Type="${REL_TYPE}/theme" Target="../theme/theme1.xml"/>` +
    '</Relationships>'
  )
}

function titleLayoutXml(): string {
  const title = placeholderSp({
    id: 2,
    name: 'Title 1',
    phAttrs: 'type="ctrTitle"',
    rect: TITLE_LAYOUT_RECTS.ctrTitle,
  })
  const subtitle = placeholderSp({
    id: 3,
    name: 'Subtitle 2',
    phAttrs: 'type="subTitle" idx="1"',
    rect: TITLE_LAYOUT_RECTS.subTitle,
  })
  return (
    XML_HEAD +
    `<p:sldLayout ${NS} type="title" preserve="1">` +
    `<p:cSld name="Title Slide"><p:spTree>${SP_TREE_HEAD}${title}${subtitle}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
  )
}

function bodyLayoutXml(): string {
  const title = placeholderSp({
    id: 2,
    name: 'Title 1',
    phAttrs: 'type="title"',
    rect: BODY_LAYOUT_RECTS.title,
  })
  const body = placeholderSp({
    id: 3,
    name: 'Body 2',
    phAttrs: 'type="body" idx="1"',
    rect: BODY_LAYOUT_RECTS.body,
  })
  return (
    XML_HEAD +
    `<p:sldLayout ${NS} type="tx" preserve="1">` +
    `<p:cSld name="Title and Body"><p:spTree>${SP_TREE_HEAD}${title}${body}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
  )
}

function layoutRelsXml(): string {
  return (
    XML_HEAD +
    `<Relationships ${PKG_REL_NS}>` +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
    '</Relationships>'
  )
}

function themeXml(palette: DeckPalette): string {
  const s = palette.scheme
  const slot = (name: keyof DeckPaletteScheme): string =>
    `<a:${name}><a:srgbClr val="${s[name]}"/></a:${name}>`
  // The fmtScheme lists each need three entries per the schema; these are the
  // simplest solid variants (base / tinted / shaded phClr).
  const fills =
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:tint val="65000"/></a:schemeClr></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:shade val="75000"/></a:schemeClr></a:solidFill>'
  const line = (w: number): string =>
    `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">` +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
  const bgFills =
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:shade val="85000"/></a:schemeClr></a:solidFill>'
  const font = (typeface: string): string =>
    `<a:latin typeface="${typeface}"/><a:ea typeface=""/><a:cs typeface=""/>`
  return (
    XML_HEAD +
    `<a:theme ${A_NS} name="Rowboat ${palette.name}"><a:themeElements>` +
    `<a:clrScheme name="${palette.name}">` +
    slot('dk1') +
    slot('lt1') +
    slot('dk2') +
    slot('lt2') +
    slot('accent1') +
    slot('accent2') +
    slot('accent3') +
    slot('accent4') +
    slot('accent5') +
    slot('accent6') +
    slot('hlink') +
    slot('folHlink') +
    '</a:clrScheme>' +
    `<a:fontScheme name="${palette.name}">` +
    `<a:majorFont>${font(palette.majorFont)}</a:majorFont>` +
    `<a:minorFont>${font(palette.minorFont)}</a:minorFont>` +
    '</a:fontScheme>' +
    '<a:fmtScheme name="Office">' +
    `<a:fillStyleLst>${fills}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
    '<a:effectStyleLst>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) +
    '</a:effectStyleLst>' +
    `<a:bgFillStyleLst>${bgFills}</a:bgFillStyleLst>` +
    '</a:fmtScheme></a:themeElements></a:theme>'
  )
}

function titleSlideXml(title: string): string {
  const trimmed = title.trim()
  const titlePara = trimmed
    ? `<a:p><a:r><a:t>${escapeXmlText(trimmed)}</a:t></a:r></a:p>`
    : undefined
  const titleSp = placeholderSp({
    id: 2,
    name: 'Title 1',
    phAttrs: 'type="ctrTitle"',
    paragraph: titlePara,
  })
  const subtitleSp = placeholderSp({
    id: 3,
    name: 'Subtitle 2',
    phAttrs: 'type="subTitle" idx="1"',
  })
  return (
    XML_HEAD +
    `<p:sld ${NS}><p:cSld><p:spTree>${SP_TREE_HEAD}${titleSp}${subtitleSp}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  )
}

function slideRelsXml(): string {
  return (
    XML_HEAD +
    `<Relationships ${PKG_REL_NS}>` +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    '</Relationships>'
  )
}

function corePropsXml(title: string, createdAt: string): string {
  const stamp = escapeXmlText(createdAt)
  return (
    XML_HEAD +
    '<cp:coreProperties' +
    ' xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
    ' xmlns:dcterms="http://purl.org/dc/terms/"' +
    ' xmlns:dcmitype="http://purl.org/dc/dcmitype/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXmlText(title)}</dc:title>` +
    '<dc:creator>Rowboat</dc:creator>' +
    '<cp:lastModifiedBy>Rowboat</cp:lastModifiedBy>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    '</cp:coreProperties>'
  )
}

function appPropsXml(): string {
  return (
    XML_HEAD +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"' +
    ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>Rowboat</Application>' +
    '<Slides>1</Slides>' +
    '<PresentationFormat>Widescreen</PresentationFormat>' +
    '</Properties>'
  )
}

// -------------------------------------------------------------------- entry

export interface NewDeckOptions {
  /** Deck title: docProps dc:title and the title slide's heading text. */
  title: string
  palette: DeckPalette
  /** ISO-8601 stamp for docProps created/modified. Defaults to now. */
  createdAt?: string
}

/** Every part of the new package, path -> XML string, in package order. */
export function newDeckParts(opts: NewDeckOptions): Map<string, string> {
  const createdAt = opts.createdAt ?? new Date().toISOString()
  return new Map([
    ['[Content_Types].xml', contentTypesXml()],
    ['_rels/.rels', packageRelsXml()],
    ['docProps/core.xml', corePropsXml(opts.title, createdAt)],
    ['docProps/app.xml', appPropsXml()],
    ['ppt/presentation.xml', presentationXml()],
    ['ppt/_rels/presentation.xml.rels', presentationRelsXml()],
    ['ppt/slideMasters/slideMaster1.xml', slideMasterXml()],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRelsXml()],
    ['ppt/slideLayouts/slideLayout1.xml', titleLayoutXml()],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', layoutRelsXml()],
    ['ppt/slideLayouts/slideLayout2.xml', bodyLayoutXml()],
    ['ppt/slideLayouts/_rels/slideLayout2.xml.rels', layoutRelsXml()],
    ['ppt/theme/theme1.xml', themeXml(opts.palette)],
    ['ppt/slides/slide1.xml', titleSlideXml(opts.title)],
    ['ppt/slides/_rels/slide1.xml.rels', slideRelsXml()],
  ])
}

/** The new package as .pptx bytes, ready for workspace:writeFile. */
export async function newDeckPptx(opts: NewDeckOptions): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, xml] of newDeckParts(opts)) {
    zip.file(path, xml, { createFolders: false })
  }
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
