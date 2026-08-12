/**
 * Model for the in-house PPTX reader.
 *
 * Phase A renders this read-only. Phase B will edit slides in place, so the
 * model deliberately keeps everything needed to get back to the bytes it came
 * from: the loaded zip, each slide's raw XML, and a stable path from a slide's
 * parsed tree to the node each shape came from.
 */

import type JSZip from 'jszip'
import type { ShapeStyleSnapshot } from './geometry'

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
  /**
   * The run's own `a:latin@typeface`, VERBATIM — a literal family name, or a
   * theme token like `+mn-lt`. Absent when the run inherits its typeface.
   * Byte-anchored like the rest of this model: the serializer re-derives it
   * from the retained XML and compares, so a stale edit fails closed.
   */
  latinFont?: string
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
  /** Ready-to-use CSS font-family. Absent when nothing is authored anywhere. */
  fontFamily?: string
  /**
   * The resolved primary latin typeface (theme tokens already mapped), which
   * is what the font picker shows and offers. `fontFamily` is this plus the
   * ea/cs slots and a generic fallback.
   */
  latinFont?: string
  /**
   * `a:rPr@spc` character tracking in points; negative tightens. Absolute, so
   * unlike the size it is not scaled by normAutofit — same rule as a fixed
   * `a:spcPts` line height.
   */
  letterSpacingPt?: number
}

/** CSS line-height used when no a:lnSpc is authored anywhere in the cascade. */
export const DEFAULT_LINE_HEIGHT = 1.2

/**
 * Resolved a:lnSpc. `mult` is a unitless CSS line-height (spcPct scales the
 * 1.2 default, so 100% keeps today's rendering); `pt` is fixed (a:spcPts).
 */
export type LineSpacing = { kind: 'mult'; value: number } | { kind: 'pt'; pt: number }

/** `a:normAutofit` shrink factors, as fractions (fontScale 1 = unscaled). */
export interface TextAutofit {
  fontScale: number
  lnSpcReduction: number
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
  /** Resolved a:lnSpc; `{ kind: 'mult', value: 1.2 }` when unspecified. */
  lineHeight: LineSpacing
  /** Resolved a:spcBef/a:spcAft in points (spcPct is taken of defaultRun's size). */
  spaceBeforePt: number
  spaceAfterPt: number
  /** Fully resolved style per ORIGINAL run index (explicit rPr over cascade). */
  runs: ResolvedRunStyle[]
  /** The cascade result at this level, for runs with no original anchor. */
  defaultRun: ResolvedRunStyle
}

/** Vertical anchoring of a text body inside its box (`a:bodyPr@anchor`). */
export type TextAnchor = 't' | 'ctr' | 'b'

export interface TextDisplay {
  /** By ORIGINAL paragraph index, matching the as-parsed `paragraphs`. */
  paragraphs: ParagraphDisplay[]
  /** Level-0 cascade result, for wholly new content. */
  defaultRun: ResolvedRunStyle
  /** OOXML defaults to top; `just`/`dist` render as top. */
  anchor: TextAnchor
  /** Shrink-to-fit factors from the shape's own bodyPr, applied at render. */
  autofit?: TextAutofit
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
  /**
   * The shape's OWN spPr fill/line, unresolved. Present for the kinds that
   * can be restyled (`p:sp`, `p:cxnSp`); this is the write-back anchor the
   * serializer re-derives and compares, never the display `visual`.
   */
  style?: ShapeStyleSnapshot
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
  | 'video'
  | 'unknown'

export interface PlaceholderShape extends ShapeBase {
  type: 'placeholder'
  kind: PlaceholderKind
}

/**
 * A `p:grpSp`, walked rather than stubbed. `xfrmEmu` is the group's bounding
 * box in slide space; each child's `xfrmEmu` is likewise already mapped to
 * final slide-space EMU through the group's chOff/chExt transform (nested
 * groups multiply through), so the renderer draws children with no further
 * coordinate work.
 *
 * Children are READ-ONLY: their nodePaths point through the group and must
 * never be handed to the serializer, and the editor exposes no way to select
 * or edit them individually.
 */
export interface GroupShape extends ShapeBase {
  type: 'group'
  children: Shape[]
}

export type Shape = TextShape | ImageShape | PlaceholderShape | DrawingShape | GroupShape

export interface Slide {
  id: string
  /** Zip path, e.g. `ppt/slides/slide1.xml`. */
  xmlPath: string
  /** In document order, which is also z-order: later shapes paint on top. */
  shapes: Shape[]
  /**
   * Node path of this slide's `p:spTree`. Inserted shapes append to it, so
   * this is what gives a not-yet-written shape its real node path — the model
   * shape list cannot supply it, since spTree also holds nvGrpSpPr/grpSpPr.
   */
  spTreePath: NodePath
  /**
   * Resolved page background (slide → layout → master cascade), display only.
   * Absent when no part in the chain declares one; `{ kind: 'none' }` when one
   * is declared but can't be drawn — both render as the white page.
   */
  background?: Fill
  /**
   * Decoration shapes inherited from the master and layout (non-placeholder
   * spTree content), in paint order beneath `shapes`. Render-only and fully
   * inert: their nodePaths point into the layout/master parts — never into
   * this slide — and must never be handed to the serializer. Shared across
   * slides that use the same layout.
   */
  underlay?: Shape[]
}

export interface SlideDeck {
  slideSizeEmu: { w: number; h: number }
  slides: Slide[]
  /**
   * Display-only: key scheme colours of the FIRST slide's theme, so inserted
   * shapes can be previewed in the colour the file will actually get
   * (`schemeClr accent1`) before any save. Multi-master decks with different
   * themes per slide will preview with slide 1's accent; the written XML is a
   * theme reference either way, so the saved file is always right.
   */
  themeColors?: { accent1: string; tx1: string }
  /** Everything Phase B needs to write back without touching untouched parts. */
  source: {
    zip: JSZip
    /** Raw XML per slide, keyed by zip path. */
    slideXml: Record<string, string>
  }
}
