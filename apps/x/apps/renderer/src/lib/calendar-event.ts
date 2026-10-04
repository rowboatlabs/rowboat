/**
 * Matches a video-conference join URL for the providers we support (Zoom,
 * Microsoft Teams, Google Meet). Captures the full URL up to the first
 * whitespace, quote, or angle/round/square bracket.
 */
const MEETING_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com)\/[^\s"'<>)\]]+/i

function findMeetingUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = MEETING_URL_RE.exec(value)
  // Calendar descriptions are often HTML, so decode &amp; back to & in the URL.
  return match ? match[0].replace(/&amp;/g, '&') : undefined
}

/**
 * Extract a video conference link from raw Google Calendar event JSON.
 * Checks conferenceData.entryPoints (video type), hangoutLink, a top-level
 * conferenceLink, then falls back to scanning the location/description for a
 * known meeting URL (Zoom, Microsoft Teams, Google Meet).
 */
export function extractConferenceLink(raw: Record<string, unknown>): string | undefined {
  const confData = raw.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined
  if (confData?.entryPoints) {
    const video = confData.entryPoints.find(ep => ep.entryPointType === 'video')
    if (video?.uri) return video.uri
  }
  if (typeof raw.hangoutLink === 'string') return raw.hangoutLink
  if (typeof raw.conferenceLink === 'string') return raw.conferenceLink
  return findMeetingUrl(raw.location) ?? findMeetingUrl(raw.description)
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * Format the time or date subtitle for an upcoming meeting in the sidebar (2026-10-05, issue #932).
 * Timed events get today's time, tomorrow's time, or an explicit date.
 * All-day events get "All day" when today, "Tmrw · All day" when tomorrow,
 * and a date qualifier (e.g. "9/9 · All day") otherwise.
 */
export function formatMeetingTime(event: { start: Date; isAllDay: boolean }): string {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // All-day events get a date qualifier when not today (2026-10-05, issue #932)
  if (event.isAllDay) {
    if (isSameLocalDay(event.start, now)) return 'All day'
    if (isSameLocalDay(event.start, tomorrow)) return 'Tmrw · All day'
    const date = event.start.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
    return `${date} · All day`
  }

  const time = event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (isSameLocalDay(event.start, now)) return time
  if (isSameLocalDay(event.start, tomorrow)) return `Tmrw ${time}`
  return event.start.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

/**
 * Sort upcoming meetings chronologically across multiple days (2026-10-05, issue #932).
 * Keep all-day first only when start times match.
 */
export function sortUpcomingMeetings<T extends { start: Date; isAllDay: boolean }>(items: T[]): T[] {
  return items.sort((a, b) => {
    const diff = a.start.getTime() - b.start.getTime()
    if (diff !== 0) return diff
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1
    return 0
  })
}

