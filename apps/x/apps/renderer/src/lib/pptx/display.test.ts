import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx, parseXml } from './parse'
import type { DrawingShape, TextShape } from './types'
import {
  DEFAULT_THEME,
  applyColorTransforms,
  clrMapOfMaster,
  parseTheme,
  resolveColorNode,
  resolveFirstColor,
  schemeColorHex,
  type Theme,
} from './theme'
import {
  autoNumText,
  bulletCharFor,
  layersOf,
  levelStyleFromPPr,
  mergeLevelStyles,
  parseListStyle,
  runLayerFromRPr,
  txStyleKindFor,
} from './textstyle'
import { fillFromNode, isLinePreset, lineFromLn, shapeVisualOf } from './geometry'

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

function firstNode(xml: string) {
  return parseXml(xml)[0]
}

const TEST_THEME_XML =
  `<a:theme ${A} name="T"><a:themeElements><a:clrScheme name="c">` +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
  '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
  '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
  '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  '</a:clrScheme><a:fontScheme name="f"><a:majorFont><a:latin typeface="X"/></a:majorFont><a:minorFont><a:latin typeface="X"/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="fmt"><a:fillStyleLst>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '</a:fillStyleLst><a:lnStyleLst>' +
  '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '</a:lnStyleLst><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>' +
  '</a:themeElements></a:theme>'

function loadTheme(clrMapAttrs?: string): Theme {
  const theme = parseTheme(parseXml(TEST_THEME_XML))
  if (clrMapAttrs) {
    const master = parseXml(
      `<p:sldMaster xmlns:p="http://p"><p:clrMap ${clrMapAttrs}/></p:sldMaster>`,
    )
    const map = clrMapOfMaster(master)
    if (map) theme.clrMap = map
  }
  return theme
}

describe('theme color resolution', () => {
  it('parses the scheme and resolves schemeClr slots', () => {
    const theme = loadTheme()
    expect(theme.scheme.accent1).toBe('4472C4')
    expect(theme.scheme.dk1).toBe('000000')
    const node = firstNode(`<a:schemeClr ${A} val="accent1"/>`)
    expect(resolveColorNode(node, theme)?.hex).toBe('4472C4')
  })

  it('routes tx1/bg1 aliases through the master clrMap', () => {
    const theme = loadTheme(
      'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" ' +
        'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"',
    )
    // A dark master swaps text/background: tx1 now maps to the LIGHT color.
    expect(schemeColorHex(theme, 'tx1')).toBe('FFFFFF')
    expect(schemeColorHex(theme, 'bg1')).toBe('000000')
    // Default map goes the usual way.
    expect(schemeColorHex(loadTheme(), 'tx1')).toBe('000000')
  })

  it('applies lumMod/lumOff (accent1, lighter 40%)', () => {
    const node = firstNode(
      `<a:schemeClr ${A} val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>`,
    )
    const out = resolveColorNode(node, loadTheme())?.hex
    // HSL round-trip of 4472C4 with l' = l*0.6 + 0.4.
    expect(out).toBe('8FAADC')
  })

  it('applies tint and shade in RGB space', () => {
    // shade 50% of white -> mid gray; tint 50% of black -> mid gray.
    expect(applyColorTransforms('FFFFFF', firstNode(`<a:srgbClr ${A} val="FFFFFF"><a:shade val="50000"/></a:srgbClr>`))).toBe('808080')
    expect(applyColorTransforms('000000', firstNode(`<a:srgbClr ${A} val="000000"><a:tint val="50000"/></a:srgbClr>`))).toBe('808080')
  })

  it('reads alpha and phClr substitution', () => {
    const node = firstNode(`<a:schemeClr ${A} val="phClr"><a:alpha val="50000"/></a:schemeClr>`)
    const out = resolveColorNode(node, loadTheme(), 'ED7D31')
    expect(out).toEqual({ hex: 'ED7D31', alpha: 0.5 })
  })
})

describe('run property cascade', () => {
  const theme = DEFAULT_THEME

  it('parses defRPr layers out of list styles', () => {
    const lst = firstNode(
      `<a:lstStyle ${A}>` +
        '<a:lvl1pPr marL="342900" indent="-342900" algn="ctr"><a:buChar char="•"/><a:defRPr sz="2400" b="1"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:defRPr></a:lvl1pPr>' +
        '<a:lvl2pPr><a:defRPr sz="2000"/></a:lvl2pPr>' +
        '</a:lstStyle>',
    )
    const parsed = parseListStyle(lst, theme)
    expect(parsed.levels[0]).toMatchObject({
      marLEmu: 342900,
      indentEmu: -342900,
      align: 'ctr',
      sizePt: 24,
      bold: true,
      colorHex: '112233',
      bullet: { kind: 'char', char: '•' },
    })
    expect(parsed.levels[1]).toMatchObject({ sizePt: 20 })
    expect(parsed.levels[2]).toBeUndefined()
  })

  it('merges layers nearest-first: rPr wins over shape over master', () => {
    const shape = parseListStyle(
      firstNode(`<a:lstStyle ${A}><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></a:lstStyle>`),
      theme,
    )
    const master = parseListStyle(
      firstNode(
        `<a:lstStyle ${A}><a:lvl1pPr marL="457200"><a:defRPr sz="1800" i="1"/></a:lvl1pPr></a:lstStyle>`,
      ),
      theme,
    )
    const merged = mergeLevelStyles([...layersOf(shape, 0), ...layersOf(master, 0)])
    expect(merged.sizePt).toBe(28) // nearest layer wins
    expect(merged.italic).toBe(true) // inherited from the farther layer
    expect(merged.marLEmu).toBe(457200)

    // An explicit rPr overrides everything, including b="0" clearing bold.
    const rPr = runLayerFromRPr(firstNode(`<a:rPr ${A} b="0" sz="1400"/>`), theme)
    expect(rPr).toMatchObject({ bold: false, sizePt: 14 })
  })

  it('reads paragraph-level overrides including buNone and buAutoNum', () => {
    const pPr = firstNode(
      `<a:pPr ${A} lvl="1" marL="742950" indent="-285750"><a:buAutoNum type="arabicPeriod" startAt="3"/></a:pPr>`,
    )
    const style = levelStyleFromPPr(pPr, theme)
    expect(style.bullet).toEqual({ kind: 'auto', scheme: 'arabicPeriod', startAt: 3 })
    expect(style.marLEmu).toBe(742950)

    const none = levelStyleFromPPr(firstNode(`<a:pPr ${A}><a:buNone/></a:pPr>`), theme)
    expect(none.bullet).toEqual({ kind: 'none' })
  })

  it('routes placeholder types to the right master txStyles table', () => {
    expect(txStyleKindFor('ctrTitle', true)).toBe('title')
    expect(txStyleKindFor('body', true)).toBe('body')
    expect(txStyleKindFor(undefined, true)).toBe('body')
    expect(txStyleKindFor('ftr', true)).toBe('other')
    expect(txStyleKindFor(undefined, false)).toBe('other')
  })
})

describe('bullets', () => {
  it('maps Wingdings glyphs (including the F0xx private-use forms)', () => {
    expect(bulletCharFor('Wingdings', 'l')).toBe('●')
    expect(bulletCharFor('Wingdings', 'n')).toBe('■')
    expect(bulletCharFor('Wingdings', '')).toBe('▪')
    expect(bulletCharFor('Wingdings', 'Ø')).toBe('➢')
    expect(bulletCharFor('Wingdings', 'ü')).toBe('✓')
    expect(bulletCharFor('Wingdings', '~')).toBe('•') // unknown -> generic
    expect(bulletCharFor('Symbol', '')).toBe('•')
    expect(bulletCharFor('Arial', '•')).toBe('•') // text fonts pass through
    expect(bulletCharFor('Arial', '-')).toBe('-')
  })

  it('formats autonumber schemes', () => {
    expect(autoNumText('arabicPeriod', 3)).toBe('3.')
    expect(autoNumText('arabicParenR', 2)).toBe('2)')
    expect(autoNumText('romanLcPeriod', 4)).toBe('iv.')
    expect(autoNumText('romanUcPeriod', 9)).toBe('IX.')
    expect(autoNumText('alphaLcParenR', 2)).toBe('b)')
    expect(autoNumText('alphaUcPeriod', 27)).toBe('AA.')
    expect(autoNumText('someUnknownScheme', 5)).toBe('5.')
  })
})

describe('shape visuals', () => {
  const theme = loadTheme()

  it('resolves explicit solid fills, gradients and lines', () => {
    const solid = fillFromNode(
      firstNode(`<a:solidFill ${A}><a:schemeClr val="accent2"/></a:solidFill>`),
      theme,
    )
    expect(solid).toEqual({ kind: 'solid', hex: 'ED7D31' })

    const grad = fillFromNode(
      firstNode(
        `<a:gradFill ${A}><a:gsLst>` +
          '<a:gs pos="100000"><a:srgbClr val="000000"/></a:gs>' +
          '<a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>' +
          '</a:gsLst><a:lin ang="5400000"/></a:gradFill>',
      ),
      theme,
    )
    expect(grad).toMatchObject({
      kind: 'gradient',
      angleDeg: 90,
      stops: [
        { pos: 0, hex: 'FFFFFF' },
        { pos: 1, hex: '000000' },
      ],
    })

    const line = lineFromLn(
      firstNode(
        `<a:ln ${A} w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="sysDash"/></a:ln>`,
      ),
      theme,
    )
    expect(line).toEqual({ hex: 'FF0000', widthEmu: 25400, dash: 'dash', alpha: undefined })
    expect(
      lineFromLn(firstNode(`<a:ln ${A}><a:noFill/></a:ln>`), theme),
    ).toBeNull()
  })

  it('resolves style fillRef/lnRef through the theme format scheme', () => {
    const sp = firstNode(
      `<p:sp xmlns:p="http://p" ${A}>` +
        '<p:spPr><a:xfrm rot="2700000" flipH="1"><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm>' +
        '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom></p:spPr>' +
        '<p:style><a:lnRef idx="2"><a:schemeClr val="accent6"/></a:lnRef>' +
        '<a:fillRef idx="1"><a:schemeClr val="accent3"/></a:fillRef>' +
        '<a:effectRef idx="0"><a:schemeClr val="accent3"/></a:effectRef>' +
        '<a:fontRef idx="minor"/></p:style></p:sp>',
    )
    const visual = shapeVisualOf(sp, theme)
    // fillRef idx 1 -> first fmtScheme fill (solid phClr) with accent3 substituted.
    expect(visual.fill).toEqual({ kind: 'solid', hex: 'A5A5A5', alpha: undefined })
    // lnRef idx 2 -> second fmtScheme line (w=12700) with accent6 substituted.
    expect(visual.line).toEqual({ hex: '70AD47', widthEmu: 12700, dash: 'solid', alpha: undefined })
    expect(visual.geom).toEqual({ preset: 'roundRect', adj: { adj: 25000 } })
    expect(visual.rotDeg).toBe(45)
    expect(visual.flipH).toBe(true)
    expect(visual.flipV).toBeUndefined()
  })

  it('lets explicit spPr fills win over the style reference', () => {
    const sp = firstNode(
      `<p:sp xmlns:p="http://p" ${A}><p:spPr><a:noFill/></p:spPr>` +
        '<p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>',
    )
    expect(shapeVisualOf(sp, theme).fill).toEqual({ kind: 'none' })
  })

  it('classifies line presets', () => {
    expect(isLinePreset('line')).toBe(true)
    expect(isLinePreset('straightConnector1')).toBe(true)
    expect(isLinePreset('bentConnector3')).toBe(true)
    expect(isLinePreset('roundRect')).toBe(false)
  })
})

describe('theme defaults without a theme part', () => {
  it('resolveFirstColor falls back to the stock Office scheme', () => {
    const fill = firstNode(`<a:solidFill ${A}><a:schemeClr val="accent1"/></a:solidFill>`)
    expect(resolveFirstColor(fill, DEFAULT_THEME)?.hex).toBe('4472C4')
  })
})

// -------------------------------------------------------- deck integration

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const DECK_SLIDE =
  `<p:sld ${P} ${A}><p:cSld><p:spTree>` +
  // Body placeholder: no own size/color anywhere on the slide -> inherits.
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:nvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
  '<p:spPr/><p:txBody><a:bodyPr/>' +
  '<a:p><a:r><a:t>inherited</a:t></a:r></a:p>' +
  '<a:p><a:pPr lvl="1"/><a:r><a:rPr sz="1200"/><a:t>explicit</a:t></a:r></a:p>' +
  '<a:p><a:r><a:rPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr></a:solidFill></a:rPr><a:t>tinted</a:t></a:r></a:p>' +
  '</p:txBody></p:sp>' +
  // A themed rectangle with no txBody.
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Box"/></p:nvSpPr>` +
  '<p:spPr><a:xfrm rot="5400000"><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm>' +
  '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></p:spPr>' +
  '<p:style><a:lnRef idx="1"><a:schemeClr val="accent2"/></a:lnRef>' +
  '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>' +
  '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"/></p:style></p:sp>' +
  '</p:spTree></p:cSld></p:sld>'

const DECK_LAYOUT =
  `<p:sldLayout ${P} ${A}><p:cSld><p:spTree>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="9" name="ph"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
  '<p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr b="1"/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>' +
  '</p:spTree></p:cSld></p:sldLayout>'

const DECK_MASTER =
  `<p:sldMaster ${P} ${A}>` +
  '<p:cSld><p:spTree/></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:txStyles><p:titleStyle/><p:bodyStyle>' +
  '<a:lvl1pPr marL="342900" indent="-342900"><a:buFont typeface="Wingdings"/><a:buChar char="l"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr>' +
  '<a:lvl2pPr marL="742950" indent="-285750"><a:buAutoNum type="arabicPeriod"/><a:defRPr sz="2000"/></a:lvl2pPr>' +
  '</p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>'

async function buildDisplayFixture(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>` +
      '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships ${REL_NS}><Relationship Id="rId2" Type="${REL_TYPE}/slide" Target="slides/slide1.xml"/></Relationships>`,
  )
  zip.file('ppt/slides/slide1.xml', DECK_SLIDE)
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  )
  zip.file('ppt/slideLayouts/slideLayout1.xml', DECK_LAYOUT)
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL_TYPE}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  )
  zip.file('ppt/slideMasters/slideMaster1.xml', DECK_MASTER)
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL_TYPE}/theme" Target="../theme/theme1.xml"/></Relationships>`,
  )
  zip.file('ppt/theme/theme1.xml', TEST_THEME_XML)
  return zip.generateAsync({ type: 'uint8array' })
}

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
beforeAll(() => {
  URL.createObjectURL = (() => 'blob:mock/0') as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
})
afterAll(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

describe('deck-level display resolution', () => {
  it('cascades run properties and bullets from master through layout to the slide', async () => {
    const deck = await parsePptx(await buildDisplayFixture())
    const body = deck.slides[0].shapes[0] as TextShape

    // The MODEL stays raw — this is what the serializer validates against.
    expect(body.paragraphs[0].runs[0]).toEqual({ text: 'inherited' })

    const display = body.display
    expect(display).toBeDefined()
    const p0 = display!.paragraphs[0]
    // Size from master bodyStyle lvl1, bold from the layout override,
    // color from tx2 -> dk2 -> theme.
    expect(p0.runs[0]).toEqual({
      sizePt: 24,
      bold: true,
      italic: false,
      underline: false,
      colorHex: '44546A',
    })
    // Wingdings 'l' from the master maps to a round bullet, with hanging indent.
    expect(p0.bullet).toEqual({ kind: 'char', char: '●' })
    expect(p0.marLEmu).toBe(342900)
    expect(p0.indentEmu).toBe(-342900)

    // Level 2: explicit sz wins over the lvl2 default; autonum from master.
    const p1 = display!.paragraphs[1]
    expect(p1.level).toBe(1)
    expect(p1.runs[0].sizePt).toBe(12)
    expect(p1.defaultRun.sizePt).toBe(20)
    expect(p1.bullet).toEqual({ kind: 'auto', scheme: 'arabicPeriod', startAt: 1 })

    // Theme transform on an explicit run color.
    expect(display!.paragraphs[2].runs[0].colorHex).toBe('8FAADC')

    // Inherited placeholder geometry still works (from the layout).
    expect(body.xfrmEmu).toEqual({ x: 10, y: 20, w: 30, h: 40 })
  })

  it('renders plain sp without txBody as a drawing with themed fill/line/rotation', async () => {
    const deck = await parsePptx(await buildDisplayFixture())
    const box = deck.slides[0].shapes[1] as DrawingShape
    expect(box.type).toBe('drawing')
    expect(box.visual?.fill).toEqual({ kind: 'solid', hex: '4472C4', alpha: undefined })
    expect(box.visual?.line).toMatchObject({ hex: 'ED7D31', widthEmu: 6350 })
    expect(box.visual?.geom?.preset).toBe('roundRect')
    expect(box.visual?.rotDeg).toBe(90)
  })
})
