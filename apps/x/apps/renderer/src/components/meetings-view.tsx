import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, ChevronDown, Clock, ExternalLink, Loader2, MapPin, Mic, Square, UserRound, UsersRound, Video, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SettingsDialog } from '@/components/settings-dialog'
import { formatRelativeTime } from '@/lib/relative-time'
import { extractConferenceLink } from '@/lib/calendar-event'
import { cn } from '@/lib/utils'
import type { MeetingTranscriptionState } from '@/hooks/useMeetingTranscription'

const MEETINGS_ROOT = 'knowledge/Meetings'
const CALENDAR_DIR = 'calendar_sync'
const UPCOMING_MAX_DAYS = 4 // today + next 3

type MeetingNoteRow = {
  path: string
  name: string
  dateLabel: string
  mtimeMs: number
}

type MeetingsViewProps = {
  onOpenNote: (path: string) => void
  onTakeMeetingNotes: () => void
  meetingState: MeetingTranscriptionState
  meetingSummarizing?: boolean
}

function isMeetingPath(path: string | undefined): boolean {
  return typeof path === 'string' && (path === MEETINGS_ROOT || path.startsWith(`${MEETINGS_ROOT}/`))
}

function isCalendarPath(path: string | undefined): boolean {
  return typeof path === 'string' && (path === CALENDAR_DIR || path.startsWith(`${CALENDAR_DIR}/`))
}

type RawCalendarEvent = {
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
}

type CalendarPerson = {
  email?: string
  displayName?: string
  self?: boolean
}

type CalendarAttendee = CalendarPerson & {
  responseStatus?: string
  optional?: boolean
}

type DescriptionPart =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

type UpcomingEvent = {
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
  source: string // workspace path to the calendar_sync JSON
  rawStart: { dateTime?: string; date?: string } | undefined
  rawEnd: { dateTime?: string; date?: string } | undefined
  dateKey: string // YYYY-MM-DD (local)
}

type DayGroup = {
  dateKey: string
  date: Date // local start-of-day
  events: UpcomingEvent[]
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Parse an all-day calendar date string ("YYYY-MM-DD") into a local Date at midnight.
function parseAllDayDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function normalizeEvent(raw: RawCalendarEvent, sourcePath: string): UpcomingEvent | null {
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
    source: sourcePath,
    rawStart: raw.start,
    rawEnd: raw.end,
    dateKey: localDateKey(start),
  }
}

function triggerMeetingCapture(event: UpcomingEvent, openConference: boolean) {
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

// Always show today (anchor). For days within the window after today, include
// only those that actually have events — skip empty days.
function selectVisibleDays(allDays: DayGroup[]): DayGroup[] {
  if (allDays.length === 0) return []
  const out: DayGroup[] = [allDays[0]]
  const cap = Math.min(allDays.length, UPCOMING_MAX_DAYS)
  for (let i = 1; i < cap; i++) {
    if (allDays[i].events.length > 0) out.push(allDays[i])
  }
  return out
}

function buildDayWindow(now: Date): DayGroup[] {
  const today = startOfDay(now)
  return Array.from({ length: UPCOMING_MAX_DAYS }, (_, i) => {
    const date = addDays(today, i)
    return { dateKey: localDateKey(date), date, events: [] }
  })
}

function formatEventTimeRange(event: UpcomingEvent): string {
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

function formatEventDetailTime(event: UpcomingEvent): string {
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

function personLabel(person: CalendarPerson | null | undefined): string | null {
  if (!person) return null
  return person.displayName?.trim() || person.email?.trim() || null
}

function attendeeLabel(attendee: CalendarAttendee): string | null {
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

function parseDescriptionParts(value: string): DescriptionPart[] {
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

function UpcomingEvents() {
  const [events, setEvents] = useState<UpcomingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  // Calendar sync uses the native Google OAuth connection.
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const oauthState = await window.ipc.invoke('oauth:getState', null)
        if (!cancelled) setCalendarConnected(oauthState.config?.google?.connected ?? false)
      } catch {
        if (!cancelled) setCalendarConnected(false)
      }
    }
    void check()
    const cleanupOAuthConnect = window.ipc.on('oauth:didConnect', () => { void check() })
    return () => {
      cancelled = true
      cleanupOAuthConnect()
    }
  }, [])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const exists = await window.ipc.invoke('workspace:exists', { path: CALENDAR_DIR })
      if (!exists.exists) {
        setEvents([])
        setError(null)
        return
      }
      const entries = await window.ipc.invoke('workspace:readdir', {
        path: CALENDAR_DIR,
        opts: { recursive: false, includeHidden: false, includeStats: false },
      })
      const jsonEntries = entries.filter((e) => e.kind === 'file' && e.name.endsWith('.json'))

      const now = new Date()
      const todayStart = startOfDay(now)
      const windowEnd = addDays(todayStart, UPCOMING_MAX_DAYS) // exclusive

      const settled = await Promise.allSettled(
        jsonEntries.map(async (entry): Promise<UpcomingEvent | null> => {
          const result = await window.ipc.invoke('workspace:readFile', {
            path: entry.path,
            encoding: 'utf8',
          })
          const raw = JSON.parse(result.data) as RawCalendarEvent
          const ev = normalizeEvent(raw, entry.path)
          if (!ev) return null
          // Event must overlap the [now, windowEnd) range — i.e. not already ended,
          // and not start after the window closes.
          const effectiveEnd = ev.end ?? (ev.isAllDay ? addDays(ev.start, 1) : ev.start)
          if (effectiveEnd <= now) return null
          if (ev.start >= windowEnd) return null
          return ev
        }),
      )

      const collected: UpcomingEvent[] = []
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) collected.push(r.value)
      }
      collected.sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1
        return a.start.getTime() - b.start.getTime()
      })
      setEvents(collected)
      setError(null)
    } catch (err) {
      console.error('Failed to load upcoming events:', err)
      setError('Could not load upcoming events.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents, refreshTick])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const scheduleReload = () => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        timeout = null
        setRefreshTick((t) => t + 1)
      }, 250)
    }
    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      switch (event.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (isCalendarPath(event.path)) scheduleReload()
          break
        case 'moved':
          if (isCalendarPath(event.from) || isCalendarPath(event.to)) scheduleReload()
          break
        case 'bulkChanged':
          if (!event.paths || event.paths.some(isCalendarPath)) scheduleReload()
          break
      }
    })
    // Refresh on the hour so day labels and "ended" filtering stay current.
    const tick = setInterval(() => setRefreshTick((t) => t + 1), 60 * 60 * 1000)
    return () => {
      cleanup()
      clearInterval(tick)
      if (timeout) clearTimeout(timeout)
    }
  }, [])

  const visibleDays = useMemo(() => {
    const window = buildDayWindow(new Date())
    const byKey = new Map(window.map((d) => [d.dateKey, d]))
    for (const ev of events) {
      byKey.get(ev.dateKey)?.events.push(ev)
    }
    return selectVisibleDays(window)
  }, [events])

  const totalVisible = visibleDays.reduce((s, d) => s + d.events.length, 0)
  const now = new Date()
  const todayKey = localDateKey(now)

  return (
    <section className="border-b border-border/60 px-6 pb-6 pt-5">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            Coming up
          </h3>
          {loading && events.length === 0 ? null : (
            <span
              className="text-[11px] uppercase tracking-wider"
              style={{ color: 'var(--gm-text-faint)' }}
            >
              {totalVisible} {totalVisible === 1 ? 'event' : 'events'}
            </span>
          )}
        </div>

        {calendarConnected === false && events.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Calendar className="size-7 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Connect your calendar to see upcoming meetings here.</p>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Calendar className="size-4" />
              Connect your calendar
            </button>
          </div>
        ) : loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-4 text-sm text-muted-foreground">{error}</div>
        ) : (
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: 'var(--gm-border)', background: 'var(--gm-bg)' }}
          >
            {visibleDays.map((day, idx) => (
              <UpcomingDayRow
                key={day.dateKey}
                day={day}
                isToday={day.dateKey === todayKey}
                isLast={idx === visibleDays.length - 1}
              />
            ))}
          </div>
        )}
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab="connections" />
    </section>
  )
}

function UpcomingDayRow({ day, isToday, isLast }: { day: DayGroup; isToday: boolean; isLast: boolean }) {
  const dayNum = day.date.getDate()
  const month = day.date.toLocaleDateString([], { month: 'short' })
  const weekday = day.date.toLocaleDateString([], { weekday: 'short' })

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: '96px minmax(0, 1fr)',
        borderBottom: isLast ? undefined : '1px dashed var(--gm-border-strong)',
      }}
    >
      <div className="flex items-start gap-2 px-4 py-4">
        <span
          className="leading-none"
          style={{ fontSize: 30, fontWeight: 400, color: 'var(--gm-text-strong)' }}
        >
          {dayNum}
        </span>
        <span className="flex flex-col leading-tight">
          <span
            className="flex items-center gap-1"
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--gm-text)' }}
          >
            {month}
            {isToday ? (
              <span
                aria-hidden
                className="inline-block rounded-full"
                style={{ width: 5, height: 5, background: 'var(--gm-accent)' }}
              />
            ) : null}
          </span>
          <span style={{ fontSize: 12, color: 'var(--gm-text-faint)' }}>{weekday}</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-col py-3 pr-3">
        {day.events.length === 0 ? (
          <div
            className="flex w-full items-center gap-3 px-3 py-2 text-sm"
            style={{ color: 'var(--gm-text-faint)', minHeight: 40 }}
          >
            <span aria-hidden className="self-stretch shrink-0" style={{ width: 3 }} />
            <span>{isToday ? 'No events today' : 'No events'}</span>
          </div>
        ) : (
          day.events.map((ev) => <UpcomingEventItem key={ev.id} event={ev} />)
        )}
      </div>
    </div>
  )
}

function UpcomingEventItem({ event }: { event: UpcomingEvent }) {
  const [open, setOpen] = useState(false)

  const titleAndLocation = event.location ? `${event.summary} · ${event.location}` : event.summary

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          title={titleAndLocation}
          className={cn(
            'upcoming-event-row group flex w-full items-center gap-3 px-3 py-2 text-left cursor-pointer',
          )}
          style={{ color: 'var(--gm-text)', minHeight: 40 }}
        >
          <span
            aria-hidden
            className="self-stretch rounded-full"
            style={{ width: 3, background: 'var(--gm-accent)', opacity: 0.55 }}
          />
          <span className="min-w-0 flex-1">
            <span
              className="block truncate"
              style={{ fontSize: 14, fontWeight: 500, color: 'var(--gm-text-strong)' }}
            >
              {event.summary}
            </span>
            <span
              className="mt-0.5 block truncate"
              style={{ fontSize: 12, color: 'var(--gm-text-muted)' }}
            >
              {formatEventTimeRange(event)}
              {event.location ? <span style={{ color: 'var(--gm-text-faint)' }}> · {event.location}</span> : null}
            </span>
          </span>
          <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {event.conferenceLink ? (
              <SplitJoinButton
                onJoinAndNotes={() => triggerMeetingCapture(event, true)}
                onNotesOnly={() => triggerMeetingCapture(event, false)}
              />
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); triggerMeetingCapture(event, false) }}
                onMouseDown={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
                style={{
                  background: 'var(--gm-bg-pill)',
                  color: 'var(--gm-text)',
                  border: '1px solid var(--gm-border)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gm-bg-pill-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gm-bg-pill)' }}
              >
                <Mic className="size-3" />
                Take notes
              </button>
            )}
          </div>
        </div>
      </PopoverTrigger>
      <EventDetailsPopover event={event} onClose={() => setOpen(false)} />
    </Popover>
  )
}

function EventDetailsPopover({ event, onClose }: { event: UpcomingEvent; onClose: () => void }) {
  const organizer = personLabel(event.organizer) ?? personLabel(event.creator)
  const attendees = event.attendees.map(attendeeLabel).filter((label): label is string => Boolean(label))
  const descriptionParts = event.description ? parseDescriptionParts(event.description) : []
  const handleMeetingCapture = (openConference: boolean) => {
    onClose()
    triggerMeetingCapture(event, openConference)
  }

  return (
    <PopoverContent
      align="start"
      side="bottom"
      sideOffset={6}
      className="w-[min(380px,calc(100vw-32px))] rounded-lg p-0 shadow-xl"
      style={{
        backgroundColor: 'var(--popover, #fff)',
        borderColor: 'var(--border, #e4e4e7)',
        color: 'var(--popover-foreground, #09090b)',
      }}
    >
      <div className="flex items-center justify-end gap-1 border-b px-3 py-2" style={{ borderColor: 'var(--border, #e4e4e7)' }}>
        {event.htmlLink ? (
          <button
            type="button"
            onClick={() => window.open(event.htmlLink!, '_blank')}
            className="inline-flex size-8 items-center justify-center rounded-md transition-colors"
            style={{ color: 'var(--muted-foreground, #71717a)' }}
            aria-label="Open in Google Calendar"
            title="Open in Google Calendar"
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--muted, #f4f4f5)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <ExternalLink className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center rounded-md transition-colors"
          style={{ color: 'var(--muted-foreground, #71717a)' }}
          aria-label="Close event details"
          title="Close"
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--muted, #f4f4f5)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="flex gap-3">
          <span
            aria-hidden
            className="mt-1.5 h-3 w-3 shrink-0 rounded-sm"
            style={{ background: 'var(--primary, #18181b)' }}
          />
          <div className="min-w-0">
            <h4 className="break-words text-[20px] font-normal leading-6" style={{ color: 'var(--foreground, #09090b)' }}>
              {event.summary}
            </h4>
          </div>
        </div>

        <EventDetailRow icon={<Clock className="size-4" />} value={formatEventDetailTime(event)} />
        {event.location ? <EventDetailRow icon={<MapPin className="size-4" />} value={event.location} /> : null}
        {organizer ? <EventDetailRow icon={<UserRound className="size-4" />} value={`Organizer: ${organizer}`} /> : null}
        {attendees.length > 0 ? (
          <EventDetailRow
            icon={<UsersRound className="size-4" />}
            value={attendees.slice(0, 8).join(', ') + (attendees.length > 8 ? `, +${attendees.length - 8} more` : '')}
          />
        ) : null}

        {event.conferenceLink ? (
          <div className="flex gap-3">
            <Video className="mt-1 size-4 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => handleMeetingCapture(true)}>
                Join & take notes
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => handleMeetingCapture(false)}>
                Take notes only
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <Mic className="mt-1 size-4 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }} />
            <Button type="button" size="sm" variant="outline" onClick={() => handleMeetingCapture(false)}>
              Take notes
            </Button>
          </div>
        )}

        {descriptionParts.length > 0 ? (
          <div className="flex gap-3">
            <span className="mt-1 size-4 shrink-0" />
            <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm leading-5" style={{ color: 'var(--foreground, #27272a)' }}>
              {descriptionParts.map((part, index) => {
                if (part.type === 'text') return <span key={index}>{part.text}</span>
                return (
                  <a
                    key={index}
                    href={part.href}
                    onClick={(e) => {
                      e.preventDefault()
                      window.open(part.href, '_blank')
                    }}
                    className="underline underline-offset-2"
                    style={{ color: 'var(--primary, #18181b)' }}
                  >
                    {part.text}
                  </a>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    </PopoverContent>
  )
}

function EventDetailRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex gap-3 text-sm leading-5">
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }}>{icon}</span>
      <span className="min-w-0 break-words" style={{ color: 'var(--foreground, #27272a)' }}>{value}</span>
    </div>
  )
}

function SplitJoinButton({ onJoinAndNotes, onNotesOnly }: {
  onJoinAndNotes: () => void
  onNotesOnly: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target
      if (ref.current && target instanceof globalThis.Node && !ref.current.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'stretch' }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onJoinAndNotes() }}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs transition-colors"
        style={{
          background: 'var(--gm-bg-pill)',
          color: 'var(--gm-text)',
          border: '1px solid var(--gm-border)',
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gm-bg-pill-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gm-bg-pill)' }}
      >
        <Video className="size-3" />
        Join & take notes
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-label="More meeting options"
        className="inline-flex items-center justify-center px-1.5 py-1 transition-colors"
        style={{
          background: 'var(--gm-bg-pill)',
          color: 'var(--gm-text)',
          border: '1px solid var(--gm-border)',
          borderLeft: 'none',
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gm-bg-pill-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gm-bg-pill)' }}
      >
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            background: 'var(--gm-bg-card)',
            border: '1px solid var(--gm-border)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            minWidth: 144,
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setOpen(false); onNotesOnly() }}
            className="flex w-full items-center gap-1 px-2 py-1.5 text-xs"
            style={{ background: 'transparent', color: 'var(--gm-text)', whiteSpace: 'nowrap', border: 'none' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gm-bg-row-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <Mic className="size-3" />
            Take notes only
          </button>
        </div>
      )}
    </div>
  )
}

function formatMeetingName(name: string): string {
  return name.replace(/\.md$/i, '').replace(/_/g, ' ')
}

function formatDateLabel(label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label || '—'
  const date = new Date(`${label}T00:00:00`)
  if (Number.isNaN(date.getTime())) return label
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getMeetingButtonLabel(state: MeetingTranscriptionState): string {
  switch (state) {
    case 'connecting':
      return 'Starting...'
    case 'recording':
      return 'Stop recording'
    case 'stopping':
      return 'Stopping...'
    case 'idle':
    default:
      return 'Take meeting notes'
  }
}

export function MeetingsView({ onOpenNote, onTakeMeetingNotes, meetingState, meetingSummarizing = false }: MeetingsViewProps) {
  const [notes, setNotes] = useState<MeetingNoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const exists = await window.ipc.invoke('workspace:exists', { path: MEETINGS_ROOT })
      if (!exists.exists) {
        setNotes([])
        setError(null)
        return
      }

      const entries = await window.ipc.invoke('workspace:readdir', {
        path: MEETINGS_ROOT,
        opts: {
          recursive: true,
          includeHidden: false,
          includeStats: true,
        },
      })

      const rows = entries
	        .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md'))
	        .map((entry) => {
	          const relative = entry.path.slice(`${MEETINGS_ROOT}/`.length)
	          const parts = relative.split('/')
	          const dateFolder = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) ?? ''
	          return {
	            path: entry.path,
	            name: formatMeetingName(entry.name),
	            dateLabel: formatDateLabel(dateFolder),
	            mtimeMs: entry.stat?.mtimeMs ?? 0,
	          } satisfies MeetingNoteRow
        })
        .sort((a, b) => {
          if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
          return b.path.localeCompare(a.path)
        })

      setNotes(rows)
      setError(null)
    } catch (err) {
      console.error('Failed to load meetings:', err)
      setError('Could not load meeting notes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null

    const scheduleReload = () => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        timeout = null
        void loadNotes()
      }, 200)
    }

    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      switch (event.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (isMeetingPath(event.path)) scheduleReload()
          break
        case 'moved':
          if (isMeetingPath(event.from) || isMeetingPath(event.to)) {
            scheduleReload()
          }
          break
        case 'bulkChanged':
          if (!event.paths || event.paths.some(isMeetingPath)) {
            scheduleReload()
          }
          break
      }
    })

    return () => {
      cleanup()
      if (timeout) clearTimeout(timeout)
    }
  }, [loadNotes])

  const isBusy = meetingState === 'connecting' || meetingState === 'stopping' || meetingSummarizing
  const isRecording = meetingState === 'recording'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Mic className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Meetings</h2>
          </div>
          <Button
            type="button"
            size="sm"
            variant={isRecording ? 'destructive' : 'default'}
            disabled={isBusy}
            onClick={onTakeMeetingNotes}
          >
            {meetingSummarizing || meetingState === 'connecting' || meetingState === 'stopping' ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : isRecording ? (
              <Square className="mr-2 size-3.5" />
            ) : (
              <Mic className="mr-2 size-4" />
            )}
            {meetingSummarizing ? 'Generating notes...' : getMeetingButtonLabel(meetingState)}
          </Button>
	        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Upcoming events and meeting notes.
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <UpcomingEvents />
        <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center px-8 py-10 text-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-8 py-10 text-center">
            <div className="rounded-full bg-muted p-3">
              <Mic className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No meeting notes yet. Use <strong>Take meeting notes</strong> to start one.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[56%]" />
                <col className="w-[20%]" />
                <col className="w-[24%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-left">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Note</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Updated</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr key={note.path} className="border-b border-border/50 last:border-b-0 hover:bg-muted/20">
                    <td className="px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => onOpenNote(note.path)}
                        className="min-w-0 text-left text-sm font-medium text-foreground hover:underline"
                      >
                        <span className="block truncate">{note.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-muted-foreground">{note.dateLabel}</td>
                    <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                      {note.mtimeMs > 0 ? (formatRelativeTime(new Date(note.mtimeMs).toISOString()) || '—') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
