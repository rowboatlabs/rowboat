import { extractConferenceLink } from '@/lib/calendar-event'

export const CALENDAR_DIR = 'calendar_sync'

export function isCalendarPath(path: string | undefined): boolean {
  return typeof path === 'string' && (path === CALENDAR_DIR || path.startsWith(`${CALENDAR_DIR}/`))
}

export type RawCalendarEvent = {
  id?: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  location?: string
  description?: string
  htmlLink?: string
  status?: string
  creator?: CalendarPerson
  organizer?: CalendarPerson
  attendees?: CalendarAttendee[]
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
  hangoutLink?: string
  conferenceLink?: string
  // Present on instances of a repeating series (sync expands singleEvents).
  recurringEventId?: string
  // Stamped by the sync loop on events from non-primary calendars.
  rowboatCalendarId?: string
}

// Entry from calendar_sync/calendars.json (written by the sync loop).
export type CalendarMeta = {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
  foregroundColor?: string
  accessRole?: string
  selected?: boolean
}

export type CalendarPerson = {
  email?: string
  displayName?: string
  self?: boolean
}

export type CalendarAttendee = CalendarPerson & {
  responseStatus?: string
  optional?: boolean
}

export type DescriptionPart =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

export type UpcomingEvent = {
  id: string
  summary: string
  start: Date
  end: Date | null
  isAllDay: boolean
  location: string | null
  description: string | null
  htmlLink: string | null
  conferenceLink: string | null
  creator: CalendarPerson | null
  organizer: CalendarPerson | null
  attendees: CalendarAttendee[]
  recurringEventId: string | null // series master id when this is an instance
  calendarId: string // 'primary' or a secondary calendar's id
  color: string | null // calendar color, set for secondary calendars only
  readOnly: boolean // calendar grants no event edits (reader access roles)
  source: string // workspace path to the calendar_sync JSON
  rawStart: { dateTime?: string; date?: string } | undefined
  rawEnd: { dateTime?: string; date?: string } | undefined
  dateKey: string // YYYY-MM-DD (local)
}

export function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Parse an all-day calendar date string ("YYYY-MM-DD") into a local Date at midnight.
export function parseAllDayDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function normalizeEvent(raw: RawCalendarEvent, sourcePath: string): UpcomingEvent | null {
  if (raw.status === 'cancelled') return null
  const declined = raw.attendees?.find((a) => a.self)?.responseStatus === 'declined'
  if (declined) return null

  const allDayStart = raw.start?.date
  const timedStart = raw.start?.dateTime
  const isAllDay = !timedStart && Boolean(allDayStart)

  let start: Date | null = null
  let end: Date | null = null
  if (timedStart) {
    start = new Date(timedStart)
    end = raw.end?.dateTime ? new Date(raw.end.dateTime) : null
  } else if (allDayStart) {
    start = parseAllDayDate(allDayStart)
    // Google's all-day end is exclusive (next day at 00:00) — keep as-is.
    end = raw.end?.date ? parseAllDayDate(raw.end.date) : null
  }
  if (!start || Number.isNaN(start.getTime())) return null

  const conferenceLink = extractConferenceLink(raw as unknown as Record<string, unknown>) ?? null

  return {
    id: raw.id ?? sourcePath,
    summary: raw.summary?.trim() || '(No title)',
    start,
    end,
    isAllDay,
    location: raw.location?.trim() || null,
    description: raw.description?.trim() || null,
    htmlLink: raw.htmlLink ?? null,
    conferenceLink,
    creator: raw.creator ?? null,
    organizer: raw.organizer ?? null,
    attendees: raw.attendees ?? [],
    recurringEventId: raw.recurringEventId ?? null,
    calendarId: raw.rowboatCalendarId ?? 'primary',
    color: null,
    readOnly: false,
    source: sourcePath,
    rawStart: raw.start,
    rawEnd: raw.end,
    dateKey: localDateKey(start),
  }
}

// "#RRGGBB" with an alpha channel appended; non-hex inputs pass through as-is.
export function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `#${m[1]}${a}`
}

export function triggerMeetingCapture(event: UpcomingEvent, openConference: boolean) {
  window.__pendingCalendarEvent = {
    summary: event.summary,
    start: event.rawStart,
    end: event.rawEnd,
    location: event.location ?? undefined,
    htmlLink: event.htmlLink ?? undefined,
    conferenceLink: event.conferenceLink ?? undefined,
    source: event.source,
  }
  if (openConference && event.conferenceLink) {
    window.open(event.conferenceLink, '_blank')
  }
  window.dispatchEvent(new Event('calendar-block:join-meeting'))
}

export function formatEventTimeRange(event: UpcomingEvent): string {
  if (event.isAllDay) return 'All day'
  const start = event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (!event.end) return start
  // If start and end are on different days, show date+time on both ends.
  const sameDay = localDateKey(event.start) === localDateKey(event.end)
  if (!sameDay) {
    const startLong = event.start.toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    const endLong = event.end.toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    return `${startLong} – ${endLong}`
  }
  const end = event.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${start} – ${end}`
}

// Compact range for the upcoming list: drops the leading meridiem when both
// ends share it ("9:00 – 11:00 AM" instead of "9:00 AM – 11:00 AM").
export function formatEventTimeRangeCompact(event: UpcomingEvent): string {
  if (event.isAllDay) return 'All day'
  const startStr = event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (!event.end) return startStr
  const sameDay = localDateKey(event.start) === localDateKey(event.end)
  if (!sameDay) return formatEventTimeRange(event)
  const endStr = event.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const meridiemRe = /\s*[AP]M$/i
  const startMer = startStr.match(meridiemRe)?.[0]?.trim().toUpperCase()
  const endMer = endStr.match(meridiemRe)?.[0]?.trim().toUpperCase()
  if (startMer && endMer && startMer === endMer) {
    return `${startStr.replace(meridiemRe, '')} – ${endStr}`
  }
  return `${startStr} – ${endStr}`
}

// Whether a timed event is happening right now.
export function isEventNow(event: UpcomingEvent): boolean {
  if (event.isAllDay) return false
  const now = Date.now()
  const start = event.start.getTime()
  const end = event.end ? event.end.getTime() : start + 30 * 60 * 1000
  return start <= now && now < end
}

// Human label for the conferencing provider behind an event's join link.
export function meetingPlatformLabel(link: string | null): string | null {
  if (!link) return null
  if (/zoom\.us|zoomgov\.com/i.test(link)) return 'Zoom'
  if (/teams\.(?:microsoft|live)\.com/i.test(link)) return 'Teams'
  if (/meet\.google\.com/i.test(link)) return 'Meet'
  return 'Video call'
}

export function formatEventDetailTime(event: UpcomingEvent): string {
  if (!event.isAllDay) {
    const date = event.start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    return `${date}, ${formatEventTimeRange(event)}`
  }

  const start = event.start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  if (!event.end) return `${start}, all day`

  const exclusiveEnd = addDays(event.end, -1)
  if (localDateKey(exclusiveEnd) === localDateKey(event.start)) return `${start}, all day`

  const end = exclusiveEnd.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  return `${start} – ${end}, all day`
}

export function personLabel(person: CalendarPerson | null | undefined): string | null {
  if (!person) return null
  return person.displayName?.trim() || person.email?.trim() || null
}

export function attendeeLabel(attendee: CalendarAttendee): string | null {
  const label = personLabel(attendee)
  if (!label) return null
  if (attendee.self) return `${label} (you)`
  return label
}

function normalizeDescriptionParts(parts: DescriptionPart[]): DescriptionPart[] {
  const normalized: DescriptionPart[] = []
  for (const part of parts) {
    const text = part.text.replace(/\n{3,}/g, '\n\n')
    if (!text) continue
    const previous = normalized[normalized.length - 1]
    if (previous?.type === 'text' && part.type === 'text') {
      previous.text += text
    } else if (part.type === 'link') {
      normalized.push({ ...part, text })
    } else {
      normalized.push({ type: 'text', text })
    }
  }
  return normalized
}

function isSafeDescriptionHref(value: string): boolean {
  try {
    const url = new URL(value, window.location.href)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function linkifyText(value: string): DescriptionPart[] {
  const parts: DescriptionPart[] = []
  const urlRe = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi
  let lastIndex = 0
  for (const match of value.matchAll(urlRe)) {
    const raw = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) parts.push({ type: 'text', text: value.slice(lastIndex, index) })
    const href = raw.startsWith('www.') ? `https://${raw}` : raw
    parts.push({ type: 'link', text: raw, href })
    lastIndex = index + raw.length
  }
  if (lastIndex < value.length) parts.push({ type: 'text', text: value.slice(lastIndex) })
  return parts
}

export function parseDescriptionParts(value: string): DescriptionPart[] {
  const withLineBreaks = value.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
  if (typeof DOMParser === 'undefined') {
    return normalizeDescriptionParts(linkifyText(withLineBreaks.replace(/<[^>]*>/g, '').trim()))
  }
  const doc = new DOMParser().parseFromString(withLineBreaks, 'text/html')
  const parts: DescriptionPart[] = []

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(...linkifyText(node.textContent ?? ''))
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? ''
      const text = node.textContent?.trim() || href
      if (href && isSafeDescriptionHref(href)) {
        parts.push({ type: 'link', text, href })
        return
      }
    }
    if (node.tagName === 'BR') {
      parts.push({ type: 'text', text: '\n' })
      return
    }
    node.childNodes.forEach(visit)
    if (/^(P|DIV|LI|TR|H[1-6])$/.test(node.tagName)) {
      parts.push({ type: 'text', text: '\n' })
    }
  }

  doc.body.childNodes.forEach(visit)
  return normalizeDescriptionParts(parts).map((part, index, all) => {
    if (index === 0 || index === all.length - 1) return { ...part, text: part.text.trim() }
    return part
  }).filter((part) => part.text.length > 0)
}
