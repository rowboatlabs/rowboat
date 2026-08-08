import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import JSZip from 'jszip'
import { parsePptx } from './parse'
import { writeDeck } from './serialize'
import { DECK_PALETTES, newDeckPptx } from './new-deck'
import { buildThemeXml, resolveThemePath } from './restyle'
import { synthesizeDeckFromOutline } from './generate'
import type { Shape, TextShape } from './types'
import type { deck as deckShared } from '@x/shared'

const NAVY = DECK_PALETTES[0]
const WARM = DECK_PALETTES[1]
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

const THEME_PATH = 'ppt/theme/theme1.xml'

function fillHex(shape: Shape): string | undefined {
  const fill = shape.visual?.fill
  return fill?.kind === 'solid' ? fill.hex : undefined
}

describe('resolveThemePath', () => {
  it('resolves the theme the master references (standard name)', async () => {
    const zip = await JSZip.loadAsync(await newDeckPptx({ title: 'T', palette: NAVY }))
    expect(await resolveThemePath(zip)).toBe(THEME_PATH)
  })

  it('resolves a differently-named theme part via the master rels (imported deck)', async () => {
    // Rename the theme part and repoint the master rels + content types, the
    // way a Canva/Office export might name it (theme3.xml, office.xml, …).
    const zip = await JSZip.loadAsync(await newDeckPptx({ title: 'T', palette: NAVY }))
    const relsPath = 'ppt/slideMasters/_rels/slideMaster1.xml.rels'
    const theme = await zip.files[THEME_PATH].async('string')
    zip.remove(THEME_PATH)
    zip.file('ppt/theme/office.xml', theme)
    zip.file(relsPath, (await zip.files[relsPath].async('string')).replace('../theme/theme1.xml', '../theme/office.xml'))
    zip.file('[Content_Types].xml', (await zip.files['[Content_Types].xml'].async('string')).replace('/ppt/theme/theme1.xml', '/ppt/theme/office.xml'))
    const reloaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))
    expect(await resolveThemePath(reloaded)).toBe('ppt/theme/office.xml')
  })

  it('fails closed when the master has more than one theme relationship', async () => {
    const zip = await JSZip.loadAsync(await newDeckPptx({ title: 'T', palette: NAVY }))
    const relsPath = 'ppt/slideMasters/_rels/slideMaster1.xml.rels'
    zip.file(
      relsPath,
      (await zip.files[relsPath].async('string')).replace(
        '</Relationships>',
        `<Relationship Id="rId99" Type="${REL_TYPE}/theme" Target="../theme/theme1.xml"/></Relationships>`,
      ),
    )
    const reloaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))
    await expect(resolveThemePath(reloaded)).rejects.toThrow(/exactly one theme relationship/)
  })

  it('fails closed when there is more than one slide master', async () => {
    const zip = await JSZip.loadAsync(await newDeckPptx({ title: 'T', palette: NAVY }))
    zip.file('ppt/slideMasters/slideMaster2.xml', await zip.files['ppt/slideMasters/slideMaster1.xml'].async('string'))
    const reloaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))
    await expect(resolveThemePath(reloaded)).rejects.toThrow(/exactly one slide master/)
  })
})

describe('writeDeck replaceTheme', () => {
  it('swaps exactly the theme entry, byte-for-byte everywhere else', async () => {
    const input = await newDeckPptx({ title: 'T', palette: NAVY })
    const deck = await parsePptx(input)
    const warmTheme = buildThemeXml(WARM)
    const out = await writeDeck(deck, new Map(), { replaceTheme: { xml: warmTheme } })

    const inZip = await JSZip.loadAsync(input)
    const outZip = await JSZip.loadAsync(out)
    expect(Object.keys(outZip.files).sort()).toEqual(Object.keys(inZip.files).sort())
    for (const name of Object.keys(inZip.files)) {
      if (inZip.files[name].dir) continue
      const a = Buffer.from(await inZip.files[name].async('uint8array'))
      const b = Buffer.from(await outZip.files[name].async('uint8array'))
      if (name === THEME_PATH) {
        expect(await outZip.files[name].async('string')).toBe(warmTheme)
        expect(a.equals(b), 'theme part must differ').toBe(false)
      } else {
        expect(a.equals(b), `byte-identical: ${name}`).toBe(true)
      }
    }
  })

  it('fails closed on an ambiguous package, writing nothing', async () => {
    const zip = await JSZip.loadAsync(await newDeckPptx({ title: 'T', palette: NAVY }))
    const relsPath = 'ppt/slideMasters/_rels/slideMaster1.xml.rels'
    zip.file(
      relsPath,
      (await zip.files[relsPath].async('string')).replace(
        '</Relationships>',
        `<Relationship Id="rId99" Type="${REL_TYPE}/theme" Target="../theme/theme1.xml"/></Relationships>`,
      ),
    )
    const deck = await parsePptx(await zip.generateAsync({ type: 'uint8array' }))
    await expect(
      writeDeck(deck, new Map(), { replaceTheme: { xml: buildThemeXml(WARM) } }),
    ).rejects.toThrow(/theme relationship/)
  })
})

describe('navy → warm on a generated deck', () => {
  const OUTLINE: deckShared.DeckOutline = {
    title: 'Deck',
    suggestedPalette: 'navy',
    slides: [
      { layout: 'title', pattern: 'title', heading: 'Deck', body: 'Subtitle' },
      { layout: 'title-body', pattern: 'section', heading: 'A section' },
      { layout: 'title-body', pattern: 'big-number', heading: 'Growth', stat: { value: '312%', caption: 'YoY' } },
    ],
  }

  it('re-parses with warm accents resolved in pattern fills and run colours', async () => {
    const generated = await synthesizeDeckFromOutline(OUTLINE, NAVY)
    const navyDeck = await parsePptx(generated.bytes)
    // Sanity: the section's full-bleed background is navy accent1 before the swap.
    const navySection = navyDeck.slides[1].shapes.map(fillHex)
    expect(navySection).toContain(NAVY.scheme.accent1)

    const out = await writeDeck(navyDeck, new Map(), { replaceTheme: { xml: buildThemeXml(WARM) } })
    const warmDeck = await parsePptx(out)

    // Deck-level preview colours follow the new theme.
    expect(warmDeck.themeColors?.accent1).toBe(WARM.scheme.accent1)

    // Section pattern fill (schemeClr accent1) now resolves to WARM accent1.
    expect(warmDeck.slides[1].shapes.map(fillHex)).toContain(WARM.scheme.accent1)
    expect(warmDeck.slides[1].shapes.map(fillHex)).not.toContain(NAVY.scheme.accent1)

    // A run colour (the big-number stat is schemeClr accent1) resolves to WARM.
    const stat = warmDeck.slides[2].shapes.find(
      (s) => s.type === 'text' && (s as TextShape).display?.paragraphs[0]?.runs[0]?.colorHex === WARM.scheme.accent1,
    )
    expect(stat, 'a run should resolve to the warm accent').toBeDefined()
  })

  it('undo restores the original theme bytes exactly', async () => {
    const generated = await synthesizeDeckFromOutline(OUTLINE, NAVY)
    const input = generated.bytes
    const themePath = await resolveThemePath(await JSZip.loadAsync(input))
    const originalTheme = await (await JSZip.loadAsync(input)).files[themePath].async('string')

    // Apply warm…
    const navyDeck = await parsePptx(input)
    const swapped = await writeDeck(navyDeck, new Map(), { replaceTheme: { xml: buildThemeXml(WARM) } })
    // …then undo by restoring the snapshotted original theme part.
    const swappedDeck = await parsePptx(swapped)
    const restored = await writeDeck(swappedDeck, new Map(), { replaceTheme: { xml: originalTheme } })

    const restoredTheme = await (await JSZip.loadAsync(restored)).files[themePath].async('string')
    expect(restoredTheme).toBe(originalTheme)
  })
})
