import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { attr, childByLocal, childrenByLocal, childrenOf, parseAddedSlide, parsePptx, parseXml, resolveRelTarget } from '@x/shared/dist/pptx/parse.js'
import { writeDeck } from '@x/shared/dist/pptx/serialize.js'
import { planNewSlide } from '@x/shared/dist/pptx/add-slide.js'
import {
  EMPTY_DECK_EDITS,
  shapeKeyOf,
  toSlideEdits,
  withSlideAdded,
  type DeckEdits,
} from '@/components/pptx/edit-model'
import {
  BODY_LAYOUT_RECTS,
  DECK_PALETTES,
  newDeckParts,
  newDeckPptx,
  SLIDE_SIZE_EMU,
  TITLE_LAYOUT_RECTS,
  upgradeGeneratedDeck,
} from '@x/shared/dist/pptx/new-deck.js'
import type { TextShape } from '@x/shared/dist/pptx/types.js'

const NAVY = DECK_PALETTES[0]
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

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

// -------------------------------------------------- structural validation

/** Directory a rels part's targets resolve against: the `_rels` dir's parent. */
function relsOwnerDir(relsPath: string): string {
  const dir = relsPath.slice(0, relsPath.lastIndexOf('/'))
  return dir.endsWith('_rels') ? dir.slice(0, -'_rels'.length).replace(/\/$/, '') : dir
}

interface Rel {
  id: string
  type: string
  /** Target resolved to a package path. */
  target: string
}

function relsOf(parts: Map<string, string>, relsPath: string): Rel[] {
  const xml = parts.get(relsPath)
  expect(xml, `missing rels part ${relsPath}`).toBeDefined()
  const root = childByLocal(parseXml(xml!), 'Relationships')
  expect(root, `no <Relationships> in ${relsPath}`).toBeDefined()
  const baseDir = relsOwnerDir(relsPath)
  return childrenByLocal(childrenOf(root!), 'Relationship').map((rel) => ({
    id: attr(rel, 'Id') ?? '',
    type: attr(rel, 'Type') ?? '',
    target: resolveRelTarget(baseDir, attr(rel, 'Target') ?? ''),
  }))
}

/**
 * The OPC-level consistency the task demands: every Override typed and
 * pointing at a real part, every relationship target present in the package,
 * and the presentation -> master -> layout / theme id chains agreeing.
 */
function validatePackage(parts: Map<string, string>): void {
  // --- [Content_Types].xml: Defaults + one typed Override per XML part.
  const typesRoot = childByLocal(parseXml(parts.get('[Content_Types].xml')!), 'Types')
  expect(typesRoot).toBeDefined()
  const defaults = new Map(
    childrenByLocal(childrenOf(typesRoot!), 'Default').map((d) => [
      attr(d, 'Extension'),
      attr(d, 'ContentType'),
    ]),
  )
  const overrides = new Map(
    childrenByLocal(childrenOf(typesRoot!), 'Override').map((o) => [
      attr(o, 'PartName'),
      attr(o, 'ContentType'),
    ]),
  )
  expect(defaults.get('rels')).toBe('application/vnd.openxmlformats-package.relationships+xml')
  expect(defaults.get('xml')).toBe('application/xml')

  // Every Override names an existing part and carries a non-empty type.
  for (const [partName, contentType] of overrides) {
    expect(partName?.startsWith('/'), `Override PartName ${partName} must be absolute`).toBe(true)
    expect(parts.has(partName!.slice(1)), `Override target ${partName} missing`).toBe(true)
    expect(contentType, `untyped Override for ${partName}`).toBeTruthy()
  }

  // Every part is covered by a Default or an Override; the core PPTX parts
  // must carry their exact content type.
  const expectedTypes: Record<string, string> = {
    'ppt/presentation.xml':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    'ppt/slideMasters/slideMaster1.xml':
      'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
    'ppt/slideLayouts/slideLayout1.xml':
      'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
    'ppt/slideLayouts/slideLayout2.xml':
      'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
    'ppt/slides/slide1.xml':
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
    'ppt/theme/theme1.xml': 'application/vnd.openxmlformats-officedocument.theme+xml',
    'ppt/presProps.xml':
      'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
    'ppt/viewProps.xml':
      'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
    'ppt/tableStyles.xml':
      'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
    'docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
    'docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  }
  for (const [part, contentType] of Object.entries(expectedTypes)) {
    expect(overrides.get(`/${part}`), `Override for /${part}`).toBe(contentType)
  }
  for (const path of parts.keys()) {
    if (path === '[Content_Types].xml') continue
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const covered = overrides.has(`/${path}`) || defaults.has(ext)
    expect(covered, `part ${path} has no content type`).toBe(true)
  }

  // --- every relationship target exists in the package.
  for (const path of parts.keys()) {
    if (!path.endsWith('.rels')) continue
    for (const rel of relsOf(parts, path)) {
      expect(rel.id).toMatch(/^rId\d+$/)
      expect(parts.has(rel.target), `${path}: dangling target ${rel.target}`).toBe(true)
    }
  }

  // --- package root points at the presentation and both docProps parts.
  const rootRels = relsOf(parts, '_rels/.rels')
  expect(rootRels.find((r) => r.type === `${REL_TYPE}/officeDocument`)?.target).toBe(
    'ppt/presentation.xml',
  )

  // --- presentation.xml id lists resolve through its rels.
  const presRels = relsOf(parts, 'ppt/_rels/presentation.xml.rels')
  const presRelById = new Map(presRels.map((r) => [r.id, r]))
  const pres = childByLocal(parseXml(parts.get('ppt/presentation.xml')!), 'presentation')
  expect(pres).toBeDefined()
  const masterIds = childrenByLocal(
    childrenOf(childByLocal(childrenOf(pres!), 'sldMasterIdLst')!),
    'sldMasterId',
  )
  expect(masterIds).toHaveLength(1)
  expect(Number(attr(masterIds[0], 'id'))).toBeGreaterThanOrEqual(2147483648)
  const masterRel = presRelById.get(attr(masterIds[0], 'r:id') ?? '')
  expect(masterRel?.type).toBe(`${REL_TYPE}/slideMaster`)
  expect(masterRel?.target).toBe('ppt/slideMasters/slideMaster1.xml')

  const sldIds = childrenByLocal(
    childrenOf(childByLocal(childrenOf(pres!), 'sldIdLst')!),
    'sldId',
  )
  expect(sldIds).toHaveLength(1)
  const sldIdNum = Number(attr(sldIds[0], 'id'))
  expect(sldIdNum).toBeGreaterThanOrEqual(256)
  expect(sldIdNum).toBeLessThan(2147483648)
  const slideRel = presRelById.get(attr(sldIds[0], 'r:id') ?? '')
  expect(slideRel?.type).toBe(`${REL_TYPE}/slide`)
  expect(slideRel?.target).toBe('ppt/slides/slide1.xml')

  // --- master -> layouts and theme; layouts -> master; slide -> layout.
  const masterRels = relsOf(parts, 'ppt/slideMasters/_rels/slideMaster1.xml.rels')
  const masterRelById = new Map(masterRels.map((r) => [r.id, r]))
  const master = childByLocal(parseXml(parts.get('ppt/slideMasters/slideMaster1.xml')!), 'sldMaster')
  const layoutIds = childrenByLocal(
    childrenOf(childByLocal(childrenOf(master!), 'sldLayoutIdLst')!),
    'sldLayoutId',
  )
  expect(layoutIds).toHaveLength(2)
  const layoutTargets = layoutIds.map((lid) => {
    const idNum = Number(attr(lid, 'id'))
    expect(idNum).toBeGreaterThanOrEqual(2147483648)
    const rel = masterRelById.get(attr(lid, 'r:id') ?? '')
    expect(rel?.type).toBe(`${REL_TYPE}/slideLayout`)
    return rel!.target
  })
  expect(new Set(layoutIds.map((lid) => attr(lid, 'id'))).size).toBe(2)
  expect(layoutTargets).toEqual([
    'ppt/slideLayouts/slideLayout1.xml',
    'ppt/slideLayouts/slideLayout2.xml',
  ])
  expect(masterRels.find((r) => r.type === `${REL_TYPE}/theme`)?.target).toBe(
    'ppt/theme/theme1.xml',
  )

  for (const layout of ['slideLayout1', 'slideLayout2']) {
    const rels = relsOf(parts, `ppt/slideLayouts/_rels/${layout}.xml.rels`)
    expect(rels.find((r) => r.type === `${REL_TYPE}/slideMaster`)?.target).toBe(
      'ppt/slideMasters/slideMaster1.xml',
    )
  }
  const slideRels = relsOf(parts, 'ppt/slides/_rels/slide1.xml.rels')
  expect(slideRels.find((r) => r.type === `${REL_TYPE}/slideLayout`)?.target).toBe(
    'ppt/slideLayouts/slideLayout1.xml',
  )
}

// ------------------------------------------------------------------- tests

describe('newDeckParts package structure', () => {
  for (const palette of DECK_PALETTES) {
    it(`is structurally consistent OOXML for the ${palette.id} palette`, () => {
      const parts = newDeckParts({
        title: 'T',
        palette,
        createdAt: '2026-08-07T00:00:00.000Z',
      })
      // Every part parses as XML.
      for (const [path, xml] of parts) {
        expect(parseXml(xml).length, `unparseable part ${path}`).toBeGreaterThan(0)
      }
      validatePackage(parts)

      // The whole palette lands in theme1.xml — and nowhere else — so a later
      // "change theme" can retarget one part.
      const theme = parts.get('ppt/theme/theme1.xml')!
      for (const [slot, hex] of Object.entries(palette.scheme)) {
        expect(theme).toContain(`<a:${slot}><a:srgbClr val="${hex}"/></a:${slot}>`)
      }
      expect(theme).toContain(`<a:majorFont><a:latin typeface="${palette.majorFont}"/>`)
      expect(theme).toContain(`<a:minorFont><a:latin typeface="${palette.minorFont}"/>`)
    })
  }

  it('escapes the title in slide text and docProps', () => {
    const parts = newDeckParts({ title: 'A & B <deck>', palette: NAVY })
    expect(parts.get('ppt/slides/slide1.xml')).toContain('<a:t>A &amp; B &lt;deck&gt;</a:t>')
    expect(parts.get('docProps/core.xml')).toContain('<dc:title>A &amp; B &lt;deck&gt;</dc:title>')
  })
})

describe('PowerPoint-required scaffolding', () => {
  // Desktop PowerPoint silently renders slides blank — no repair prompt on
  // Mac — when a package is schema-minimal, even though the XML validates
  // against ECMA-376 and every other renderer shows the text. These pin the
  // package to the shape PowerPoint itself emits.
  const parts = newDeckParts({ title: 'T', palette: NAVY, createdAt: '2026-08-07T00:00:00.000Z' })

  it('ships presProps, viewProps and tableStyles, related from the presentation', () => {
    for (const part of ['ppt/presProps.xml', 'ppt/viewProps.xml', 'ppt/tableStyles.xml']) {
      expect(parts.has(part), part).toBe(true)
    }
    const presRels = relsOf(parts, 'ppt/_rels/presentation.xml.rels')
    expect(presRels.find((r) => r.type === `${REL_TYPE}/presProps`)?.target).toBe('ppt/presProps.xml')
    expect(presRels.find((r) => r.type === `${REL_TYPE}/viewProps`)?.target).toBe('ppt/viewProps.xml')
    expect(presRels.find((r) => r.type === `${REL_TYPE}/tableStyles`)?.target).toBe(
      'ppt/tableStyles.xml',
    )
  })

  it('ships the full Office theme, not a schema-minimal skeleton', () => {
    const theme = parts.get('ppt/theme/theme1.xml')!
    // The complete style matrix: gradient fills, real effect styles, and the
    // object defaults + extra scheme list tail Office always writes.
    expect(theme).toContain('<a:gradFill rotWithShape="1">')
    expect(theme).toContain('<a:outerShdw')
    expect(theme).toContain('<a:objectDefaults>')
    expect(theme).toContain('<a:extraClrSchemeLst/>')
    // Per-script typeface tables on both font slots.
    expect(theme.match(/script="Jpan"/g)).toHaveLength(2)
  })

  it('ships deep master txStyles, a bgRef background and a default text style', () => {
    const master = parts.get('ppt/slideMasters/slideMaster1.xml')!
    expect(master).toContain('<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>')
    // The full 9-level body ladder, not just lvl1.
    expect(master).toContain('<a:lvl9pPr')
    // Footer chrome placeholders exist on the master (and only there — the
    // layouts stay chrome-free so planNewSlide never instantiates them).
    expect(master).toContain('type="dt"')
    expect(master).toContain('type="ftr"')
    expect(master).toContain('type="sldNum"')
    expect(parts.get('ppt/slideLayouts/slideLayout1.xml')).not.toContain('type="ftr"')
    expect(parts.get('ppt/presentation.xml')).toContain('<p:defaultTextStyle>')
  })
})

describe('round-trip through parsePptx', () => {
  it('parses as one 16:9 slide with two placeholders inheriting layout geometry', async () => {
    const deck = await parsePptx(await newDeckPptx({ title: 'Quarterly Review', palette: NAVY }))
    expect(deck.slideSizeEmu).toEqual(SLIDE_SIZE_EMU)
    expect(deck.slides).toHaveLength(1)

    const shapes = deck.slides[0].shapes as TextShape[]
    expect(shapes).toHaveLength(2)
    const [title, subtitle] = shapes
    expect(title.type).toBe('text')
    expect(subtitle.type).toBe('text')

    // The slide's placeholders carry no xfrm of their own — these boxes come
    // from the Title Slide layout through the inheritance cascade.
    expect(title.xfrmEmu).toEqual(TITLE_LAYOUT_RECTS.ctrTitle)
    expect(subtitle.xfrmEmu).toEqual(TITLE_LAYOUT_RECTS.subTitle)

    // Deck name on the title, empty subtitle (the editor's "Add text" state).
    expect(title.paragraphs).toHaveLength(1)
    expect(title.paragraphs[0].runs.map((r) => r.text)).toEqual(['Quarterly Review'])
    expect(subtitle.paragraphs[0].runs).toHaveLength(0)

    // Theme resolves: deck preview colors, master txStyles size, major font.
    expect(deck.themeColors).toEqual({
      accent1: NAVY.scheme.accent1,
      tx1: NAVY.scheme.dk1,
    })
    expect(title.display?.defaultRun.sizePt).toBe(44)
    expect(title.display?.defaultRun.latinFont).toBe(NAVY.majorFont)
    expect(title.display?.defaultRun.colorHex).toBe(NAVY.scheme.dk1)
    // Master background (bg1 -> lt1) reaches the slide.
    expect(deck.slides[0].background).toMatchObject({ kind: 'solid', hex: NAVY.scheme.lt1 })
  })

  it('keeps an empty title as an empty placeholder', async () => {
    const deck = await parsePptx(await newDeckPptx({ title: '  ', palette: NAVY }))
    const title = deck.slides[0].shapes[0] as TextShape
    expect(title.paragraphs[0].runs).toHaveLength(0)
  })
})

describe('editing a generated deck', () => {
  it('supports Add Slide anchored on the title layout', async () => {
    const deck = await parsePptx(await newDeckPptx({ title: 'T', palette: NAVY }))
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])
    expect(plan.path).toBe('ppt/slides/slide2.xml')
    expect(plan.xml).toContain('<p:ph type="ctrTitle"/>')
    expect(plan.xml).toContain('<p:ph type="subTitle" idx="1"/>')

    const out = await writeDeck(deck, new Map(), { addSlides: [plan] })
    const reparsed = await parsePptx(out)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
    ])
    const [t, s] = reparsed.slides[1].shapes as TextShape[]
    expect(t.xfrmEmu).toEqual(TITLE_LAYOUT_RECTS.ctrTitle)
    expect(s.xfrmEmu).toEqual(TITLE_LAYOUT_RECTS.subTitle)
  })

  it('supports Add Slide anchored on the title+body layout', async () => {
    const deck = await parsePptx(await newDeckPptx({ title: 'T', palette: NAVY }))
    // Rels naming layout2, the way a pending added slide on that layout would.
    const anchorRels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>` +
      '</Relationships>'
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', anchorRels, [])
    expect(plan.xml).toContain('<p:ph type="title"/>')
    expect(plan.xml).toContain('<p:ph type="body" idx="1"/>')

    const out = await writeDeck(deck, new Map(), { addSlides: [plan] })
    const reparsed = await parsePptx(out)
    const [t, b] = reparsed.slides[1].shapes as TextShape[]
    expect(t.xfrmEmu).toEqual(BODY_LAYOUT_RECTS.title)
    expect(b.xfrmEmu).toEqual(BODY_LAYOUT_RECTS.body)
  })

  it('writes back byte-identically with no edits', async () => {
    const input = await newDeckPptx({ title: 'T', palette: NAVY })
    const deck = await parsePptx(input)
    const out = await writeDeck(deck, new Map())

    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(out)
    expect(Object.keys(outZip.files).sort()).toEqual(Object.keys(inZip.files).sort())
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir) continue
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      expect(Buffer.from(a).equals(Buffer.from(b)), `byte-identical: ${name}`).toBe(true)
    }
  })

  it('a title text edit splices only the slide part', async () => {
    const input = await newDeckPptx({ title: 'Hello', palette: NAVY })
    const deck = await parsePptx(input)
    const title = deck.slides[0].shapes[0] as TextShape

    const out = await writeDeck(
      deck,
      new Map([
        [
          'ppt/slides/slide1.xml',
          [
            {
              kind: 'text' as const,
              nodePath: title.nodePath,
              original: title.paragraphs,
              next: [{ srcPara: 0, runs: [{ text: 'Hello, world', srcPara: 0, srcRun: 0 }] }],
            },
          ],
        ],
      ]),
    )

    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(out)
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir || name === 'ppt/slides/slide1.xml') continue
      const a = await inZip.files[name].async('uint8array')
      const b = await outZip.files[name].async('uint8array')
      expect(Buffer.from(a).equals(Buffer.from(b)), `byte-identical: ${name}`).toBe(true)
    }
    // The slide differs by exactly the spliced run text.
    const inSlide = await inZip.files['ppt/slides/slide1.xml'].async('string')
    const outSlide = await outZip.files['ppt/slides/slide1.xml'].async('string')
    expect(outSlide).toBe(inSlide.replace('<a:t>Hello</a:t>', '<a:t>Hello, world</a:t>'))

    const reparsed = await parsePptx(out)
    const editedTitle = reparsed.slides[0].shapes[0] as TextShape
    expect(editedTitle.paragraphs[0].runs[0].text).toBe('Hello, world')
  })

  it('typed text reaches the written bytes via the editor save path (title + added-slide body)', async () => {
    // The exact flow the editor runs: commit shape edits into a DeckEdits,
    // plan an added slide, then writeDeck(toSlideEdits(...), { addSlides }).
    // Guards the silent-data-loss repro: type into the title, add a slide,
    // type into its body, export.
    const deck = await parsePptx(await newDeckPptx({ title: 'Untitled presentation', palette: NAVY }))
    const slide1Path = 'ppt/slides/slide1.xml'
    const title = deck.slides[0].shapes[0] as TextShape

    let edits: DeckEdits = {
      ...EMPTY_DECK_EDITS,
      shapes: {
        [shapeKeyOf(slide1Path, title.nodePath)]: {
          slidePath: slide1Path,
          nodePath: title.nodePath,
          original: title.paragraphs,
          text: [{ srcPara: 0, runs: [{ text: 'prakhar', srcPara: 0, srcRun: 0 }] }],
        },
      },
    }

    // Add a slide on the title+body layout and type into its body placeholder.
    const anchorRels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>` +
      '</Relationships>'
    const plan = await planNewSlide(deck, slide1Path, anchorRels, [])
    const added = await parseAddedSlide(deck, plan.path, plan.xml, plan.relsXml)
    edits = withSlideAdded(edits, { ...plan, slide: added })
    const body = added.shapes[1] as TextShape
    edits = {
      ...edits,
      shapes: {
        ...edits.shapes,
        [shapeKeyOf(plan.path, body.nodePath)]: {
          slidePath: plan.path,
          nodePath: body.nodePath,
          original: body.paragraphs,
          text: [{ srcPara: 0, runs: [{ text: 'body copy' }] }],
        },
      },
    }

    const bytes = await writeDeck(deck, toSlideEdits(edits.shapes), {
      deleteSlides: edits.deletedSlides,
      addSlides: edits.addedSlides,
      slideOrder: edits.slideOrder,
    })

    // The typed text is in the bytes on disk…
    const zip = await JSZip.loadAsync(bytes)
    expect(await zip.files[slide1Path].async('string')).toContain('<a:t>prakhar</a:t>')
    expect(await zip.files[plan.path].async('string')).toContain('<a:t>body copy</a:t>')

    // …and re-parsing the WRITTEN package finds it in the correct shapes.
    const reparsed = await parsePptx(bytes)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([slide1Path, plan.path])
    const writtenTitle = reparsed.slides[0].shapes[0] as TextShape
    const writtenBody = reparsed.slides[1].shapes[1] as TextShape
    expect(writtenTitle.paragraphs[0].runs.map((r) => r.text)).toEqual(['prakhar'])
    expect(writtenBody.paragraphs[0].runs.map((r) => r.text)).toEqual(['body copy'])
    expect(writtenBody.xfrmEmu).toEqual(BODY_LAYOUT_RECTS.body)
  })
})

// ------------------------------------------------- v1 scaffolding upgrade

/**
 * The first version of the generator emitted a schema-minimal skeleton
 * (no presProps/viewProps/tableStyles, bare theme, no defaultTextStyle)
 * that desktop PowerPoint renders as blank slides. Rebuilt here by
 * downgrading v2 parts, so the fixture always matches the current package
 * layout in everything the upgrade does not touch.
 */
const V1_THEME =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Rowboat Navy">' +
  '<a:themeElements><a:clrScheme name="Navy">' +
  (
    ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const
  )
    .map((n) => `<a:${n}><a:srgbClr val="${NAVY.scheme[n]}"/></a:${n}>`)
    .join('') +
  '</a:clrScheme><a:fontScheme name="Navy">' +
  '<a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
  '</a:fontScheme></a:themeElements></a:theme>'

async function buildV1StyleDeck(title: string): Promise<Uint8Array> {
  const parts = newDeckParts({ title, palette: NAVY, createdAt: '2026-08-07T00:00:00.000Z' })
  const zip = new JSZip()
  for (const [p, xml] of parts) {
    if (p === 'ppt/presProps.xml' || p === 'ppt/viewProps.xml' || p === 'ppt/tableStyles.xml') {
      continue
    }
    let out = xml
    if (p === '[Content_Types].xml') {
      out = out.replace(/<Override PartName="\/ppt\/(presProps|viewProps|tableStyles)\.xml"[^>]*\/>/g, '')
    } else if (p === 'ppt/presentation.xml') {
      out = out.replace(/<p:defaultTextStyle>[\s\S]*<\/p:defaultTextStyle>/, '')
    } else if (p === 'ppt/_rels/presentation.xml.rels') {
      out = out.replace(/<Relationship Id="rId[456]"[^>]*\/>/g, '')
    } else if (p === 'ppt/theme/theme1.xml') {
      out = V1_THEME
    }
    zip.file(p, out, { createFolders: false })
  }
  return zip.generateAsync({ type: 'uint8array' })
}

async function partsOfZip(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes)
  const out = new Map<string, string>()
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) out.set(name, await zip.files[name].async('string'))
  }
  return out
}

describe('upgradeGeneratedDeck', () => {
  it('rebuilds v1 scaffolding into the full PowerPoint-shaped package', async () => {
    const upgraded = await upgradeGeneratedDeck(await buildV1StyleDeck('Legacy deck'))
    expect(upgraded).not.toBeNull()

    // The upgraded package passes the same structural bar as a fresh one.
    const parts = await partsOfZip(upgraded!)
    validatePackage(parts)
    const theme = parts.get('ppt/theme/theme1.xml')!
    expect(theme).toContain('<a:objectDefaults>')
    expect(theme).toContain(`val="${NAVY.scheme.accent1}"`)
    expect(theme).toContain('typeface="Georgia"')
    expect(parts.get('ppt/presentation.xml')).toContain('<p:defaultTextStyle>')

    // Slide content and inherited geometry survive untouched.
    const deck = await parsePptx(upgraded!)
    const title = deck.slides[0].shapes[0] as TextShape
    expect(title.paragraphs[0].runs.map((r) => r.text)).toEqual(['Legacy deck'])
    expect(title.xfrmEmu).toEqual(TITLE_LAYOUT_RECTS.ctrTitle)
  })

  it('preserves edits and added slides made to a v1 deck before the upgrade', async () => {
    // The user's lifecycle: create with v1, type, add a slide, save — THEN open.
    const deck = await parsePptx(await buildV1StyleDeck('Legacy deck'))
    const title = deck.slides[0].shapes[0] as TextShape
    const plan = await planNewSlide(deck, 'ppt/slides/slide1.xml', undefined, [])
    const edited = await writeDeck(
      deck,
      new Map([
        [
          'ppt/slides/slide1.xml',
          [
            {
              kind: 'text' as const,
              nodePath: title.nodePath,
              original: title.paragraphs,
              next: [{ srcPara: 0, runs: [{ text: 'kept', srcPara: 0, srcRun: 0 }] }],
            },
          ],
        ],
      ]),
      { addSlides: [plan] },
    )

    const upgraded = await upgradeGeneratedDeck(edited)
    expect(upgraded).not.toBeNull()
    // (validatePackage asserts the pristine single-slide shape, so here just
    // check the support parts landed alongside the preserved second slide.)
    const parts = await partsOfZip(upgraded!)
    expect(parts.has('ppt/presProps.xml')).toBe(true)
    expect(parts.get('[Content_Types].xml')).toContain('/ppt/slides/slide2.xml')
    const reparsed = await parsePptx(upgraded!)
    expect(reparsed.slides.map((s) => s.xmlPath)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
    ])
    expect((reparsed.slides[0].shapes[0] as TextShape).paragraphs[0].runs[0].text).toBe('kept')
  })

  it('leaves fresh v2 decks and foreign decks alone', async () => {
    // Fresh v2: nothing to do.
    expect(await upgradeGeneratedDeck(await newDeckPptx({ title: 'T', palette: NAVY }))).toBeNull()
    // Idempotent: an upgraded package is a v2 package.
    const upgraded = await upgradeGeneratedDeck(await buildV1StyleDeck('T'))
    expect(await upgradeGeneratedDeck(upgraded!)).toBeNull()
    // Foreign deck (not our theme marker): untouched.
    const foreign = new JSZip()
    for (const [p, xml] of newDeckParts({ title: 'T', palette: NAVY })) {
      foreign.file(p, p === 'ppt/theme/theme1.xml' ? V1_THEME.replace('Rowboat Navy', 'Office Theme') : xml)
    }
    expect(await upgradeGeneratedDeck(await foreign.generateAsync({ type: 'uint8array' }))).toBeNull()
  })
})
