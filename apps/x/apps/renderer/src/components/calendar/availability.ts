import { localDateKey } from '@/lib/calendar-events'
import type { AvailabilitySlot } from './week-grid'

// Merge overlapping/touching windows on the same day and sort chronologically.
export function mergeAvailabilitySlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const sorted = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime())
  const merged: AvailabilitySlot[] = []
  for (const slot of sorted) {
    const last = merged[merged.length - 1]
    if (last && localDateKey(last.start) === localDateKey(slot.start) && slot.start.getTime() <= last.end.getTime()) {
      if (slot.end.getTime() > last.end.getTime()) last.end = new Date(slot.end)
    } else {
      merged.push({ start: new Date(slot.start), end: new Date(slot.end) })
    }
  }
  return merged
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Clipboard text for the merged windows, one line per day, with the local
// timezone spelled out so recipients elsewhere aren't left guessing.
export function formatAvailabilityText(slots: AvailabilitySlot[]): string {
  const merged = mergeAvailabilitySlots(slots)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const lines: string[] = [`Here's when I'm available (times in ${tz}):`, '']
  let lastDay = ''
  for (const slot of merged) {
    const dayKey = localDateKey(slot.start)
    const range = `${timeLabel(slot.start)} – ${timeLabel(slot.end)}`
    if (dayKey !== lastDay) {
      const dayLabel = slot.start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      lines.push(`${dayLabel}: ${range}`)
      lastDay = dayKey
    } else {
      lines[lines.length - 1] += `, ${range}`
    }
  }
  return lines.join('\n')
}
