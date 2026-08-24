/**
 * Shape visuals: fill, line, preset geometry, rotation/flips.
 *
 * Style references (`p:style`/`a:fillRef`/`a:lnRef`) resolve through the
 * theme's fmtScheme with the reference color substituted for `phClr` — that
 * lazy substitution mirrors how pptx-viewer (Apache-2.0) treats the format
 * scheme; the parsing here is our own. Explicit spPr fills always win over
 * style references, per ECMA-376.
 *
 * Display-only: nothing here feeds the serializer's validation derivation.
 */

import {
  attr,
  childByLocal,
  childrenOf,
  descend,
  localNameOf,
  num,
  tagNameOf,
  type XmlNode,
} from './parse.js'
import { resolveFirstColor, type Theme } from './theme.js'
import type { Fill, GradientStop, LineStyle, PresetGeometry, ShapeVisual } from './types.js'

const FILL_LOCALS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']

// ------------------------------------------------------------------- fills

function gradientFrom(gradNode: XmlNode, theme: Theme, phClr?: string): Fill {
  const stops: GradientStop[] = []
  const gsLst = descend(gradNode, 'gsLst')
  if (gsLst) {
    for (const gs of childrenOf(gsLst)) {
      const tag = tagNameOf(gs)
      if (!tag || localNameOf(tag) !== 'gs') continue
      const pos = (num(attr(gs, 'pos')) ?? 0) / 100000
      const color = resolveFirstColor(gs, theme, phClr)
      if (color) stops.push({ pos, hex: color.hex, alpha: color.alpha })
    }
  }
  stops.sort((a, b) => a.pos - b.pos)
  if (stops.length === 0) return { kind: 'none' }
  if (stops.length === 1) return { kind: 'solid', hex: stops[0].hex, alpha: stops[0].alpha }
  const lin = descend(gradNode, 'lin')
  const angDeg = lin ? (num(attr(lin, 'ang')) ?? 0) / 60000 : 0
  return { kind: 'gradient', stops, angleDeg: angDeg }
}

/** Resolves one fill node (`a:solidFill`, `a:gradFill`, `a:noFill`, …). */
export function fillFromNode(fillNode: XmlNode, theme: Theme, phClr?: string): Fill {
  const tag = tagNameOf(fillNode)
  const name = tag ? localNameOf(tag) : ''
  if (name === 'solidFill') {
    const color = resolveFirstColor(fillNode, theme, phClr)
    return color ? { kind: 'solid', hex: color.hex, alpha: color.alpha } : { kind: 'none' }
  }
  if (name === 'gradFill') return gradientFrom(fillNode, theme, phClr)
  // noFill, and the fills we can't draw yet (blip/pattern/group).
  return { kind: 'none' }
}

function firstFillChild(kids: XmlNode[]): XmlNode | undefined {
  return kids.find((n) => {
    const tag = tagNameOf(n)
    return tag !== null && FILL_LOCALS.includes(localNameOf(tag))
  })
}

/**
 * Resolves a `p:bg` node to a page fill. `p:bgPr` carries a literal fill;
 * `p:bgRef` points into the theme's format scheme by idx (1..999 →
 * fillStyleLst, ≥1001 → bgFillStyleLst) with its color child as phClr.
 * Best-effort: anything unresolvable comes back `{ kind: 'none' }`, which the
 * renderer draws as the plain white page.
 */
export function backgroundFillOf(bgNode: XmlNode, theme: Theme): Fill {
  const kids = childrenOf(bgNode)
  const bgPr = childByLocal(kids, 'bgPr')
  if (bgPr) {
    const fill = firstFillChild(childrenOf(bgPr))
    return fill ? fillFromNode(fill, theme) : { kind: 'none' }
  }
  const bgRef = childByLocal(kids, 'bgRef')
  if (bgRef) {
    const idx = num(attr(bgRef, 'idx')) ?? 0
    const phClr = resolveFirstColor(bgRef, theme)?.hex
    if (idx === 0 || idx === 1000) return { kind: 'none' }
    const styleNode =
      idx >= 1001 ? theme.bgFillStyleNodes[idx - 1001] : theme.fillStyleNodes[idx - 1]
    if (styleNode) return fillFromNode(styleNode, theme, phClr)
    if (phClr) return { kind: 'solid', hex: phClr }
  }
  return { kind: 'none' }
}

// ------------------------------------------------------------------- lines

const DASH_MAP: Record<string, LineStyle['dash']> = {
  solid: 'solid',
  dash: 'dash',
  lgDash: 'dash',
  sysDash: 'dash',
  dashDot: 'dash',
  lgDashDot: 'dash',
  lgDashDotDot: 'dash',
  sysDashDot: 'dash',
  sysDashDotDot: 'dash',
  dot: 'dot',
  sysDot: 'dot',
}

/** Default line width when `a:ln` has no @w: 0.75pt. */
export const DEFAULT_LINE_EMU = 9525

/** Resolves an `a:ln` node to a line style, or null for explicit noFill. */
export function lineFromLn(lnNode: XmlNode, theme: Theme, phClr?: string): LineStyle | null {
  const kids = childrenOf(lnNode)
  if (childByLocal(kids, 'noFill')) return null
  const solid = childByLocal(kids, 'solidFill')
  const grad = childByLocal(kids, 'gradFill')
  const color = resolveFirstColor(solid ?? grad, theme, phClr)
  if (!color) return null
  const dashNode = childByLocal(kids, 'prstDash')
  const dash = dashNode ? (DASH_MAP[attr(dashNode, 'val') ?? 'solid'] ?? 'solid') : 'solid'
  return {
    hex: color.hex,
    widthEmu: num(attr(lnNode, 'w')) ?? DEFAULT_LINE_EMU,
    dash,
    alpha: color.alpha,
  }
}

// ---------------------------------------------------------------- geometry

function geomFrom(spPrKids: XmlNode[]): PresetGeometry | undefined {
  const prstGeom = childByLocal(spPrKids, 'prstGeom')
  if (prstGeom) {
    const adj: Record<string, number> = {}
    const avLst = descend(prstGeom, 'avLst')
    if (avLst) {
      for (const gd of childrenOf(avLst)) {
        const tag = tagNameOf(gd)
        if (!tag || localNameOf(tag) !== 'gd') continue
        const name = attr(gd, 'name')
        const fmla = attr(gd, 'fmla') ?? ''
        const m = fmla.match(/^val\s+(-?\d+)/)
        if (name && m) adj[name] = Number(m[1])
      }
    }
    return { preset: attr(prstGeom, 'prst') ?? 'rect', adj }
  }
  if (childByLocal(spPrKids, 'custGeom')) return { preset: 'custom', adj: {} }
  return undefined
}

/** Presets we draw as a single stroked line rather than an outlined box. */
export function isLinePreset(preset: string): boolean {
  return preset === 'line' || preset === 'straightConnector1' || preset.startsWith('bentConnector')
}

// ----------------------------------------------------- byte-anchored style

/**
 * A shape's OWN spPr fill/line, with no theme resolution and no `p:style`
 * reference inheritance — the write-back anchor for fill and outline edits,
 * exactly as `parseParagraph` anchors text edits. `ShapeVisual` is the
 * opposite: fully resolved, display-only, and never read by the serializer.
 */
export interface ShapeStyleSnapshot {
  /** Local name of spPr's fill child (`solidFill`, `gradFill`, …); null = none. */
  fill: string | null
  /** Literal `a:srgbClr@val`; absent for theme colours and non-solid fills. */
  fillHex?: string
  hasLine: boolean
  /** Local name of the fill child inside `a:ln`; null when it has none. */
  lineFill: string | null
  lineHex?: string
  /** `a:ln@w` verbatim, so preserving the stroke width is checkable. */
  lineW?: string
}

/** Literal srgbClr directly under a fill element, if any. */
function literalHexOf(fillNode: XmlNode | undefined): string | undefined {
  const srgb = fillNode && descend(fillNode, 'srgbClr')
  const val = srgb && attr(srgb, 'val')
  return val ? val.toUpperCase() : undefined
}

export function shapeStyleSnapshotOf(shapeNode: XmlNode): ShapeStyleSnapshot {
  const out: ShapeStyleSnapshot = { fill: null, hasLine: false, lineFill: null }
  const spPr = childByLocal(childrenOf(shapeNode), 'spPr')
  if (!spPr) return out
  const kids = childrenOf(spPr)

  const fill = firstFillChild(kids)
  if (fill) {
    const tag = tagNameOf(fill)
    out.fill = tag ? localNameOf(tag) : null
    const hex = literalHexOf(fill)
    if (hex) out.fillHex = hex
  }

  const ln = childByLocal(kids, 'ln')
  if (ln) {
    out.hasLine = true
    const lnFill = firstFillChild(childrenOf(ln))
    if (lnFill) {
      const tag = tagNameOf(lnFill)
      out.lineFill = tag ? localNameOf(tag) : null
      const hex = literalHexOf(lnFill)
      if (hex) out.lineHex = hex
    }
    const w = attr(ln, 'w')
    if (w) out.lineW = w
  }
  return out
}

/** Canonical form for the serializer's fail-closed comparison. */
export function normalizeShapeStyle(s: ShapeStyleSnapshot): string {
  return JSON.stringify([s.fill, s.fillHex, s.hasLine, s.lineFill, s.lineHex, s.lineW])
}

// -------------------------------------------------------------- shape visual

/**
 * The visual properties of a `p:sp` / `p:cxnSp` / `p:pic` node: explicit spPr
 * values first, then `p:style` fillRef/lnRef resolved through the theme's
 * format scheme with the reference color as phClr.
 */
export function shapeVisualOf(shapeNode: XmlNode, theme: Theme): ShapeVisual {
  const spPr = childByLocal(childrenOf(shapeNode), 'spPr')
  const style = childByLocal(childrenOf(shapeNode), 'style')
  const out: ShapeVisual = {}
  if (!spPr) return out
  const spPrKids = childrenOf(spPr)

  // Rotation / flips.
  const xfrm = childByLocal(spPrKids, 'xfrm')
  if (xfrm) {
    const rot = num(attr(xfrm, 'rot'))
    if (rot !== undefined && rot !== 0) out.rotDeg = rot / 60000
    if (attr(xfrm, 'flipH') === '1') out.flipH = true
    if (attr(xfrm, 'flipV') === '1') out.flipV = true
  }

  out.geom = geomFrom(spPrKids)

  // Fill: explicit spPr fill wins; otherwise the style fillRef.
  const explicitFill = firstFillChild(spPrKids)
  if (explicitFill) {
    out.fill = fillFromNode(explicitFill, theme)
  } else if (style) {
    const fillRef = descend(style, 'fillRef')
    const idx = fillRef ? (num(attr(fillRef, 'idx')) ?? 0) : 0
    if (fillRef && idx >= 1 && idx < 1000) {
      const phClr = resolveFirstColor(fillRef, theme)?.hex
      const themeFill = theme.fillStyleNodes[idx - 1]
      out.fill = themeFill
        ? fillFromNode(themeFill, theme, phClr)
        : phClr
          ? { kind: 'solid', hex: phClr }
          : undefined
    }
    // idx 0 = no fill from style; idx >= 1000 = background fills (not drawn).
  }

  // Line: explicit a:ln wins; otherwise the style lnRef.
  const ln = childByLocal(spPrKids, 'ln')
  if (ln) {
    const line = lineFromLn(ln, theme)
    if (line) out.line = line
  } else if (style) {
    const lnRef = descend(style, 'lnRef')
    const idx = lnRef ? (num(attr(lnRef, 'idx')) ?? 0) : 0
    if (lnRef && idx >= 1) {
      const phClr = resolveFirstColor(lnRef, theme)?.hex
      const themeLn = theme.lineStyleNodes[idx - 1]
      const line = themeLn
        ? lineFromLn(themeLn, theme, phClr)
        : phClr
          ? { hex: phClr, widthEmu: DEFAULT_LINE_EMU, dash: 'solid' as const }
          : null
      if (line) out.line = line
    }
  }

  return out
}
