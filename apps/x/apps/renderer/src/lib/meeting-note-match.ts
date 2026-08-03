import type { UpcomingEvent } from '@/lib/calendar-events'

const MEETINGS_ROOT = 'knowledge/Meetings'

// Loose name matching: meeting notes are titled after the event, but with
// underscores, suffixes, or truncation — compare on normalized word soup.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Find the captured meeting note for a calendar event, if one exists.
 * Notes live under `knowledge/Meetings/<source>/<YYYY-MM-DD>/<name>.md`
 * (the source folder — `rowboat/`, `fireflies/` — may be absent or nested) —
 * match the event's local date folder anywhere in the path, then the title;
 * a lone note on that day counts as a match even when the names diverge.
 */
export async function findMeetingNoteForEvent(event: UpcomingEvent): Promise<string | null> {
  try {
    const exists = await window.ipc.invoke('workspace:exists', { path: MEETINGS_ROOT })
    if (!exists.exists) return null
    const entries = await window.ipc.invoke('workspace:readdir', {
      path: MEETINGS_ROOT,
      opts: { recursive: true, includeHidden: false, includeStats: false },
    })
    const dateSegment = `/${event.dateKey}/`
    const notes = entries.filter(
      (e) =>
        e.kind === 'file' &&
        e.name.endsWith('.md') &&
        e.path.includes(dateSegment) &&
        !e.path.startsWith(`${MEETINGS_ROOT}/prep/`),
    )
    if (notes.length === 0) return null
    const target = normalize(event.summary)
    if (target) {
      const byTitle = notes.find((n) => {
        const name = normalize(n.name)
        return name.includes(target) || target.includes(name)
      })
      if (byTitle) return byTitle.path
    }
    return notes.length === 1 ? notes[0].path : null
  } catch {
    return null
  }
}
