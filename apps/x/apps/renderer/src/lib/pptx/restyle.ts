/**
 * Theme (palette) generation and post-creation theme swapping.
 *
 * `buildThemeXml` is the single source of a Rowboat deck's theme part — both
 * new-deck.ts (at creation) and the "change theme" flow call it, so a
 * generated deck's theme and a restyled theme are byte-for-byte the same code
 * path. Because G0 put every colour in theme1.xml, swapping that one part
 * recolours the whole deck.
 *
 * `resolveThemePath` finds exactly which theme part the slide master
 * references (via the master's rels), so the swap targets the right part even
 * for imported decks whose theme is named differently. It fails closed when
 * the reference is ambiguous, so a best-effort swap never corrupts a package.
 */

import JSZip from 'jszip'
import { attr, childByLocal, childrenByLocal, childrenOf, parseXml, relsPathFor, resolveRelTarget } from './parse'
import type { DeckPalette, DeckPaletteScheme } from './new-deck'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

// ----------------------------------------------------- VERBATIM OFFICE XML
// The palette-neutral scaffolding of the theme part, taken from a
// PowerPoint-authored package. Colours flow through the clrScheme/fontScheme
// buildThemeXml writes; these are the fmtScheme, per-script font tables and
// object-defaults tail. Do not hand-edit; regenerate from a real package.

/** a:fmtScheme — the full Office style matrix (fills, lines, effects, bg). */
const FMT_SCHEME = `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="35000"><a:schemeClr val="phClr"><a:tint val="37000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="15000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="100000"/><a:shade val="100000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="50000"/><a:shade val="100000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/><a:satMod val="105000"/></a:schemeClr></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d><a:camera prst="orthographicFront"><a:rot lat="0" lon="0" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"><a:rot lat="0" lon="0" rev="1200000"/></a:lightRig></a:scene3d><a:sp3d><a:bevelT w="63500" h="25400"/></a:sp3d></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="40000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="40000"><a:schemeClr val="phClr"><a:tint val="45000"/><a:shade val="99000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="20000"/><a:satMod val="255000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="-80000" r="50000" b="180000"/></a:path></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="80000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="30000"/><a:satMod val="200000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill></a:bgFillStyleLst></a:fmtScheme>`

/** Per-script typeface tables from the Office theme's a:majorFont. */
const MAJOR_FONT_SCRIPTS = `<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="宋体"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Times New Roman"/><a:font script="Hebr" typeface="Times New Roman"/><a:font script="Thai" typeface="Angsana New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="MoolBoran"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Times New Roman"/><a:font script="Uigh" typeface="Microsoft Uighur"/><a:font script="Geor" typeface="Sylfaen"/>`

/** Per-script typeface tables from the Office theme's a:minorFont. */
const MINOR_FONT_SCRIPTS = `<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="宋体"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Arial"/><a:font script="Hebr" typeface="Arial"/><a:font script="Thai" typeface="Cordia New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="DaunPenh"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Arial"/><a:font script="Uigh" typeface="Microsoft Uighur"/><a:font script="Geor" typeface="Sylfaen"/>`

/** a:objectDefaults + a:extraClrSchemeLst — the theme's trailing elements. */
const THEME_TAIL = `<a:objectDefaults><a:spDef><a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></a:style></a:spDef><a:lnDef><a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></a:style></a:lnDef></a:objectDefaults><a:extraClrSchemeLst/>`

// ------------------------------------------------------------- generation

export function buildThemeXml(palette: DeckPalette): string {
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

// ------------------------------------------------------------- resolution

const dirNameOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

/**
 * The package path of the theme part the (single) slide master references.
 * Fails closed — throws — unless there is exactly one slide master with
 * exactly one resolvable theme relationship, so a swap never guesses.
 */
export async function resolveThemePath(zip: JSZip): Promise<string> {
  const masters = Object.keys(zip.files).filter((p) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p))
  if (masters.length !== 1) {
    throw new Error(`replaceTheme: expected exactly one slide master, found ${masters.length}`)
  }
  const masterPath = masters[0]
  const relsPath = relsPathFor(masterPath)
  const relsFile = zip.file(relsPath)
  if (!relsFile) throw new Error(`replaceTheme: slide master has no relationships part (${relsPath})`)
  const root = childByLocal(parseXml(await relsFile.async('string')), 'Relationships')
  if (!root) throw new Error(`replaceTheme: malformed relationships in ${relsPath}`)
  const themeRels = childrenByLocal(childrenOf(root), 'Relationship').filter(
    (r) => (attr(r, 'Type') ?? '').endsWith('/theme') && attr(r, 'Target') !== undefined,
  )
  if (themeRels.length !== 1) {
    throw new Error(`replaceTheme: expected exactly one theme relationship on the master, found ${themeRels.length}`)
  }
  const themePath = resolveRelTarget(dirNameOf(masterPath), attr(themeRels[0], 'Target')!)
  if (!zip.file(themePath)) throw new Error(`replaceTheme: theme part ${themePath} is missing from the package`)
  return themePath
}
