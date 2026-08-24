/**
 * Synthesized XML for shapes inserted into an existing slide.
 *
 * Pure string building: no scanning, no splicing, no id allocation. The
 * serializer owns where these land, which id they get, and (for pictures)
 * which relationship they reference — this module only decides what the new
 * element looks like, so the shapes it produces re-parse as ordinary model
 * shapes and are then movable, stylable and deletable like any other.
 */

import type { RectEmu } from './types.js'

/** Preset geometries the insert menu offers. */
export type InsertPreset = 'rect' | 'roundRect' | 'ellipse' | 'line'

export type NewShapeSpec =
  | { kind: 'textbox'; xfrmEmu: RectEmu }
  | { kind: 'shape'; preset: InsertPreset; xfrmEmu: RectEmu }
  | {
      kind: 'image'
      xfrmEmu: RectEmu
      /** Lowercase extension without the dot, e.g. `png`. */
      ext: string
      /** The file's bytes, base64. Written verbatim as a new media part. */
      dataBase64: string
      /** Original file name, used only for the shape's display name. */
      name?: string
    }

/** Namespace prefixes taken from the slide being written into. */
export interface XmlPrefixes {
  /** presentationml, usually `p`. */
  p: string
  /** drawingml, usually `a`. */
  a: string
  /** officeDocument relationships, usually `r`. Only pictures need it. */
  r: string
}

const tag = (prefix: string, name: string): string => (prefix ? `${prefix}:${name}` : name)

/** Escapes a value for a double-quoted XML attribute. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
}

function xfrmXml(a: string, rect: RectEmu): string {
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const cx = Math.max(1, Math.round(rect.w))
  const cy = Math.max(1, Math.round(rect.h))
  return (
    `<${tag(a, 'xfrm')}><${tag(a, 'off')} x="${x}" y="${y}"/>` +
    `<${tag(a, 'ext')} cx="${cx}" cy="${cy}"/></${tag(a, 'xfrm')}>`
  )
}

const prstGeomXml = (a: string, preset: string): string =>
  `<${tag(a, 'prstGeom')} prst="${preset}"><${tag(a, 'avLst')}/></${tag(a, 'prstGeom')}>`

/**
 * An empty text body: one paragraph, no runs — the editor's "Add text" state.
 *
 * The lstStyle seeds an explicit `tx1` default. Without it the run inherits
 * from the master's otherStyle, which routinely authors no colour at all, so
 * the text fell through to whatever the cascade happened to resolve — white on
 * some decks, i.e. invisible. `tx1` is the theme's own body-text colour (dark
 * on a light theme), so this follows the deck rather than hardcoding black.
 */
const emptyTxBodyXml = (p: string, a: string, anchor?: string): string =>
  `<${tag(p, 'txBody')}><${tag(a, 'bodyPr')} wrap="square" rtlCol="0"${
    anchor ? ` anchor="${anchor}"` : ''
  }/><${tag(a, 'lstStyle')}><${tag(a, 'lvl1pPr')}><${tag(a, 'defRPr')}>` +
  `<${tag(a, 'solidFill')}><${tag(a, 'schemeClr')} val="tx1"/></${tag(a, 'solidFill')}>` +
  `</${tag(a, 'defRPr')}></${tag(a, 'lvl1pPr')}></${tag(a, 'lstStyle')}>` +
  `<${tag(a, 'p')}><${tag(a, 'endParaRPr')} lang="en-US"/></${tag(a, 'p')}></${tag(p, 'txBody')}>`

/** Theme-following accent fill, so an inserted shape matches the deck. */
const accentFillXml = (a: string): string =>
  `<${tag(a, 'solidFill')}><${tag(a, 'schemeClr')} val="accent1"/></${tag(a, 'solidFill')}>`

const PRESET_NAMES: Record<InsertPreset, string> = {
  rect: 'Rectangle',
  roundRect: 'Rounded Rectangle',
  ellipse: 'Oval',
  line: 'Straight Connector',
}

/**
 * The element to splice in, for a shape that is not a picture. `id` must
 * already be unique within the slide.
 */
export function newShapeXml(spec: NewShapeSpec, id: number, px: XmlPrefixes): string {
  const { p, a } = px
  if (spec.kind === 'image') throw new Error('newShapeXml: pictures use newPictureXml')

  if (spec.kind === 'textbox') {
    // txBox="1" is what marks it a text box rather than a shape with text;
    // no fill and no a:ln, so only the text shows.
    return (
      `<${tag(p, 'sp')}><${tag(p, 'nvSpPr')}>` +
      `<${tag(p, 'cNvPr')} id="${id}" name="TextBox ${id}"/>` +
      `<${tag(p, 'cNvSpPr')} txBox="1"/><${tag(p, 'nvPr')}/></${tag(p, 'nvSpPr')}>` +
      `<${tag(p, 'spPr')}>${xfrmXml(a, spec.xfrmEmu)}${prstGeomXml(a, 'rect')}` +
      `<${tag(a, 'noFill')}/></${tag(p, 'spPr')}>` +
      emptyTxBodyXml(p, a) +
      `</${tag(p, 'sp')}>`
    )
  }

  const isLine = spec.preset === 'line'
  // A line is a stroke, not a filled region: colour goes on a:ln instead.
  const style = isLine
    ? `<${tag(a, 'noFill')}/><${tag(a, 'ln')}>${accentFillXml(a)}</${tag(a, 'ln')}>`
    : accentFillXml(a)
  return (
    `<${tag(p, 'sp')}><${tag(p, 'nvSpPr')}>` +
    `<${tag(p, 'cNvPr')} id="${id}" name="${PRESET_NAMES[spec.preset]} ${id}"/>` +
    `<${tag(p, 'cNvSpPr')}/><${tag(p, 'nvPr')}/></${tag(p, 'nvSpPr')}>` +
    `<${tag(p, 'spPr')}>${xfrmXml(a, spec.xfrmEmu)}${prstGeomXml(a, spec.preset)}${style}` +
    `</${tag(p, 'spPr')}>` +
    (isLine ? '' : emptyTxBodyXml(p, a, 'ctr')) +
    `</${tag(p, 'sp')}>`
  )
}

/** The `p:pic` element for an inserted image, referencing an assigned rId. */
export function newPictureXml(
  spec: Extract<NewShapeSpec, { kind: 'image' }>,
  id: number,
  rId: string,
  px: XmlPrefixes,
): string {
  const { p, a, r } = px
  const name = spec.name ? esc(spec.name) : `Picture ${id}`
  return (
    `<${tag(p, 'pic')}><${tag(p, 'nvPicPr')}>` +
    `<${tag(p, 'cNvPr')} id="${id}" name="${name}"/>` +
    `<${tag(p, 'cNvPicPr')}><${tag(a, 'picLocks')} noChangeAspect="1"/></${tag(p, 'cNvPicPr')}>` +
    `<${tag(p, 'nvPr')}/></${tag(p, 'nvPicPr')}>` +
    `<${tag(p, 'blipFill')}><${tag(a, 'blip')} ${tag(r, 'embed')}="${rId}"/>` +
    `<${tag(a, 'stretch')}><${tag(a, 'fillRect')}/></${tag(a, 'stretch')}></${tag(p, 'blipFill')}>` +
    `<${tag(p, 'spPr')}>${xfrmXml(a, spec.xfrmEmu)}${prstGeomXml(a, 'rect')}</${tag(p, 'spPr')}>` +
    `</${tag(p, 'pic')}>`
  )
}
