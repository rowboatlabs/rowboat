import type { ActiveMention } from '@/hooks/use-mention-detection'

type MentionRange = {
  start: number
  end: number
}

export type MentionHighlightSegment = {
  text: string
  highlighted: boolean
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const getMentionHighlightSegments = (
  value: string,
  activeMention?: ActiveMention | null,
  mentionLabels?: string[]
) => {
  if (!value) {
    return { segments: [], hasHighlights: false }
  }

  const ranges: MentionRange[] = []
  const addRange = (start: number, end: number) => {
    if (end <= start) return
    ranges.push({ start, end })
  }

  // First, match multi-word mention labels (like "AI Agents")
  if (mentionLabels && mentionLabels.length > 0) {
    const uniqueLabels = Array.from(
      new Set(mentionLabels.map((label) => label.trim()).filter(Boolean))
    )

    for (const label of uniqueLabels) {
      const escaped = escapeRegExp(label)
      const labelRegex = new RegExp(
        `(^|\\s)(@${escaped})(?=$|\\s|[\\)\\]\\}\\.,!?;:])`,
        'gi'
      )
      let labelMatch: RegExpExecArray | null
      while ((labelMatch = labelRegex.exec(value)) !== null) {
        const prefix = labelMatch[1] ?? ''
        const mention = labelMatch[2] ?? ''
        if (!mention) continue
        const start = labelMatch.index + prefix.length
        const end = start + mention.length
        addRange(start, end)
      }
    }
  }

  // Then match single-word mentions (fallback for non-file mentions)
  const mentionRegex = /(^|[\s])(@[^\s@]+)/g
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(value)) !== null) {
    const prefix = match[1] ?? ''
    const mention = match[2] ?? ''
    if (!mention) continue
    const start = match.index + prefix.length
    const end = start + mention.length
    addRange(start, end)
  }

  // Highlight active mention trigger (just the @) when typing
  if (activeMention && activeMention.query.length === 0) {
    const start = activeMention.triggerIndex
    if (start >= 0 && start < value.length && value[start] === '@') {
      addRange(start, Math.min(value.length, start + 1))
    }
  }

  if (ranges.length === 0) {
    return { segments: [{ text: value, highlighted: false }], hasHighlights: false }
  }

  // Sort and merge overlapping ranges
  ranges.sort((a, b) => a.start - b.start)
  const merged: MentionRange[] = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (!last || range.start > last.end) {
      merged.push({ ...range })
      continue
    }
    last.end = Math.max(last.end, range.end)
  }

  // Build segments from merged ranges
  const segments: MentionHighlightSegment[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor) {
      segments.push({
        text: value.slice(cursor, range.start),
        highlighted: false,
      })
    }
    if (range.end > range.start) {
      segments.push({
        text: value.slice(range.start, range.end),
        highlighted: true,
      })
    }
    cursor = range.end
  }
  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor), highlighted: false })
  }

  return { segments, hasHighlights: true }
}
