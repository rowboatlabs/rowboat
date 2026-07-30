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

import type {
  EditedParagraph,
  RunFormatOverrides,
  RunRef,
  SlideEdit,
} from '@/lib/pptx/serialize'
import type {
  NodePath,
  Paragraph,
  Shape,
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
}

export type EditSet = Readonly<Record<ShapeKey, ShapeEdit>>

export const EMPTY_EDIT_SET: EditSet = {}

export function hasEdits(edits: EditSet): boolean {
  return Object.keys(edits).length > 0
}

const isBrRun = (text: string): boolean => text === '\n'

/**
 * True when `next` keeps the paragraph/run structure of `original`, so the
 * serializer can splice text in place and formatting edits stay addressable.
 */
export function structureMatches(
  original: readonly Paragraph[],
  next: readonly { runs: readonly { text: string }[] }[],
): boolean {
  if (original.length !== next.length) return false
  for (let i = 0; i < original.length; i++) {
    const o = original[i].runs
    const n = next[i].runs
    if (o.length !== n.length) return false
    for (let j = 0; j < o.length; j++) {
      if (isBrRun(o[j].text) !== isBrRun(n[j].text)) return false
      // An embedded newline becomes new <a:br/> structure on write.
      if (!isBrRun(n[j].text) && n[j].text.includes('\n')) return false
    }
  }
  return true
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
  const paras: Paragraph[] = source.map((p) => ({
    align: p.align,
    runs: p.runs.map((r) => ({ ...r })),
  }))
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

/** The deck as the user currently sees it. `deck` itself is never mutated. */
export function applyEditSet(deck: SlideDeck, edits: EditSet): SlideDeck {
  if (!hasEdits(edits)) return deck
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      let touched = false
      const shapes = slide.shapes.map((shape) => {
        const edit = edits[shapeKeyOf(slide.xmlPath, shape.nodePath)]
        if (!edit) return shape
        touched = true
        let next: Shape = shape
        if (edit.geometry) next = { ...next, xfrmEmu: { ...edit.geometry } }
        if (next.type === 'text' && (edit.text || edit.formats || edit.aligns)) {
          next = {
            ...next,
            paragraphs: effectiveParagraphs(edit, (next as TextShape).paragraphs),
          }
        }
        return next
      })
      return touched ? { ...slide, shapes } : slide
    }),
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
