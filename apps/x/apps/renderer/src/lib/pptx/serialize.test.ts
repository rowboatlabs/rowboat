import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx, parseXml } from './parse'
import { updateSlideXml, writeDeck, type ShapeTextEdit } from './serialize'
import type { TextShape } from './types'

// Real-PowerPoint-shaped slide: CRLF after the declaration, one line, mixed
// self-closing forms, an undecoded NCR (&#8217;), entities in attributes and
// in a second (never-edited) shape, xml:space, endParaRPr, and a fld.
const SLIDE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<p:cSld><p:spTree>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Bob&apos;s &amp; Co"/></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="100" cy="200"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/>' +
  '<a:p><a:pPr algn="ctr"/>' +
  '<a:r><a:rPr lang="en-US" b="1" sz="2800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Hello</a:t></a:r>' +
  '<a:r><a:rPr lang="en-US" i="1"/><a:t>It&#8217;s</a:t></a:r>' +
  '<a:br/>' +
  '<a:r><a:t xml:space="preserve"> tail </a:t></a:r>' +
  '<a:endParaRPr lang="en-US" dirty="0"/>' +
  '</a:p></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr/>' +
  '<a:p><a:fld id="{X}" type="slidenum"><a:t>7</a:t></a:fld>' +
  '<a:r><a:t>A &amp; B &lt;kept&gt;</a:t></a:r></a:p>' +
  '</p:txBody></p:sp>' +
  '</p:spTree></p:cSld></p:sld>'

const PRESENTATION_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
  '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'

const PRESENTATION_RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
  '</Relationships>'

/** Bytes 0..255, twice — a binary part that must survive untouched. */
const BLOB_BYTES = Uint8Array.from({ length: 512 }, (_, i) => i % 256)

const CORE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  '<cp:coreProperties xmlns:cp="http://c"><dc:title xmlns:dc="http://d">A &amp; B</dc:title></cp:coreProperties>'

async function buildFixtureZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', PRESENTATION_XML)
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
  zip.file('ppt/slides/slide1.xml', SLIDE_XML)
  zip.file('ppt/media/blob.bin', BLOB_BYTES)
  zip.file('docProps/core.xml', CORE_XML)
  return zip.generateAsync({ type: 'uint8array' })
}

async function loadDeck() {
  const deck = await parsePptx(await buildFixtureZip())
  const slide = deck.slides[0]
  const title = slide.shapes[0] as TextShape
  const notes = slide.shapes[1] as TextShape
  return { deck, slide, title, notes }
}

/** A text-only edit: same structure/props, one run's text replaced. */
function textOnlyEdit(title: TextShape, newText: string): ShapeTextEdit {
  return {
    nodePath: title.nodePath,
    original: title.paragraphs,
    next: title.paragraphs.map((p) => ({
      align: p.align,
      runs: p.runs.map((r, ri) => (ri === 0 && r.text === 'Hello' ? { ...r, text: newText } : { ...r })),
      srcPara: 0,
    })),
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

describe('updateSlideXml round-trip contract', () => {
  it('returns the exact input bytes for zero edits', () => {
    const out = updateSlideXml(SLIDE_XML, [])
    expect(out).toBe(SLIDE_XML)
    expect(parseXml(out)).toEqual(parseXml(SLIDE_XML))
  })

  it('a text-only edit changes exactly the targeted <a:t> content and nothing else', async () => {
    const { title } = await loadDeck()
    const out = updateSlideXml(SLIDE_XML, [textOnlyEdit(title, 'Hi & <bye> "q" \'z\'')])
    // Everything outside the one a:t is untouched: the expected output is the
    // input with a single substring replaced.
    const expected = SLIDE_XML.replace(
      '<a:t>Hello</a:t>',
      '<a:t>Hi &amp; &lt;bye&gt; "q" \'z\'</a:t>',
    )
    expect(out).toBe(expected)
    // The evidence trail: CRLF after the declaration, the NCR in the adjacent
    // run, attribute entities, and the fld all survive byte-identically.
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n')).toBe(true)
    expect(out).toContain('<a:t>It&#8217;s</a:t>')
    expect(out).toContain('name="Bob&apos;s &amp; Co"')
    expect(out).toContain('<a:fld id="{X}" type="slidenum"><a:t>7</a:t></a:fld>')
  })

  it('refuses to write when the edit original does not match the slide XML', async () => {
    const { title } = await loadDeck()
    const edit = textOnlyEdit(title, 'x')
    edit.original = edit.original.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, text: r.text + '!' })) }))
    expect(() => updateSlideXml(SLIDE_XML, [edit])).toThrow(/does not match/)
  })

  it('refuses a nodePath that is not a text shape and an empty next', async () => {
    const { title } = await loadDeck()
    const bad = { ...textOnlyEdit(title, 'x'), nodePath: [...title.nodePath.slice(0, -1), 0] }
    // Index 0 in spTree children is a whitespace-free doc, so 0 is the first
    // shape itself here; point at a guaranteed non-sp node instead: the pPr
    // path inside the shape.
    bad.nodePath = [...title.nodePath, 0]
    expect(() => updateSlideXml(SLIDE_XML, [bad])).toThrow(/pptx write-back/)
    expect(() => updateSlideXml(SLIDE_XML, [{ ...textOnlyEdit(title, 'x'), next: [] }])).toThrow(
      /at least one paragraph/,
    )
  })
})

describe('updateSlideXml structural rebuild', () => {
  it('splits a paragraph, preserving pPr/rPr/NCR bytes and adding xml:space where needed', async () => {
    const { title } = await loadDeck()
    const orig = title.paragraphs[0]
    const edit: ShapeTextEdit = {
      nodePath: title.nodePath,
      original: title.paragraphs,
      next: [
        {
          align: orig.align,
          srcPara: 0,
          runs: [{ ...orig.runs[0], srcPara: 0, srcRun: 0 }], // 'Hello' unchanged
        },
        {
          align: orig.align,
          srcPara: 0,
          runs: [
            { ...orig.runs[1], srcPara: 0, srcRun: 1 }, // NCR run, unchanged text
            { text: '\n' }, // new break, no provenance
            { text: ' spaced ' }, // new run, no provenance
          ],
        },
      ],
    }
    const out = updateSlideXml(SLIDE_XML, [edit])

    // Both halves reuse the original pPr and endParaRPr bytes.
    expect(out.match(/<a:pPr algn="ctr"\/>/g)).toHaveLength(2)
    expect(out.match(/<a:endParaRPr lang="en-US" dirty="0"\/>/g)).toHaveLength(2)
    // The unchanged NCR run is copied verbatim — the entity byte form survives.
    expect(out).toContain('<a:r><a:rPr lang="en-US" i="1"/><a:t>It&#8217;s</a:t></a:r>')
    // The new break and the new run with edge whitespace.
    expect(out).toContain('<a:br/>')
    expect(out).toContain('<a:t xml:space="preserve"> spaced </a:t>')
    // The dropped runs (original br + ' tail ') are gone.
    expect(out).not.toContain('<a:t xml:space="preserve"> tail </a:t>')
    // Outside the txBody nothing moved.
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n')).toBe(true)
    expect(out).toContain('<a:t>A &amp; B &lt;kept&gt;</a:t>')

    // And the result re-parses into the intended model.
    const zip = new JSZip()
    const src = await JSZip.loadAsync(await buildFixtureZip())
    for (const [name, entry] of Object.entries(src.files)) {
      if (!entry.dir) zip.file(name, await entry.async('uint8array'))
    }
    zip.file('ppt/slides/slide1.xml', out)
    const deck2 = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    const shape2 = deck2.slides[0].shapes[0] as TextShape
    expect(shape2.paragraphs.map((p) => p.runs.map((r) => r.text))).toEqual([
      ['Hello'],
      ['It&#8217;s', '\n', ' spaced '],
    ])
    expect(shape2.paragraphs[0].runs[0].bold).toBe(true)
  })
})

describe('writeDeck', () => {
  it('copies every unedited entry byte-for-byte and rewrites only edited slides', async () => {
    const input = await buildFixtureZip()
    const { deck, title } = await loadDeck()
    const out = await writeDeck(
      deck,
      new Map([['ppt/slides/slide1.xml', [textOnlyEdit(title, 'Changed')]]]),
    )

    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(out)
    const inNames = Object.keys(inZip.files).filter((n) => !inZip.files[n].dir).sort()
    const outNames = Object.keys(outZip.files).filter((n) => !outZip.files[n].dir).sort()
    expect(outNames).toEqual(inNames)

    for (const name of inNames) {
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      if (name === 'ppt/slides/slide1.xml') {
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
      } else {
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
      }
    }
    expect(await outZip.files['ppt/slides/slide1.xml'].async('string')).toContain(
      '<a:t>Changed</a:t>',
    )
  })

  it('escapes user text and round-trips emoji and Devanagari through a full save', async () => {
    const wild = 'A & B < C > "D" \'E\' 🚀 नमस्ते'
    const { deck, title } = await loadDeck()
    const out = await writeDeck(
      deck,
      new Map([['ppt/slides/slide1.xml', [textOnlyEdit(title, wild)]]]),
    )

    const raw = await (await JSZip.loadAsync(out)).files['ppt/slides/slide1.xml'].async('string')
    expect(raw).toContain('<a:t>A &amp; B &lt; C &gt; "D" \'E\' 🚀 नमस्ते</a:t>')

    const deck2 = await parsePptx(out)
    const shape2 = deck2.slides[0].shapes[0] as TextShape
    expect(shape2.paragraphs[0].runs[0].text).toBe(wild)
  })

  it('rejects edits that reference a slide the deck does not contain', async () => {
    const { deck, title } = await loadDeck()
    await expect(
      writeDeck(deck, new Map([['ppt/slides/slide9.xml', [textOnlyEdit(title, 'x')]]])),
    ).rejects.toThrow(/unknown slide/)
  })
})
