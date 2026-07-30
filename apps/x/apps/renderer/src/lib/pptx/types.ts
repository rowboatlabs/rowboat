/**
 * Model for the in-house PPTX reader.
 *
 * Phase A renders this read-only. Phase B will edit slides in place, so the
 * model deliberately keeps everything needed to get back to the bytes it came
 * from: the loaded zip, each slide's raw XML, and a stable path from a slide's
 * parsed tree to the node each shape came from.
 */

import type JSZip from 'jszip'

/** English Metric Units per inch — the unit every OOXML coordinate is in. */
export const EMU_PER_INCH = 914400

/** A rectangle in EMU, exactly as authored. Scale at render time, not here. */
export interface RectEmu {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Index chain from a slide's parsed document array down to a shape's node.
 * Walk it as: `let nodes = doc; for (const i of path) { node = nodes[i]; nodes = childrenOf(node) }`.
 * Stable across re-parses of the same XML, which is what Phase B writes through.
 */
export type NodePath = number[]

export type TextAlign = 'l' | 'ctr' | 'r' | 'just'

export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  sizePt?: number
  /** Six-digit RRGGBB. Absent when the run inherits or uses a theme color. */
  colorHex?: string
}

export interface Paragraph {
  align?: TextAlign
  runs: TextRun[]
}

// ------------------------------------------------------------- display model
//
// Everything below the "display" line is derived presentation data (theme
// colors, inherited text styles, fills, rotation). The serializer never reads
// it — its validation derives from raw XML via `parseParagraph`, which stays
// byte-anchored — so display resolution can improve without touching the
// write-back invariants.

export type Fill =
  | { kind: 'solid'; hex: string; alpha?: number }
  | { kind: 'gradient'; stops: GradientStop[]; angleDeg: number }
  | { kind: 'none' }

export interface GradientStop {
  /** 0..1 position along the gradient. */
  pos: number
  hex: string
  alpha?: number
}

export interface LineStyle {
  hex: string
  widthEmu: number
  dash: 'solid' | 'dash' | 'dot'
  alpha?: number
}

export interface PresetGeometry {
  /** OOXML preset name (`rect`, `roundRect`, `ellipse`, `line`, …) or `custom`. */
  preset: string
  /** Adjust values from `a:avLst`, e.g. `{ adj: 16667 }`. */
  adj: Record<string, number>
}

/** Visual properties shared by every shape kind; display only. */
export interface ShapeVisual {
  fill?: Fill
  line?: LineStyle
  geom?: PresetGeometry
  /** Degrees clockwise. */
  rotDeg?: number
  flipH?: boolean
  flipV?: boolean
}

export interface ResolvedRunStyle {
  sizePt: number
  bold: boolean
  italic: boolean
  underline: boolean
  colorHex: string
}

export type ResolvedBullet =
  | { kind: 'none' }
  | { kind: 'char'; char: string }
  | { kind: 'auto'; scheme: string; startAt: number }

export interface ParagraphDisplay {
  level: number
  marLEmu: number
  indentEmu: number
  /** Resolved fallback used when the paragraph itself declares no algn. */
  align?: TextAlign
  bullet: ResolvedBullet
  /** Fully resolved style per ORIGINAL run index (explicit rPr over cascade). */
  runs: ResolvedRunStyle[]
  /** The cascade result at this level, for runs with no original anchor. */
  defaultRun: ResolvedRunStyle
}

export interface TextDisplay {
  /** By ORIGINAL paragraph index, matching the as-parsed `paragraphs`. */
  paragraphs: ParagraphDisplay[]
  /** Level-0 cascade result, for wholly new content. */
  defaultRun: ResolvedRunStyle
}

// ------------------------------------------------------------------- shapes

interface ShapeBase {
  /** `p:cNvPr@id` when present, else a synthesized `idx:<n>`. */
  id: string
  /** Zip path of the slide this shape lives on, e.g. `ppt/slides/slide1.xml`. */
  slideXmlPath: string
  nodePath: NodePath
  xfrmEmu: RectEmu
  /** Display-only visual properties (fill, line, geometry, rotation). */
  visual?: ShapeVisual
}

export interface TextShape extends ShapeBase {
  type: 'text'
  paragraphs: Paragraph[]
  /** Display-only resolved text styling (theme + inheritance cascade). */
  display?: TextDisplay
}

/** A `p:sp` without a txBody, or a `p:cxnSp` — pure geometry, no text. */
export interface DrawingShape extends ShapeBase {
  type: 'drawing'
}

export interface ImageShape extends ShapeBase {
  type: 'image'
  /** Object URL for the media part. Revoke via `disposeDeck`. */
  blobUrl: string
  /** Zip path of the backing media part, e.g. `ppt/media/image1.png`. */
  mediaPath: string
}

/** What we recognized but do not render yet. */
export type PlaceholderKind =
  | 'chart'
  | 'smartart'
  | 'table'
  | 'group'
  | 'video'
  | 'unknown'

export interface PlaceholderShape extends ShapeBase {
  type: 'placeholder'
  kind: PlaceholderKind
}

export type Shape = TextShape | ImageShape | PlaceholderShape | DrawingShape

export interface Slide {
  id: string
  /** Zip path, e.g. `ppt/slides/slide1.xml`. */
  xmlPath: string
  /** In document order, which is also z-order: later shapes paint on top. */
  shapes: Shape[]
}

export interface SlideDeck {
  slideSizeEmu: { w: number; h: number }
  slides: Slide[]
  /** Everything Phase B needs to write back without touching untouched parts. */
  source: {
    zip: JSZip
    /** Raw XML per slide, keyed by zip path. */
    slideXml: Record<string, string>
  }
}
