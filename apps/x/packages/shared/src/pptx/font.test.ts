import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx } from './parse.js'
import { updateSlideXml, writeDeck, type FormatRunsEdit } from './serialize.js'
import type { TextShape } from './types.js'

const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// Four runs covering every rPr shape the typeface splice has to handle:
//  0 — rPr WITH an existing a:latin (plus siblings on both sides of it)
//  1 — rPr with attributes and a fill, but NO a:latin
//  2 — self-closing rPr
//  3 — no rPr at all
const RUN_0 =
  '<a:r><a:rPr lang="en-US" sz="2800" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>' +
  '<a:latin typeface="Tahoma" pitchFamily="34"/><a:cs typeface="Tahoma"/></a:rPr><a:t>first</a:t></a:r>'
const RUN_1 =
  '<a:r><a:rPr lang="en-US" i="1"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:rPr>' +
  '<a:t>second</a:t></a:r>'
const RUN_2 = '<a:r><a:rPr lang="en-US" u="sng"/><a:t>third</a:t></a:r>'
const RUN_3 = '<a:r><a:t>fourth</a:t></a:r>'

const SLIDE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<p:sld ${NS_P} ${NS_A}><p:cSld><p:spTree>` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p>' +
  RUN_0 +
  RUN_1 +
  RUN_2 +
  RUN_3 +
  '</a:p></p:txBody></p:sp>' +
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

async function loadDeck() {
  const deck = await parsePptx(await buildZip())
  return { deck, shape: deck.slides[0].shapes[0] as TextShape }
}

function fontEdit(shape: TextShape, run: number, latinFont: string): FormatRunsEdit {
  return {
    kind: 'formatRuns',
    nodePath: shape.nodePath,
    original: shape.paragraphs,
    targets: [{ para: 0, run }],
    set: { latinFont },
  }
}

describe('a:latin parsing', () => {
  it('reads the run typeface verbatim into the byte-anchored model', async () => {
    const { shape } = await loadDeck()
    expect(shape.paragraphs[0].runs.map((r) => r.latinFont)).toEqual([
      'Tahoma',
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe('formatRuns latinFont', () => {
  it('splices the typeface ATTRIBUTE when a:latin exists, leaving every neighbour byte-identical', async () => {
    const { shape } = await loadDeck()
    const out = updateSlideXml(SLIDE_XML, [fontEdit(shape, 0, 'Georgia')])
    // Exactly one attribute value changed: pitchFamily, the sibling a:cs, the
    // fill, the rPr attributes and all three other runs keep their bytes.
    expect(out).toBe(SLIDE_XML.replace('typeface="Tahoma" pitchFamily="34"', 'typeface="Georgia" pitchFamily="34"'))
    expect(out).toContain('<a:cs typeface="Tahoma"/>')
    expect(out).toContain(RUN_1)
    expect(out).toContain(RUN_2)
    expect(out).toContain(RUN_3)
  })

  it('inserts a:latin at its schema position when the rPr has other children', async () => {
    const { shape } = await loadDeck()
    const out = updateSlideXml(SLIDE_XML, [fontEdit(shape, 1, 'Verdana')])
    // After the fill, and the rPr's attributes and fill are untouched.
    expect(out).toBe(
      SLIDE_XML.replace(
        '<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:rPr>',
        '<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:latin typeface="Verdana"/></a:rPr>',
      ),
    )
    expect(out).toContain(RUN_0)
  })

  it('reopens a self-closing rPr, preserving its attributes', async () => {
    const { shape } = await loadDeck()
    const out = updateSlideXml(SLIDE_XML, [fontEdit(shape, 2, 'Verdana')])
    expect(out).toBe(
      SLIDE_XML.replace(
        '<a:rPr lang="en-US" u="sng"/>',
        '<a:rPr lang="en-US" u="sng"><a:latin typeface="Verdana"/></a:rPr>',
      ),
    )
  })

  it('a run with no rPr gains one containing only a:latin', async () => {
    const { shape } = await loadDeck()
    const out = updateSlideXml(SLIDE_XML, [fontEdit(shape, 3, 'Courier New')])
    expect(out).toBe(
      SLIDE_XML.replace(
        '<a:r><a:t>fourth</a:t></a:r>',
        '<a:r><a:rPr><a:latin typeface="Courier New"/></a:rPr><a:t>fourth</a:t></a:r>',
      ),
    )
  })

  it('combines with a colour change in one rPr without overlapping', async () => {
    const { shape } = await loadDeck()
    const out = updateSlideXml(SLIDE_XML, [
      {
        kind: 'formatRuns',
        nodePath: shape.nodePath,
        original: shape.paragraphs,
        targets: [{ para: 0, run: 2 }],
        set: { latinFont: 'Georgia', colorHex: '112233', bold: true },
      },
    ])
    // Self-closing rPr reopens with attributes first, then fill, then latin.
    expect(out).toContain(
      '<a:rPr lang="en-US" u="sng" b="1"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr>',
    )
  })

  it('escapes a typeface that would otherwise break the attribute', async () => {
    const { shape } = await loadDeck()
    const out = updateSlideXml(SLIDE_XML, [fontEdit(shape, 3, 'A & B "C"')])
    expect(out).toContain('<a:latin typeface="A &amp; B &quot;C&quot;"/>')
  })

  it('fails closed on an empty typeface and on a stale original', async () => {
    const { shape } = await loadDeck()
    expect(() => updateSlideXml(SLIDE_XML, [fontEdit(shape, 3, '   ')])).toThrow(/must not be empty/)

    // The validation derivation compares the typeface, so an edit whose
    // `original` disagrees with the retained bytes is refused.
    const stale = fontEdit(shape, 1, 'Georgia')
    stale.original = stale.original.map((p) => ({
      ...p,
      runs: p.runs.map((r, i) => (i === 0 ? { ...r, latinFont: 'Helvetica' } : r)),
    }))
    expect(() => updateSlideXml(SLIDE_XML, [stale])).toThrow(/does not match/)
  })

  it('re-parses to the new font after a full save', async () => {
    const { deck, shape } = await loadDeck()
    const out = await writeDeck(
      deck,
      new Map([
        [
          'ppt/slides/slide1.xml',
          [fontEdit(shape, 0, 'Georgia'), fontEdit(shape, 3, 'Courier New')],
        ],
      ]),
    )
    const reparsed = (await parsePptx(out)).slides[0].shapes[0] as TextShape
    expect(reparsed.paragraphs[0].runs.map((r) => r.latinFont)).toEqual([
      'Georgia',
      undefined,
      undefined,
      'Courier New',
    ])
    // And the display cascade picks the new families up for rendering. Run 0
    // keeps its untouched a:cs slot in the stack — only a:latin was edited.
    const display = reparsed.display!.paragraphs[0]
    expect(display.runs[0].latinFont).toBe('Georgia')
    expect(display.runs[0].fontFamily).toBe("'Georgia', 'Tahoma', serif")
    expect(display.runs[3].fontFamily).toBe("'Courier New', monospace")
  })
})
