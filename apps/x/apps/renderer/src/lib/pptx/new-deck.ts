/**
 * Synthesizes a complete, valid .pptx package from strings — the
 * whole-package counterpart to add-slide.ts's single-part synthesis. The
 * result is a 16:9 deck with one slide master, two layouts (Title Slide,
 * Title and Body), a theme built from a caller-chosen palette, docProps, and
 * one title slide on the Title Slide layout.
 *
 * The package is deliberately shaped like what PowerPoint itself emits, not
 * the schema-minimal subset: desktop PowerPoint silently renders slides
 * BLANK (no repair prompt on Mac) when the supporting parts are too bare,
 * even though the XML validates against the ECMA-376 schemas and every
 * other renderer (this editor, macOS QuickLook, LibreOffice) shows the
 * text. So the scaffolding here — the full Office format scheme and font
 * script tables in the theme, presProps/viewProps/tableStyles parts, the
 * presentation-level default text style, complete 9-level master txStyles,
 * and Office-style placeholder bodies — is copied verbatim from a genuine
 * PowerPoint-authored package (the `VERBATIM OFFICE XML` section below),
 * with only colors, fonts, geometry and text parameterized.
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

/**
 * The prompt paragraph PowerPoint puts in master/layout placeholder slots
 * ("Click to edit…"). Slot text is a template, never slide content: the
 * parser skips it and planNewSlide instantiates empty shapes over it.
 */
function promptPara(text: string): string {
  return (
    `<a:p><a:r><a:rPr lang="en-US" smtClean="0"/><a:t>${text}</a:t></a:r>` +
    '<a:endParaRPr lang="en-US"/></a:p>'
  )
}

/** Office's placeholder bodyPr: explicit insets, optional middle anchoring. */
function officeBodyPr(anchor?: 'ctr'): string {
  return (
    '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"' +
    (anchor ? ` anchor="${anchor}"` : '') +
    '><a:normAutofit/></a:bodyPr>'
  )
}

/** One placeholder p:sp; layout/master slots carry geometry, slides don't. */
function placeholderSp(opts: {
  id: number
  name: string
  phAttrs: string
  rect?: { x: number; y: number; w: number; h: number }
  /** Emit Office's explicit `<a:prstGeom prst="rect">` (master slots). */
  prstGeom?: boolean
  bodyPr?: string
  lstStyle?: string
  paragraph?: string
}): string {
  const spPrBody =
    (opts.rect ? xfrm(opts.rect) : '') +
    (opts.prstGeom ? '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' : '')
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${opts.id}" name="${opts.name}"/>` +
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    `<p:nvPr><p:ph ${opts.phAttrs}/></p:nvPr></p:nvSpPr>` +
    (spPrBody ? `<p:spPr>${spPrBody}</p:spPr>` : '<p:spPr/>') +
    `<p:txBody>${opts.bodyPr ?? '<a:bodyPr/>'}${opts.lstStyle ?? '<a:lstStyle/>'}` +
    `${opts.paragraph ?? '<a:p><a:endParaRPr/></a:p>'}</p:txBody></p:sp>`
  )
}

const ct = (part: string, type: string): string =>
  `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-${type}"/>`

/** Content-type Overrides for the three Office support parts. */
const SUPPORT_PART_OVERRIDES =
  ct('ppt/presProps.xml', 'officedocument.presentationml.presProps+xml') +
  ct('ppt/viewProps.xml', 'officedocument.presentationml.viewProps+xml') +
  ct('ppt/tableStyles.xml', 'officedocument.presentationml.tableStyles+xml')

function contentTypesXml(): string {
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
    SUPPORT_PART_OVERRIDES +
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
    DEFAULT_TEXT_STYLE +
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
    `<Relationship Id="rId4" Type="${REL_TYPE}/presProps" Target="presProps.xml"/>` +
    `<Relationship Id="rId5" Type="${REL_TYPE}/viewProps" Target="viewProps.xml"/>` +
    `<Relationship Id="rId6" Type="${REL_TYPE}/tableStyles" Target="tableStyles.xml"/>` +
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
    prstGeom: true,
    bodyPr: officeBodyPr('ctr'),
    paragraph: promptPara('Click to edit Master title style'),
  })
  const bodySp = placeholderSp({
    id: 3,
    name: 'Body Placeholder 2',
    phAttrs: 'type="body" idx="1"',
    rect: BODY_LAYOUT_RECTS.body,
    prstGeom: true,
    bodyPr: officeBodyPr(),
    paragraph: promptPara('Click to edit Master text styles'),
  })
  return (
    XML_HEAD +
    `<p:sldMaster ${NS}><p:cSld>` +
    '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
    `<p:spTree>${SP_TREE_HEAD}${titleSp}${bodySp}${MASTER_CHROME}</p:spTree></p:cSld>` +
    `<p:clrMap ${CLR_MAP_ATTRS}/>` +
    '<p:sldLayoutIdLst>' +
    '<p:sldLayoutId id="2147483649" r:id="rId1"/>' +
    '<p:sldLayoutId id="2147483650" r:id="rId2"/>' +
    '</p:sldLayoutIdLst>' +
    TX_STYLES +
    '</p:sldMaster>'
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
    paragraph: promptPara('Click to edit Master title style'),
  })
  const subtitle = placeholderSp({
    id: 3,
    name: 'Subtitle 2',
    phAttrs: 'type="subTitle" idx="1"',
    rect: TITLE_LAYOUT_RECTS.subTitle,
    lstStyle: SUBTITLE_LSTSTYLE,
    paragraph: promptPara('Click to edit Master subtitle style'),
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
    paragraph: promptPara('Click to edit Master title style'),
  })
  const body = placeholderSp({
    id: 3,
    name: 'Body 2',
    phAttrs: 'type="body" idx="1"',
    rect: BODY_LAYOUT_RECTS.body,
    bodyPr: '<a:bodyPr><a:normAutofit/></a:bodyPr>',
    paragraph: promptPara('Click to edit Master text styles'),
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
  const font = (typeface: string, scripts: string): string =>
    `<a:latin typeface="${typeface}"/><a:ea typeface=""/><a:cs typeface=""/>${scripts}`
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
    `<a:majorFont>${font(palette.majorFont, MAJOR_FONT_SCRIPTS)}</a:majorFont>` +
    `<a:minorFont>${font(palette.minorFont, MINOR_FONT_SCRIPTS)}</a:minorFont>` +
    '</a:fontScheme>' +
    FMT_SCHEME +
    '</a:themeElements>' +
    THEME_TAIL +
    '</a:theme>'
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

function presPropsXml(): string {
  return XML_HEAD + `<p:presentationPr ${NS}/>`
}

function viewPropsXml(): string {
  return (
    XML_HEAD +
    `<p:viewPr ${NS}>` +
    '<p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>' +
    '<p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1">' +
    '<p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/>' +
    '</p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr>' +
    '<p:gridSpacing cx="76200" cy="76200"/></p:viewPr>'
  )
}

function tableStylesXml(): string {
  return (
    XML_HEAD +
    `<a:tblStyleLst ${A_NS} def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`
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
    ['ppt/presProps.xml', presPropsXml()],
    ['ppt/viewProps.xml', viewPropsXml()],
    ['ppt/tableStyles.xml', tableStylesXml()],
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

// ------------------------------------------------------------------ upgrade

/** Reads the palette back out of a generated theme part; null if not ours. */
function paletteOfThemeXml(theme: string): DeckPalette | null {
  const slot = (name: string): string | undefined =>
    theme.match(new RegExp(`<a:${name}><a:srgbClr val="([0-9A-Fa-f]{6})"/></a:${name}>`))?.[1]
  const slots: Partial<DeckPaletteScheme> = {}
  for (const name of [
    'dk1', 'lt1', 'dk2', 'lt2',
    'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
    'hlink', 'folHlink',
  ] as const) {
    const hex = slot(name)
    if (!hex) return null
    slots[name] = hex.toUpperCase()
  }
  const name = theme.match(/<a:clrScheme name="([^"]*)">/)?.[1]
  const majorFont = theme.match(/<a:majorFont><a:latin typeface="([^"]*)"\/>/)?.[1]
  const minorFont = theme.match(/<a:minorFont><a:latin typeface="([^"]*)"\/>/)?.[1]
  if (!name || !majorFont || !minorFont) return null
  return { id: 'upgraded', name, scheme: slots as DeckPaletteScheme, majorFont, minorFont }
}

/**
 * Upgrades a deck created by the first version of this generator to the
 * PowerPoint-shaped package newDeckParts() now emits.
 *
 * The v1 packages were schema-minimal, and desktop PowerPoint silently
 * renders their slides blank (see the module doc). Because writeDeck copies
 * unedited parts byte-for-byte, every edit/save keeps that v1 scaffolding —
 * so the editor runs this on open and persists the result.
 *
 * Only the support parts are touched: theme, master and layouts are replaced
 * (the editor never edits them, so nothing is lost) and the missing Office
 * parts are added. Slides, their rels and docProps are untouched, so all
 * typed content survives. Returns null when the package is not a v1
 * Rowboat-generated deck — including anything this function already
 * upgraded — or when any splice anchor is missing (fail closed, never
 * corrupt).
 */
export async function upgradeGeneratedDeck(bytes: Uint8Array): Promise<Uint8Array | null> {
  const zip = await JSZip.loadAsync(bytes)
  const themeFile = zip.file('ppt/theme/theme1.xml')
  if (!themeFile) return null
  const theme = await themeFile.async('string')
  // v1 fingerprint: our theme marker without the Office scaffolding v2 ships.
  const isV1 =
    theme.includes('name="Rowboat ') &&
    !theme.includes('<a:objectDefaults>') &&
    zip.file('ppt/presProps.xml') === null
  if (!isV1) return null
  const palette = paletteOfThemeXml(theme)
  if (!palette) return null

  const presFile = zip.file('ppt/presentation.xml')
  const presRelsFile = zip.file('ppt/_rels/presentation.xml.rels')
  const ctFile = zip.file('[Content_Types].xml')
  const masterFile = zip.file('ppt/slideMasters/slideMaster1.xml')
  const layout1File = zip.file('ppt/slideLayouts/slideLayout1.xml')
  const layout2File = zip.file('ppt/slideLayouts/slideLayout2.xml')
  if (!presFile || !presRelsFile || !ctFile || !masterFile || !layout1File || !layout2File) {
    return null
  }
  const pres = await presFile.async('string')
  const presRels = await presRelsFile.async('string')
  const contentTypes = await ctFile.async('string')
  if (
    !pres.endsWith('</p:presentation>') ||
    pres.includes('<p:defaultTextStyle>') ||
    !presRels.endsWith('</Relationships>') ||
    !contentTypes.endsWith('</Types>')
  ) {
    return null
  }

  let maxRel = 0
  for (const m of presRels.matchAll(/Id="rId(\d+)"/g)) {
    maxRel = Math.max(maxRel, Number(m[1]))
  }
  const supportRels =
    `<Relationship Id="rId${maxRel + 1}" Type="${REL_TYPE}/presProps" Target="presProps.xml"/>` +
    `<Relationship Id="rId${maxRel + 2}" Type="${REL_TYPE}/viewProps" Target="viewProps.xml"/>` +
    `<Relationship Id="rId${maxRel + 3}" Type="${REL_TYPE}/tableStyles" Target="tableStyles.xml"/>`

  zip.file('ppt/theme/theme1.xml', themeXml(palette), { createFolders: false })
  zip.file('ppt/slideMasters/slideMaster1.xml', slideMasterXml(), { createFolders: false })
  zip.file('ppt/slideLayouts/slideLayout1.xml', titleLayoutXml(), { createFolders: false })
  zip.file('ppt/slideLayouts/slideLayout2.xml', bodyLayoutXml(), { createFolders: false })
  zip.file('ppt/presProps.xml', presPropsXml(), { createFolders: false })
  zip.file('ppt/viewProps.xml', viewPropsXml(), { createFolders: false })
  zip.file('ppt/tableStyles.xml', tableStylesXml(), { createFolders: false })
  zip.file(
    '[Content_Types].xml',
    contentTypes.replace('</Types>', `${SUPPORT_PART_OVERRIDES}</Types>`),
    { createFolders: false },
  )
  zip.file(
    'ppt/presentation.xml',
    pres.replace('</p:presentation>', `${DEFAULT_TEXT_STYLE}</p:presentation>`),
    { createFolders: false },
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    presRels.replace('</Relationships>', `${supportRels}</Relationships>`),
    { createFolders: false },
  )
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

// ----------------------------------------------------- VERBATIM OFFICE XML
// Extracted from a PowerPoint-authored package (python-pptx's default
// template, saved by desktop PowerPoint). Palette-neutral: colors go through
// scheme slots and fonts through +mj-lt/+mn-lt, so parameterization stays in
// themeXml()'s clrScheme/fontScheme. Do not hand-edit; regenerate from a real
// package if these ever need to change.

/** a:fmtScheme — the full Office style matrix (fills, lines, effects, bg). */
const FMT_SCHEME = `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="35000"><a:schemeClr val="phClr"><a:tint val="37000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="15000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="100000"/><a:shade val="100000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="50000"/><a:shade val="100000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/><a:satMod val="105000"/></a:schemeClr></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d><a:camera prst="orthographicFront"><a:rot lat="0" lon="0" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"><a:rot lat="0" lon="0" rev="1200000"/></a:lightRig></a:scene3d><a:sp3d><a:bevelT w="63500" h="25400"/></a:sp3d></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="40000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="40000"><a:schemeClr val="phClr"><a:tint val="45000"/><a:shade val="99000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="20000"/><a:satMod val="255000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="-80000" r="50000" b="180000"/></a:path></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="80000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="30000"/><a:satMod val="200000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill></a:bgFillStyleLst></a:fmtScheme>`

/** Per-script typeface tables from the Office theme's a:majorFont. */
const MAJOR_FONT_SCRIPTS = `<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="宋体"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Times New Roman"/><a:font script="Hebr" typeface="Times New Roman"/><a:font script="Thai" typeface="Angsana New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="MoolBoran"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Times New Roman"/><a:font script="Uigh" typeface="Microsoft Uighur"/><a:font script="Geor" typeface="Sylfaen"/>`

/** Per-script typeface tables from the Office theme's a:minorFont. */
const MINOR_FONT_SCRIPTS = `<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="宋体"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Arial"/><a:font script="Hebr" typeface="Arial"/><a:font script="Thai" typeface="Cordia New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="DaunPenh"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Arial"/><a:font script="Uigh" typeface="Microsoft Uighur"/><a:font script="Geor" typeface="Sylfaen"/>`

/** a:objectDefaults + a:extraClrSchemeLst — the theme's trailing elements. */
const THEME_TAIL = `<a:objectDefaults><a:spDef><a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></a:style></a:spDef><a:lnDef><a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></a:style></a:lnDef></a:objectDefaults><a:extraClrSchemeLst/>`

/** p:defaultTextStyle for presentation.xml — the 9-level Office ladder. */
const DEFAULT_TEXT_STYLE = `<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="457200" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl2pPr><a:lvl3pPr marL="914400" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl3pPr><a:lvl4pPr marL="1371600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl4pPr><a:lvl5pPr marL="1828800" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl5pPr><a:lvl6pPr marL="2286000" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl6pPr><a:lvl7pPr marL="2743200" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl7pPr><a:lvl8pPr marL="3200400" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl8pPr><a:lvl9pPr marL="3657600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl9pPr></p:defaultTextStyle>`

/** p:txStyles for the master — full Office title/body/other ladders. */
const TX_STYLES = `<p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="3200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="742950" indent="-285750" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="–"/><a:defRPr sz="2800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl2pPr><a:lvl3pPr marL="1143000" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl3pPr><a:lvl4pPr marL="1600200" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="–"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl4pPr><a:lvl5pPr marL="2057400" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="»"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl5pPr><a:lvl6pPr marL="2514600" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl6pPr><a:lvl7pPr marL="2971800" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl7pPr><a:lvl8pPr marL="3429000" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl8pPr><a:lvl9pPr marL="3886200" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl9pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="457200" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl2pPr><a:lvl3pPr marL="914400" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl3pPr><a:lvl4pPr marL="1371600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl4pPr><a:lvl5pPr marL="1828800" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl5pPr><a:lvl6pPr marL="2286000" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl6pPr><a:lvl7pPr marL="2743200" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl7pPr><a:lvl8pPr marL="3200400" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl8pPr><a:lvl9pPr marL="3657600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl9pPr></p:otherStyle></p:txStyles>`

/** The Title Slide layout's subtitle lstStyle (kills bodyStyle bullets). */
const SUBTITLE_LSTSTYLE = `<a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="457200" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl2pPr><a:lvl3pPr marL="914400" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl3pPr><a:lvl4pPr marL="1371600" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl4pPr><a:lvl5pPr marL="1828800" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl5pPr><a:lvl6pPr marL="2286000" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl6pPr><a:lvl7pPr marL="2743200" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl7pPr><a:lvl8pPr marL="3200400" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl8pPr><a:lvl9pPr marL="3657600" indent="0" algn="ctr"><a:buNone/><a:defRPr><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl9pPr></a:lstStyle>`

/** Date / footer / slide-number master placeholders, rescaled to 16:9. */
const MASTER_CHROME = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Date Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="dt" sz="half" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="6356350"/><a:ext cx="2844800" cy="365125"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{5BCAD085-E8A6-8845-BD4E-CB4CCA059FC4}" type="datetimeFigureOut"><a:rPr lang="en-US" smtClean="0"/><a:t>1/27/13</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="5" name="Footer Placeholder 4"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ftr" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="4165600" y="6356350"/><a:ext cx="3860800" cy="365125"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="6" name="Slide Number Placeholder 5"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="4"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="8737600" y="6356350"/><a:ext cx="2844800" cy="365125"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{C1FF6DA9-008F-8B48-92A6-B652298478BF}" type="slidenum"><a:rPr lang="en-US" smtClean="0"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`
