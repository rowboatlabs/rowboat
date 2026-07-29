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

interface ShapeBase {
  /** `p:cNvPr@id` when present, else a synthesized `idx:<n>`. */
  id: string
  /** Zip path of the slide this shape lives on, e.g. `ppt/slides/slide1.xml`. */
  slideXmlPath: string
  nodePath: NodePath
  xfrmEmu: RectEmu
}

export interface TextShape extends ShapeBase {
  type: 'text'
  paragraphs: Paragraph[]
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

export type Shape = TextShape | ImageShape | PlaceholderShape

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
