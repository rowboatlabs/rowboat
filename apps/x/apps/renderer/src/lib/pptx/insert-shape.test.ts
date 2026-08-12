import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx } from './parse'
import { updateSlideXml, writeDeck, type SlideEdit } from './serialize'
import type { ImageShape, TextShape } from './types'

const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm>'
const EXISTING_SP =
  '<p:sp><p:nvSpPr><p:cNvPr id="7" name="Existing"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
  `<p:spPr>${XFRM}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
  '<p:txBody><a:bodyPr/><a:p><a:r><a:t>hello</a:t></a:r></a:p></p:txBody></p:sp>'

const SLIDE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<p:sld ${NS_P} ${NS_A} ${NS_R}><p:cSld><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr/>' +
  EXISTING_SP +
  '</p:spTree></p:cSld></p:sld>'

const PRESENTATION_XML =
  `<p:presentation ${NS_P} ${NS_R}>` +
  '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
  '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'
const PRESENTATION_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId2" Type="${REL_TYPE}/slide" Target="slides/slide1.xml"/></Relationships>`
/** The slide already owns rId1 (its layout) and an image, so ids must skip. */
const SLIDE_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_TYPE}/image" Target="../media/image3.png"/>` +
  '</Relationships>'

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_B64 = Buffer.from(PNG).toString('base64')

/** png already typed; webp deliberately NOT, to prove the Default is added. */
const CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
  '</Types>'

async function buildZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('ppt/presentation.xml', PRESENTATION_XML)
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
  zip.file('ppt/slides/slide1.xml', SLIDE_XML)
  zip.file('ppt/slides/_rels/slide1.xml.rels', SLIDE_RELS)
  // image3 exists, so the next free name is image4 — not image1.
  zip.file('ppt/media/image3.png', PNG)
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

const P1 = 'ppt/slides/slide1.xml'
const RECT = { x: 100, y: 200, w: 300, h: 400 }

const textboxEdit: SlideEdit = { kind: 'insertShape', spec: { kind: 'textbox', xfrmEmu: RECT } }

describe('insert non-picture shapes', () => {
  it('appends exactly one element before </p:spTree>, leaving every other byte alone', () => {
    const out = updateSlideXml(SLIDE_XML, [textboxEdit])
    // Everything before spTree's close tag is unchanged, and the new element
    // sits after the existing shape — i.e. on top of the z-order.
    expect(out.startsWith(SLIDE_XML.slice(0, SLIDE_XML.indexOf('</p:spTree>')))).toBe(true)
    expect(out.endsWith('</p:spTree></p:cSld></p:sld>')).toBe(true)
    expect(out).toContain(EXISTING_SP)
    const inserted = out.slice(
      SLIDE_XML.indexOf('</p:spTree>'),
      out.indexOf('</p:spTree>'),
    )
    expect(inserted).toContain('<p:cNvSpPr txBox="1"/>')
    expect(inserted).toContain('<a:noFill/>')
    expect(inserted).toContain('<a:defRPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr>')
    expect(inserted).toContain('<a:off x="100" y="200"/><a:ext cx="300" cy="400"/>')
    // A text box has no outline.
    expect(inserted).not.toContain('<a:ln')
    // Exactly one new top-level element.
    expect(inserted.match(/<p:sp>/g)).toHaveLength(1)
  })

  it('assigns ids above every existing cNvPr, including pending inserts', () => {
    const out = updateSlideXml(SLIDE_XML, [
      textboxEdit,
      { kind: 'insertShape', spec: { kind: 'shape', preset: 'ellipse', xfrmEmu: RECT } },
      { kind: 'insertShape', spec: { kind: 'shape', preset: 'roundRect', xfrmEmu: RECT } },
    ])
    // Existing ids are 1 and 7, so the three inserts take 8, 9, 10.
    expect(out).toContain('<p:cNvPr id="8" name="TextBox 8"/>')
    expect(out).toContain('<p:cNvPr id="9" name="Oval 9"/>')
    expect(out).toContain('<p:cNvPr id="10" name="Rounded Rectangle 10"/>')
    const ids = [...out.matchAll(/cNvPr id="(\d+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives a shape a theme accent fill, and a line a stroke instead', () => {
    const rect = updateSlideXml(SLIDE_XML, [
      { kind: 'insertShape', spec: { kind: 'shape', preset: 'rect', xfrmEmu: RECT } },
    ])
    expect(rect).toContain('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>')
    expect(rect).toContain('<a:prstGeom prst="rect">')

    const line = updateSlideXml(SLIDE_XML, [
      { kind: 'insertShape', spec: { kind: 'shape', preset: 'line', xfrmEmu: RECT } },
    ])
    expect(line).toContain(
      '<a:noFill/><a:ln><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>',
    )
    // A line carries no text body.
    expect(line.slice(line.indexOf('Straight Connector'))).not.toContain('<p:txBody>')
  })

  it('re-parses as an ordinary, editable model shape', async () => {
    const deck = await parsePptx(await buildZip())
    const out = await writeDeck(deck, new Map([[P1, [textboxEdit]]]))
    const shapes = (await parsePptx(out)).slides[0].shapes
    expect(shapes).toHaveLength(2)
    const added = shapes[1] as TextShape
    expect(added.type).toBe('text')
    expect(added.id).toBe('8')
    expect(added.xfrmEmu).toEqual(RECT)
    // One empty paragraph, and a style snapshot so it can be recoloured.
    expect(added.paragraphs).toHaveLength(1)
    expect(added.paragraphs[0].runs).toHaveLength(0)
    expect(added.style).toEqual({ fill: 'noFill', hasLine: false, lineFill: null })
    // An explicit tx1 default, so typed text is the theme's body colour rather
    // than whatever the master cascade happens to resolve — which on some
    // decks is white, i.e. invisible.
    expect(added.display?.defaultRun.colorHex).toBe('000000')
  })
})

describe('insert image', () => {
  it('writes the media part and the relationship exactly, touching nothing else', async () => {
    const input = await buildZip()
    const deck = await parsePptx(input)
    const out = await writeDeck(
      deck,
      new Map([
        [
          P1,
          [
            {
              kind: 'insertShape',
              spec: {
                kind: 'image',
                xfrmEmu: RECT,
                ext: 'png',
                dataBase64: PNG_B64,
                name: 'photo.png',
              },
            } as SlideEdit,
          ],
        ],
      ]),
    )
    const outZip = await JSZip.loadAsync(out)

    // image3 was taken, so the new part is image4 — with the exact bytes.
    const bytes = await outZip.files['ppt/media/image4.png'].async('uint8array')
    expect(Buffer.from(bytes).equals(Buffer.from(PNG))).toBe(true)

    // Exactly one Relationship appended, before </Relationships>; rId1/rId2
    // were taken, so it is rId3.
    expect(await outZip.files['ppt/slides/_rels/slide1.xml.rels'].async('string')).toBe(
      SLIDE_RELS.replace(
        '</Relationships>',
        `<Relationship Id="rId3" Type="${REL_TYPE}/image" Target="../media/image4.png"/></Relationships>`,
      ),
    )
    // The p:pic references that id.
    const slide = await outZip.files[P1].async('string')
    expect(slide).toContain('<a:blip r:embed="rId3"/>')
    expect(slide).toContain('name="photo.png"')

    // Every pre-existing part is byte-identical.
    const inZip = await JSZip.loadAsync(input)
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir) continue
      if (name === P1 || name === 'ppt/slides/_rels/slide1.xml.rels') continue
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      expect(Buffer.from(a).equals(Buffer.from(b)), `byte-identical: ${name}`).toBe(true)
    }

    // And it reopens as a real image shape pointing at the new part.
    const added = (await parsePptx(out)).slides[0].shapes[1] as ImageShape
    expect(added.type).toBe('image')
    expect(added.mediaPath).toBe('ppt/media/image4.png')
  })

  it('claims distinct parts and ids for several images in one save', async () => {
    const deck = await parsePptx(await buildZip())
    const image = (name: string): SlideEdit => ({
      kind: 'insertShape',
      spec: { kind: 'image', xfrmEmu: RECT, ext: 'png', dataBase64: PNG_B64, name },
    })
    const out = await writeDeck(deck, new Map([[P1, [image('a.png'), image('b.png')]]]))
    const outZip = await JSZip.loadAsync(out)
    expect(outZip.files['ppt/media/image4.png']).toBeDefined()
    expect(outZip.files['ppt/media/image5.png']).toBeDefined()
    const rels = await outZip.files['ppt/slides/_rels/slide1.xml.rels'].async('string')
    expect(rels).toContain('Id="rId3"')
    expect(rels).toContain('Id="rId4"')
    const slide = await outZip.files[P1].async('string')
    expect(slide).toContain('r:embed="rId3"')
    expect(slide).toContain('r:embed="rId4"')
  })

  it('fails closed when an image insert reaches the writer with no extension', async () => {
    const deck = await parsePptx(await buildZip())
    await expect(
      writeDeck(
        deck,
        new Map([
          [
            P1,
            [
              {
                kind: 'insertShape',
                spec: { kind: 'image', xfrmEmu: RECT, ext: '', dataBase64: PNG_B64 },
              } as SlideEdit,
            ],
          ],
        ]),
      ),
    ).rejects.toThrow(/no usable file extension/)

    // And an insert addressed at a slide that does not exist.
    await expect(
      writeDeck(deck, new Map([['ppt/slides/slide9.xml', [textboxEdit]]])),
    ).rejects.toThrow(/unknown slide/)
  })

  it('refuses a picture whose relationship was never planned', () => {
    // updateSlideXml on its own cannot mint relationships, so it must not
    // silently emit a dangling r:embed.
    expect(() =>
      updateSlideXml(SLIDE_XML, [
        {
          kind: 'insertShape',
          spec: { kind: 'image', xfrmEmu: RECT, ext: 'png', dataBase64: PNG_B64 },
        },
      ]),
    ).toThrow(/no relationship id/)
  })
})

describe('insert composes with the other edit kinds', () => {
  it('insert + edit + delete of the same shape nets out to the original bytes', async () => {
    const input = await buildZip()
    const deck = await parsePptx(await buildZip())

    // Insert a text box, and confirm it lands.
    const inserted = await writeDeck(deck, new Map([[P1, [textboxEdit]]]))
    expect((await parsePptx(inserted)).slides[0].shapes).toHaveLength(2)

    // The edit set is the unit of truth: dropping the insert from it — which
    // is exactly what undo does — recomputes the original bytes from base.
    const undone = await writeDeck(deck, new Map())
    const a = await (await JSZip.loadAsync(input)).files[P1].async('uint8array')
    const b = await (await JSZip.loadAsync(undone)).files[P1].async('uint8array')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)

    // A save that inserts and then deletes the PRE-EXISTING shape still only
    // touches what it owns: the survivor is the inserted one.
    const existing = deck.slides[0].shapes[0] as TextShape
    const both = await writeDeck(
      deck,
      new Map([
        [
          P1,
          [
            textboxEdit,
            {
              kind: 'deleteShape',
              nodePath: existing.nodePath,
              shapeType: 'text',
              shapeId: existing.id,
              original: existing.paragraphs,
            },
          ],
        ],
      ]),
    )
    const after = (await parsePptx(both)).slides[0].shapes
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe('8')
  })
})

describe('an inserted shape is addressable like any other', () => {
  it('type + bold into a freshly inserted text box saves and round-trips', async () => {
    const deck = await parsePptx(await buildZip())
    const slide = deck.slides[0]
    // The node path the box WILL occupy: the next spTree CHILD index, not the
    // next model-shape index — spTree also holds nvGrpSpPr/grpSpPr.
    const last = slide.shapes[slide.shapes.length - 1]
    const insertedPath = [...slide.spTreePath, last.nodePath[last.nodePath.length - 1] + 1]

    const out = await writeDeck(
      deck,
      new Map<string, SlideEdit[]>([
        [
          P1,
          [
            textboxEdit,
            // Typing into the box that this same save is creating.
            {
              kind: 'text',
              nodePath: insertedPath,
              original: [{ runs: [] }],
              next: [{ runs: [{ text: 'typed', bold: true, colorHex: 'FF0000' }] }],
            },
          ],
        ],
      ]),
    )

    const shapes = (await parsePptx(out)).slides[0].shapes
    expect(shapes).toHaveLength(2)
    const box = shapes[1] as TextShape
    expect(box.paragraphs[0].runs[0].text).toBe('typed')
    expect(box.paragraphs[0].runs[0].bold).toBe(true)
    expect(box.paragraphs[0].runs[0].colorHex).toBe('FF0000')
    // The pre-existing shape is untouched.
    expect((shapes[0] as TextShape).paragraphs[0].runs[0].text).toBe('hello')
  })

  it('accepts geometry, style and deletion edits on a shape inserted in the same save', async () => {
    const deck = await parsePptx(await buildZip())
    const slide = deck.slides[0]
    const last = slide.shapes[slide.shapes.length - 1]
    const insertedPath = [...slide.spTreePath, last.nodePath[last.nodePath.length - 1] + 1]

    const moved = await writeDeck(
      deck,
      new Map<string, SlideEdit[]>([
        [
          P1,
          [
            { kind: 'insertShape', spec: { kind: 'shape', preset: 'rect', xfrmEmu: RECT } },
            {
              kind: 'shapeGeometry',
              nodePath: insertedPath,
              offEmu: { x: 999, y: 888 },
              extEmu: { w: 777, h: 666 },
            },
          ],
        ],
      ]),
    )
    const shape = (await parsePptx(moved)).slides[0].shapes[1]
    expect(shape.xfrmEmu).toEqual({ x: 999, y: 888, w: 777, h: 666 })

    // Deleting it in the same save leaves the slide as it started.
    const netZero = await writeDeck(
      deck,
      new Map<string, SlideEdit[]>([
        [
          P1,
          [
            textboxEdit,
            {
              kind: 'deleteShape',
              nodePath: insertedPath,
              shapeType: 'text',
              shapeId: '8',
              // A synthesized text box has exactly one empty paragraph, and
              // deletion revalidates that against the bytes like any other.
              original: [{ runs: [] }],
            },
          ],
        ],
      ]),
    )
    expect((await parsePptx(netZero)).slides[0].shapes).toHaveLength(1)
  })
})

describe('inserted media is typed in [Content_Types].xml', () => {
  it('adds a Default for a new extension and leaves an already-typed one alone', async () => {
    const deck = await parsePptx(await buildZip())
    const image = (ext: string): SlideEdit => ({
      kind: 'insertShape',
      spec: { kind: 'image', xfrmEmu: RECT, ext, dataBase64: PNG_B64 },
    })

    // png is already typed: CT must stay byte-identical.
    const pngOnly = await JSZip.loadAsync(await writeDeck(deck, new Map([[P1, [image('png')]]])))
    expect(await pngOnly.files['[Content_Types].xml'].async('string')).toBe(CONTENT_TYPES)

    // webp is not: exactly one Default appears, before </Types>.
    const withWebp = await JSZip.loadAsync(await writeDeck(deck, new Map([[P1, [image('webp')]]])))
    expect(await withWebp.files['[Content_Types].xml'].async('string')).toBe(
      CONTENT_TYPES.replace('</Types>', '<Default Extension="webp" ContentType="image/webp"/></Types>'),
    )
  })
})

describe('restyling a shape inserted in the same save', () => {
  it('validates against the synthesized snapshot and recolours it', async () => {
    const deck = await parsePptx(await buildZip())
    const slide = deck.slides[0]
    const last = slide.shapes[slide.shapes.length - 1]
    const insertedPath = [...last.nodePath.slice(0, -1), last.nodePath[last.nodePath.length - 1] + 1]

    const out = await writeDeck(
      deck,
      new Map<string, SlideEdit[]>([
        [
          P1,
          [
            { kind: 'insertShape', spec: { kind: 'shape', preset: 'rect', xfrmEmu: RECT } },
            {
              kind: 'setShapeStyle',
              nodePath: insertedPath,
              shapeType: 'text',
              shapeId: '8',
              // Exactly what the preview snapshot claims the synthesized
              // rect parses to — the fail-closed comparison runs against it.
              original: { fill: 'solidFill', hasLine: false, lineFill: null },
              fillHex: '112233',
            },
          ],
        ],
      ]),
    )
    const shape = (await parsePptx(out)).slides[0].shapes[1]
    expect(shape.style?.fillHex).toBe('112233')
    // The theme reference is gone; a literal colour took its place.
    const raw = await (await JSZip.loadAsync(out)).files[P1].async('string')
    expect(raw).not.toContain('schemeClr val="accent1"')
    expect(raw).toContain('<a:srgbClr val="112233"/>')
  })
})
