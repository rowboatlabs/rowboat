import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parseAddedSlide, parsePptx } from './parse'
import { writeDeck, type NewSlidePart } from './serialize'
import { planNewSlide } from './add-slide'
import type { TextShape } from './types'

const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const TITLE_RECT = { x: 100000, y: 200000, w: 3000000, h: 400000 }

const LAYOUT_XML =
  `<p:sldLayout ${NS_P} ${NS_A}><p:cSld><p:spTree>` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  `<p:spPr><a:xfrm><a:off x="${TITLE_RECT.x}" y="${TITLE_RECT.y}"/><a:ext cx="${TITLE_RECT.w}" cy="${TITLE_RECT.h}"/></a:xfrm></p:spPr>` +
  '<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="100000" y="700000"/><a:ext cx="3000000" cy="1500000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/></p:txBody></p:sp>' +
  // Chrome slots must NOT be instantiated on a new slide.
  '<p:sp><p:nvSpPr><p:cNvPr id="4"/><p:nvPr><p:ph type="ftr" idx="5"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/></p:txBody></p:sp>' +
  '</p:spTree></p:cSld></p:sldLayout>'

const SLIDE = (n: number) =>
  `<p:sld ${NS_P} ${NS_A}><p:cSld><p:spTree>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T${n}"/></p:nvSpPr>` +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>' +
  `<p:txBody><a:bodyPr/><a:p><a:r><a:t>slide ${n}</a:t></a:r></a:p></p:txBody></p:sp>` +
  '</p:spTree></p:cSld></p:sld>'

const SLDID_1 = '<p:sldId id="256" r:id="rId2"/>'
const PRESENTATION_XML =
  `<p:presentation ${NS_P} ${NS_R}>` +
  `<p:sldIdLst>${SLDID_1}<p:sldId id="257" r:id="rId3"/></p:sldIdLst>` +
  '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'

const PRESENTATION_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId1" Type="${REL_TYPE}/theme" Target="theme/theme1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_TYPE}/slide" Target="slides/slide1.xml"/>` +
  `<Relationship Id="rId3" Type="${REL_TYPE}/slide" Target="slides/slide2.xml"/>` +
  '</Relationships>'

const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  `<Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/>` +
  `<Override PartName="/ppt/slides/slide2.xml" ContentType="${SLIDE_CT}"/>` +
  '</Types>'

const slideRels = () =>
  `<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`

async function buildFixtureZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('ppt/presentation.xml', PRESENTATION_XML)
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
  zip.file('ppt/slides/slide1.xml', SLIDE(1))
  zip.file('ppt/slides/_rels/slide1.xml.rels', slideRels())
  zip.file('ppt/slides/slide2.xml', SLIDE(2))
  zip.file('ppt/slides/_rels/slide2.xml.rels', slideRels())
  zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT_XML)
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

async function loadDeck() {
  return parsePptx(await buildFixtureZip())
}

describe('planNewSlide', () => {
  it('claims the next part name and instantiates the layout content placeholders', async () => {
    const deck = await loadDeck()
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])
    expect(plan.path).toBe('ppt/slides/slide3.xml')
    expect(plan.afterPath).toBe('ppt/slides/slide1.xml')
    // Title and body placeholders, but never the footer chrome.
    expect(plan.xml).toContain('<p:ph type="title"/>')
    expect(plan.xml).toContain('<p:ph type="body" idx="1"/>')
    expect(plan.xml).not.toContain('type="ftr"')
    // The rels reference the anchor's layout.
    expect(plan.relsXml).toContain('Target="../slideLayouts/slideLayout1.xml"')
    // Pending added paths are dodged too.
    const next = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [plan.path])
    expect(next.path).toBe('ppt/slides/slide4.xml')
  })

  it('renders through the real pipeline with layout geometry and empty text', async () => {
    const deck = await loadDeck()
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])
    const slide = await parseAddedSlide(deck, plan.path, plan.xml, plan.relsXml)
    expect(slide.xmlPath).toBe(plan.path)
    const [title, body] = slide.shapes as TextShape[]
    expect(title.type).toBe('text')
    // Placeholder geometry inherits from the layout slot.
    expect(title.xfrmEmu).toEqual(TITLE_RECT)
    // Empty text body: the editor shows its "Add text" affordance.
    expect(title.paragraphs).toHaveLength(1)
    expect(title.paragraphs[0].runs).toHaveLength(0)
    // Text style cascades from the layout's lstStyle.
    expect(title.display?.defaultRun.sizePt).toBe(44)
    expect(body.type).toBe('text')
  })

  it('fails closed when the anchor has no layout to clone', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', CONTENT_TYPES)
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    zip.file('ppt/slides/slide1.xml', SLIDE(1))
    zip.file('ppt/slides/slide2.xml', SLIDE(2))
    const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    await expect(planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])).rejects.toThrow(
      /no relationships part/,
    )
  })
})

describe('writeDeck addSlides', () => {
  it('adds the part + rels and splices sldId, Relationship and Override — nothing else', async () => {
    const input = await buildFixtureZip()
    const deck = await loadDeck()
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])
    const out = await writeDeck(deck, new Map(), { addSlides: [plan] })

    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(out)

    // The new sldId lands right after the anchor's, with fresh unique ids.
    expect(await outZip.files['ppt/presentation.xml'].async('string')).toBe(
      PRESENTATION_XML.replace(SLDID_1, `${SLDID_1}<p:sldId id="258" r:id="rId4"/>`),
    )
    expect(await outZip.files['ppt/_rels/presentation.xml.rels'].async('string')).toBe(
      PRESENTATION_RELS.replace(
        '</Relationships>',
        `<Relationship Id="rId4" Type="${REL_TYPE}/slide" Target="slides/slide3.xml"/></Relationships>`,
      ),
    )
    expect(await outZip.files['[Content_Types].xml'].async('string')).toBe(
      CONTENT_TYPES.replace(
        '</Types>',
        `<Override PartName="/ppt/slides/slide3.xml" ContentType="${SLIDE_CT}"/></Types>`,
      ),
    )
    expect(await outZip.files['ppt/slides/slide3.xml'].async('string')).toBe(plan.xml)
    expect(await outZip.files['ppt/slides/_rels/slide3.xml.rels'].async('string')).toBe(plan.relsXml)

    // Every pre-existing part is byte-identical.
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir) continue
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

    // The result reopens as a three-slide deck in the right order.
    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide3.xml',
      'ppt/slides/slide2.xml',
    ])
  })

  it('applies text edits addressed at the added slide against its synthesized XML', async () => {
    const deck = await loadDeck()
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])
    const slide = await parseAddedSlide(deck, plan.path, plan.xml, plan.relsXml)
    const title = slide.shapes[0] as TextShape

    const out = await writeDeck(
      deck,
      new Map([
        [
          plan.path,
          [
            {
              kind: 'text' as const,
              nodePath: title.nodePath,
              original: title.paragraphs,
              next: [{ srcPara: 0, runs: [{ text: 'Hello new slide' }] }],
            },
          ],
        ],
      ]),
      { addSlides: [plan] },
    )
    const raw = await (await JSZip.loadAsync(out)).files[plan.path].async('string')
    expect(raw).toContain('<a:t>Hello new slide</a:t>')

    const reparsed = await parsePptx(out)
    const added = reparsed.slides[1].shapes[0] as TextShape
    expect(added.paragraphs[0].runs[0].text).toBe('Hello new slide')
  })

  it('chains an add anchored to another pending add, in order', async () => {
    const deck = await loadDeck()
    const a = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])
    const b = await planNewSlide(deck, a.path, a.relsXml, [a.path])
    expect(b.path).toBe('ppt/slides/slide4.xml')
    const out = await writeDeck(deck, new Map(), { addSlides: [a, b] })

    expect(await (await JSZip.loadAsync(out)).files['ppt/presentation.xml'].async('string')).toBe(
      PRESENTATION_XML.replace(
        SLDID_1,
        `${SLDID_1}<p:sldId id="258" r:id="rId4"/><p:sldId id="259" r:id="rId5"/>`,
      ),
    )
    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide3.xml',
      'ppt/slides/slide4.xml',
      'ppt/slides/slide2.xml',
    ])
  })

  it('fails closed on collisions, unknown anchors, and anchors being deleted', async () => {
    const deck = await loadDeck()
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])

    await expect(
      writeDeck(deck, new Map(), { addSlides: [{ ...plan, path: 'ppt/slides/slide2.xml' }] }),
    ).rejects.toThrow(/collides/)
    await expect(
      writeDeck(deck, new Map(), { addSlides: [{ ...plan, afterPath: 'ppt/slides/slide9.xml' }] }),
    ).rejects.toThrow(/unknown anchor/)
    await expect(
      writeDeck(deck, new Map(), {
        addSlides: [plan],
        deleteSlides: ['ppt/slides/slide1.xml'],
      }),
    ).rejects.toThrow(/being deleted/)
  })

  it('composes with a deletion elsewhere in the same save', async () => {
    const deck = await loadDeck()
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])
    const out = await writeDeck(deck, new Map(), {
      addSlides: [plan] as readonly NewSlidePart[],
      deleteSlides: ['ppt/slides/slide2.xml'],
    })
    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide3.xml',
    ])
  })
})
