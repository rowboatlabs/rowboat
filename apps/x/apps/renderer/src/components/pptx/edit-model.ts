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

import { DEFAULT_LINE_EMU, type ShapeStyleSnapshot } from '@/lib/pptx/geometry'
import type { NewShapeSpec } from '@/lib/pptx/shape-xml'
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
  /** Shape fill / outline, six-digit RRGGBB. */
  fillHex?: string
  lineHex?: string
  /** The shape's as-parsed spPr style, the serializer's fail-closed anchor. */
  styleOriginal?: ShapeStyleSnapshot
  /** Shape identity, carried so the serializer can revalidate it. */
  shapeType?: Shape['type']
  shapeId?: string
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
/**
 * A shape inserted into an existing slide. The spec is what the serializer
 * writes; `slide` records which slide it belongs to and `key` gives it a
 * stable identity for selection and undo BEFORE it exists in any XML.
 */
export interface InsertedShape {
  key: ShapeKey
  slidePath: string
  spec: NewShapeSpec
  /** Object URL for an image's bytes, so the canvas can draw it pre-save. */
  previewUrl?: string
}

export interface DeckEdits {
  shapes: EditSet
  /** Shapes added to existing slides, in insertion (z-) order. */
  insertedShapes: readonly InsertedShape[]
  deletedSlides: readonly string[]
  addedSlides: readonly AddedSlide[]
  /**
   * Explicit final slide order, as xml paths. Absent until the user reorders;
   * when present it must be an exact permutation of the surviving base paths
   * plus the added paths, and it fully governs both the render and the written
   * `sldIdLst` (see `composeSlideOrder` for the composition rule).
   */
  slideOrder?: readonly string[]
}

export const EMPTY_DECK_EDITS: DeckEdits = {
  shapes: EMPTY_EDIT_SET,
  insertedShapes: [],
  deletedSlides: [],
  addedSlides: [],
}

export function hasEdits(edits: DeckEdits): boolean {
  return (
    Object.keys(edits.shapes).length > 0 ||
    edits.insertedShapes.length > 0 ||
    edits.deletedSlides.length > 0 ||
    edits.addedSlides.length > 0 ||
    edits.slideOrder !== undefined
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
  if (set.latinFont !== undefined) run.latinFont = set.latinFont
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
 * The rendered slide sequence. THE COMPOSITION RULE, in order:
 *
 *  1. base document order, minus `deletedSlides`;
 *  2. each added slide inserted immediately after its `afterPath` anchor
 *     ('' anchors at the front; an added slide may itself anchor later adds,
 *     so chains resolve recursively);
 *  3. if `slideOrder` is present it REPLACES 1–2 as the sequence — anchors
 *     then only identify where a *new* add lands when the order is next
 *     recomputed. Paths in the order that no longer exist are skipped, and
 *     anything the order forgot is appended in 1–2 order, so a stale order can
 *     never drop a slide from the editor.
 *
 * `writeDeck` applies the same rule to `sldIdLst`, so what you see is what is
 * written.
 */
function composeSlideOrder(deck: SlideDeck, edits: DeckEdits): Slide[] {
  const removed = new Set(edits.deletedSlides)
  const anchored = (): Slide[] => {
    if (edits.addedSlides.length === 0) {
      return removed.size === 0
        ? [...deck.slides]
        : deck.slides.filter((s) => !removed.has(s.xmlPath))
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

  const natural = anchored()
  if (!edits.slideOrder) return natural

  const byPath = new Map(natural.map((s) => [s.xmlPath, s]))
  const ordered: Slide[] = []
  const placed = new Set<string>()
  for (const p of edits.slideOrder) {
    const slide = byPath.get(p)
    if (!slide || placed.has(p)) continue
    placed.add(p)
    ordered.push(slide)
  }
  for (const slide of natural) {
    if (!placed.has(slide.xmlPath)) ordered.push(slide)
  }
  return ordered
}

/** The rendered slide paths, in the order `applyEditSet` will render them. */
export function renderedSlidePaths(deck: SlideDeck, edits: DeckEdits): string[] {
  return composeSlideOrder(deck, edits).map((s) => s.xmlPath)
}

/** Records an explicit final slide order (what a rail drag commits). */
export function withSlideOrder(edits: DeckEdits, order: readonly string[]): DeckEdits {
  return { ...edits, slideOrder: [...order] }
}

/**
 * Adds a slide to the edit set. When an explicit order already exists the new
 * path is spliced into it right after its anchor, so a reorder followed by an
 * add keeps both intents.
 */
export function withSlideAdded(edits: DeckEdits, added: AddedSlide): DeckEdits {
  const addedSlides = [...edits.addedSlides, added]
  if (!edits.slideOrder) return { ...edits, addedSlides }
  const order = [...edits.slideOrder]
  const at = order.indexOf(added.afterPath)
  if (at >= 0) order.splice(at + 1, 0, added.path)
  else order.unshift(added.path)
  return { ...edits, addedSlides, slideOrder: order }
}

/**
 * A preview of an inserted shape, so the canvas can draw it before it exists
 * in any XML. Its nodePath is the position it WILL occupy — last in spTree —
 * which is also what makes it addressable by move/style/delete edits.
 */
/**
 * Where the next inserted shape lands: the spTree node path, and the child
 * index it will occupy.
 *
 * Derived from the existing shapes wherever possible rather than read straight
 * off `slide.spTreePath`. A Slide object can predate that field — a deck held
 * in React state across a hot reload is exactly that — and spreading a missing
 * one is a hard TypeError, which crashed insert instead of degrading. Any
 * shape's node path already ends in its spTree child index, so the parent path
 * is simply its prefix.
 */
export function spTreeSlotOf(slide: Slide): { path: NodePath; nextChild: number } {
  const last = slide.shapes[slide.shapes.length - 1]
  if (last && last.nodePath.length > 1) {
    return {
      path: last.nodePath.slice(0, -1),
      nextChild: last.nodePath[last.nodePath.length - 1] + 1,
    }
  }
  // No shapes to derive from. spTree always opens with nvGrpSpPr and grpSpPr,
  // so the first shape slot is index 2.
  return { path: slide.spTreePath ?? [], nextChild: 2 }
}

/** PowerPoint's stock accent1, for a deck whose theme could not be read. */
const FALLBACK_ACCENT = '4472C4'

function previewShapeOf(
  ins: InsertedShape,
  slide: Slide,
  offset: number,
  accentHex: string | undefined,
): Shape {
  // The node path the shape WILL have once written: inserts append to spTree,
  // so it is the next spTree CHILD index — not the next model-shape index.
  // spTree also holds nvGrpSpPr/grpSpPr, which are not shapes, so counting
  // model shapes pointed at the wrong element and nothing addressed at it
  // resolved.
  const slot = spTreeSlotOf(slide)
  const nodePath = [...slot.path, slot.nextChild + offset]
  const base = {
    id: shapeKeyOf(slide.xmlPath, nodePath),
    slideXmlPath: slide.xmlPath,
    nodePath,
    xfrmEmu: { ...ins.spec.xfrmEmu },
  }
  if (ins.spec.kind === 'image') {
    return { ...base, type: 'image', blobUrl: ins.previewUrl ?? '', mediaPath: '' }
  }
  // Every preview carries the `style` snapshot its synthesized XML will parse
  // to. That is what lets the Fill/Outline swatches target it, and what the
  // serializer's fail-closed check re-derives and compares.
  if (ins.spec.kind === 'textbox') {
    return {
      ...base,
      type: 'text',
      paragraphs: [{ runs: [] }],
      style: { fill: 'noFill', hasLine: false, lineFill: null },
    }
  }
  // The preview must show what the file will contain: `schemeClr accent1`,
  // resolved through the deck's own theme. With no fill at all here, an
  // inserted rectangle rendered as an invisible "white" box.
  const accent = accentHex ?? FALLBACK_ACCENT
  if (ins.spec.preset === 'line') {
    return {
      ...base,
      type: 'drawing',
      visual: {
        geom: { preset: 'line', adj: {} },
        line: { hex: accent, widthEmu: DEFAULT_LINE_EMU, dash: 'solid' },
      },
      style: { fill: 'noFill', hasLine: true, lineFill: 'solidFill' },
    }
  }
  return {
    ...base,
    type: 'drawing',
    visual: {
      geom: { preset: ins.spec.preset, adj: {} },
      fill: { kind: 'solid', hex: accent },
    },
    style: { fill: 'solidFill', hasLine: false, lineFill: null },
  }
}

/** The deck as the user currently sees it. `deck` itself is never mutated. */
export function applyEditSet(deck: SlideDeck, edits: DeckEdits): SlideDeck {
  if (!hasEdits(edits)) return deck
  return {
    ...deck,
    slides: composeSlideOrder(deck, edits).map((slide) => {
      // Inserted shapes join the list BEFORE edits are applied, so every edit
      // kind reaches them exactly as it reaches a shape already in the file.
      // Appending them afterwards meant nothing applied: a dragged box snapped
      // straight back, and typing, recolouring and restyling were all inert.
      const inserts = edits.insertedShapes.filter((i) => i.slidePath === slide.xmlPath)
      // They append to spTree, so they paint on top of everything else.
      const source =
        inserts.length > 0
          ? [...slide.shapes, ...inserts.map((ins, i) => previewShapeOf(ins, slide, i, deck.themeColors?.accent1))]
          : slide.shapes

      let touched = inserts.length > 0
      const shapes: Shape[] = []
      for (const shape of source) {
        const edit = edits.shapes[shapeKeyOf(slide.xmlPath, shape.nodePath)]
        if (!edit) {
          shapes.push(shape)
          continue
        }
        touched = true
        if (edit.deleted) continue
        let next: Shape = shape
        if (edit.geometry) next = { ...next, xfrmEmu: { ...edit.geometry } }
        // Fill / outline overrides ride on the DISPLAY visual, so the canvas
        // and the thumbnails pick them up through the one render path.
        if (edit.fillHex !== undefined || edit.lineHex !== undefined) {
          const visual = { ...next.visual }
          if (edit.fillHex !== undefined) visual.fill = { kind: 'solid', hex: edit.fillHex }
          if (edit.lineHex !== undefined) {
            visual.line = {
              // A shape with no authored outline gains a hairline, matching
              // the minimal a:ln the serializer writes.
              widthEmu: visual.line?.widthEmu ?? EMU_PER_PT,
              dash: visual.line?.dash ?? 'solid',
              ...visual.line,
              hex: edit.lineHex,
            }
          }
          next = { ...next, visual }
        }
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
 * Removes a shape that this edit set INSERTED. It never existed in the file,
 * so there is nothing to splice out — the insert is simply dropped. Emitting a
 * deleteShape for it instead would fail closed: a preview shape's `id` is its
 * composite editor key, not the numeric cNvPr id the serializer re-derives.
 */
export function withShapeUninserted(edits: DeckEdits, key: ShapeKey): DeckEdits {
  const insertedShapes = edits.insertedShapes.filter((i) => i.key !== key)
  if (insertedShapes.length === edits.insertedShapes.length) return edits
  const shapes = Object.fromEntries(Object.entries(edits.shapes).filter(([k]) => k !== key))
  return { ...edits, shapes, insertedShapes }
}

/** True when `key` names a shape this edit set inserted. */
export function isInsertedShape(edits: DeckEdits, key: ShapeKey): boolean {
  return edits.insertedShapes.some((i) => i.key === key)
}

/** Adds an inserted shape to the edit set. */
export function withShapeInserted(edits: DeckEdits, inserted: InsertedShape): DeckEdits {
  return { ...edits, insertedShapes: [...edits.insertedShapes, inserted] }
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
  const next: DeckEdits = {
    shapes,
    // An inserted shape on a removed slide goes with it.
    insertedShapes: edits.insertedShapes.filter((i) => i.slidePath !== targetPath),
    addedSlides,
    deletedSlides: wasAdded ? edits.deletedSlides : [...edits.deletedSlides, targetPath],
  }
  // An explicit order must stay an exact permutation of what survives.
  if (edits.slideOrder) next.slideOrder = edits.slideOrder.filter((p) => p !== targetPath)
  return next
}

// ------------------------------------------------------------- serialization

function formatSignature(set: RunFormatOverrides): string {
  return JSON.stringify([set.bold, set.italic, set.underline, set.sizePt, set.colorHex])
}

/** Groups the edit set into the per-slide arrays `writeDeck` consumes. */
/** Insert edits, grouped by slide, in insertion (z-) order. */
export function insertsToSlideEdits(
  inserted: readonly InsertedShape[],
): Map<string, SlideEdit[]> {
  const out = new Map<string, SlideEdit[]>()
  for (const ins of inserted) {
    const list = out.get(ins.slidePath) ?? []
    list.push({ kind: 'insertShape', spec: ins.spec })
    out.set(ins.slidePath, list)
  }
  return out
}

/** Merges two per-slide edit maps, keeping each slide's ordering. */
export function mergeSlideEdits(
  a: Map<string, SlideEdit[]>,
  b: Map<string, SlideEdit[]>,
): Map<string, SlideEdit[]> {
  const out = new Map(a)
  for (const [slide, edits] of b) out.set(slide, [...(out.get(slide) ?? []), ...edits])
  return out
}

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
    if (
      (edit.fillHex !== undefined || edit.lineHex !== undefined) &&
      edit.styleOriginal &&
      edit.shapeType &&
      edit.shapeId !== undefined
    ) {
      list.push({
        kind: 'setShapeStyle',
        nodePath: edit.nodePath,
        shapeType: edit.shapeType,
        shapeId: edit.shapeId,
        original: edit.styleOriginal,
        fillHex: edit.fillHex,
        lineHex: edit.lineHex,
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
