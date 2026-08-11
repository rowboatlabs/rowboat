/**
 * Text style inheritance: run rPr -> paragraph defRPr(lvl) -> shape lstStyle
 * -> layout placeholder -> master placeholder -> master txStyles (by
 * placeholder type) -> presentation defaultTextStyle -> built-in default.
 *
 * The cascade order follows ECMA-376 Part 1 §21.1.2 as implemented across
 * open-source readers; the merge itself (nearest defined layer wins, per
 * property) is our own code. Bullet glyph and autonumber mapping are our own,
 * from public Wingdings/Symbol tables.
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
import { resolveFirstColor, themeFontOf, type Theme } from './theme.js'
import type { ResolvedBullet, TextAlign } from './types.js'

export interface RunLayerProps {
  sizePt?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  colorHex?: string
  /** Resolved family names — theme +mj/+mn tokens already mapped. */
  latinFont?: string
  eaFont?: string
  csFont?: string
  /**
   * Character tracking in points from `a:rPr@spc` (authored in hundredths).
   * Negative tightens. Design tools author this to make a heading fit its box
   * on exactly one line, so ignoring it re-wraps the text and overflows.
   */
  letterSpacingPt?: number
}

/** One a:lnSpc / a:spcBef / a:spcAft value. Exactly one field is set. */
export interface SpacingSpec {
  /** Fraction, from a:spcPct (val=100000 -> 1). */
  pct?: number
  /** Points, from a:spcPts (val is hundredths of a point). */
  pt?: number
}

/** One layer's contribution for one indent level. undefined = inherit. */
export interface LevelStyle extends RunLayerProps {
  marLEmu?: number
  indentEmu?: number
  align?: TextAlign
  bullet?: ResolvedBullet
  lnSpc?: SpacingSpec
  spcBef?: SpacingSpec
  spcAft?: SpacingSpec
}

export interface ParsedListStyle {
  /** From a:defPPr — applies to every level, below the level-specific entry. */
  def?: LevelStyle
  /** Index 0..8 from a:lvl1pPr..a:lvl9pPr. */
  levels: Array<LevelStyle | undefined>
}

export const EMPTY_LIST_STYLE: ParsedListStyle = { levels: [] }

const ALIGNS: readonly TextAlign[] = ['l', 'ctr', 'r', 'just']

// ------------------------------------------------------------------ bullets

/**
 * Wingdings/Symbol private-use glyphs mapped to close Unicode equivalents.
 * PowerPoint stores either the raw byte char or its F0xx private-use form.
 */
const WINGDINGS_MAP: Record<number, string> = {
  0x6c: '●',
  0x6d: '○',
  0x6e: '■',
  0x6f: '□',
  0x70: '◻',
  0x71: '❑',
  0x72: '❒',
  0x73: '▲',
  0x74: '▼',
  0x75: '◆',
  0x76: '❖',
  0x77: '⬥',
  0xa7: '▪',
  0xa8: '□',
  0xd8: '➢',
  0xde: '➔',
  0xe0: '⇨',
  0xfc: '✓',
  0xfb: '✗',
}

const SYMBOL_MAP: Record<number, string> = {
  0xb7: '•',
  0x2d: '–',
  0xa8: '♦',
}

/** Maps a buChar glyph to something renderable, per its declared font. */
export function bulletCharFor(fontTypeface: string | undefined, char: string): string {
  if (!char) return '•'
  let code = char.codePointAt(0) ?? 0
  // Office often stores symbol-font chars in the F0xx private-use area.
  if (code >= 0xf000 && code <= 0xf0ff) code -= 0xf000
  const font = (fontTypeface ?? '').toLowerCase()
  if (font.startsWith('wingdings')) return WINGDINGS_MAP[code] ?? '•'
  if (font.startsWith('symbol')) return SYMBOL_MAP[code] ?? '•'
  // A regular text font: the character is what it claims to be.
  return code === (char.codePointAt(0) ?? 0) ? char : String.fromCodePoint(code)
}

function toRoman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let out = ''
  let rest = Math.max(1, Math.round(n))
  for (const [value, glyph] of table) {
    while (rest >= value) {
      out += glyph
      rest -= value
    }
  }
  return out
}

function toAlpha(n: number): string {
  let out = ''
  let rest = Math.max(1, Math.round(n))
  while (rest > 0) {
    rest--
    out = String.fromCharCode(97 + (rest % 26)) + out
    rest = Math.floor(rest / 26)
  }
  return out
}

/** Formats one auto-number ordinal per the buAutoNum scheme. */
export function autoNumText(scheme: string, n: number): string {
  switch (scheme) {
    case 'arabicPeriod':
      return `${n}.`
    case 'arabicParenR':
      return `${n})`
    case 'arabicParenBoth':
      return `(${n})`
    case 'arabicPlain':
      return String(n)
    case 'romanUcPeriod':
      return `${toRoman(n).toUpperCase()}.`
    case 'romanLcPeriod':
      return `${toRoman(n)}.`
    case 'romanLcParenR':
      return `${toRoman(n)})`
    case 'alphaUcPeriod':
      return `${toAlpha(n).toUpperCase()}.`
    case 'alphaLcPeriod':
      return `${toAlpha(n)}.`
    case 'alphaLcParenR':
      return `${toAlpha(n)})`
    case 'alphaUcParenR':
      return `${toAlpha(n).toUpperCase()})`
    default:
      return `${n}.`
  }
}

// ------------------------------------------------------------------ parsing

/** Run-level properties from an rPr/defRPr node, theme colors/fonts resolved. */
export function runLayerFromRPr(rPr: XmlNode | undefined, theme: Theme): RunLayerProps {
  if (!rPr) return {}
  const out: RunLayerProps = {}
  const b = attr(rPr, 'b')
  if (b !== undefined) out.bold = b === '1' || b === 'true'
  const i = attr(rPr, 'i')
  if (i !== undefined) out.italic = i === '1' || i === 'true'
  const u = attr(rPr, 'u')
  if (u !== undefined) out.underline = u !== 'none'
  const sz = num(attr(rPr, 'sz'))
  if (sz !== undefined) out.sizePt = sz / 100
  const spc = num(attr(rPr, 'spc'))
  if (spc !== undefined) out.letterSpacingPt = spc / 100
  const kids = childrenOf(rPr)
  const fill = childByLocal(kids, 'solidFill')
  const color = resolveFirstColor(fill, theme)
  if (color) out.colorHex = color.hex
  const face = (name: string): string | undefined => {
    const node = childByLocal(kids, name)
    const typeface = node ? attr(node, 'typeface')?.trim() : undefined
    return typeface ? themeFontOf(theme, typeface) : undefined
  }
  const latin = face('latin')
  if (latin) out.latinFont = latin
  const ea = face('ea')
  if (ea) out.eaFont = ea
  const cs = face('cs')
  if (cs) out.csFont = cs
  return out
}

/** The a:spcPct / a:spcPts child of one spacing element, or undefined. */
function spacingOf(pPrKids: XmlNode[], name: string): SpacingSpec | undefined {
  const node = childByLocal(pPrKids, name)
  if (!node) return undefined
  const kids = childrenOf(node)
  const pctNode = childByLocal(kids, 'spcPct')
  if (pctNode) {
    const v = num(attr(pctNode, 'val'))
    if (v !== undefined) return { pct: v / 100000 }
  }
  const ptsNode = childByLocal(kids, 'spcPts')
  if (ptsNode) {
    const v = num(attr(ptsNode, 'val'))
    if (v !== undefined) return { pt: v / 100 }
  }
  return undefined
}

function bulletOf(pPrKids: XmlNode[], theme: Theme): ResolvedBullet | undefined {
  void theme
  if (childByLocal(pPrKids, 'buNone')) return { kind: 'none' }
  const auto = childByLocal(pPrKids, 'buAutoNum')
  if (auto) {
    return {
      kind: 'auto',
      scheme: attr(auto, 'type') ?? 'arabicPeriod',
      startAt: num(attr(auto, 'startAt')) ?? 1,
    }
  }
  const buChar = childByLocal(pPrKids, 'buChar')
  if (buChar) {
    const font = childByLocal(pPrKids, 'buFont')
    return {
      kind: 'char',
      char: bulletCharFor(font ? attr(font, 'typeface') : undefined, attr(buChar, 'char') ?? '•'),
    }
  }
  return undefined
}

/** One pPr/defPPr/lvlNpPr node -> one cascade layer. */
export function levelStyleFromPPr(pPr: XmlNode | undefined, theme: Theme): LevelStyle {
  if (!pPr) return {}
  const kids = childrenOf(pPr)
  const out: LevelStyle = { ...runLayerFromRPr(childByLocal(kids, 'defRPr'), theme) }
  const marL = num(attr(pPr, 'marL'))
  if (marL !== undefined) out.marLEmu = marL
  const indent = num(attr(pPr, 'indent'))
  if (indent !== undefined) out.indentEmu = indent
  const algn = attr(pPr, 'algn')
  if (algn && (ALIGNS as readonly string[]).includes(algn)) out.align = algn as TextAlign
  const bullet = bulletOf(kids, theme)
  if (bullet) out.bullet = bullet
  const lnSpc = spacingOf(kids, 'lnSpc')
  if (lnSpc) out.lnSpc = lnSpc
  const spcBef = spacingOf(kids, 'spcBef')
  if (spcBef) out.spcBef = spcBef
  const spcAft = spacingOf(kids, 'spcAft')
  if (spcAft) out.spcAft = spcAft
  return out
}

/** An a:lstStyle / p:titleStyle / p:bodyStyle / p:otherStyle / defaultTextStyle. */
export function parseListStyle(node: XmlNode | undefined, theme: Theme): ParsedListStyle {
  if (!node) return EMPTY_LIST_STYLE
  const kids = childrenOf(node)
  const levels: Array<LevelStyle | undefined> = []
  for (let lvl = 0; lvl < 9; lvl++) {
    const pPr = childByLocal(kids, `lvl${lvl + 1}pPr`)
    levels[lvl] = pPr ? levelStyleFromPPr(pPr, theme) : undefined
  }
  const defPPr = childByLocal(kids, 'defPPr')
  return { def: defPPr ? levelStyleFromPPr(defPPr, theme) : undefined, levels }
}

/** The two layers a ParsedListStyle contributes for a given level. */
export function layersOf(style: ParsedListStyle | undefined, level: number): LevelStyle[] {
  if (!style) return []
  const out: LevelStyle[] = []
  const lvl = style.levels[level]
  if (lvl) out.push(lvl)
  if (style.def) out.push(style.def)
  return out
}

/** First defined value wins, walking layers nearest-first. */
export function mergeLevelStyles(layers: readonly LevelStyle[]): LevelStyle {
  const out: LevelStyle = {}
  for (const layer of layers) {
    if (out.marLEmu === undefined && layer.marLEmu !== undefined) out.marLEmu = layer.marLEmu
    if (out.indentEmu === undefined && layer.indentEmu !== undefined) out.indentEmu = layer.indentEmu
    if (out.align === undefined && layer.align !== undefined) out.align = layer.align
    if (out.bullet === undefined && layer.bullet !== undefined) out.bullet = layer.bullet
    if (out.sizePt === undefined && layer.sizePt !== undefined) out.sizePt = layer.sizePt
    if (out.bold === undefined && layer.bold !== undefined) out.bold = layer.bold
    if (out.italic === undefined && layer.italic !== undefined) out.italic = layer.italic
    if (out.underline === undefined && layer.underline !== undefined) out.underline = layer.underline
    if (out.colorHex === undefined && layer.colorHex !== undefined) out.colorHex = layer.colorHex
    if (out.latinFont === undefined && layer.latinFont !== undefined) out.latinFont = layer.latinFont
    if (out.eaFont === undefined && layer.eaFont !== undefined) out.eaFont = layer.eaFont
    if (out.csFont === undefined && layer.csFont !== undefined) out.csFont = layer.csFont
    if (out.letterSpacingPt === undefined && layer.letterSpacingPt !== undefined) {
      out.letterSpacingPt = layer.letterSpacingPt
    }
    if (out.lnSpc === undefined && layer.lnSpc !== undefined) out.lnSpc = layer.lnSpc
    if (out.spcBef === undefined && layer.spcBef !== undefined) out.spcBef = layer.spcBef
    if (out.spcAft === undefined && layer.spcAft !== undefined) out.spcAft = layer.spcAft
  }
  return out
}

// ------------------------------------------------------------- font families

/** Generic CSS family guessed from the primary name, for missing-font fallback. */
function genericFamilyFor(name: string): string {
  const n = name.toLowerCase()
  if (/(courier|consolas|menlo|monaco|mono)/.test(n)) return 'monospace'
  if (/sans/.test(n)) return 'sans-serif'
  if (/(times|georgia|garamond|palatino|baskerville|didot|cambria|bookman|serif)/.test(n)) {
    return 'serif'
  }
  return 'sans-serif'
}

/**
 * CSS font-family for a resolved latin/ea/cs trio: authored families in order
 * (CSS falls back per character, which is what the ea/cs slots are for), then
 * a generic guessed from the primary name. Names are sanitized so the result
 * can be embedded in inline-style HTML attributes.
 */
export function cssFontFamily(
  latin: string | undefined,
  ea: string | undefined,
  cs: string | undefined,
): string | undefined {
  const names = [...new Set([latin, ea, cs].filter((n): n is string => Boolean(n)))]
  if (names.length === 0) return undefined
  const quoted = names.map((n) => `'${n.replace(/['"\\;{}<>&]/g, '')}'`)
  return `${quoted.join(', ')}, ${genericFamilyFor(names[0])}`
}

// -------------------------------------------------- placeholder style routing

/**
 * Which master txStyles table a shape inherits from, per its placeholder type.
 * Title variants use titleStyle, body-ish placeholders bodyStyle, everything
 * else (including plain text boxes) otherStyle.
 */
export function txStyleKindFor(phType: string | undefined, isPlaceholder: boolean): 'title' | 'body' | 'other' {
  if (!isPlaceholder) return 'other'
  const t = phType ?? 'body'
  if (t === 'title' || t === 'ctrTitle') return 'title'
  if (t === 'body' || t === 'subTitle' || t === 'obj' || t === 'txBody') return 'body'
  return 'other'
}

/** Kept-run walk of an a:p node, mirroring parseParagraph's skip rule exactly. */
export function keptRunNodesOf(pNode: XmlNode): Array<{ kind: 'r' | 'fld' | 'br'; rPr?: XmlNode }> {
  const out: Array<{ kind: 'r' | 'fld' | 'br'; rPr?: XmlNode }> = []
  for (const child of childrenOf(pNode)) {
    const tag = tagNameOf(child)
    if (!tag) continue
    const name = localNameOf(tag)
    if (name === 'r' || name === 'fld') {
      const t = childByLocal(childrenOf(child), 't')
      const text = t
        ? childrenOf(t)
            .map((n) => (typeof n['#text'] === 'string' ? (n['#text'] as string) : ''))
            .join('')
        : ''
      if (text === '') continue
      out.push({ kind: name, rPr: childByLocal(childrenOf(child), 'rPr') })
    } else if (name === 'br') {
      out.push({ kind: 'br', rPr: descend(child, 'rPr') })
    }
  }
  return out
}
