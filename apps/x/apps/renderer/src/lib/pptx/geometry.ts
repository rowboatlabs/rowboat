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
} from './parse'
import { resolveFirstColor, type Theme } from './theme'
import type { Fill, GradientStop, LineStyle, PresetGeometry, ShapeVisual } from './types'

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
const DEFAULT_LINE_EMU = 9525

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
