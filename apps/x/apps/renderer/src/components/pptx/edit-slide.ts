/**
 * AI slide editing: turn a rendered slide back into outline form for the
 * model, then plan how to apply the model's edited slide.
 *
 * THE APPLY DECISION. Two paths, chosen by `planSlideEdit`:
 *
 *  - TEXT: same pattern and same slot structure → per-shape text edits on the
 *    existing shapes, so everything else in the file stays byte-identical and
 *    the slide keeps its identity (selection, comments, part path).
 *  - REPLACE: the pattern changed, or the slot structure did (a card added or
 *    removed, a caption/attribution/subtitle appearing or disappearing) →
 *    re-synthesize the slide's content in place. Slots whose paragraphs share
 *    one style (bullets, card lines, support lines) tolerate count changes as
 *    text; slots whose paragraphs have DIFFERENT roles (section heading +
 *    tagline, quote + attribution) replace on count change, because a text
 *    edit would clone the wrong paragraph's styling onto the new line.
 *
 * Everything here is pure; the editor owns IPC and the edit-set commit.
 */

import type { deck as deckShared } from '@x/shared'
import type { EditedParagraph } from '@/lib/pptx/serialize'
import type { NodePath, Paragraph, Shape, Slide, TextShape } from '@/lib/pptx/types'

type DeckOutlineSlide = deckShared.DeckOutlineSlide
type DeckSlidePattern = deckShared.DeckSlidePattern

const SLIDE_W = 12192000
const SLIDE_H = 6858000
const EMU_PER_IN = 914400

// --------------------------------------------------------------- utilities

/** One string per paragraph (runs joined), for a text shape. */
export function paraLines(shape: TextShape): string[] {
  return shape.paragraphs.map((p) => p.runs.map((r) => r.text).join(''))
}

function textShapes(slide: Slide): TextShape[] {
  return slide.shapes.filter((s): s is TextShape => s.type === 'text')
}

function solidHex(shape: Shape): string | undefined {
  const fill = shape.visual?.fill
  return fill?.kind === 'solid' ? fill.hex : undefined
}

function isFilled(shape: Shape): boolean {
  return solidHex(shape) !== undefined
}

/** Non-empty trimmed paragraph lines. */
function contentLines(shape: TextShape): string[] {
  return paraLines(shape)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function maxRunSizePt(shape: TextShape): number {
  let max = 0
  for (const p of shape.paragraphs) {
    for (const r of p.runs) {
      if (r.sizePt !== undefined && r.sizePt > max) max = r.sizePt
    }
  }
  return max
}

// -------------------------------------------------------- pattern detection

/**
 * Which pattern a slide's shape signature corresponds to. Built for the
 * shapes our own synthesizer emits; anything unrecognised is 'bullets', whose
 * slot mapping (first text shape = heading, second = body) degrades gracefully
 * on arbitrary decks.
 */
export function detectPattern(slide: Slide): DeckSlidePattern {
  const shapes = slide.shapes
  const texts = textShapes(slide)
  const filled = shapes.filter(isFilled)

  // big-number: the giant stat run is unmistakable.
  if (texts.some((t) => maxRunSizePt(t) >= 100)) return 'big-number'

  // section: a full-bleed filled backdrop.
  const fullBleed = filled.some(
    (f) =>
      f.xfrmEmu.x <= EMU_PER_IN * 0.05 &&
      f.xfrmEmu.y <= EMU_PER_IN * 0.05 &&
      f.xfrmEmu.w >= SLIDE_W * 0.97 &&
      f.xfrmEmu.h >= SLIDE_H * 0.97,
  )
  if (fullBleed) return 'section'

  // two-column: two mid-size filled cards side by side.
  const cards = filled.filter((f) => f.xfrmEmu.w >= SLIDE_W * 0.25 && f.xfrmEmu.h >= EMU_PER_IN)
  if (cards.length >= 2) return 'two-column'

  // quote: one large filled panel (>= half the slide area).
  const large = filled.find((f) => f.xfrmEmu.w * f.xfrmEmu.h >= SLIDE_W * SLIDE_H * 0.5)
  if (large) return 'quote'

  // A small accent bar marks the authored title/closing patterns; the title's
  // bar is horizontally centered, the closing's sits at the left margin.
  const bar = filled.find((f) => f.xfrmEmu.h <= EMU_PER_IN * 0.15)
  if (bar) {
    const centered = Math.abs(bar.xfrmEmu.x + bar.xfrmEmu.w / 2 - SLIDE_W / 2) <= EMU_PER_IN * 0.2
    return centered ? 'title' : 'closing'
  }

  // Placeholder slides: the Title Slide layout's centered title box.
  const first = texts[0]
  if (first && first.xfrmEmu.y >= SLIDE_H * 0.25 && texts.length <= 2) return 'title'
  return 'bullets'
}

// ------------------------------------------------------------- slot mapping

/**
 * A text slot: one existing text shape and the lines the edited outline wants
 * in it. `uniformStyle` slots may grow/shrink their paragraph count as a text
 * edit; the rest must keep it (heterogeneous paragraph roles).
 */
interface Slot {
  shape: TextShape
  lines: string[]
  uniformStyle: boolean
}

/** Mirrors generate.ts's per-pattern content rules. */
function bodyLinesOf(slide: DeckOutlineSlide, limit: number): string[] {
  if (slide.bullets && slide.bullets.length > 0) {
    return slide.bullets.map((b) => b.trim()).filter((b) => b.length > 0).slice(0, limit)
  }
  if (slide.body && slide.body.trim()) {
    return slide.body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(0, limit)
  }
  return []
}

/**
 * The text slots for `edited` laid onto `current`'s shapes, or null when the
 * shape set no longer matches (→ replace). Slot construction mirrors the
 * author functions in generate.ts so an untouched field produces identical
 * lines and therefore no edit.
 */
function slotsFor(
  current: Slide,
  pattern: DeckSlidePattern,
  edited: DeckOutlineSlide,
): Slot[] | null {
  const texts = textShapes(current)
  const unfilled = texts.filter((t) => !isFilled(t))
  const heading = edited.heading.trim()

  switch (pattern) {
    case 'bullets': {
      if (texts.length < 1) return null
      const slots: Slot[] = [{ shape: texts[0], lines: [heading], uniformStyle: false }]
      if (texts[1]) slots.push({ shape: texts[1], lines: bodyLinesOf(edited, 5), uniformStyle: true })
      return slots
    }
    case 'title': {
      const sub = edited.body?.trim() || bodyLinesOf(edited, 1)[0] || ''
      if (texts.length >= 2 && !current.shapes.some(isFilled)) {
        // Placeholder title slide: separate title/subtitle boxes.
        return [
          { shape: texts[0], lines: [heading], uniformStyle: false },
          { shape: texts[1], lines: sub ? [sub] : [], uniformStyle: true },
        ]
      }
      // Authored: one box, heading + optional subtitle line (different roles).
      if (texts.length < 1) return null
      return [{ shape: texts[0], lines: sub ? [heading, sub] : [heading], uniformStyle: false }]
    }
    case 'section': {
      if (unfilled.length < 1) return null
      const sub = edited.body?.trim() || bodyLinesOf(edited, 1)[0] || ''
      return [{ shape: unfilled[0], lines: sub ? [heading, sub] : [heading], uniformStyle: false }]
    }
    case 'closing': {
      if (unfilled.length < 1) return null
      const line = edited.body?.trim() || bodyLinesOf(edited, 1)[0] || ''
      const slots: Slot[] = [{ shape: unfilled[0], lines: [heading], uniformStyle: false }]
      if (unfilled[1]) slots.push({ shape: unfilled[1], lines: line ? [line] : [], uniformStyle: false })
      else if (line) return null // a closing line appeared but there is no shape for it
      return slots
    }
    case 'quote': {
      if (unfilled.length < 1) return null
      const text = edited.quote?.text?.trim() || edited.body?.trim() || heading
      const attribution = edited.quote?.attribution?.trim()
      const lines = attribution ? [`“${text}”`, `— ${attribution}`] : [`“${text}”`]
      return [{ shape: unfilled[0], lines, uniformStyle: false }]
    }
    case 'big-number': {
      // y-ordered text boxes: eyebrow, stat, then caption and/or support.
      const byY = [...texts].sort((a, b) => a.xfrmEmu.y - b.xfrmEmu.y)
      if (byY.length < 2) return null
      const [eyebrow, stat, ...rest] = byY
      const slots: Slot[] = [
        { shape: eyebrow, lines: [heading], uniformStyle: false },
        { shape: stat, lines: [edited.stat?.value?.trim() || heading], uniformStyle: false },
      ]
      const caption = edited.stat?.caption?.trim() ?? ''
      const support = bodyLinesOf(edited, 3)
      // The caption box is one 24pt line; support lines are smaller. Authored
      // runs carry their size explicitly, so read the run, not the cascade.
      const captionShape = rest.find((s) => (s.paragraphs[0]?.runs[0]?.sizePt ?? 0) >= 20)
      const supportShape = rest.find((s) => s !== captionShape)
      if (caption ? !captionShape : Boolean(captionShape)) return null
      if (support.length > 0 ? !supportShape : Boolean(supportShape)) return null
      if (captionShape) slots.push({ shape: captionShape, lines: [caption], uniformStyle: false })
      if (supportShape) slots.push({ shape: supportShape, lines: support, uniformStyle: true })
      return slots
    }
    case 'two-column': {
      const columns = (edited.columns ?? []).slice(0, 2)
      if (columns.length === 0) return null
      // The heading box spans the content width; card text boxes sit lower.
      const headingShape = unfilled.find((t) => t.xfrmEmu.w >= SLIDE_W * 0.6)
      const cardShapes = unfilled.filter((t) => t !== headingShape).sort((a, b) => a.xfrmEmu.x - b.xfrmEmu.x)
      if (!headingShape || cardShapes.length !== columns.length) return null
      const slots: Slot[] = [{ shape: headingShape, lines: [heading], uniformStyle: false }]
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]
        const colHeading = col.heading.trim()
        const lines = [
          ...(colHeading ? [colHeading] : []),
          ...col.lines.map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 4),
        ]
        // The first paragraph's role (card heading vs body) must not flip.
        if (Boolean(colHeading) !== hasCardHeading(cardShapes[i])) return null
        slots.push({ shape: cardShapes[i], lines, uniformStyle: true })
      }
      return slots
    }
  }
}

/** A card's first paragraph is a heading iff it renders bolder/larger than the rest. */
function hasCardHeading(shape: TextShape): boolean {
  const first = shape.display?.paragraphs[0]?.runs[0] ?? shape.display?.paragraphs[0]?.defaultRun
  if (!first) return shape.paragraphs.length > 1
  return Boolean(first.bold) || first.sizePt >= 18
}

// ------------------------------------------------------------------- plan

export type ApplyPlan =
  | { kind: 'noop' }
  | { kind: 'replace' }
  | { kind: 'text'; changes: Array<{ nodePath: NodePath; lines: string[] }> }

/**
 * Decides how the edited outline lands on the current slide. See the module
 * doc for the decision rule.
 */
export function planSlideEdit(
  current: Slide,
  currentPattern: DeckSlidePattern,
  edited: DeckOutlineSlide,
): ApplyPlan {
  // An absent pattern means "unchanged" — the model is only required to state
  // one when it intends a change.
  const nextPattern = edited.pattern ?? currentPattern
  if (nextPattern !== currentPattern) return { kind: 'replace' }

  const slots = slotsFor(current, currentPattern, edited)
  if (!slots) return { kind: 'replace' }

  const changes: Array<{ nodePath: NodePath; lines: string[] }> = []
  for (const slot of slots) {
    const currentLines = contentLines(slot.shape)
    const nextLines = slot.lines
    const same =
      currentLines.length === nextLines.length && currentLines.every((l, i) => l === nextLines[i])
    if (same) continue
    // Paragraph-count changes are only safe as text when the slot's
    // paragraphs share one style; otherwise the new line would clone a
    // paragraph with a different role.
    if (!slot.uniformStyle && currentLines.length !== nextLines.length) return { kind: 'replace' }
    changes.push({ nodePath: slot.shape.nodePath, lines: nextLines })
  }
  return changes.length === 0 ? { kind: 'noop' } : { kind: 'text', changes }
}

// -------------------------------------------------------------- extraction

/** The current slide in outline form, for the model to edit. */
export function extractOutlineSlide(slide: Slide): { pattern: DeckSlidePattern; outline: DeckOutlineSlide } {
  const pattern = detectPattern(slide)
  const texts = textShapes(slide)
  const unfilled = texts.filter((t) => !isFilled(t))
  const layout: DeckOutlineSlide['layout'] = pattern === 'title' ? 'title' : 'title-body'
  const base = { layout, pattern }

  switch (pattern) {
    case 'big-number': {
      const byY = [...texts].sort((a, b) => a.xfrmEmu.y - b.xfrmEmu.y)
      const statShape = byY.find((t) => maxRunSizePt(t) >= 100)
      const others = byY.filter((t) => t !== statShape)
      const heading = others[0] ? contentLines(others[0])[0] ?? '' : ''
      const tail = others.slice(1)
      const caption = tail.find((s) => (s.paragraphs[0]?.runs[0]?.sizePt ?? 0) >= 20)
      const support = tail.find((s) => s !== caption)
      return {
        pattern,
        outline: {
          ...base,
          heading: heading || 'Metric',
          stat: {
            value: statShape ? contentLines(statShape)[0] ?? '' : '',
            caption: caption ? contentLines(caption)[0] ?? '' : '',
          },
          ...(support ? { bullets: contentLines(support) } : {}),
        },
      }
    }
    case 'quote': {
      const lines = unfilled[0] ? contentLines(unfilled[0]) : []
      const text = (lines[0] ?? '').replace(/^“/, '').replace(/”$/, '')
      const attribution = (lines[1] ?? '').replace(/^—\s*/, '')
      return {
        pattern,
        outline: {
          ...base,
          heading: text || 'Quote',
          quote: { text, ...(attribution ? { attribution } : {}) },
        },
      }
    }
    case 'two-column': {
      const headingShape = unfilled.find((t) => t.xfrmEmu.w >= SLIDE_W * 0.6)
      const cardShapes = unfilled.filter((t) => t !== headingShape).sort((a, b) => a.xfrmEmu.x - b.xfrmEmu.x)
      return {
        pattern,
        outline: {
          ...base,
          heading: headingShape ? contentLines(headingShape)[0] ?? '' : '',
          columns: cardShapes.map((card) => {
            const lines = contentLines(card)
            return hasCardHeading(card)
              ? { heading: lines[0] ?? '', lines: lines.slice(1) }
              : { heading: '', lines }
          }),
        },
      }
    }
    case 'section':
    case 'closing':
    case 'title': {
      const lines = unfilled.flatMap((t) => contentLines(t))
      return {
        pattern,
        outline: {
          ...base,
          heading: lines[0] ?? '',
          ...(lines[1] ? { body: lines[1] } : {}),
        },
      }
    }
    case 'bullets': {
      const heading = texts[0] ? contentLines(texts[0])[0] ?? '' : ''
      const bullets = texts[1] ? contentLines(texts[1]) : []
      return {
        pattern,
        outline: { ...base, heading, ...(bullets.length > 0 ? { bullets } : {}) },
      }
    }
  }
}

// ----------------------------------------------------------- paragraph build

/**
 * Target lines as EditedParagraph[]. Each paragraph anchors to the original
 * paragraph at its own index (clamped to the last), so a slot whose
 * paragraphs share a style extends naturally and per-index roles are kept;
 * runs carry the anchored run's formatting the way the overlay's commit does.
 */
export function linesToEditedParagraphs(original: Paragraph[], lines: string[]): EditedParagraph[] {
  if (lines.length === 0) {
    return [{ srcPara: original.length > 0 ? 0 : undefined, runs: [] }]
  }
  return lines.map((text, i) => {
    const srcPara = original.length > 0 ? Math.min(i, original.length - 1) : undefined
    const srcRun = srcPara !== undefined && original[srcPara].runs.length > 0 ? 0 : undefined
    const src = srcPara !== undefined && srcRun !== undefined ? original[srcPara].runs[srcRun] : undefined
    return {
      align: srcPara !== undefined ? original[srcPara].align : undefined,
      srcPara,
      runs: [
        {
          text,
          srcPara,
          srcRun,
          bold: src?.bold,
          italic: src?.italic,
          underline: src?.underline,
          sizePt: src?.sizePt,
          colorHex: src?.colorHex,
          latinFont: src?.latinFont,
        },
      ],
    }
  })
}
