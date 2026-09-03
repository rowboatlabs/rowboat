import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx, parseXml, resolveNodePath, resolveRelTarget, tagNameOf } from './parse.js'
import { writeDeck } from './serialize.js'
import type { GroupShape, ImageShape, PlaceholderShape, TextShape } from './types.js'

const SLIDE_W = 12192000
const SLIDE_H = 6858000

const TEXT_RECT = { x: 838200, y: 365125, w: 10515600, h: 1325563 }
const IMAGE_RECT = { x: 1000000, y: 2000000, w: 3000000, h: 2000000 }

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/>
</p:presentation>`

const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`

const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`

const SLIDE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Title 1"/></p:nvSpPr>
      <p:spPr><a:xfrm>
        <a:off x="${TEXT_RECT.x}" y="${TEXT_RECT.y}"/>
        <a:ext cx="${TEXT_RECT.w}" cy="${TEXT_RECT.h}"/>
      </a:xfrm></p:spPr>
      <p:txBody>
        <a:p>
          <a:pPr algn="ctr"/>
          <a:r>
            <a:rPr lang="en-US" b="1" sz="2800">
              <a:solidFill><a:srgbClr val="ff0000"/></a:solidFill>
            </a:rPr>
            <a:t>Hello </a:t>
          </a:r>
          <a:r>
            <a:rPr lang="en-US" i="1" u="sng"/>
            <a:t>world</a:t>
          </a:r>
        </a:p>
      </p:txBody>
    </p:sp>
    <p:pic>
      <p:nvPicPr><p:cNvPr id="3" name="Picture 2"/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId1"/></p:blipFill>
      <p:spPr><a:xfrm>
        <a:off x="${IMAGE_RECT.x}" y="${IMAGE_RECT.y}"/>
        <a:ext cx="${IMAGE_RECT.w}" cy="${IMAGE_RECT.h}"/>
      </a:xfrm></p:spPr>
    </p:pic>
    <p:graphicFrame>
      <p:nvGraphicFramePr><p:cNvPr id="4" name="Chart 3"/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic>
    </p:graphicFrame>
  </p:spTree></p:cSld>
</p:sld>`

/** 1x1 transparent PNG. */
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
      'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

async function buildFixture(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', PRESENTATION_XML)
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
  zip.file('ppt/slides/slide1.xml', SLIDE_XML)
  zip.file('ppt/slides/_rels/slide1.xml.rels', SLIDE_RELS)
  zip.file('ppt/media/image1.png', PNG_BYTES)
  return zip.generateAsync({ type: 'uint8array' })
}

// jsdom implements neither of these.
const createdUrls: string[] = []
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

beforeAll(() => {
  URL.createObjectURL = (() => {
    const url = `blob:mock/${createdUrls.length}`
    createdUrls.push(url)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
})

afterAll(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

describe('parsePptx', () => {
  it('reads slide size, shapes, coordinates and run formatting', async () => {
    const deck = await parsePptx(await buildFixture())

    expect(deck.slideSizeEmu).toEqual({ w: SLIDE_W, h: SLIDE_H })
    expect(deck.slides).toHaveLength(1)

    const slide = deck.slides[0]
    expect(slide.xmlPath).toBe('ppt/slides/slide1.xml')
    // Document order is preserved, which is also z-order.
    expect(slide.shapes.map((s) => s.type)).toEqual(['text', 'image', 'placeholder'])

    const text = slide.shapes[0] as TextShape
    expect(text.id).toBe('2')
    expect(text.xfrmEmu).toEqual(TEXT_RECT)
    expect(text.paragraphs).toHaveLength(1)
    expect(text.paragraphs[0].align).toBe('ctr')

    const runs = text.paragraphs[0].runs
    expect(runs).toHaveLength(2)
    // Trailing space inside a:t must survive parsing.
    expect(runs[0]).toEqual({ text: 'Hello ', bold: true, sizePt: 28, colorHex: 'FF0000' })
    expect(runs[1]).toEqual({ text: 'world', italic: true, underline: true })

    const image = slide.shapes[1] as ImageShape
    expect(image.xfrmEmu).toEqual(IMAGE_RECT)
    expect(image.mediaPath).toBe('ppt/media/image1.png')
    expect(image.blobUrl).toMatch(/^blob:mock\//)

    // graphicFrame keeps its xfrm directly, not under spPr.
    const frame = slide.shapes[2] as PlaceholderShape
    expect(frame.kind).toBe('chart')
    expect(frame.xfrmEmu).toEqual({ x: 10, y: 20, w: 30, h: 40 })
  })

  it('records a node path that resolves back to the shape it came from', async () => {
    const deck = await parsePptx(await buildFixture())
    const slide = deck.slides[0]
    // Re-parse from the retained raw XML exactly as Phase B will, then walk each
    // recorded path and confirm it lands on the element the shape came from.
    const doc = parseXml(deck.source.slideXml[slide.xmlPath])
    const landedOn = slide.shapes.map((s) => {
      const node = resolveNodePath(doc, s.nodePath)
      return node ? tagNameOf(node) : null
    })
    expect(landedOn).toEqual(['p:sp', 'p:pic', 'p:graphicFrame'])
    for (const shape of slide.shapes) {
      expect(shape.slideXmlPath).toBe('ppt/slides/slide1.xml')
    }
    // The raw XML is retained verbatim for surgical write-back.
    expect(deck.source.slideXml['ppt/slides/slide1.xml']).toBe(SLIDE_XML)
  })

  it('rejects a package that is not a presentation', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'not a deck')
    await expect(parsePptx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /presentation\.xml/,
    )
  })
})

describe('placeholder geometry inheritance', () => {
  const LAYOUT_TITLE = { x: 100000, y: 200000, w: 300000, h: 400000 }
  const MASTER_BODY = { x: 11, y: 22, w: 33, h: 44 }

  /** How PowerPoint really authors it: placeholders carry no a:xfrm at all. */
  const SLIDE = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:p><a:r><a:t>Inherited title</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="3"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:p><a:r><a:t>Inherited body</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld></p:sld>`

  const LAYOUT = `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="9"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm>
        <a:off x="${LAYOUT_TITLE.x}" y="${LAYOUT_TITLE.y}"/>
        <a:ext cx="${LAYOUT_TITLE.w}" cy="${LAYOUT_TITLE.h}"/>
      </a:xfrm></p:spPr>
    </p:sp>
  </p:spTree></p:cSld></p:sldLayout>`

  const MASTER = `<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="8"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm>
        <a:off x="${MASTER_BODY.x}" y="${MASTER_BODY.y}"/>
        <a:ext cx="${MASTER_BODY.w}" cy="${MASTER_BODY.h}"/>
      </a:xfrm></p:spPr>
    </p:sp>
  </p:spTree></p:cSld></p:sldMaster>`

  const rels = (entries: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`

  it('resolves a placeholder rect from the layout, and from the master via the layout', async () => {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    zip.file('ppt/slides/slide1.xml', SLIDE)
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      rels(
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
      ),
    )
    zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT)
    zip.file(
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      rels(
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>',
      ),
    )
    zip.file('ppt/slideMasters/slideMaster1.xml', MASTER)

    const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    const [title, body] = deck.slides[0].shapes as TextShape[]

    // ctrTitle on the slide matches the layout's `title` slot.
    expect(title.xfrmEmu).toEqual(LAYOUT_TITLE)
    // Not present on the layout, so it falls through to the master by idx.
    expect(body.xfrmEmu).toEqual(MASTER_BODY)
  })
})

describe('group shapes', () => {
  // Children live in a 6096000×3048000 child space (chOff 100000/200000)
  // mapped onto a 3048000×1524000 box at (914400, 457200): scale 0.5 per axis.
  const GROUP_SLIDE = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:grpSp>
      <p:nvGrpSpPr><p:cNvPr id="10" name="Group 9"/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm>
        <a:off x="914400" y="457200"/><a:ext cx="3048000" cy="1524000"/>
        <a:chOff x="100000" y="200000"/><a:chExt cx="6096000" cy="3048000"/>
      </a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="11"/></p:nvSpPr>
        <p:spPr><a:xfrm>
          <a:off x="2100000" y="1200000"/><a:ext cx="1000000" cy="600000"/>
        </a:xfrm><a:solidFill><a:srgbClr val="1B2A4A"/></a:solidFill></p:spPr>
        <p:txBody><a:p><a:r><a:t>Inside the group</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:grpSp>
  </p:spTree></p:cSld></p:sld>`

  // Outer maps a 12192000×6096000 child space onto 6096000×3048000 at the
  // origin (scale 0.5); the inner group halves again — 0.25 through both.
  const NESTED_SLIDE = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:grpSp>
      <p:nvGrpSpPr><p:cNvPr id="20"/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm>
        <a:off x="0" y="0"/><a:ext cx="6096000" cy="3048000"/>
        <a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6096000"/>
      </a:xfrm></p:grpSpPr>
      <p:grpSp>
        <p:nvGrpSpPr><p:cNvPr id="21"/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm>
          <a:off x="2000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/>
          <a:chOff x="0" y="0"/><a:chExt cx="8000000" cy="4000000"/>
        </a:xfrm></p:grpSpPr>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="22"/></p:nvSpPr>
          <p:spPr><a:xfrm>
            <a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="1000000"/>
          </a:xfrm></p:spPr>
        </p:sp>
      </p:grpSp>
    </p:grpSp>
  </p:spTree></p:cSld></p:sld>`

  async function loadSlide(xml: string) {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    zip.file('ppt/slides/slide1.xml', xml)
    return parsePptx(await zip.generateAsync({ type: 'uint8array' }))
  }

  it('walks a group and maps children through chOff/chExt to final slide EMU', async () => {
    const deck = await loadSlide(GROUP_SLIDE)
    const [group] = deck.slides[0].shapes as [GroupShape]

    expect(group.type).toBe('group')
    // The group's own box passes through untransformed (top level).
    expect(group.xfrmEmu).toEqual({ x: 914400, y: 457200, w: 3048000, h: 1524000 })

    const child = group.children[0] as TextShape
    expect(child.type).toBe('text')
    // off + (child − chOff) · 0.5 per axis; extents halve.
    expect(child.xfrmEmu).toEqual({ x: 1914400, y: 957200, w: 500000, h: 300000 })
    // The child renders through the full pipeline: text and fill intact.
    expect(child.paragraphs[0].runs[0].text).toBe('Inside the group')
    expect(child.visual?.fill).toEqual({ kind: 'solid', hex: '1B2A4A' })
    // Its nodePath stays well-formed (resolves back through the group)…
    const doc = parseXml(deck.source.slideXml['ppt/slides/slide1.xml'])
    expect(tagNameOf(resolveNodePath(doc, child.nodePath)!)).toBe('p:sp')
  })

  it('multiplies nested group transforms through', async () => {
    const deck = await loadSlide(NESTED_SLIDE)
    const [outer] = deck.slides[0].shapes as [GroupShape]
    const inner = outer.children[0] as GroupShape

    expect(inner.type).toBe('group')
    // Inner group's box mapped through the outer transform alone.
    expect(inner.xfrmEmu).toEqual({ x: 1000000, y: 500000, w: 2000000, h: 1000000 })

    // Leaf: through inner (0.5, offset 2000000/1000000) then outer (0.5).
    const leaf = inner.children[0]
    expect(leaf.xfrmEmu).toEqual({ x: 1250000, y: 1000000, w: 1000000, h: 250000 })
  })

  it('keeps unedited write-back of a deck with groups byte-identical', async () => {
    const deck = await loadSlide(GROUP_SLIDE)
    const out = await writeDeck(deck, new Map())
    const raw = await (await JSZip.loadAsync(out)).files['ppt/slides/slide1.xml'].async('string')
    expect(raw).toBe(GROUP_SLIDE)
  })
})

describe('slide background', () => {
  const BG_SLIDE = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="1B2A4A"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree></p:spTree>
  </p:cSld></p:sld>`

  const PLAIN_SLIDE = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>`

  const BG_LAYOUT = `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="102030"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree></p:spTree>
  </p:cSld></p:sldLayout>`

  const rels = (entries: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`

  it('resolves a slide-level solidFill background', async () => {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    zip.file('ppt/slides/slide1.xml', BG_SLIDE)
    const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    expect(deck.slides[0].background).toEqual({ kind: 'solid', hex: '1B2A4A' })
  })

  it('cascades to the layout background when the slide has none', async () => {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    zip.file('ppt/slides/slide1.xml', PLAIN_SLIDE)
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      rels(
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
      ),
    )
    zip.file('ppt/slideLayouts/slideLayout1.xml', BG_LAYOUT)
    const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    expect(deck.slides[0].background).toEqual({ kind: 'solid', hex: '102030' })
  })
})

describe('layout decoration underlay', () => {
  // Canva-style layout: a real photo/panel drawn on the layout part itself,
  // alongside a placeholder slot that must NOT render.
  const DECOR_LAYOUT = `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="30" name="Panel"/></p:nvSpPr>
      <p:spPr><a:xfrm>
        <a:off x="0" y="0"/><a:ext cx="4000000" cy="6858000"/>
      </a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="222F44"/></a:solidFill></p:spPr>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="31"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:p><a:r><a:t>Click to edit title</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld></p:sldLayout>`

  const SLIDE = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:p><a:r><a:t>Real title</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld></p:sld>`

  const rels = (entries: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`

  it('renders layout decoration as an inert underlay, skipping placeholder slots', async () => {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    zip.file('ppt/slides/slide1.xml', SLIDE)
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      rels(
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
      ),
    )
    zip.file('ppt/slideLayouts/slideLayout1.xml', DECOR_LAYOUT)

    const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    const slide = deck.slides[0]

    // Only the decoration panel — the "Click to edit title" prompt is a slot.
    expect(slide.underlay).toHaveLength(1)
    const panel = slide.underlay![0]
    expect(panel.type).toBe('drawing')
    expect(panel.xfrmEmu).toEqual({ x: 0, y: 0, w: 4000000, h: 6858000 })
    expect(panel.visual?.fill).toEqual({ kind: 'solid', hex: '222F44' })
    // Provenance is the layout part, never the slide — read-only by contract.
    expect(panel.slideXmlPath).toBe('ppt/slideLayouts/slideLayout1.xml')

    // The slide's own editable shapes are unaffected.
    expect(slide.shapes.map((s) => s.type)).toEqual(['text'])
  })
})

describe('text anchor', () => {
  const ANCHOR_SLIDE = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr anchor="ctr"/><a:p><a:r><a:t>Centered</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="3"/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:p><a:r><a:t>Defaulted</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld></p:sld>`

  it('honours an explicit bodyPr anchor and defaults to top', async () => {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', PRESENTATION_XML)
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS)
    zip.file('ppt/slides/slide1.xml', ANCHOR_SLIDE)
    const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    const [centered, defaulted] = deck.slides[0].shapes as TextShape[]
    expect(centered.display?.anchor).toBe('ctr')
    // The OOXML default is top — forcing center clipped top-anchored decks.
    expect(defaulted.display?.anchor).toBe('t')
  })
})

describe('resolveRelTarget', () => {
  it('resolves relative, parent and absolute targets', () => {
    expect(resolveRelTarget('ppt', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml')
    expect(resolveRelTarget('ppt/slides', '../media/image1.png')).toBe('ppt/media/image1.png')
    expect(resolveRelTarget('ppt/slides', '/ppt/media/image1.png')).toBe('ppt/media/image1.png')
  })
})
