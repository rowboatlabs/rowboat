/**
 * In-memory outline previews: the deck an outline WILL produce, parsed and
 * renderable, without any workspace write.
 *
 * The pipeline is Create's own, shared piece by piece — buildOutlineBase and
 * buildOutlineSlidePart from generate.ts produce the identical base package,
 * pattern XML and text edits; the only difference is the last step: instead
 * of writeDeck → bytes, the parts are parsed (parseAddedSlide) and the edits
 * rendered through applyEditSet, the editor's own render path. So the
 * preview is by construction what Create writes.
 *
 * Failure isolation: a slide whose synthesis throws (bad pattern payload)
 * becomes a null hole in `slides` — the rest of the deck still previews, and
 * Create keeps its own strict fail-closed path.
 */

import type { deck as deckShared } from '@x/shared'
import { disposeDeck, parseAddedSlide } from '@x/shared/dist/pptx/parse.js'
import { buildOutlineBase, buildOutlineSlidePart } from '@x/shared/dist/pptx/generate.js'
import type { DeckPalette } from '@x/shared/dist/pptx/new-deck.js'
import type { Slide, SlideDeck } from '@x/shared/dist/pptx/types.js'
import {
  applyEditSet,
  shapeKeyOf,
  EMPTY_DECK_EDITS,
  type AddedSlide,
  type ShapeEdit,
} from '@/components/pptx/edit-model'

type DeckOutline = deckShared.DeckOutline

export interface OutlinePreview {
  /** The rendered deck, or null when even the base package failed. */
  deck: SlideDeck | null
  /** One entry per outline slide, in order; null = preview unavailable. */
  slides: (Slide | null)[]
}

/**
 * Builds the outline's deck in memory and renders it. Never throws: the
 * worst case is a preview full of null holes.
 */
export async function synthesizeOutlineDeck(
  outline: DeckOutline,
  palette: DeckPalette,
): Promise<OutlinePreview> {
  let base: SlideDeck
  let firstSlideEdits: Awaited<ReturnType<typeof buildOutlineBase>>['firstSlideEdits']
  try {
    ;({ base, firstSlideEdits } = await buildOutlineBase(outline, palette))
  } catch {
    return { deck: null, slides: outline.slides.map(() => null) }
  }

  const shapes: Record<string, ShapeEdit> = {}
  const addedSlides: AddedSlide[] = []
  /** Which part path previews each outline index; null = failed slide. */
  const pathForIndex: (string | null)[] = []

  // Text edits render through the edit set, exactly as the editor shows them.
  const addTextEdits = (slidePath: string, edits: Awaited<ReturnType<typeof buildOutlineSlidePart>>['edits']): void => {
    for (const e of edits) {
      if (e.kind !== 'text') continue
      shapes[shapeKeyOf(slidePath, e.nodePath)] = {
        slidePath,
        nodePath: e.nodePath,
        original: e.original,
        text: e.next,
      }
    }
  }

  const firstPath = base.slides[0].xmlPath
  pathForIndex.push(firstPath)
  addTextEdits(firstPath, firstSlideEdits)

  let anchorPath = firstPath
  for (let i = 1; i < outline.slides.length; i++) {
    try {
      const { part, edits } = await buildOutlineSlidePart(
        base,
        outline.slides[i],
        anchorPath,
        addedSlides.map((a) => a.path),
      )
      const parsed = await parseAddedSlide(base, part.path, part.xml, part.relsXml)
      addedSlides.push({ ...part, slide: parsed })
      addTextEdits(part.path, edits)
      pathForIndex.push(part.path)
      anchorPath = part.path
    } catch {
      // This slide's payload broke synthesis; hole it and keep going.
      pathForIndex.push(null)
    }
  }

  const rendered = applyEditSet(base, { ...EMPTY_DECK_EDITS, shapes, addedSlides })
  const byPath = new Map(rendered.slides.map((s) => [s.xmlPath, s]))
  return {
    deck: rendered,
    slides: pathForIndex.map((p) => (p !== null ? byPath.get(p) ?? null : null)),
  }
}

/**
 * Releases a replaced preview's blob URLs. Rendered slides share shape
 * objects with the base deck, so disposing the rendered deck covers both.
 */
export function disposeOutlinePreview(preview: OutlinePreview | null): void {
  if (preview?.deck) disposeDeck(preview.deck)
}
