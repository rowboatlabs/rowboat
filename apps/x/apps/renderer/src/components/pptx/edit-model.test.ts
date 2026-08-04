import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx } from '@/lib/pptx/parse'
import { updateSlideXml, writeDeck, type EditedParagraph } from '@/lib/pptx/serialize'
import type { Paragraph, TextShape } from '@/lib/pptx/types'
import { buildEditableHtml, extractParagraphs } from './text-dom'
import {
  EMPTY_DECK_EDITS,
  acceptsFormatting,
  applyEditSet,
  renderedSlidePaths,
  withSlideAdded,
  withSlideOrder,
  withSlideRemoved,
  effectiveParagraphs,
  isNoopCommit,
  shapeKeyOf,
  structureMatches,
  toSlideEdits,
  withShapeEdit,
  type AddedSlide,
  type DeckEdits,
  type EditSet,
  type ShapeEdit,
} from './edit-model'

const PRES =
  '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
  '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'
const RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

/** Two paragraphs with DIFFERENT pPr bytes, so reusing the wrong one shows. */
const TWO_PARA_SLIDE =
  '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/>' +
  '<a:p><a:pPr algn="ctr"><a:buChar char="H"/></a:pPr><a:r><a:t>heading</a:t></a:r></a:p>' +
  '<a:p><a:pPr algn="r"><a:buChar char="B"/></a:pPr><a:r><a:t>body</a:t></a:r></a:p>' +
  '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>'

/** One run carrying an explicit rPr — the near-universal real-deck shape. */
const STYLED_SLIDE =
  '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/>' +
  '<a:p><a:r><a:rPr sz="2800" b="1"/><a:t>Hello</a:t></a:r></a:p>' +
  '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>'

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

type CommitDeltaCase = { textChanged: boolean; formatCount: number; alignCount: number }

async function loadSlide(xml: string) {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', PRES)
  zip.file('ppt/_rels/presentation.xml.rels', RELS)
  zip.file('ppt/slides/slide1.xml', xml)
  const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
  return { deck, slide: deck.slides[0], shape: deck.slides[0].shapes[0] as TextShape }
}

const TWO_SLIDE_PRES =
  '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>' +
  '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>' +
  '<p:sldSz cx="12192000" cy="6858000"/></p:presentation>'
const TWO_SLIDE_RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
  '</Relationships>'

async function loadTwoSlides() {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', TWO_SLIDE_PRES)
  zip.file('ppt/_rels/presentation.xml.rels', TWO_SLIDE_RELS)
  zip.file('ppt/slides/slide1.xml', STYLED_SLIDE)
  zip.file('ppt/slides/slide2.xml', TWO_PARA_SLIDE)
  return parsePptx(await zip.generateAsync({ type: 'uint8array' }))
}

describe('paragraph provenance survives rendering', () => {
  it('effectiveParagraphs keeps srcPara, not just run-level provenance', () => {
    const base: Paragraph[] = [{ align: 'ctr', runs: [{ text: 'a' }] }, { runs: [{ text: 'b' }] }]
    const text: EditedParagraph[] = [{ srcPara: 1, runs: [{ text: 'b', srcPara: 1, srcRun: 0 }] }]
    const out = effectiveParagraphs({ slidePath: 's', nodePath: [0], text }, base)
    expect((out[0] as EditedParagraph).srcPara).toBe(1)
    expect((out[0].runs[0] as { srcPara?: number }).srcPara).toBe(1)
  })

  it('a SECOND edit after a structural one still reuses the surviving pPr bytes', async () => {
    const { deck, slide, shape } = await loadSlide(TWO_PARA_SLIDE)
    const original = shape.paragraphs

    // Edit 1 (structural): delete paragraph 0, keeping paragraph 1.
    const first: EditedParagraph[] = [
      { align: original[1].align, srcPara: 1, runs: [{ text: 'body', srcPara: 1, srcRun: 0 }] },
    ]
    expect(updateSlideXml(TWO_PARA_SLIDE, [
      { kind: 'text', nodePath: shape.nodePath, original, next: first },
    ])).toContain('<a:buChar char="B"/>')

    // Render the edited deck, then re-open the box exactly as the editor does.
    const edits: EditSet = {
      [shapeKeyOf(slide.xmlPath, shape.nodePath)]: {
        slidePath: slide.xmlPath,
        nodePath: shape.nodePath,
        original,
        text: first,
      },
    }
    const rendered = applyEditSet(deck, { shapes: edits, deletedSlides: [], addedSlides: [] }).slides[0]
      .shapes[0] as TextShape
    const host = document.createElement('div')
    host.innerHTML = buildEditableHtml(rendered, 1)
    const reopened = extractParagraphs(host, rendered, 1)

    // The overlay must stamp the ORIGINAL paragraph index, not the position.
    expect(reopened.map((p) => p.srcPara)).toEqual([1])

    // Edit 2: retype the text; the write must still land on paragraph 1's pPr.
    const second: EditedParagraph[] = reopened.map((p) => ({
      align: p.srcPara !== undefined ? original[p.srcPara]?.align : p.align,
      srcPara: p.srcPara,
      runs: p.runs.map((r) => ({ text: 'body edited', srcPara: r.srcPara, srcRun: r.srcRun })),
    }))
    const out = updateSlideXml(TWO_PARA_SLIDE, [
      { kind: 'text', nodePath: shape.nodePath, original, next: second },
    ])
    expect(out).toContain('<a:buChar char="B"/>')
    expect(out).toContain('algn="r"')
    expect(out).not.toContain('<a:buChar char="H"/>')
  })
})

describe('deletion in the edit set', () => {
  it('a deleted shape leaves the render and toSlideEdits emits its validation payload', async () => {
    const deck = await loadTwoSlides()
    const slide1 = deck.slides[0]
    const shape = slide1.shapes[0] as TextShape
    const key = shapeKeyOf(slide1.xmlPath, shape.nodePath)

    const shapes = withShapeEdit(
      {},
      key,
      { slidePath: slide1.xmlPath, nodePath: shape.nodePath, original: shape.paragraphs },
      (draft) => {
        draft.deleted = { shapeType: shape.type, shapeId: shape.id }
      },
    )
    const edits: DeckEdits = { shapes, deletedSlides: [], addedSlides: [] }

    const rendered = applyEditSet(deck, edits)
    expect(rendered.slides[0].shapes).toHaveLength(0)
    // The untouched slide keeps its identity, so its thumbnail never re-renders.
    expect(rendered.slides[1]).toBe(deck.slides[1])

    const emitted = toSlideEdits(shapes).get(slide1.xmlPath)
    expect(emitted).toEqual([
      {
        kind: 'deleteShape',
        nodePath: shape.nodePath,
        shapeType: 'text',
        shapeId: shape.id,
        original: shape.paragraphs,
      },
    ])

    // The whole pipeline holds: the emitted edit deletes cleanly.
    expect(updateSlideXml(STYLED_SLIDE, emitted!)).not.toContain('<a:t>Hello</a:t>')
  })

  it('a deleted slide leaves the render, and undo restores shape and slide alike', async () => {
    const deck = await loadTwoSlides()
    const edits: DeckEdits = { shapes: {}, deletedSlides: ['ppt/slides/slide2.xml'], addedSlides: [] }

    const rendered = applyEditSet(deck, edits)
    expect(rendered.slides.map((s) => s.xmlPath)).toEqual(['ppt/slides/slide1.xml'])
    expect(rendered.slides[0]).toBe(deck.slides[0])

    // Undo re-renders from the prior snapshot; the empty set IS the base deck,
    // so both the slide and any deleted shapes are back, identity intact.
    expect(applyEditSet(deck, EMPTY_DECK_EDITS)).toBe(deck)
  })
})

describe('added slides in the edit set', () => {
  const fakeAdded = (path: string, afterPath: string): AddedSlide => ({
    path,
    afterPath,
    xml: '<p:sld/>',
    relsXml: '<Relationships/>',
    slide: { id: path, xmlPath: path, shapes: [] },
  })

  it('renders added slides after their anchors, chains included, undo restores', async () => {
    const deck = await loadTwoSlides()
    const a = fakeAdded('ppt/slides/slide3.xml', 'ppt/slides/slide1.xml')
    const b = fakeAdded('ppt/slides/slide4.xml', a.path)
    const edits: DeckEdits = { shapes: {}, deletedSlides: [], addedSlides: [a, b] }

    const rendered = applyEditSet(deck, edits)
    expect(rendered.slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide3.xml',
      'ppt/slides/slide4.xml',
      'ppt/slides/slide2.xml',
    ])
    // Base slides keep identity; the added slide IS the pre-parsed object.
    expect(rendered.slides[0]).toBe(deck.slides[0])
    expect(rendered.slides[1]).toBe(a.slide)

    // Undo: the prior snapshot renders the base deck by identity.
    expect(applyEditSet(deck, EMPTY_DECK_EDITS)).toBe(deck)
  })

  it("withSlideRemoved drops an added slide and re-anchors what followed it", async () => {
    const deck = await loadTwoSlides()
    const a = fakeAdded('ppt/slides/slide3.xml', 'ppt/slides/slide1.xml')
    const b = fakeAdded('ppt/slides/slide4.xml', a.path)
    const edits: DeckEdits = { shapes: {}, deletedSlides: [], addedSlides: [a, b] }

    // Removing the ADDED slide A: no deletedSlides entry (it never existed in
    // the file); B re-anchors to A's own anchor and keeps its place.
    const next = withSlideRemoved(edits, a.path, 'ppt/slides/slide1.xml')
    expect(next.deletedSlides).toEqual([])
    expect(next.addedSlides.map((x) => [x.path, x.afterPath])).toEqual([
      ['ppt/slides/slide4.xml', 'ppt/slides/slide1.xml'],
    ])
    expect(applyEditSet(deck, next).slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide4.xml',
      'ppt/slides/slide2.xml',
    ])

    // Removing a BASE slide records the deletion and re-anchors its additions.
    const afterBase = withSlideRemoved(next, 'ppt/slides/slide1.xml', '')
    expect(afterBase.deletedSlides).toEqual(['ppt/slides/slide1.xml'])
    expect(applyEditSet(deck, afterBase).slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide4.xml',
      'ppt/slides/slide2.xml',
    ])
  })
})

describe('explicit slide order', () => {
  const fakeAdd = (path: string, afterPath: string): AddedSlide => ({
    path,
    afterPath,
    xml: '<p:sld/>',
    relsXml: '<Relationships/>',
    slide: { id: path, xmlPath: path, shapes: [] },
  })

  it('governs the render, keeps slide identity, and undo returns the prior rendering', async () => {
    const deck = await loadTwoSlides()
    const reordered = withSlideOrder(EMPTY_DECK_EDITS, [
      'ppt/slides/slide2.xml',
      'ppt/slides/slide1.xml',
    ])
    const rendered = applyEditSet(deck, reordered)
    expect(rendered.slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide2.xml',
      'ppt/slides/slide1.xml',
    ])
    // Reordering moves slides, it does not rebuild them.
    expect(rendered.slides[0]).toBe(deck.slides[1])
    expect(rendered.slides[1]).toBe(deck.slides[0])
    // Undo: the prior snapshot is the base deck, by identity.
    expect(applyEditSet(deck, EMPTY_DECK_EDITS)).toBe(deck)
  })

  it('renderedSlidePaths matches what applyEditSet renders', async () => {
    const deck = await loadTwoSlides()
    const a = fakeAdd('ppt/slides/slide3.xml', 'ppt/slides/slide1.xml')
    const edits = withSlideOrder({ ...EMPTY_DECK_EDITS, addedSlides: [a] }, [
      a.path,
      'ppt/slides/slide2.xml',
      'ppt/slides/slide1.xml',
    ])
    expect(renderedSlidePaths(deck, edits)).toEqual(
      applyEditSet(deck, edits).slides.map((s) => s.xmlPath),
    )
    expect(renderedSlidePaths(deck, edits)).toEqual([
      a.path,
      'ppt/slides/slide2.xml',
      'ppt/slides/slide1.xml',
    ])
  })

  it('an add lands after its anchor inside an existing order; a removal prunes it', async () => {
    const deck = await loadTwoSlides()
    const ordered = withSlideOrder(EMPTY_DECK_EDITS, [
      'ppt/slides/slide2.xml',
      'ppt/slides/slide1.xml',
    ])
    const a = fakeAdd('ppt/slides/slide3.xml', 'ppt/slides/slide2.xml')
    const added = withSlideAdded(ordered, a)
    expect(added.slideOrder).toEqual([
      'ppt/slides/slide2.xml',
      a.path,
      'ppt/slides/slide1.xml',
    ])

    // Removing a slide keeps the order an exact permutation of what survives.
    const removed = withSlideRemoved(added, 'ppt/slides/slide2.xml', '')
    expect(removed.slideOrder).toEqual([a.path, 'ppt/slides/slide1.xml'])
    expect(applyEditSet(deck, removed).slides.map((s) => s.xmlPath)).toEqual([
      a.path,
      'ppt/slides/slide1.xml',
    ])
  })

  it('a stale order never drops a slide from the editor', async () => {
    const deck = await loadTwoSlides()
    // An order that forgot slide2 and names a slide that no longer exists.
    const edits = withSlideOrder(EMPTY_DECK_EDITS, ['ppt/slides/slide9.xml', 'ppt/slides/slide1.xml'])
    expect(applyEditSet(deck, edits).slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
    ])
  })
})

describe('retyping the original text reverts the edit', () => {
  it('isNoopCommit only skips when there is no accumulated edit to clear', () => {
    const clean: CommitDeltaCase = { textChanged: false, formatCount: 0, alignCount: 0 }
    const withText: ShapeEdit = {
      slidePath: 's',
      nodePath: [0],
      text: [{ srcPara: 0, runs: [{ text: 'edited' }] }],
    }
    // Nothing accumulated and nothing changed -> genuinely a no-op.
    expect(isNoopCommit(undefined, clean)).toBe(true)
    // A prior text edit is still recorded -> this commit is a REVERT.
    expect(isNoopCommit(withText, clean)).toBe(false)
    // Prior formatting likewise must be cleared.
    expect(isNoopCommit({ slidePath: 's', nodePath: [0], formats: { '0:0': { bold: true } } }, clean)).toBe(false)
    // Any real change always commits.
    expect(isNoopCommit(undefined, { ...clean, textChanged: true })).toBe(false)
  })

  it('edit -> save -> retype original -> save writes byte-identical slide XML', async () => {
    const { deck, slide, shape } = await loadSlide(STYLED_SLIDE)
    const key = shapeKeyOf(slide.xmlPath, shape.nodePath)
    const original = shape.paragraphs
    const seed = { slidePath: slide.xmlPath, nodePath: shape.nodePath, original }

    // 1. Edit the text and save — the slide really is rewritten.
    const edited: EditedParagraph[] = [
      { align: original[0].align, srcPara: 0, runs: [{ ...original[0].runs[0], text: 'Changed', srcPara: 0, srcRun: 0 }] },
    ]
    let edits = withShapeEdit({}, key, seed, (d) => {
      d.original = original
      d.text = edited
    })
    const afterEdit = await writeDeck(deck, toSlideEdits(edits))
    const editedXml = await (await JSZip.loadAsync(afterEdit)).files[slide.xmlPath].async('string')
    expect(editedXml).not.toBe(STYLED_SLIDE)
    expect(editedXml).toContain('<a:t>Changed</a:t>')

    // 2. Retype the original wording. Nothing differs from the original file,
    //    but the accumulated text edit still has to be cleared.
    const previous = edits[key]
    expect(isNoopCommit(previous, { textChanged: false, formatCount: 0, alignCount: 0 })).toBe(false)
    edits = withShapeEdit(edits, key, seed, (d) => {
      d.original = original
      d.text = undefined // what handleTextCommit assigns when nothing changed
    })

    // The shape's entry is gone entirely, so the slide is not touched at all.
    expect(edits[key]).toBeUndefined()
    expect(toSlideEdits(edits).size).toBe(0)

    // 3. Save again — byte-identical to the original slide XML.
    const afterRevert = await writeDeck(deck, toSlideEdits(edits))
    const revertedXml = await (await JSZip.loadAsync(afterRevert)).files[slide.xmlPath].async('string')
    expect(revertedXml).toBe(STYLED_SLIDE)
  })
})

describe('structureMatches agrees with the serializer', () => {
  it('stays true for an in-place text edit, so formatting remains addressable', async () => {
    const { shape } = await loadSlide(STYLED_SLIDE)
    const original = shape.paragraphs
    // What handleTextCommit builds: provenance intact, ORIGINAL props copied.
    const next: EditedParagraph[] = [
      {
        align: original[0].align,
        srcPara: 0,
        runs: [{ ...original[0].runs[0], text: 'Goodbye', srcPara: 0, srcRun: 0 }],
      },
    ]
    expect(structureMatches(original, next)).toBe(true)
    expect(acceptsFormatting({ slidePath: 's', nodePath: shape.nodePath, original, text: next })).toBe(true)
    // Both edits together must still write cleanly.
    expect(() =>
      updateSlideXml(STYLED_SLIDE, [
        { kind: 'text', nodePath: shape.nodePath, original, next },
        { kind: 'formatRuns', nodePath: shape.nodePath, original, targets: [{ para: 0, run: 0 }], set: { bold: false } },
      ]),
    ).not.toThrow()
  })

  it('goes false when a run loses provenance, so formats are never co-emitted', async () => {
    const { shape } = await loadSlide(STYLED_SLIDE)
    const original = shape.paragraphs
    // Paste destroys the styled span: same run count, but no provenance, so
    // handleTextCommit stamps every property undefined.
    const next: EditedParagraph[] = [
      { align: original[0].align, srcPara: 0, runs: [{ text: 'Pasted' }] },
    ]
    // Structure is superficially intact, but the serializer must rebuild —
    // so the editor has to agree and drop formatting for this shape.
    expect(structureMatches(original, next)).toBe(false)
    expect(acceptsFormatting({ slidePath: 's', nodePath: shape.nodePath, original, text: next })).toBe(false)

    // The rebuild alone writes cleanly and preserves the original rPr bytes.
    const out = updateSlideXml(STYLED_SLIDE, [
      { kind: 'text', nodePath: shape.nodePath, original, next },
    ])
    expect(out).toContain('<a:rPr sz="2800" b="1"/>')
    expect(out).toContain('<a:t>Pasted</a:t>')
  })
})
