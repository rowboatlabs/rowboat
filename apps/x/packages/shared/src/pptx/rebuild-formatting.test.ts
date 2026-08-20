import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parseAddedSlide, parsePptx } from './parse.js'
import { planDuplicateSlide, readSlideRels } from './add-slide.js'
import { updateSlideXml, writeDeck, type EditedParagraph, type SlideEdit } from './serialize.js'
import type { TextShape } from './types.js'

const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * The shape of the real bug: a title placeholder whose LAYOUT default colour
 * is white, while its authored runs are dark. A rebuilt run that carries no
 * rPr therefore renders invisible on the light slide.
 */
const LAYOUT_XML =
  `<p:sldLayout ${NS_P} ${NS_A}><p:cSld><p:spTree>` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9000000" cy="1000000"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="4000">' +
  '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
  '</a:defRPr></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>' +
  '</p:spTree></p:cSld></p:sldLayout>'

/** Two runs, both explicitly dark, with extra rPr attributes worth preserving. */
const TITLE_SP =
  '<p:sp><p:nvSpPr><p:cNvPr id="7" name="Title"/><p:cNvSpPr/>' +
  '<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9000000" cy="1000000"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p>' +
  '<a:r><a:rPr lang="en-US" dirty="0" spc="-170"><a:solidFill><a:srgbClr val="0C414B"/></a:solidFill></a:rPr><a:t>Welcome</a:t></a:r>' +
  '<a:r><a:rPr lang="en-US" dirty="0" spc="-170"><a:solidFill><a:srgbClr val="0C414B"/></a:solidFill></a:rPr><a:t> To</a:t></a:r>' +
  '</a:p></p:txBody></p:sp>'

const OTHER_SP =
  '<p:sp><p:nvSpPr><p:cNvPr id="8" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="0" y="2000000"/><a:ext cx="500000" cy="500000"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:p><a:r><a:t>untouched</a:t></a:r></a:p></p:txBody></p:sp>'

const SLIDE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<p:sld ${NS_P} ${NS_A} ${NS_R}><p:cSld><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
  TITLE_SP +
  OTHER_SP +
  '</p:spTree></p:cSld></p:sld>'

const PRESENTATION_XML =
  `<p:presentation ${NS_P} ${NS_R}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>` +
  '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'
const PRESENTATION_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId2" Type="${REL_TYPE}/slide" Target="slides/slide1.xml"/></Relationships>`
const SLIDE_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  '</Relationships>'

const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  `<Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/></Types>`

async function buildZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('ppt/presentation.xml', PRESENTATION_XML)
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
  zip.file('ppt/slides/slide1.xml', SLIDE_XML)
  zip.file('ppt/slides/_rels/slide1.xml.rels', SLIDE_RELS)
  zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT_XML)
  return zip.generateAsync({ type: 'uint8array' })
}

const oc = URL.createObjectURL
const orv = URL.revokeObjectURL
beforeAll(() => {
  URL.createObjectURL = (() => 'blob:m') as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
})
afterAll(() => {
  URL.createObjectURL = oc
  URL.revokeObjectURL = orv
})

const P1 = 'ppt/slides/slide1.xml'
async function loadTitle() {
  const deck = await parsePptx(await buildZip())
  return { deck, title: deck.slides[0].shapes[0] as TextShape }
}

/** Re-parse a slide after swapping its bytes, as a save-then-reopen would. */
async function reparseWith(deck: Awaited<ReturnType<typeof loadTitle>>['deck'], xml: string) {
  deck.source.zip.file(P1, xml)
  const re = await parsePptx(await deck.source.zip.generateAsync({ type: 'uint8array' }))
  deck.source.zip.file(P1, SLIDE_XML)
  return re
}

describe('the layout default is genuinely white', () => {
  it('so a run with no rPr of its own is invisible — the premise of the bug', async () => {
    const { title } = await loadTitle()
    expect(title.display?.paragraphs[0].defaultRun.colorHex).toBe('FFFFFF')
    expect(title.paragraphs[0].runs[0].colorHex).toBe('0C414B')
  })
})

describe('SYMPTOM 1: typing on a new line rendered white', () => {
  it('inherits the neighbouring paragraph rPr instead of emitting a bare run', async () => {
    const { deck, title } = await loadTitle()
    // Enter at the end, then type: paragraph 1 has NO source paragraph.
    const next: EditedParagraph[] = [
      { srcPara: 0, runs: title.paragraphs[0].runs.map((r, i) => ({ ...r, srcPara: 0, srcRun: i })) },
      { runs: [{ text: 'Typed on a new line' }] },
    ]
    const written = updateSlideXml(SLIDE_XML, [
      { kind: 'text', nodePath: title.nodePath, original: title.paragraphs, next },
    ])
    // The new run carries the inherited colour rather than nothing at all.
    expect(written).toContain(
      '<a:r><a:rPr lang="en-US" dirty="0" spc="-170"><a:solidFill><a:srgbClr val="0C414B"/></a:solidFill></a:rPr>' +
        '<a:t>Typed on a new line</a:t></a:r>',
    )
    const re = await reparseWith(deck, written)
    const rs = re.slides[0].shapes[0] as TextShape
    expect(rs.display?.paragraphs[1].runs[0].colorHex).toBe('0C414B')
    expect(rs.display?.paragraphs[1].runs[0].colorHex).not.toBe('FFFFFF')
    // The untouched shape keeps its bytes.
    expect(written).toContain(OTHER_SP)
  })

  it('falls back to the shape own bytes when NO paragraph has a source', async () => {
    const { title } = await loadTitle()
    const written = updateSlideXml(SLIDE_XML, [
      {
        kind: 'text',
        nodePath: title.nodePath,
        original: title.paragraphs,
        next: [{ runs: [{ text: 'wholly new' }] }],
      },
    ])
    expect(written).toContain('<a:srgbClr val="0C414B"/></a:solidFill></a:rPr><a:t>wholly new</a:t>')
  })
})

describe('SYMPTOM 2: a colour pick on a restructured box was dropped', () => {
  it('emits the override onto the inherited rPr, preserving its other bytes', async () => {
    const { deck, title } = await loadTitle()
    const written = updateSlideXml(SLIDE_XML, [
      {
        kind: 'text',
        nodePath: title.nodePath,
        original: title.paragraphs,
        // Select-all + retype (structural) with a colour the user picked.
        next: [{ srcPara: 0, runs: [{ text: 'My New Title', colorHex: 'FF0000' }] }],
      },
    ])
    // The picked colour lands, and dirty/spc/lang from the donor survive.
    expect(written).toContain(
      '<a:r><a:rPr lang="en-US" dirty="0" spc="-170"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr>' +
        '<a:t>My New Title</a:t></a:r>',
    )
    const rs = (await reparseWith(deck, written)).slides[0].shapes[0] as TextShape
    expect(rs.display?.paragraphs[0].runs[0].colorHex).toBe('FF0000')
  })

  it('carries bold / size / font on a provenance-less run too', async () => {
    const { title } = await loadTitle()
    const written = updateSlideXml(SLIDE_XML, [
      {
        kind: 'text',
        nodePath: title.nodePath,
        original: title.paragraphs,
        next: [{ runs: [{ text: 'styled', bold: true, sizePt: 32, latinFont: 'Georgia' }] }],
      },
    ])
    const run = written.match(/<a:r>(?:(?!<\/a:r>).)*styled.*?<\/a:r>/s)?.[0] ?? ''
    expect(run).toContain('b="1"')
    expect(run).toContain('sz="3200"')
    expect(run).toContain('<a:latin typeface="Georgia"/>')
  })

  it('a run whose props match its original still copies bytes verbatim', async () => {
    const { title } = await loadTitle()
    // Structural (one run removed), but the survivor is unchanged.
    const written = updateSlideXml(SLIDE_XML, [
      {
        kind: 'text',
        nodePath: title.nodePath,
        original: title.paragraphs,
        next: [
          { srcPara: 0, runs: [{ ...title.paragraphs[0].runs[0], srcPara: 0, srcRun: 0 }] },
        ],
      },
    ])
    // No rPr rewriting: exactly the original run bytes.
    expect(written).toContain(
      '<a:r><a:rPr lang="en-US" dirty="0" spc="-170"><a:solidFill><a:srgbClr val="0C414B"/></a:solidFill></a:rPr><a:t>Welcome</a:t></a:r>',
    )
    expect(written).not.toContain('<a:t> To</a:t>')
  })
})

describe('compose paths on a DUPLICATED slide', () => {
  it('formatRuns, setShapeStyle and insertShape all apply to the copy in one save', async () => {
    const deck = await parsePptx(await buildZip())
    const plan = planDuplicateSlide(
      deck,
      P1,
      { xml: deck.source.slideXml[P1], relsXml: await readSlideRels(deck, P1) },
      [],
    )
    const dup = await parseAddedSlide(deck, plan.path, plan.xml, plan.relsXml)
    const dupTitle = dup.shapes[0] as TextShape
    // The duplicate resolves the same cascade as the original.
    expect(dupTitle.display?.paragraphs[0].defaultRun.colorHex).toBe('FFFFFF')

    const out = await writeDeck(
      deck,
      new Map<string, SlideEdit[]>([
        [
          plan.path,
          [
            // Structural retype WITH formatting carried on the run itself —
            // the path the editor uses while a box is open. A separate
            // formatRuns edit on the same shape would overlap this rebuild,
            // and the serializer rightly refuses that (see the fail-closed
            // case below).
            {
              kind: 'text',
              nodePath: dupTitle.nodePath,
              original: dupTitle.paragraphs,
              next: [{ runs: [{ text: 'Renamed on the copy', bold: true }] }],
            },
            // formatRuns against an UNrestructured shape on the same copy.
            {
              kind: 'formatRuns',
              nodePath: (dup.shapes[1] as TextShape).nodePath,
              original: (dup.shapes[1] as TextShape).paragraphs,
              targets: [{ para: 0, run: 0 }],
              set: { italic: true },
            },
            {
              kind: 'setShapeStyle',
              nodePath: (dup.shapes[1] as TextShape).nodePath,
              shapeType: 'text',
              shapeId: dup.shapes[1].id,
              original: dup.shapes[1].style!,
              fillHex: '336699',
            },
            { kind: 'insertShape', spec: { kind: 'textbox', xfrmEmu: { x: 1, y: 2, w: 3, h: 4 } } },
          ],
        ],
      ]),
      { addSlides: [plan] },
    )

    const re = await parsePptx(out)
    expect(re.slides.map((s) => s.xmlPath)).toEqual([P1, plan.path])
    const copy = re.slides[1]
    // The retyped title is dark (not the white default) and bold.
    const t = copy.shapes[0] as TextShape
    expect(t.paragraphs[0].runs[0].text).toBe('Renamed on the copy')
    expect(t.display?.paragraphs[0].runs[0].colorHex).toBe('0C414B')
    expect(t.paragraphs[0].runs[0].bold).toBe(true)
    // The recoloured shape and the inserted box both landed.
    expect((copy.shapes[1] as TextShape).style?.fillHex).toBe('336699')
    expect((copy.shapes[1] as TextShape).paragraphs[0].runs[0].italic).toBe(true)
    expect(copy.shapes).toHaveLength(3)
    expect((copy.shapes[2] as TextShape).type).toBe('text')
    // And the ORIGINAL slide is untouched.
    const orig = re.slides[0].shapes[0] as TextShape
    expect(orig.paragraphs[0].runs[0].text).toBe('Welcome')
  })
})

describe('the fail-closed invariant still holds', () => {
  it('refuses a formatRuns that would overlap a structural rebuild of the same shape', async () => {
    const { title } = await loadTitle()
    expect(() =>
      updateSlideXml(SLIDE_XML, [
        {
          kind: 'text',
          nodePath: title.nodePath,
          original: title.paragraphs,
          next: [{ runs: [{ text: 'restructured' }] }],
        },
        {
          kind: 'formatRuns',
          nodePath: title.nodePath,
          original: title.paragraphs,
          targets: [{ para: 0, run: 0 }],
          set: { bold: true },
        },
      ]),
    ).toThrow(/overlapping splices/)
  })

  it('still refuses a text edit whose original disagrees with the bytes', async () => {
    const { title } = await loadTitle()
    const stale = title.paragraphs.map((p) => ({
      ...p,
      runs: p.runs.map((r) => ({ ...r, text: r.text + '!' })),
    }))
    expect(() =>
      updateSlideXml(SLIDE_XML, [
        {
          kind: 'text',
          nodePath: title.nodePath,
          original: stale,
          next: [{ runs: [{ text: 'x' }] }],
        },
      ]),
    ).toThrow(/does not match/)
  })
})
