/**
 * The editor's in-memory edit set, and how it maps onto the C1 serializer.
 *
 * Saves are idempotent recomputations — original bytes + the whole accumulated
 * edit set — so undo/redo is just a stack of these immutable snapshots and the
 * rendered deck is always `applyEditSet(baseDeck, current)`.
 *
 * One structural constraint drives the shape of this module. The serializer
 * writes a text change either as in-place `<a:t>` splices (when paragraph/run
 * structure is unchanged) or by rebuilding the whole `<a:p>` range. A rebuild
 * overlaps the regions that `formatRuns` and `paragraphAlign` splice, and the
 * serializer fails closed on overlapping splices. So:
 *
 *  - text edits carry ORIGINAL run props and alignment, never the current
 *    formatted ones, which keeps them on the in-place path;
 *  - formatting lives only in `formats` / `aligns`, addressed by ORIGINAL
 *    (paragraph, run) indices;
 *  - once a shape's text structure diverges from the original those indices
 *    have no meaning, so formatting is dropped and disabled for that shape.
 */

import {
  isTextOnlyEdit,
  type DeleteShapeEdit,
  type EditedParagraph,
  type NewSlidePart,
  type RunFormatOverrides,
  type RunRef,
  type SlideEdit,
} from '@/lib/pptx/serialize'
import type {
  NodePath,
  Paragraph,
  Shape,
  Slide,
  SlideDeck,
  TextAlign,
  TextShape,
} from '@/lib/pptx/types'

export const EMU_PER_INCH = 914400
export const CSS_PX_PER_INCH = 96
/** One CSS pixel at 100% zoom. */
export const EMU_PER_PX = EMU_PER_INCH / CSS_PX_PER_INCH
export const EMU_PER_PT = 12700
/** Grid step: 8 CSS px at 100% zoom. */
export const GRID_EMU = 8 * EMU_PER_PX
/** Smallest shape we will resize to (1/8 inch). */
export const MIN_EXTENT_EMU = EMU_PER_INCH / 8

export type ShapeKey = string

export function shapeKeyOf(slidePath: string, nodePath: NodePath): ShapeKey {
  return `${slidePath}#${nodePath.join('.')}`
}

export interface RectEmuBox {
  x: number
  y: number
  w: number
  h: number
}

/** `${originalParagraph}:${originalRun}` */
export type RunKey = string

export function runKeyOf(para: number, run: number): RunKey {
  return `${para}:${run}`
}

function parseRunKey(key: RunKey): RunRef {
  const [para, run] = key.split(':')
  return { para: Number(para), run: Number(run) }
}

/** Marks a shape deleted; carries what the serializer revalidates first. */
export interface ShapeDeletion {
  shapeType: DeleteShapeEdit['shapeType']
  shapeId: string
}

export interface ShapeEdit {
  slidePath: string
  nodePath: NodePath
  /** As-parsed paragraphs. Present for text shapes; the serializer's anchor. */
  original?: Paragraph[]
  /** Replacement text. Run props/alignment mirror `original` by construction. */
  text?: EditedParagraph[]
  formats?: Record<RunKey, RunFormatOverrides>
  /** Original paragraph index (as a string key) -> alignment. */
  aligns?: Record<string, TextAlign>
  geometry?: RectEmuBox
  /**
   * Set when the shape is deleted. Supersedes every other field: their splices
   * would land inside the removed range, and the serializer fails closed on
   * overlap — so marking deleted must also clear them.
   */
  deleted?: ShapeDeletion
}

export type EditSet = Readonly<Record<ShapeKey, ShapeEdit>>

export const EMPTY_EDIT_SET: EditSet = {}

/**
 * A slide that exists only in the edit set: its synthesized part strings (what
 * the serializer writes and applies this slide's shape edits against) plus the
 * pre-parsed Slide the canvas renders. Parsed once at add time, so its object
 * identity — and every nodePath in it — is stable across history snapshots.
 */
export interface AddedSlide extends NewSlidePart {
  slide: Slide
}

/**
 * Everything the editor has changed, and the unit the history stack snapshots:
 * per-shape edits plus slides removed from / added to the deck (by xml path —
 * positions shift as slides come and go, paths never do).
 */
export interface DeckEdits {
  shapes: EditSet
  deletedSlides: readonly string[]
  addedSlides: readonly AddedSlide[]
}

export const EMPTY_DECK_EDITS: DeckEdits = {
  shapes: EMPTY_EDIT_SET,
  deletedSlides: [],
  addedSlides: [],
}

export function hasEdits(edits: DeckEdits): boolean {
  return (
    Object.keys(edits.shapes).length > 0 ||
    edits.deletedSlides.length > 0 ||
    edits.addedSlides.length > 0
  )
}

/**
 * True when `next` keeps the paragraph/run structure of `original`, so the
 * serializer can splice text in place and formatting edits stay addressable.
 *
 * This delegates to the serializer's own predicate rather than re-deriving it.
 * A second implementation drifted from it: this one compared run counts and
 * break positions only, while the serializer also compares alignment and run
 * properties. A commit whose runs lost their provenance (paste, type-over)
 * carries undefined props, so the serializer rebuilt the whole `<a:p>` range
 * while the editor still recorded `formats` against original indices. The two
 * splices overlap, `applySplices` fails closed — and because saves recompute
 * from the same edit set, that file could never be saved again.
 */
export function structureMatches(
  original: readonly Paragraph[],
  next: readonly EditedParagraph[],
): boolean {
  return isTextOnlyEdit(original, next)
}

/** True when the accumulated edit records run formatting or paragraph alignment. */
export function editHoldsFormatting(edit: ShapeEdit | undefined): boolean {
  return (
    Boolean(edit?.formats && Object.keys(edit.formats).length > 0) ||
    Boolean(edit?.aligns && Object.keys(edit.aligns).length > 0)
  )
}

/** What a text commit found to differ from the ORIGINAL file. */
export interface CommitDelta {
  textChanged: boolean
  formatCount: number
  alignCount: number
}

/**
 * True when a commit can be dropped entirely: nothing differs from the
 * original AND no earlier edit for this shape is left to clear.
 *
 * That second half is the easy one to miss. Typing a box's text back to its
 * original value is a REVERT, not a no-op: the commit has to go through so the
 * stale `text` edit is dropped. Skipping it left the old edit in the set, so
 * the canvas snapped back to the superseded text and every save kept writing
 * it — with no way out but undo.
 */
export function isNoopCommit(previous: ShapeEdit | undefined, delta: CommitDelta): boolean {
  if (delta.textChanged || delta.formatCount > 0 || delta.alignCount > 0) return false
  return !previous?.text && !editHoldsFormatting(previous)
}

/** True when this shape can still take formatting/alignment edits. */
export function acceptsFormatting(edit: ShapeEdit | undefined): boolean {
  if (!edit?.original) return true
  if (!edit.text) return true
  return structureMatches(edit.original, edit.text)
}

// ------------------------------------------------------------------ deriving

function applyOverrides(run: Record<string, unknown>, set: RunFormatOverrides): void {
  // Explicit false is preserved: display resolution treats undefined as
  // "inherit", so clearing bold on an inherited-bold run must stay `false`.
  if (set.bold !== undefined) run.bold = set.bold
  if (set.italic !== undefined) run.italic = set.italic
  if (set.underline !== undefined) run.underline = set.underline
  if (set.sizePt !== undefined) run.sizePt = set.sizePt
  if (set.colorHex !== undefined) run.colorHex = set.colorHex
}

/** The paragraphs to render: text replacement, then formatting on top. */
export function effectiveParagraphs(edit: ShapeEdit, base: readonly Paragraph[]): Paragraph[] {
  const source = edit.text ?? base
  // Spread the whole paragraph, the way the runs below already do: `srcPara`
  // is what maps a rendered paragraph back to the original it came from.
  // Rebuilding it as {align, runs} dropped that, so re-opening an edited box
  // stamped positional provenance into the overlay and the NEXT commit reused
  // a different paragraph's pPr/endParaRPr bytes — silently moving authored
  // alignment, bullets and indent onto the wrong paragraph on save.
  const paras: Paragraph[] = source.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r })) }))
  if (edit.formats) {
    for (const [key, set] of Object.entries(edit.formats)) {
      const { para, run } = parseRunKey(key)
      const target = paras[para]?.runs[run]
      if (target) applyOverrides(target as unknown as Record<string, unknown>, set)
    }
  }
  if (edit.aligns) {
    for (const [key, align] of Object.entries(edit.aligns)) {
      const target = paras[Number(key)]
      if (target) target.align = align
    }
  }
  return paras
}

/**
 * The rendered slide order: base slides minus deletions, with added slides
 * inserted after their anchors ('' anchors at the front; an added slide can
 * itself anchor later additions).
 */
function composeSlideOrder(deck: SlideDeck, edits: DeckEdits): Slide[] {
  const removed = new Set(edits.deletedSlides)
  if (edits.addedSlides.length === 0) {
    return removed.size === 0 ? [...deck.slides] : deck.slides.filter((s) => !removed.has(s.xmlPath))
  }
  const byAnchor = new Map<string, AddedSlide[]>()
  for (const a of edits.addedSlides) {
    const list = byAnchor.get(a.afterPath) ?? []
    list.push(a)
    byAnchor.set(a.afterPath, list)
  }
  const ordered: Slide[] = []
  const visited = new Set<string>()
  const emitAdds = (anchorPath: string): void => {
    for (const a of byAnchor.get(anchorPath) ?? []) {
      if (visited.has(a.path)) continue // defensive: an anchor cycle can't hang the render
      visited.add(a.path)
      ordered.push(a.slide)
      emitAdds(a.path)
    }
  }
  emitAdds('')
  for (const slide of deck.slides) {
    if (removed.has(slide.xmlPath)) continue
    ordered.push(slide)
    emitAdds(slide.xmlPath)
  }
  // An add whose anchor vanished (never reachable from the UI) still renders,
  // at the end, rather than silently disappearing from the editor.
  for (const a of edits.addedSlides) {
    if (!visited.has(a.path)) ordered.push(a.slide)
  }
  return ordered
}

/** The deck as the user currently sees it. `deck` itself is never mutated. */
export function applyEditSet(deck: SlideDeck, edits: DeckEdits): SlideDeck {
  if (!hasEdits(edits)) return deck
  return {
    ...deck,
    slides: composeSlideOrder(deck, edits).map((slide) => {
      let touched = false
      const shapes: Shape[] = []
      for (const shape of slide.shapes) {
        const edit = edits.shapes[shapeKeyOf(slide.xmlPath, shape.nodePath)]
        if (!edit) {
          shapes.push(shape)
          continue
        }
        touched = true
        if (edit.deleted) continue
        let next: Shape = shape
        if (edit.geometry) next = { ...next, xfrmEmu: { ...edit.geometry } }
        if (next.type === 'text' && (edit.text || edit.formats || edit.aligns)) {
          next = {
            ...next,
            paragraphs: effectiveParagraphs(edit, (next as TextShape).paragraphs),
          }
        }
        shapes.push(next)
      }
      return touched ? { ...slide, shapes } : slide
    }),
  }
}

/**
 * The edit set after removing one rendered slide. An ADDED slide is removed by
 * dropping its entry (it never existed in the file); a base slide joins
 * `deletedSlides`. Either way its shape edits go, and any additions anchored
 * to it re-anchor to `reanchorTo` (its rendered predecessor; '' for the front)
 * so they keep their place in the deck.
 */
export function withSlideRemoved(
  edits: DeckEdits,
  targetPath: string,
  reanchorTo: string,
): DeckEdits {
  const shapes = Object.fromEntries(
    Object.entries(edits.shapes).filter(([, v]) => v.slidePath !== targetPath),
  )
  const wasAdded = edits.addedSlides.some((a) => a.path === targetPath)
  const addedSlides = edits.addedSlides
    .filter((a) => a.path !== targetPath)
    .map((a) => (a.afterPath === targetPath ? { ...a, afterPath: reanchorTo } : a))
  return {
    shapes,
    addedSlides,
    deletedSlides: wasAdded ? edits.deletedSlides : [...edits.deletedSlides, targetPath],
  }
}

// ------------------------------------------------------------- serialization

function formatSignature(set: RunFormatOverrides): string {
  return JSON.stringify([set.bold, set.italic, set.underline, set.sizePt, set.colorHex])
}

/** Groups the edit set into the per-slide arrays `writeDeck` consumes. */
export function toSlideEdits(edits: EditSet): Map<string, SlideEdit[]> {
  const out = new Map<string, SlideEdit[]>()
  for (const edit of Object.values(edits)) {
    let list = out.get(edit.slidePath)
    if (!list) {
      list = []
      out.set(edit.slidePath, list)
    }

    if (edit.deleted) {
      // Deletion supersedes every other field (withShapeEdit cleared them).
      list.push({
        kind: 'deleteShape',
        nodePath: edit.nodePath,
        shapeType: edit.deleted.shapeType,
        shapeId: edit.deleted.shapeId,
        original: edit.original,
      })
      continue
    }
    if (edit.geometry) {
      list.push({
        kind: 'shapeGeometry',
        nodePath: edit.nodePath,
        offEmu: { x: edit.geometry.x, y: edit.geometry.y },
        extEmu: { w: edit.geometry.w, h: edit.geometry.h },
      })
    }
    if (edit.text && edit.original) {
      list.push({
        kind: 'text',
        nodePath: edit.nodePath,
        original: edit.original,
        next: edit.text,
      })
    }
    if (edit.formats && edit.original) {
      // One formatRuns edit per distinct override set.
      const grouped = new Map<string, { set: RunFormatOverrides; targets: RunRef[] }>()
      for (const [key, set] of Object.entries(edit.formats)) {
        const sig = formatSignature(set)
        const group = grouped.get(sig) ?? { set, targets: [] }
        group.targets.push(parseRunKey(key))
        grouped.set(sig, group)
      }
      for (const group of grouped.values()) {
        list.push({
          kind: 'formatRuns',
          nodePath: edit.nodePath,
          original: edit.original,
          targets: group.targets,
          set: group.set,
        })
      }
    }
    if (edit.aligns && edit.original) {
      for (const [key, align] of Object.entries(edit.aligns)) {
        list.push({
          kind: 'paragraphAlign',
          nodePath: edit.nodePath,
          original: edit.original,
          paraIndex: Number(key),
          align,
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- mutation

function isEmptyEdit(edit: ShapeEdit): boolean {
  return (
    !edit.text &&
    !edit.geometry &&
    !edit.deleted &&
    (!edit.formats || Object.keys(edit.formats).length === 0) &&
    (!edit.aligns || Object.keys(edit.aligns).length === 0)
  )
}

/**
 * Returns a new edit set with `mutate` applied to one shape's entry. Returning
 * an entry that holds nothing removes it, so undoing back to a clean document
 * yields a genuinely empty set.
 */
export function withShapeEdit(
  edits: EditSet,
  key: ShapeKey,
  seed: Pick<ShapeEdit, 'slidePath' | 'nodePath' | 'original'>,
  mutate: (draft: ShapeEdit) => void,
): EditSet {
  const existing = edits[key]
  const draft: ShapeEdit = existing
    ? {
        ...existing,
        formats: existing.formats ? { ...existing.formats } : undefined,
        aligns: existing.aligns ? { ...existing.aligns } : undefined,
      }
    : { ...seed }
  mutate(draft)

  const next = { ...edits }
  if (isEmptyEdit(draft)) delete next[key]
  else next[key] = draft
  return next
}
