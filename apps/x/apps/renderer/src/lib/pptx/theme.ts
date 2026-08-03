/**
 * Theme parsing and OOXML color resolution.
 *
 * Portions adapted from pptx-viewer (Apache-2.0), specifically the color
 * transform application order and math (`color-transforms.ts`,
 * `color-primitives.ts`) and the lazy clrMap alias routing
 * (`PptxHandlerRuntimeThemeLoading.ts`): the theme scheme stays the source of
 * truth and `tx1/bg1/tx2/bg2` route through the master's `p:clrMap` at lookup
 * time, so masters that swap text/background mappings resolve correctly.
 *
 * The XML access layer differs from the reference (we use fast-xml-parser's
 * preserveOrder arrays), so the traversal code here is our own; the semantics
 * are the reference's.
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

export interface ResolvedColor {
  /** RRGGBB, uppercase, no '#'. */
  hex: string
  /** 0..1 when an a:alpha transform is present. */
  alpha?: number
}

export interface Theme {
  /** dk1/lt1/dk2/lt2/accent1..6/hlink/folHlink -> RRGGBB. */
  scheme: Record<string, string>
  /** Alias -> scheme slot, from the master's p:clrMap (bg1 -> lt1, …). */
  clrMap: Record<string, string>
  /** Raw fill nodes from a:fmtScheme/a:fillStyleLst, for style fillRef. */
  fillStyleNodes: XmlNode[]
  /** Raw a:ln nodes from a:fmtScheme/a:lnStyleLst, for style lnRef. */
  lineStyleNodes: XmlNode[]
  /** Raw fill nodes from a:fmtScheme/a:bgFillStyleLst, for p:bgRef idx ≥ 1001. */
  bgFillStyleNodes: XmlNode[]
}

export const DEFAULT_CLR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
}

/** The stock Office theme, used when a deck has no theme part. */
const DEFAULT_SCHEME: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
}

export const DEFAULT_THEME: Theme = {
  scheme: DEFAULT_SCHEME,
  clrMap: DEFAULT_CLR_MAP,
  fillStyleNodes: [],
  lineStyleNodes: [],
  bgFillStyleNodes: [],
}

// ------------------------------------------------------------- primitives

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

function toHex2(value: number): string {
  return Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  }
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const cMax = Math.max(rN, gN, bN)
  const cMin = Math.min(rN, gN, bN)
  const delta = cMax - cMin
  const l = (cMax + cMin) / 2
  let s = 0
  if (delta !== 0) s = delta / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (delta !== 0) {
    if (cMax === rN) h = 60 * (((gN - bN) / delta) % 6)
    else if (cMax === gN) h = 60 * ((bN - rN) / delta + 2)
    else h = 60 * ((rN - gN) / delta + 4)
  }
  if (h < 0) h += 360
  return { h, s: clamp01(s), l: clamp01(l) }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sC = clamp01(s)
  const lC = clamp01(l)
  const hN = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * lC - 1)) * sC
  const x = c * (1 - Math.abs(((hN / 60) % 2) - 1))
  const m = lC - c / 2
  let rP = 0
  let gP = 0
  let bP = 0
  if (hN < 60) [rP, gP, bP] = [c, x, 0]
  else if (hN < 120) [rP, gP, bP] = [x, c, 0]
  else if (hN < 180) [rP, gP, bP] = [0, c, x]
  else if (hN < 240) [rP, gP, bP] = [0, x, c]
  else if (hN < 300) [rP, gP, bP] = [x, 0, c]
  else [rP, gP, bP] = [c, 0, x]
  return {
    r: Math.round((rP + m) * 255),
    g: Math.round((gP + m) * 255),
    b: Math.round((bP + m) * 255),
  }
}

/** OOXML thousandth-percent -> unclamped fraction (lumMod can exceed 100%). */
function fraction(value: string | undefined): number | undefined {
  const n = num(value)
  return n === undefined ? undefined : n / 100000
}

/** OOXML 60000ths-of-a-degree angle -> degrees. */
function degrees(value: string | undefined): number | undefined {
  const n = num(value)
  return n === undefined ? undefined : n / 60000
}

// ------------------------------------------------------------- transforms

function transformChild(kids: XmlNode[], name: string): XmlNode | undefined {
  return childByLocal(kids, name)
}

function transformVal(kids: XmlNode[], name: string): string | undefined {
  const node = transformChild(kids, name)
  return node ? attr(node, 'val') : undefined
}

/**
 * Applies the OOXML color transforms found among a color node's children to a
 * base RRGGBB color. Transform order (structural -> shade/tint -> batched HSL
 * -> direct RGB channels) is adapted from pptx-viewer (Apache-2.0), which
 * matches PowerPoint's rendering behaviour; gamma and the rare channel
 * transforms are omitted as out of scope here.
 */
export function applyColorTransforms(baseHex: string, colorNode: XmlNode): string {
  const rgb = hexToRgb(baseHex)
  if (!rgb) return baseHex
  const kids = childrenOf(colorNode)
  let { r, g, b } = rgb

  // 1. Structural.
  if (transformChild(kids, 'comp')) {
    const hsl = rgbToHsl(r, g, b)
    const out = hslToRgb((hsl.h + 180) % 360, hsl.s, hsl.l)
    ;({ r, g, b } = out)
  }
  if (transformChild(kids, 'inv')) {
    r = 255 - r
    g = 255 - g
    b = 255 - b
  }
  if (transformChild(kids, 'gray')) {
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    r = gray
    g = gray
    b = gray
  }

  // 2. Shade & tint: RGB-space mixing toward black / white.
  const shade = fraction(transformVal(kids, 'shade'))
  if (shade !== undefined) {
    const f = clamp01(shade)
    r *= f
    g *= f
    b *= f
  }
  const tint = fraction(transformVal(kids, 'tint'))
  if (tint !== undefined) {
    const f = clamp01(tint)
    r += (255 - r) * f
    g += (255 - g) * f
    b += (255 - b) * f
  }

  // 3. HSL transforms, batched into one round-trip.
  const hueAbs = degrees(transformVal(kids, 'hue'))
  const hueMod = fraction(transformVal(kids, 'hueMod'))
  const hueOff = degrees(transformVal(kids, 'hueOff'))
  const satAbs = fraction(transformVal(kids, 'sat'))
  const satMod = fraction(transformVal(kids, 'satMod'))
  const satOff = fraction(transformVal(kids, 'satOff'))
  const lumAbs = fraction(transformVal(kids, 'lum'))
  const lumMod = fraction(transformVal(kids, 'lumMod'))
  const lumOff = fraction(transformVal(kids, 'lumOff'))
  if (
    hueAbs !== undefined ||
    hueMod !== undefined ||
    hueOff !== undefined ||
    satAbs !== undefined ||
    satMod !== undefined ||
    satOff !== undefined ||
    lumAbs !== undefined ||
    lumMod !== undefined ||
    lumOff !== undefined
  ) {
    const hsl = rgbToHsl(r, g, b)
    if (hueAbs !== undefined) hsl.h = ((hueAbs % 360) + 360) % 360
    if (hueMod !== undefined) hsl.h = (((hsl.h * hueMod) % 360) + 360) % 360
    if (hueOff !== undefined) hsl.h = (((hsl.h + hueOff) % 360) + 360) % 360
    if (satAbs !== undefined) hsl.s = clamp01(satAbs)
    if (satMod !== undefined) hsl.s = clamp01(hsl.s * satMod)
    if (satOff !== undefined) hsl.s = clamp01(hsl.s + satOff)
    if (lumAbs !== undefined) hsl.l = clamp01(lumAbs)
    if (lumMod !== undefined) hsl.l = clamp01(hsl.l * lumMod)
    if (lumOff !== undefined) hsl.l = clamp01(hsl.l + lumOff)
    const out = hslToRgb(hsl.h, hsl.s, hsl.l)
    r = out.r
    g = out.g
    b = out.b
  }

  return `${toHex2(r)}${toHex2(g)}${toHex2(b)}`
}

// ---------------------------------------------------------- color choices

/** Windows system colors that appear in themes; lastClr usually wins anyway. */
const SYSTEM_COLOR_MAP: Record<string, string> = {
  windowText: '000000',
  window: 'FFFFFF',
  btnFace: 'F0F0F0',
  btnText: '000000',
  grayText: '6D6D6D',
  highlight: '0078D7',
  highlightText: 'FFFFFF',
  infoBk: 'FFFFE1',
  infoText: '000000',
  menuText: '000000',
  captionText: '000000',
}

/** The presets that actually show up in decks; unknowns fall back to gray. */
const PRESET_COLOR_MAP: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  lime: '00FF00',
  blue: '0000FF',
  yellow: 'FFFF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  gray: '808080',
  grey: '808080',
  dkGray: 'A9A9A9',
  ltGray: 'D3D3D3',
  darkGray: 'A9A9A9',
  lightGray: 'D3D3D3',
  orange: 'FFA500',
  purple: '800080',
  brown: 'A52A2A',
  silver: 'C0C0C0',
  maroon: '800000',
  navy: '000080',
  teal: '008080',
  olive: '808000',
}

/** scRGB linear-light channel fraction -> companded sRGB byte (IEC 61966-2-1). */
function scrgbToByte(linear: number): number {
  const l = clamp01(linear)
  const companded = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, Math.round(companded * 255)))
}

/**
 * Resolves a scheme slot name through the clrMap alias layer to a theme hex.
 * `tx1` -> clrMap -> `dk1` -> scheme table. Unknown slots fall back to black.
 */
export function schemeColorHex(theme: Theme, slotName: string): string {
  const slot = theme.clrMap[slotName] ?? slotName
  return theme.scheme[slot] ?? theme.scheme[slotName] ?? '000000'
}

/**
 * Resolves one color-choice node (`a:srgbClr` / `a:schemeClr` / `a:sysClr` /
 * `a:prstClr` / `a:scrgbClr` / `a:hslClr`) to a hex color, applying any child
 * transforms. `phClr` supplies the substitution color for style references.
 */
export function resolveColorNode(
  colorNode: XmlNode,
  theme: Theme,
  phClr?: string,
): ResolvedColor | undefined {
  const tag = tagNameOf(colorNode)
  if (!tag) return undefined
  const name = localNameOf(tag)
  const kids = childrenOf(colorNode)

  let base: string | undefined
  if (name === 'srgbClr') {
    const val = (attr(colorNode, 'val') ?? '').trim()
    if (/^[0-9a-fA-F]{6}$/.test(val)) base = val.toUpperCase()
  } else if (name === 'schemeClr') {
    const val = (attr(colorNode, 'val') ?? '').trim()
    if (val === 'phClr') base = phClr ?? schemeColorHex(theme, 'accent1')
    else if (val) base = schemeColorHex(theme, val)
  } else if (name === 'sysClr') {
    const last = (attr(colorNode, 'lastClr') ?? '').trim()
    if (/^[0-9a-fA-F]{6}$/.test(last)) base = last.toUpperCase()
    else base = SYSTEM_COLOR_MAP[(attr(colorNode, 'val') ?? '').trim()]
  } else if (name === 'prstClr') {
    base = PRESET_COLOR_MAP[(attr(colorNode, 'val') ?? '').trim()] ?? '808080'
  } else if (name === 'scrgbClr') {
    const r = fraction(attr(colorNode, 'r'))
    const g = fraction(attr(colorNode, 'g'))
    const b = fraction(attr(colorNode, 'b'))
    if (r !== undefined && g !== undefined && b !== undefined) {
      base = `${toHex2(scrgbToByte(r))}${toHex2(scrgbToByte(g))}${toHex2(scrgbToByte(b))}`
    }
  } else if (name === 'hslClr') {
    const hue = degrees(attr(colorNode, 'hue'))
    const sat = fraction(attr(colorNode, 'sat'))
    const lum = fraction(attr(colorNode, 'lum'))
    if (hue !== undefined && sat !== undefined && lum !== undefined) {
      const rgb = hslToRgb(hue, clamp01(sat), clamp01(lum))
      base = `${toHex2(rgb.r)}${toHex2(rgb.g)}${toHex2(rgb.b)}`
    }
  }
  if (base === undefined) return undefined

  const hex = applyColorTransforms(base, colorNode)
  const alpha = fraction(transformVal(kids, 'alpha'))
  return alpha === undefined ? { hex } : { hex, alpha: clamp01(alpha) }
}

const COLOR_CHOICE_LOCALS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']

/** Resolves the first color-choice child of a container (solidFill, gs, buClr…). */
export function resolveFirstColor(
  container: XmlNode | undefined,
  theme: Theme,
  phClr?: string,
): ResolvedColor | undefined {
  if (!container) return undefined
  for (const child of childrenOf(container)) {
    const tag = tagNameOf(child)
    if (tag && COLOR_CHOICE_LOCALS.includes(localNameOf(tag))) {
      return resolveColorNode(child, theme, phClr)
    }
  }
  return undefined
}

// ------------------------------------------------------------ theme parts

const SCHEME_SLOTS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
]

/** Parses `ppt/theme/themeN.xml` (clrScheme + fmtScheme; fonts out of scope). */
export function parseTheme(themeDoc: XmlNode[]): Theme {
  const root = childByLocal(themeDoc, 'theme')
  const elements = root ? descend(root, 'themeElements') : undefined
  const scheme: Record<string, string> = { ...DEFAULT_SCHEME }

  const clrScheme = elements ? descend(elements, 'clrScheme') : undefined
  if (clrScheme) {
    for (const slot of SCHEME_SLOTS) {
      const slotNode = childByLocal(childrenOf(clrScheme), slot)
      if (!slotNode) continue
      const resolved = resolveFirstColor(slotNode, DEFAULT_THEME)
      if (resolved) scheme[slot] = resolved.hex
    }
  }

  const fmtScheme = elements ? descend(elements, 'fmtScheme') : undefined
  const fmtNodes = (list: string) =>
    (fmtScheme ? childrenOf(descend(fmtScheme, list) ?? {}) : []).filter(
      (n) => tagNameOf(n) !== null,
    )

  return {
    scheme,
    clrMap: { ...DEFAULT_CLR_MAP },
    fillStyleNodes: fmtNodes('fillStyleLst'),
    lineStyleNodes: fmtNodes('lnStyleLst'),
    bgFillStyleNodes: fmtNodes('bgFillStyleLst'),
  }
}

/** Reads the alias routing from a master's `p:clrMap`, or null when absent. */
export function clrMapOfMaster(masterDoc: XmlNode[]): Record<string, string> | null {
  const master = childByLocal(masterDoc, 'sldMaster')
  const clrMap = master ? childByLocal(childrenOf(master), 'clrMap') : undefined
  if (!clrMap) return null
  const out: Record<string, string> = { ...DEFAULT_CLR_MAP }
  for (const alias of Object.keys(DEFAULT_CLR_MAP)) {
    const mapped = attr(clrMap, alias)?.trim()
    if (mapped) out[alias] = mapped
  }
  return out
}
