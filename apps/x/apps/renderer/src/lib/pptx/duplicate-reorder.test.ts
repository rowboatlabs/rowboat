import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parseAddedSlide, parsePptx, relsPathFor } from './parse'
import { writeDeck, type ShapeTextEdit, type SlideEdit } from './serialize'
import { planDuplicateSlide, planNewSlide, readSlideRels } from './add-slide'
import type { TextShape } from './types'

const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const LAYOUT_XML =
  `<p:sldLayout ${NS_P} ${NS_A}><p:cSld><p:spTree>` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="100000" y="200000"/><a:ext cx="3000000" cy="400000"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/></p:txBody></p:sp>' +
  '</p:spTree></p:cSld></p:sldLayout>'

/** Slide N, with one editable text run. */
const SLIDE = (n: number) =>
  `<p:sld ${NS_P} ${NS_A} ${NS_R}><p:cSld><p:spTree>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T${n}"/></p:nvSpPr>` +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>' +
  `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2800"/><a:t>slide ${n}</a:t></a:r></a:p></p:txBody></p:sp>` +
  '</p:spTree></p:cSld></p:sld>'

// Three slides, and a sldIdLst with LITERAL WHITESPACE between elements so
// reordering can be shown not to disturb it.
const SLD_1 = '<p:sldId id="256" r:id="rId2"/>'
const SLD_2 = '<p:sldId id="257" r:id="rId3"/>'
const SLD_3 = '<p:sldId id="258" r:id="rId4"/>'
const PRESENTATION_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<p:presentation ${NS_P} ${NS_R}>` +
  `<p:sldIdLst>\n  ${SLD_1}\n  ${SLD_2}\n  ${SLD_3}\n</p:sldIdLst>` +
  '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="1" cy="2"/></p:presentation>'

const PRESENTATION_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId1" Type="${REL_TYPE}/theme" Target="theme/theme1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_TYPE}/slide" Target="slides/slide1.xml"/>` +
  `<Relationship Id="rId3" Type="${REL_TYPE}/slide" Target="slides/slide2.xml"/>` +
  `<Relationship Id="rId4" Type="${REL_TYPE}/slide" Target="slides/slide3.xml"/>` +
  '</Relationships>'

const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  `<Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/>` +
  `<Override PartName="/ppt/slides/slide2.xml" ContentType="${SLIDE_CT}"/>` +
  `<Override PartName="/ppt/slides/slide3.xml" ContentType="${SLIDE_CT}"/>` +
  '</Types>'

/** Slide 1's rels also carry an image, to prove media is shared not copied. */
const SLIDE1_RELS =
  `<Relationships ${REL_NS}>` +
  `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_TYPE}/image" Target="../media/image1.png"/>` +
  '</Relationships>'
const PLAIN_RELS =
  `<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`

async function buildFixtureZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('ppt/presentation.xml', PRESENTATION_XML)
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
  for (const n of [1, 2, 3]) {
    zip.file(`ppt/slides/slide${n}.xml`, SLIDE(n))
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, n === 1 ? SLIDE1_RELS : PLAIN_RELS)
  }
  zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT_XML)
  zip.file('ppt/media/image1.png', Uint8Array.from([137, 80, 78, 71]))
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

const loadDeck = async () => parsePptx(await buildFixtureZip())

const P1 = 'ppt/slides/slide1.xml'
const P2 = 'ppt/slides/slide2.xml'
const P3 = 'ppt/slides/slide3.xml'

/** A text edit renaming slide 1's run, as the editor would commit it. */
function renameEdit(shape: TextShape, text: string): ShapeTextEdit {
  return {
    kind: 'text',
    nodePath: shape.nodePath,
    original: shape.paragraphs,
    next: [{ srcPara: 0, runs: [{ ...shape.paragraphs[0].runs[0], text, srcPara: 0, srcRun: 0 }] }],
  }
}

describe('duplicate slide', () => {
  it('captures the anchor AS SHOWN, including pending edits, and clones its rels verbatim', async () => {
    const deck = await loadDeck()
    const shape = deck.slides[0].shapes[0] as TextShape

    // Slide 1 has an uncommitted-to-disk text edit at plan time.
    const edits = [renameEdit(shape, 'edited before duplicating')]
    const plan = planDuplicateSlide(
      deck,
      P1,
      { xml: deck.source.slideXml[P1], relsXml: await readSlideRels(deck, P1), edits },
      [],
    )
    expect(plan.path).toBe('ppt/slides/slide4.xml')
    expect(plan.afterPath).toBe(P1)
    // The copy's bytes carry the edit…
    expect(plan.xml).toContain('<a:t>edited before duplicating</a:t>')
    expect(plan.xml).not.toContain('<a:t>slide 1</a:t>')
    // …and the rels are byte-identical to the anchor's, so the image target is
    // shared rather than copied.
    expect(plan.relsXml).toBe(SLIDE1_RELS)
  })

  it('is independent of the original afterwards, in both directions', async () => {
    const deck = await loadDeck()
    const shape = deck.slides[0].shapes[0] as TextShape
    const plan = planDuplicateSlide(
      deck,
      P1,
      { xml: deck.source.slideXml[P1], relsXml: await readSlideRels(deck, P1) },
      [],
    )
    const copy = await parseAddedSlide(deck, plan.path, plan.xml, plan.relsXml)
    const copyShape = copy.shapes[0] as TextShape

    // Edit the ORIGINAL and the COPY differently in one save.
    const out = await writeDeck(
      deck,
      new Map<string, SlideEdit[]>([
        [P1, [renameEdit(shape, 'original changed')]],
        [plan.path, [renameEdit(copyShape, 'copy changed')]],
      ]),
      { addSlides: [plan] },
    )
    const zip = await JSZip.loadAsync(out)
    expect(await zip.files[P1].async('string')).toContain('<a:t>original changed</a:t>')
    expect(await zip.files[plan.path].async('string')).toContain('<a:t>copy changed</a:t>')
    // Neither leaked into the other.
    expect(await zip.files[P1].async('string')).not.toContain('copy changed')
    expect(await zip.files[plan.path].async('string')).not.toContain('original changed')

    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => (s.shapes[0] as TextShape).paragraphs[0].runs[0].text)).toEqual(
      ['original changed', 'copy changed', 'slide 2', 'slide 3'],
    )
  })

  it('duplicates an ADDED slide by copying its synthesized strings', async () => {
    const deck = await loadDeck()
    const added = await planNewSlide(deck, P1, undefined, [])
    const dup = planDuplicateSlide(
      deck,
      added.path,
      { xml: added.xml, relsXml: added.relsXml },
      [added.path],
    )
    expect(dup.xml).toBe(added.xml)
    expect(dup.relsXml).toBe(added.relsXml)
    expect(dup.path).not.toBe(added.path)

    const out = await writeDeck(deck, new Map(), { addSlides: [added, dup] })
    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([P1, added.path, dup.path, P2, P3])
  })

  it('fails closed on a stale anchor edit and on a part-name collision', async () => {
    const deck = await loadDeck()
    const shape = deck.slides[0].shapes[0] as TextShape
    const stale = renameEdit(shape, 'x')
    stale.original = stale.original.map((p) => ({
      ...p,
      runs: p.runs.map((r) => ({ ...r, text: `${r.text}!` })),
    }))
    // The anchor's edits are applied through updateSlideXml, which refuses a
    // mismatch — a duplicate can never capture a half-applied edit.
    expect(() =>
      planDuplicateSlide(deck, P1, { xml: deck.source.slideXml[P1], edits: [stale] }, []),
    ).toThrow(/does not match/)

    const plan = planDuplicateSlide(deck, P1, { xml: deck.source.slideXml[P1] }, [])
    await expect(
      writeDeck(deck, new Map(), { addSlides: [{ ...plan, path: P2 }] }),
    ).rejects.toThrow(/collides/)
    await expect(
      writeDeck(deck, new Map(), { addSlides: [plan], deleteSlides: [P1] }),
    ).rejects.toThrow(/being deleted/)
  })

  it('duplicating a slide with no rels part still produces a valid part', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', CONTENT_TYPES)
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    for (const n of [1, 2, 3]) zip.file(`ppt/slides/slide${n}.xml`, SLIDE(n))
    const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    expect(await readSlideRels(deck, P1)).toBeUndefined()
    const plan = planDuplicateSlide(deck, P1, { xml: deck.source.slideXml[P1] }, [])
    expect(plan.relsXml).toContain('<Relationships')
    const reparsed = await parsePptx(await writeDeck(deck, new Map(), { addSlides: [plan] }))
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([P1, plan.path, P2, P3])
  })
})

describe('slide reorder', () => {
  it('moves sldId element ranges, leaving their bytes and all whitespace intact', async () => {
    const input = await buildFixtureZip()
    const deck = await loadDeck()
    const out = await writeDeck(deck, new Map(), { slideOrder: [P3, P1, P2] })

    const outZip = await JSZip.loadAsync(out)
    const pres = await outZip.files['ppt/presentation.xml'].async('string')

    // Each element keeps its OWN bytes (id and r:id unchanged) — only the
    // sequence differs — and the newlines/indent between slots are untouched.
    expect(pres).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
        `<p:presentation ${NS_P} ${NS_R}>` +
        `<p:sldIdLst>\n  ${SLD_3}\n  ${SLD_1}\n  ${SLD_2}\n</p:sldIdLst>` +
        '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="1" cy="2"/></p:presentation>',
    )

    // Everything else in the package is byte-identical.
    const inZip = await JSZip.loadAsync(input)
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir || name === 'ppt/presentation.xml') continue
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      expect(Buffer.from(a).equals(Buffer.from(b)), `byte-identical: ${name}`).toBe(true)
    }

    // And it reparses in the new order.
    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([P3, P1, P2])
  })

  it('an order equal to document order rewrites nothing', async () => {
    const input = await buildFixtureZip()
    const deck = await loadDeck()
    const out = await writeDeck(deck, new Map(), { slideOrder: [P1, P2, P3] })
    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(out)
    expect(await outZip.files['ppt/presentation.xml'].async('string')).toBe(PRESENTATION_XML)
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir) continue
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      expect(Buffer.from(a).equals(Buffer.from(b)), `byte-identical: ${name}`).toBe(true)
    }
  })

  it('places added slides at their position in the order, including before all base slides', async () => {
    const deck = await loadDeck()
    const plan = await planNewSlide(deck, P1, undefined, [])
    const out = await writeDeck(deck, new Map(), {
      addSlides: [plan],
      slideOrder: [plan.path, P2, P1, P3],
    })
    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([plan.path, P2, P1, P3])
  })

  it('fails closed when the order is not an exact permutation of survivors + adds', async () => {
    const deck = await loadDeck()
    await expect(writeDeck(deck, new Map(), { slideOrder: [P1, P2] })).rejects.toThrow(
      /exact permutation/,
    )
    await expect(
      writeDeck(deck, new Map(), { slideOrder: [P1, P2, P3, 'ppt/slides/slide9.xml'] }),
    ).rejects.toThrow(/exact permutation/)
    await expect(writeDeck(deck, new Map(), { slideOrder: [P1, P2, P2] })).rejects.toThrow(
      /more than once/,
    )
    // A deleted slide must not appear in the order.
    await expect(
      writeDeck(deck, new Map(), { deleteSlides: [P2], slideOrder: [P1, P2, P3] }),
    ).rejects.toThrow(/exact permutation/)
  })
})

describe('composition: delete + duplicate + reorder in one save', () => {
  it('produces a valid deck with every part consistent', async () => {
    const deck = await loadDeck()
    const shape = deck.slides[0].shapes[0] as TextShape

    // Duplicate slide 1 (capturing a pending edit), delete slide 2, and put
    // the copy first — all in a single write.
    const edits = [renameEdit(shape, 'kept and copied')]
    const dup = planDuplicateSlide(
      deck,
      P1,
      { xml: deck.source.slideXml[P1], relsXml: await readSlideRels(deck, P1), edits },
      [],
    )
    const out = await writeDeck(deck, new Map<string, SlideEdit[]>([[P1, edits]]), {
      addSlides: [dup],
      deleteSlides: [P2],
      slideOrder: [dup.path, P3, P1],
    })

    const outZip = await JSZip.loadAsync(out)
    const names = Object.keys(outZip.files).filter((n) => !outZip.files[n].dir)
    // The deleted slide's part and rels are gone; the copy's are present.
    expect(names).not.toContain(P2)
    expect(names).not.toContain(relsPathFor(P2))
    expect(names).toContain(dup.path)
    expect(names).toContain(relsPathFor(dup.path))

    // presentation.xml lists exactly the three survivors, in the new order.
    const pres = await outZip.files['ppt/presentation.xml'].async('string')
    expect(pres).not.toContain(SLD_2)
    // rels and Content_Types agree with the parts on disk.
    const rels = await outZip.files['ppt/_rels/presentation.xml.rels'].async('string')
    expect(rels).not.toContain('Target="slides/slide2.xml"')
    expect(rels).toContain('Target="slides/slide4.xml"')
    const types = await outZip.files['[Content_Types].xml'].async('string')
    expect(types).not.toContain('/ppt/slides/slide2.xml')
    expect(types).toContain(`<Override PartName="/${dup.path}" ContentType="${SLIDE_CT}"/>`)

    // The whole thing reopens as the intended deck.
    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([dup.path, P3, P1])
    expect(
      reparsed.slides.map((s) => (s.shapes[0] as TextShape).paragraphs[0].runs[0].text),
    ).toEqual(['kept and copied', 'slide 3', 'kept and copied'])

    // Media the deleted slide referenced stays (orphans are valid OOXML).
    expect(names).toContain('ppt/media/image1.png')
  })

  it('an empty edit set after all of it restores every original byte (undo)', async () => {
    const input = await buildFixtureZip()
    const deck = await loadDeck()
    const dup = planDuplicateSlide(deck, P1, { xml: deck.source.slideXml[P1] }, [])
    await writeDeck(deck, new Map(), {
      addSlides: [dup],
      deleteSlides: [P2],
      slideOrder: [dup.path, P3, P1],
    })
    // Saves recompute from base bytes + current edits, so undoing to a clean
    // set writes the original package back.
    const restored = await writeDeck(deck, new Map())
    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(restored)
    expect(Object.keys(outZip.files).filter((n) => !outZip.files[n].dir).sort()).toEqual(
      Object.keys(inZip.files).filter((n) => !inZip.files[n].dir).sort(),
    )
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir) continue
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      expect(Buffer.from(a).equals(Buffer.from(b)), `restored: ${name}`).toBe(true)
    }
  })

  it('leaves an unrelated slide edit on the in-place splice path throughout', async () => {
    const deck = await loadDeck()
    const shape3 = deck.slides[2].shapes[0] as TextShape
    const out = await writeDeck(
      deck,
      new Map<string, SlideEdit[]>([[P3, [renameEdit(shape3, 'third')]]]),
      { slideOrder: [P3, P2, P1] },
    )
    const raw = await (await JSZip.loadAsync(out)).files[P3].async('string')
    // Only the a:t content moved; the rPr bytes are untouched.
    expect(raw).toBe(SLIDE(3).replace('<a:t>slide 3</a:t>', '<a:t>third</a:t>'))
  })
})
