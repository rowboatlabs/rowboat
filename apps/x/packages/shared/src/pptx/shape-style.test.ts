import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx } from './parse.js'
import { updateSlideXml, writeDeck, type SetShapeStyleEdit } from './serialize.js'
import type { DrawingShape, Shape, TextShape } from './types.js'

const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm>'
const GEOM = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'

/** 0: solid fill + an a:ln carrying a width and a dash to preserve. */
const SP_SOLID =
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Solid"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
  `<p:spPr>${XFRM}${GEOM}<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>` +
  '<a:ln w="12700" cap="rnd"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>' +
  '<a:prstDash val="dash"/></a:ln>' +
  '<a:effectLst/></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:p><a:r><a:t>hello</a:t></a:r></a:p></p:txBody></p:sp>'

/** 1: a gradient fill, which must be replaced across its WHOLE range. */
const SP_GRAD =
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Grad"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
  `<p:spPr>${XFRM}${GEOM}<a:gradFill rotWithShape="1"><a:gsLst>` +
  '<a:gs pos="0"><a:srgbClr val="111111"/></a:gs>' +
  '<a:gs pos="100000"><a:srgbClr val="222222"/></a:gs>' +
  '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:p><a:r><a:t>grad</a:t></a:r></a:p></p:txBody></p:sp>'

/** 2: no fill and no a:ln at all — both get synthesized. */
const SP_BARE =
  '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Bare"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
  `<p:spPr>${XFRM}${GEOM}</p:spPr>` +
  '<p:txBody><a:bodyPr/><a:p><a:r><a:t>bare</a:t></a:r></a:p></p:txBody></p:sp>'

/** 3: a connector — outline only, never a fill. */
const CXN =
  '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Conn"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>' +
  `<p:spPr>${XFRM}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
  '<a:ln w="19050"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></p:spPr>' +
  '</p:cxnSp>'

/** 4: an image, which must be rejected. */
const PIC =
  '<p:pic><p:nvPicPr><p:cNvPr id="6" name="Pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
  '<p:blipFill><a:blip/></p:blipFill>' +
  `<p:spPr>${XFRM}${GEOM}</p:spPr></p:pic>`

const SLIDE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<p:sld ${NS_P} ${NS_A}><p:cSld><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr/>' +
  SP_SOLID +
  SP_GRAD +
  SP_BARE +
  CXN +
  PIC +
  '</p:spTree></p:cSld></p:sld>'

const PRESENTATION_XML =
  `<p:presentation ${NS_P} xmlns:r="${REL_TYPE}">` +
  '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
  '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'
const PRESENTATION_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId2" Type="${REL_TYPE}/slide" Target="slides/slide1.xml"/></Relationships>`

async function buildZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', PRESENTATION_XML)
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
  zip.file('ppt/slides/slide1.xml', SLIDE_XML)
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

async function loadShapes(): Promise<Shape[]> {
  return (await parsePptx(await buildZip())).slides[0].shapes
}

function styleEdit(shape: Shape, set: { fillHex?: string; lineHex?: string }): SetShapeStyleEdit {
  return {
    kind: 'setShapeStyle',
    nodePath: shape.nodePath,
    shapeType: shape.type,
    shapeId: shape.id,
    original: shape.style!,
    ...set,
  }
}

describe('shape style snapshot', () => {
  it('is byte-anchored: the shape own spPr fill/line, unresolved', async () => {
    const [solid, grad, bare, cxn, pic] = await loadShapes()
    expect(solid.style).toEqual({
      fill: 'solidFill',
      fillHex: 'FF0000',
      hasLine: true,
      lineFill: 'solidFill',
      lineHex: '00FF00',
      lineW: '12700',
    })
    expect(grad.style).toEqual({ fill: 'gradFill', hasLine: false, lineFill: null })
    expect(bare.style).toEqual({ fill: null, hasLine: false, lineFill: null })
    expect(cxn.style?.lineHex).toBe('0000FF')
    // Only restylable kinds carry one.
    expect(pic.style).toBeUndefined()
  })
})

describe('setShapeStyle fill', () => {
  it('replaces a solid fill and leaves every other byte of the slide alone', async () => {
    const [solid] = await loadShapes()
    const out = updateSlideXml(SLIDE_XML, [styleEdit(solid, { fillHex: '336699' })])
    expect(out).toBe(
      SLIDE_XML.replace(
        '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
        '<a:solidFill><a:srgbClr val="336699"/></a:solidFill>',
      ),
    )
    // The outline, its width, its dash and the effect list are untouched.
    expect(out).toContain('<a:ln w="12700" cap="rnd">')
    expect(out).toContain('<a:prstDash val="dash"/>')
    expect(out).toContain('<a:effectLst/>')
  })

  it('replaces a gradient across its ENTIRE range, orphaning no stops', async () => {
    const [, grad] = await loadShapes()
    const out = updateSlideXml(SLIDE_XML, [styleEdit(grad, { fillHex: 'ABCDEF' })])
    expect(out).toContain('<a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill>')
    // Nothing of the gradient survives.
    expect(out).not.toContain('gradFill')
    expect(out).not.toContain('a:gsLst')
    expect(out).not.toContain('val="111111"')
    expect(out).not.toContain('<a:lin ang="5400000"')
    // And the other shapes are untouched.
    expect(out).toContain(SP_SOLID)
    expect(out).toContain(SP_BARE)
  })

  it('inserts a fill at the schema position when the shape has none', async () => {
    const [, , bare] = await loadShapes()
    const out = updateSlideXml(SLIDE_XML, [styleEdit(bare, { fillHex: '010203' })])
    // After prstGeom, at the end of spPr (there is no a:ln to precede).
    expect(out).toBe(
      SLIDE_XML.replace(
        `<p:spPr>${XFRM}${GEOM}</p:spPr>`,
        `<p:spPr>${XFRM}${GEOM}<a:solidFill><a:srgbClr val="010203"/></a:solidFill></p:spPr>`,
      ),
    )
  })

  it('puts a synthesized fill BEFORE an existing a:ln', async () => {
    // Strip the solid shape's fill, keeping its a:ln, so the insert has to
    // choose a position rather than replace.
    const xml = SLIDE_XML.replace('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>', '')
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    zip.file('ppt/slides/slide1.xml', xml)
    const shape = (await parsePptx(await zip.generateAsync({ type: 'uint8array' }))).slides[0]
      .shapes[0]
    const out = updateSlideXml(xml, [styleEdit(shape, { fillHex: '445566' })])
    expect(out).toContain(
      `${GEOM}<a:solidFill><a:srgbClr val="445566"/></a:solidFill><a:ln w="12700"`,
    )
  })
})

describe('setShapeStyle outline', () => {
  it('changes the line colour while preserving a:ln width, cap and dash', async () => {
    const [solid] = await loadShapes()
    const out = updateSlideXml(SLIDE_XML, [styleEdit(solid, { lineHex: '123456' })])
    expect(out).toBe(
      SLIDE_XML.replace(
        '<a:ln w="12700" cap="rnd"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>',
        '<a:ln w="12700" cap="rnd"><a:solidFill><a:srgbClr val="123456"/></a:solidFill>',
      ),
    )
    expect(out).toContain('<a:ln w="12700" cap="rnd">')
    expect(out).toContain('<a:prstDash val="dash"/>')
    // The shape fill is untouched.
    expect(out).toContain('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>')
  })

  it('creates a minimal a:ln when the shape has none', async () => {
    const [, , bare] = await loadShapes()
    const out = updateSlideXml(SLIDE_XML, [styleEdit(bare, { lineHex: '778899' })])
    expect(out).toContain(
      `${GEOM}<a:ln><a:solidFill><a:srgbClr val="778899"/></a:solidFill></a:ln></p:spPr>`,
    )
  })

  it('sets fill and outline together, fill first', async () => {
    const [, , bare] = await loadShapes()
    const out = updateSlideXml(SLIDE_XML, [styleEdit(bare, { fillHex: 'AAAAAA', lineHex: 'BBBBBB' })])
    expect(out).toContain(
      `${GEOM}<a:solidFill><a:srgbClr val="AAAAAA"/></a:solidFill>` +
        '<a:ln><a:solidFill><a:srgbClr val="BBBBBB"/></a:solidFill></a:ln></p:spPr>',
    )
  })

  it('restyles a connector outline but refuses to give it a fill', async () => {
    const [, , , cxn] = await loadShapes()
    const out = updateSlideXml(SLIDE_XML, [styleEdit(cxn, { lineHex: 'FEDCBA' })])
    expect(out).toContain('<a:ln w="19050"><a:solidFill><a:srgbClr val="FEDCBA"/></a:solidFill>')
    expect(() => updateSlideXml(SLIDE_XML, [styleEdit(cxn, { fillHex: 'FEDCBA' })])).toThrow(
      /connector .* has no fill/,
    )
  })
})

describe('setShapeStyle fails closed', () => {
  it('rejects images, and a style that no longer matches the bytes', async () => {
    const [solid, , , , pic] = await loadShapes()
    expect(() =>
      updateSlideXml(SLIDE_XML, [
        {
          kind: 'setShapeStyle',
          nodePath: pic.nodePath,
          shapeType: pic.type,
          shapeId: pic.id,
          original: { fill: null, hasLine: false, lineFill: null },
          fillHex: 'FFFFFF',
        },
      ]),
    ).toThrow(/cannot be restyled/)

    // Stale snapshot: the editor believed a different fill than the file has.
    const stale = styleEdit(solid, { fillHex: '000000' })
    stale.original = { ...stale.original, fillHex: '00FFFF' }
    expect(() => updateSlideXml(SLIDE_XML, [stale])).toThrow(/does not match the slide XML/)

    // Wrong identity at the same path.
    const misId = styleEdit(solid, { fillHex: '000000' })
    misId.shapeId = '999'
    expect(() => updateSlideXml(SLIDE_XML, [misId])).toThrow(/style target mismatch/)

    // Not a colour.
    expect(() => updateSlideXml(SLIDE_XML, [styleEdit(solid, { fillHex: 'nope' })])).toThrow(
      /must be RRGGBB/,
    )
  })
})

describe('setShapeStyle end to end', () => {
  it('re-parses to the new colours, and an empty edit set restores the bytes', async () => {
    const input = await buildZip()
    const deck = await parsePptx(input)
    const [solid] = deck.slides[0].shapes
    const out = await writeDeck(
      deck,
      new Map([['ppt/slides/slide1.xml', [styleEdit(solid, { fillHex: '336699', lineHex: '123456' })]]]),
    )
    const reshaped = (await parsePptx(out)).slides[0].shapes[0] as TextShape
    expect(reshaped.style?.fillHex).toBe('336699')
    expect(reshaped.style?.lineHex).toBe('123456')
    // The display layer picks it up for the canvas.
    expect(reshaped.visual?.fill).toEqual({ kind: 'solid', hex: '336699' })
    expect(reshaped.visual?.line?.hex).toBe('123456')
    // Width survived the colour change.
    expect(reshaped.style?.lineW).toBe('12700')

    // Undo = an empty edit set, which rewrites the original bytes.
    const restored = await writeDeck(deck, new Map())
    const a = await (await JSZip.loadAsync(input)).files['ppt/slides/slide1.xml'].async('uint8array')
    const b = await (await JSZip.loadAsync(restored)).files['ppt/slides/slide1.xml'].async('uint8array')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('leaves a drawing shape with no text on the same path', async () => {
    const shapes = await loadShapes()
    const cxn = shapes[3] as DrawingShape
    expect(cxn.type).toBe('drawing')
    const out = updateSlideXml(SLIDE_XML, [styleEdit(cxn, { lineHex: 'FEDCBA' })])
    // Every other shape byte-identical.
    expect(out).toContain(SP_SOLID)
    expect(out).toContain(SP_GRAD)
    expect(out).toContain(SP_BARE)
    expect(out).toContain(PIC)
  })
})
