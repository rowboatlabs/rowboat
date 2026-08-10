/**
 * Pure helpers for the "Generate with AI" outline-review state — reorder,
 * delete, add, and field edits on a working copy of a DeckOutline's slides,
 * plus the clarify round-trip request shaping. No React, no IO, so the flow's
 * logic is unit-testable without mounting the dialog.
 */

import type { deck as deckShared } from '@x/shared'

export type DeckOutline = deckShared.DeckOutline
export type DeckOutlineSlide = deckShared.DeckOutlineSlide
export type GenerateDeckOutlineRequest = deckShared.GenerateDeckOutlineRequest

/** A blank slide row the "Add slide" affordance appends. */
export function blankSlide(): DeckOutlineSlide {
  return { layout: 'title-body', heading: '', bullets: [] }
}

export function moveSlide(
  slides: readonly DeckOutlineSlide[],
  index: number,
  dir: -1 | 1,
): DeckOutlineSlide[] {
  const to = index + dir
  if (index < 0 || index >= slides.length || to < 0 || to >= slides.length) {
    return [...slides]
  }
  const next = [...slides]
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved)
  return next
}

export function deleteSlide(
  slides: readonly DeckOutlineSlide[],
  index: number,
): DeckOutlineSlide[] {
  if (index < 0 || index >= slides.length) return [...slides]
  return slides.filter((_, i) => i !== index)
}

export function addSlide(slides: readonly DeckOutlineSlide[]): DeckOutlineSlide[] {
  return [...slides, blankSlide()]
}

/** Inserts a blank bullets slide at `index` (clamped below the title slide). */
export function insertSlideAt(
  slides: readonly DeckOutlineSlide[],
  index: number,
): DeckOutlineSlide[] {
  const at = Math.max(1, Math.min(index, slides.length))
  const next = [...slides]
  next.splice(at, 0, blankSlide())
  return next
}

/** Moves a slide to an arbitrary position (card drag). The title slide stays. */
export function reorderSlides(
  slides: readonly DeckOutlineSlide[],
  from: number,
  to: number,
): DeckOutlineSlide[] {
  if (from <= 0 || from >= slides.length) return [...slides]
  const target = Math.max(1, Math.min(to, slides.length - 1))
  if (target === from) return [...slides]
  const next = [...slides]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

/** Switches a slide's visual pattern; content fields are left as they are. */
export function updatePattern(
  slides: readonly DeckOutlineSlide[],
  index: number,
  pattern: DeckOutlineSlide['pattern'],
): DeckOutlineSlide[] {
  return slides.map((s, i) => (i === index ? { ...s, pattern } : s))
}

export function updateHeading(
  slides: readonly DeckOutlineSlide[],
  index: number,
  heading: string,
): DeckOutlineSlide[] {
  return slides.map((s, i) => (i === index ? { ...s, heading } : s))
}

/** Bullets are edited as a newline-joined textarea; empty lines are dropped. */
export function bulletsToText(slide: DeckOutlineSlide): string {
  if (slide.bullets && slide.bullets.length > 0) return slide.bullets.join('\n')
  return slide.body ?? ''
}

export function updateBullets(
  slides: readonly DeckOutlineSlide[],
  index: number,
  text: string,
): DeckOutlineSlide[] {
  const bullets = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  return slides.map((s, i) => {
    if (i !== index) return s
    // Moving text into bullets supersedes any prior narrative body.
    const { body: _body, ...rest } = s
    return { ...rest, bullets }
  })
}

/**
 * The request for a clarify round-trip: the original prompt/options plus the
 * answers gathered for the questions the model asked. Only answered rows are
 * sent, in question order, so the model can line them up with its questions.
 */
export function clarifyRequest(
  base: GenerateDeckOutlineRequest,
  answers: readonly string[],
): GenerateDeckOutlineRequest {
  const trimmed = answers.map((a) => a.trim())
  return { ...base, answers: trimmed.filter((a) => a.length > 0) }
}

/** True when every asked question has a non-empty answer. */
export function clarifyComplete(
  questions: readonly string[] | undefined,
  answers: readonly string[],
): boolean {
  if (!questions || questions.length === 0) return true
  return questions.every((_, i) => (answers[i] ?? '').trim().length > 0)
}
