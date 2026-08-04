import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx } from './parse'
import { updateSlideXml, writeDeck, type DeleteShapeEdit, type SlideEdit } from './serialize'
import type { GroupShape, ImageShape, PlaceholderShape, TextShape } from './types'

// Realistic namespaces: the slide-relationship Type suffix and Target
// resolution are part of what slide deletion validates.
const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// Slide 1's shapes as named constants, so "everything outside the removed
// range is byte-identical" is provable with plain string surgery.
const TEXT_SP =
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="100" cy="200"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2800"/><a:t>Keep me</a:t></a:r></a:p></p:txBody></p:sp>'

const PIC =
  '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Photo"/></p:nvPicPr>' +
  '<p:blipFill><a:blip r:embed="rId1"/></p:blipFill>' +
  '<p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm></p:spPr></p:pic>'

const GROUP =
  '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group"/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="5" y="6"/><a:ext cx="70" cy="80"/></a:xfrm></p:grpSpPr>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="11"/></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="5" y="6"/><a:ext cx="7" cy="8"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:p><a:r><a:t>inside</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>'

const FRAME =
  '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr>' +
  '<p:xfrm><a:off x="9" y="9"/><a:ext cx="9" cy="9"/></p:xfrm>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>'

const SLIDE1_HEAD =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<p:sld ${NS_P} ${NS_A} ${NS_R}><p:cSld><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
const SLIDE1_TAIL = '</p:spTree></p:cSld></p:sld>'
// A literal space between two shapes: whitespace OUTSIDE a removed element's
// range must survive deletion byte-for-byte.
const SLIDE1_XML = SLIDE1_HEAD + TEXT_SP + ' ' + PIC + GROUP + FRAME + SLIDE1_TAIL

const SLIDE2_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<p:sld ${NS_P} ${NS_A} ${NS_R}><p:cSld><p:spTree>` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="T2"/></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr/><a:p><a:r><a:t>second slide</a:t></a:r></a:p></p:txBody></p:sp>' +
  '<p:pic><p:nvPicPr><p:cNvPr id="3"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill>' +
  '<p:spPr><a:xfrm><a:off x="1" y="1"/><a:ext cx="2" cy="2"/></a:xfrm></p:spPr></p:pic>' +
  '</p:spTree></p:cSld></p:sld>'

const SLDID_2 = '<p:sldId id="257" r:id="rId3"/>'
const PRESENTATION_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<p:presentation ${NS_P} ${NS_R}>` +
  `<p:sldIdLst><p:sldId id="256" r:id="rId2"/>${SLDID_2}</p:sldIdLst>` +
  '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'

const REL_SLIDE2 = `<Relationship Id="rId3" Type="${REL_TYPE}/slide" Target="slides/slide2.xml"/>`
const PRESENTATION_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId1" Type="${REL_TYPE}/theme" Target="theme/theme1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_TYPE}/slide" Target="slides/slide1.xml"/>` +
  REL_SLIDE2 +
  '</Relationships>'

const OVERRIDE_SLIDE2 =
  '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
  OVERRIDE_SLIDE2 +
  '</Types>'

const slideRels = (target: string) =>
  `<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL_TYPE}/image" Target="${target}"/></Relationships>`

const PNG1 = Uint8Array.from([137, 80, 78, 71, 1, 2, 3])
const PNG2 = Uint8Array.from([137, 80, 78, 71, 9, 8, 7])

async function buildFixtureZip(contentTypes: string = CONTENT_TYPES): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('ppt/presentation.xml', PRESENTATION_XML)
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
  zip.file('ppt/slides/slide1.xml', SLIDE1_XML)
  zip.file('ppt/slides/_rels/slide1.xml.rels', slideRels('../media/image1.png'))
  zip.file('ppt/slides/slide2.xml', SLIDE2_XML)
  zip.file('ppt/slides/_rels/slide2.xml.rels', slideRels('../media/image2.png'))
  zip.file('ppt/media/image1.png', PNG1)
  zip.file('ppt/media/image2.png', PNG2)
  return zip.generateAsync({ type: 'uint8array' })
}

async function loadDeck(contentTypes?: string) {
  const deck = await parsePptx(await buildFixtureZip(contentTypes))
  const slide1 = deck.slides[0]
  const [text, image, group, frame] = slide1.shapes as [
    TextShape,
    ImageShape,
    GroupShape,
    PlaceholderShape,
  ]
  return { deck, slide1, text, image, group, frame }
}

function deleteEditFor(
  shape: { nodePath: number[]; id: string; type: DeleteShapeEdit['shapeType'] },
  original?: TextShape['paragraphs'],
): DeleteShapeEdit {
  return {
    kind: 'deleteShape',
    nodePath: shape.nodePath,
    shapeType: shape.type,
    shapeId: shape.id,
    original,
  }
}

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
beforeAll(() => {
  let n = 0
  URL.createObjectURL = (() => `blob:mock/${n++}`) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
})
afterAll(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

describe('deleteShape', () => {
  it('removes exactly the text shape element; whitespace and neighbours keep their bytes', async () => {
    const { text } = await loadDeck()
    expect(text.type).toBe('text')
    const out = updateSlideXml(SLIDE1_XML, [deleteEditFor(text, text.paragraphs)])
    // The space that followed the shape survives — only [start, end) went.
    expect(out).toBe(SLIDE1_HEAD + ' ' + PIC + GROUP + FRAME + SLIDE1_TAIL)
  })

  it('removes a picture, a whole group, and a graphicFrame placeholder', async () => {
    const { image, group, frame } = await loadDeck()
    expect(updateSlideXml(SLIDE1_XML, [deleteEditFor(image)])).toBe(
      SLIDE1_HEAD + TEXT_SP + ' ' + GROUP + FRAME + SLIDE1_TAIL,
    )
    expect(updateSlideXml(SLIDE1_XML, [deleteEditFor(group)])).toBe(
      SLIDE1_HEAD + TEXT_SP + ' ' + PIC + FRAME + SLIDE1_TAIL,
    )
    expect(updateSlideXml(SLIDE1_XML, [deleteEditFor(frame)])).toBe(
      SLIDE1_HEAD + TEXT_SP + ' ' + PIC + GROUP + SLIDE1_TAIL,
    )
  })

  it('composes with other edits on the same slide without overlapping', async () => {
    const { text, image } = await loadDeck()
    const edits: SlideEdit[] = [
      deleteEditFor(image),
      { kind: 'shapeGeometry', nodePath: text.nodePath, offEmu: { x: 55, y: 66 } },
    ]
    const out = updateSlideXml(SLIDE1_XML, edits)
    const movedTextSp = TEXT_SP.replace('x="10"', 'x="55"').replace('y="20"', 'y="66"')
    expect(out).toBe(SLIDE1_HEAD + movedTextSp + ' ' + GROUP + FRAME + SLIDE1_TAIL)
  })

  it('fails closed on an id mismatch, a kind mismatch, and missing/stale text content', async () => {
    const { text, image } = await loadDeck()

    // The node at the path is not the shape the edit names.
    expect(() =>
      updateSlideXml(SLIDE1_XML, [{ ...deleteEditFor(text, text.paragraphs), shapeId: '99' }]),
    ).toThrow(/delete target mismatch/)

    // The model kind does not allow the element found at the path.
    expect(() =>
      updateSlideXml(SLIDE1_XML, [
        { ...deleteEditFor(image), nodePath: text.nodePath },
      ]),
    ).toThrow(/unsupported shape/)

    // A text deletion must carry its paragraphs…
    expect(() => updateSlideXml(SLIDE1_XML, [deleteEditFor(text)])).toThrow(
      /requires its original paragraphs/,
    )
    // …and they must still match the retained bytes.
    const stale = text.paragraphs.map((p) => ({
      ...p,
      runs: p.runs.map((r) => ({ ...r, text: r.text + '!' })),
    }))
    expect(() => updateSlideXml(SLIDE1_XML, [deleteEditFor(text, stale)])).toThrow(
      /does not match/,
    )
  })
})

describe('deleteSlide', () => {
  it('removes the part, its rels, its sldId, its Relationship and its Override — nothing else', async () => {
    const input = await buildFixtureZip()
    const { deck } = await loadDeck()
    const out = await writeDeck(deck, new Map(), { deleteSlides: ['ppt/slides/slide2.xml'] })

    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(out)
    const outNames = Object.keys(outZip.files).filter((n) => !outZip.files[n].dir)

    expect(outNames).not.toContain('ppt/slides/slide2.xml')
    expect(outNames).not.toContain('ppt/slides/_rels/slide2.xml.rels')

    // The three forced package parts are the input minus exactly one element.
    expect(await outZip.files['ppt/presentation.xml'].async('string')).toBe(
      PRESENTATION_XML.replace(SLDID_2, ''),
    )
    expect(await outZip.files['ppt/_rels/presentation.xml.rels'].async('string')).toBe(
      PRESENTATION_RELS.replace(REL_SLIDE2, ''),
    )
    expect(await outZip.files['[Content_Types].xml'].async('string')).toBe(
      CONTENT_TYPES.replace(OVERRIDE_SLIDE2, ''),
    )

    // Every surviving part is byte-identical — including slide2's media,
    // which stays orphaned rather than being garbage-collected.
    for (const name of outNames) {
      if (
        name === 'ppt/presentation.xml' ||
        name === 'ppt/_rels/presentation.xml.rels' ||
        name === '[Content_Types].xml'
      ) {
        continue
      }
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      expect(Buffer.from(a).equals(Buffer.from(b)), `byte-identical: ${name}`).toBe(true)
    }
    expect(outNames).toContain('ppt/media/image2.png')

    // The result opens as a one-slide deck with slide 1 intact.
    const reparsed = await parsePptx(out)
    expect(reparsed.slides).toHaveLength(1)
    expect((reparsed.slides[0].shapes[0] as TextShape).paragraphs[0].runs[0].text).toBe('Keep me')
  })

  it('leaves [Content_Types].xml alone when it has no per-part Override for the slide', async () => {
    const noOverrides = CONTENT_TYPES.replace(OVERRIDE_SLIDE2, '')
    const { deck } = await loadDeck(noOverrides)
    const out = await writeDeck(deck, new Map(), { deleteSlides: ['ppt/slides/slide2.xml'] })
    const raw = await (await JSZip.loadAsync(out)).files['[Content_Types].xml'].async('string')
    expect(raw).toBe(noOverrides)
  })

  it('fails closed on unknown slides, edited-and-deleted slides, and deleting every slide', async () => {
    const { deck, text } = await loadDeck()
    await expect(
      writeDeck(deck, new Map(), { deleteSlides: ['ppt/slides/slide9.xml'] }),
    ).rejects.toThrow(/unknown slide/)

    const edits = new Map<string, SlideEdit[]>([
      ['ppt/slides/slide1.xml', [{ kind: 'shapeGeometry', nodePath: text.nodePath, offEmu: { x: 1, y: 1 } }]],
    ])
    await expect(
      writeDeck(deck, edits, { deleteSlides: ['ppt/slides/slide1.xml'] }),
    ).rejects.toThrow(/both edited and marked deleted/)

    await expect(
      writeDeck(deck, new Map(), {
        deleteSlides: ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml'],
      }),
    ).rejects.toThrow(/every slide/)
  })

  it('fails closed when a custom show still references the slide', async () => {
    // p:custShowLst carries its own r:id list; deleting only the sldId would
    // leave that reference dangling in the written file.
    const withCustShow = PRESENTATION_XML.replace(
      '</p:presentation>',
      '<p:custShowLst><p:custShow name="short" id="0"><p:sldLst>' +
        '<p:sld r:id="rId3"/></p:sldLst></p:custShow></p:custShowLst></p:presentation>',
    )
    const { deck } = await loadDeck()
    deck.source.zip.file('ppt/presentation.xml', withCustShow)
    await expect(
      writeDeck(deck, new Map(), { deleteSlides: ['ppt/slides/slide2.xml'] }),
    ).rejects.toThrow(/custom shows/)
  })

  it('fails closed when the retained rels disagree with the model', async () => {
    // The deck parsed cleanly, but the retained bytes no longer carry the
    // slide's Relationship — the splice must refuse, not guess.
    const { deck } = await loadDeck()
    deck.source.zip.file(
      'ppt/_rels/presentation.xml.rels',
      PRESENTATION_RELS.replace(REL_SLIDE2, ''),
    )
    await expect(
      writeDeck(deck, new Map(), { deleteSlides: ['ppt/slides/slide2.xml'] }),
    ).rejects.toThrow(/exactly one slide relationship/)
  })

  it('recomputing with an empty edit set restores every original byte (undo)', async () => {
    const input = await buildFixtureZip()
    const { deck } = await loadDeck()
    // A deletion was written…
    await writeDeck(deck, new Map(), { deleteSlides: ['ppt/slides/slide2.xml'] })
    // …then undone: saves recompute from base bytes + current edits, so an
    // empty set writes the original package back.
    const restored = await writeDeck(deck, new Map())
    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(restored)
    const inNames = Object.keys(inZip.files).filter((n) => !inZip.files[n].dir).sort()
    const outNames = Object.keys(outZip.files).filter((n) => !outZip.files[n].dir).sort()
    expect(outNames).toEqual(inNames)
    for (const name of inNames) {
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      expect(Buffer.from(a).equals(Buffer.from(b)), `restored: ${name}`).toBe(true)
    }
  })
})
