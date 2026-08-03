import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronDown, ChevronRight, FileText, Loader2, MapPin, Mic, Sparkles, Square, UserPlus, UsersRound, Video } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Streamdown } from 'streamdown'

import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { SettingsDialog } from '@/components/settings-dialog'
import { EventDetailsPopover } from '@/components/calendar/event-details-popover'
import { formatRelativeTime } from '@/lib/relative-time'
import * as analytics from '@/lib/analytics'
import {
  addDays,
  formatEventTimeRangeCompact,
  isEventNow,
  localDateKey,
  meetingPlatformLabel,
  startOfDay,
  triggerMeetingCapture,
  type UpcomingEvent,
} from '@/lib/calendar-events'
import { cn } from '@/lib/utils'
import { useCalendarEvents } from '@/hooks/use-calendar-events'
import type { MeetingTranscriptionState } from '@/hooks/useMeetingTranscription'

const MEETINGS_ROOT = 'knowledge/Meetings'
const UPCOMING_MAX_DAYS = 4 // today + next 3

// Same curve as the calendar's view slides, so expands feel related.
const PREP_TRANSITION = { duration: 0.24, ease: [0.32, 0.72, 0.25, 1] as const }

declare global {
  interface Window {
    __pendingMeetingPrepCreate?: { prompt: string }
  }
}

// Mirrors the `meeting-prep:resolve` IPC response shape.
type PrepNote = {
  path: string
  name: string
  role?: string
  organization?: string
  markdown: string
}
type PrepAttendee = {
  label: string
  email?: string
  displayName?: string
  note: PrepNote | null
}
type PrepOrg = {
  path: string
  name: string
  markdown: string
}
type PrepResult = {
  attendees: PrepAttendee[]
  organizations: PrepOrg[]
  prepNote: { path: string; brief: string } | null
  matchedCount: number
  unmatchedCount: number
}

type MeetingNoteRow = {
  path: string
  name: string
  dateLabel: string
  mtimeMs: number
}

function isMeetingPath(path: string | undefined): boolean {
  return typeof path === 'string' && (path === MEETINGS_ROOT || path.startsWith(`${MEETINGS_ROOT}/`))
}

type DayGroup = {
  dateKey: string
  date: Date // local start-of-day
  events: UpcomingEvent[]
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

// Hand the unmatched attendee off to the Copilot to research + create a note.
function requestCreateNote(attendee: PrepAttendee, meetingSummary: string) {
  const who = attendee.displayName || attendee.label
  const email = attendee.email ? ` <${attendee.email}>` : ''
  window.__pendingMeetingPrepCreate = {
    prompt: `Create a person note in my knowledge base for ${who}${email}. They're attending my "${meetingSummary}" meeting. Pull together what you know about them from my emails, past meetings, and calendar.`,
  }
  window.dispatchEvent(new Event('meeting-prep:create-note'))
}

// One note row (used for both people and organizations): a clickable row that
// navigates to the note. The markdown is NOT rendered inline in the card.
function PrepNoteRow({ title, subtitle, path, onOpenNote }: {
  title: string
  subtitle?: string
  path: string
  onOpenNote: (path: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenNote(path)}
      title={`Open ${title}`}
      className="flex w-full items-center gap-3 border-b px-5 py-1.5 text-left transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] font-semibold text-foreground">{title}</span>
        {subtitle ? <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span> : null}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

function PrepAttendeeNote({ attendee, onOpenNote }: { attendee: PrepAttendee; onOpenNote: (path: string) => void }) {
  const note = attendee.note
  if (!note) return null
  const subtitle = [note.role, note.organization].filter(Boolean).join(' · ')
  return <PrepNoteRow title={note.name} subtitle={subtitle || undefined} path={note.path} onOpenNote={onOpenNote} />
}

function PrepUnmatchedSection({ attendees, meetingSummary }: { attendees: PrepAttendee[]; meetingSummary: string }) {
  const [open, setOpen] = useState(false)
  if (attendees.length === 0) return null

  return (
    <div className="border-t bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <span className="text-xs font-medium text-muted-foreground">
          {attendees.length} {attendees.length === 1 ? 'other' : 'others'} — no notes yet
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1 px-5 pb-3 pl-12">
          {attendees.map((att, idx) => (
            <div key={`${att.email ?? att.label}-${idx}`} className="flex items-center justify-between gap-3 py-1">
              <span className="min-w-0 truncate text-sm text-foreground">{att.label}</span>
              <button
                type="button"
                onClick={() => requestCreateNote(att, meetingSummary)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <UserPlus className="size-3.5" />
                Create note
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// Inline prep for a single event: resolves the attendees against the knowledge
// base and renders their notes directly beneath the event row. Re-resolves when
// a person note changes (e.g. after "Create note") so it stays fresh.
function InlineMeetingPrep({ event, onOpenNote }: { event: UpcomingEvent; onOpenNote: (path: string) => void }) {
  const [prep, setPrep] = useState<PrepResult | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const attendees = event.attendees.map((a) => ({ email: a.email, displayName: a.displayName, self: a.self }))
        const result = await window.ipc.invoke('meeting-prep:resolve', { attendees, eventId: event.id })
        if (!cancelled) setPrep(result)
      } catch (err) {
        console.error('Meeting prep failed:', err)
        if (!cancelled) setPrep(null)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [event.id, refreshTick])

  // Refresh when a People note is created/changed so newly-created notes appear.
  useEffect(() => {
    const isPeoplePath = (p: string | undefined) =>
      typeof p === 'string' && p.startsWith('knowledge/People/')
    const cleanup = window.ipc.on('workspace:didChange', (e) => {
      switch (e.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (isPeoplePath(e.path)) setRefreshTick((t) => t + 1)
          break
        case 'moved':
          if (isPeoplePath(e.from) || isPeoplePath(e.to)) setRefreshTick((t) => t + 1)
          break
        case 'bulkChanged':
          if (!e.paths || e.paths.some(isPeoplePath)) setRefreshTick((t) => t + 1)
          break
      }
    })
    return cleanup
  }, [])

  const matched = prep?.attendees.filter((a) => a.note) ?? []
  const unmatched = prep?.attendees.filter((a) => !a.note) ?? []

  // The resolve is async — grow the section in when results land rather than
  // popping, and fold it away if the prep empties out.
  return (
    <AnimatePresence initial={false}>
      {prep && prep.attendees.length > 0 ? (
        <motion.div
          key="prep-body"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={PREP_TRANSITION}
          className="overflow-hidden"
        >
    <div className="bg-muted/10">
      {prep.prepNote && prep.prepNote.brief ? (
        <div className="border-b px-5 pb-3 pt-3">
          <Streamdown className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_p]:text-[12.5px] [&_li]:text-[12.5px]">
            {prep.prepNote.brief}
          </Streamdown>
          <button
            type="button"
            onClick={() => onOpenNote(prep.prepNote!.path)}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileText className="size-3.5" />
            Open full prep
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 px-5 pb-1 pt-2.5">
        <UsersRound className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">People</span>
      </div>
      {matched.map((att, idx) => (
        <PrepAttendeeNote key={att.note!.path + idx} attendee={att} onOpenNote={onOpenNote} />
      ))}
      <PrepUnmatchedSection attendees={unmatched} meetingSummary={event.summary} />
      {prep.organizations.length > 0 ? (
        <>
          <div className="px-5 pb-1 pt-2.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {prep.organizations.length === 1 ? 'Company' : 'Companies'}
            </span>
          </div>
          {prep.organizations.map((org) => (
            <PrepNoteRow key={org.path} title={org.name} subtitle="Organization" path={org.path} onOpenNote={onOpenNote} />
          ))}
        </>
      ) : null}
    </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function UpcomingEvents({ onOpenNote, onTakeMeetingNotes, meetingState, meetingSummarizing = false }: {
  onOpenNote: (path: string) => void
  onTakeMeetingNotes: () => void
  meetingState: MeetingTranscriptionState
  meetingSummarizing?: boolean
}) {
  const { events: allEvents, loading, error, connected: calendarConnected } = useCalendarEvents()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // The hook returns every synced event; keep only those overlapping the
  // [now, now + UPCOMING_MAX_DAYS) window, all-day first then by start. The
  // hook's minute tick produces a fresh array, so "ended" filtering stays
  // current between calendar syncs.
  const events = useMemo(() => {
    const now = new Date()
    const todayStart = startOfDay(now)
    const windowEnd = addDays(todayStart, UPCOMING_MAX_DAYS) // exclusive
    const collected = allEvents.filter((ev) => {
      // Event must overlap the [now, windowEnd) range — i.e. not already ended,
      // and not start after the window closes.
      const effectiveEnd = ev.end ?? (ev.isAllDay ? addDays(ev.start, 1) : ev.start)
      if (effectiveEnd <= now) return false
      if (ev.start >= windowEnd) return false
      return true
    })
    collected.sort((a, b) => {
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1
      return a.start.getTime() - b.start.getTime()
    })
    return collected
  }, [allEvents])

  const visibleDays = useMemo(() => {
    const window = buildDayWindow(new Date())
    const byKey = new Map(window.map((d) => [d.dateKey, d]))
    for (const ev of events) {
      byKey.get(ev.dateKey)?.events.push(ev)
    }
    return selectVisibleDays(window)
  }, [events])

  // The next meeting that's worth prepping for — soonest timed event with at
  // least one other attendee that hasn't ended. Its row gets inline prep.
  // `events` is sorted (all-day first, then by start), so `find` returns it.
  const prepEventId = useMemo(() => {
    const nowMs = Date.now()
    const candidate = events.find((ev) => {
      if (ev.isAllDay) return false
      if (ev.attendees.every((a) => a.self)) return false
      const endMs = ev.end ? ev.end.getTime() : ev.start.getTime() + 30 * 60 * 1000
      return endMs > nowMs
    })
    return candidate?.id ?? null
  }, [events])

  const totalVisible = visibleDays.reduce((s, d) => s + d.events.length, 0)
  const now = new Date()
  const todayKey = localDateKey(now)
  const isMeetingBusy = meetingState === 'connecting' || meetingState === 'stopping' || meetingSummarizing
  const isRecording = meetingState === 'recording'

  return (
    <section className="border-b border-border/60 pb-6 pt-5">
      <div className="w-full">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            Coming up
            {loading && events.length === 0 ? null : (
              <span className="text-[11px] font-normal uppercase tracking-wider text-muted-foreground">
                · {totalVisible} {totalVisible === 1 ? 'event' : 'events'}
              </span>
            )}
          </h3>
          <Button
            type="button"
            size="sm"
            variant={isRecording ? 'destructive' : 'default'}
            disabled={isMeetingBusy}
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
          <div className="flex flex-col gap-3">
            {visibleDays.map((day) => (
              <UpcomingDayCard
                key={day.dateKey}
                day={day}
                isToday={day.dateKey === todayKey}
                prepEventId={prepEventId}
                onOpenNote={onOpenNote}
              />
            ))}
          </div>
        )}
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab="connections" />
    </section>
  )
}

function UpcomingDayCard({ day, isToday, prepEventId, onOpenNote }: { day: DayGroup; isToday: boolean; prepEventId: string | null; onOpenNote: (path: string) => void }) {
  const dayNum = day.date.getDate()
  const month = day.date.toLocaleDateString([], { month: 'short' })
  const weekday = day.date.toLocaleDateString([], { weekday: 'short' })
  const count = day.events.length

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b bg-muted px-5 py-3.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[22px] font-bold leading-none text-foreground">{dayNum}</span>
          <span className="truncate text-[13px] text-muted-foreground">
            {month} · {weekday}
          </span>
          {isToday ? (
            <span className="shrink-0 rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
              Today
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {count} {count === 1 ? 'event' : 'events'}
        </span>
      </div>

      {count === 0 ? (
        <div className="px-5 py-4 text-sm text-muted-foreground">
          {isToday ? 'No events today' : 'No events'}
        </div>
      ) : (
        day.events.map((ev, idx) => (
          <UpcomingEventItem
            key={ev.id}
            event={ev}
            isLast={idx === count - 1}
            isPrepTarget={ev.id === prepEventId}
            onOpenNote={onOpenNote}
          />
        ))
      )}
    </div>
  )
}

function NowBadge() {
  return (
    <span className="shrink-0 rounded bg-green-600 px-1.5 py-px text-[10px] font-bold uppercase leading-[1.5] tracking-wide text-white">
      Now
    </span>
  )
}

function UpcomingEventItem({ event, isLast, isPrepTarget, onOpenNote }: { event: UpcomingEvent; isLast: boolean; isPrepTarget: boolean; onOpenNote: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  // The next meeting auto-expands its prep; any other meeting with attendees
  // can be expanded on demand via the Prep toggle (resolves lazily on open).
  const prepEligible = !event.isAllDay && event.attendees.some((a) => !a.self)
  const [prepOpen, setPrepOpen] = useState(isPrepTarget)
  const showPrep = prepEligible && prepOpen
  const isNow = isEventNow(event)
  const platform = meetingPlatformLabel(event.conferenceLink)
  const subtitle = platform ?? event.location
  const titleAndLocation = event.location ? `${event.summary} · ${event.location}` : event.summary

  return (
    <div className={cn(!isLast && 'border-b')}>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          title={titleAndLocation}
          className={cn(
            'group flex w-full cursor-pointer items-center gap-4 px-5 py-3 text-left transition-colors',
            showPrep && 'border-b',
            isNow ? 'bg-muted' : 'hover:bg-muted/50',
          )}
        >
          <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground" style={{ width: 118 }}>
            {formatEventTimeRangeCompact(event)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {event.summary}
              </span>
              {isNow ? <NowBadge /> : null}
            </span>
            {subtitle ? (
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                {platform ? <Video className="size-3.5 shrink-0" /> : <MapPin className="size-3.5 shrink-0" />}
                <span className="truncate">{subtitle}</span>
              </span>
            ) : null}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {prepEligible ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPrepOpen((v) => !v) }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-expanded={prepOpen}
                title={prepOpen ? 'Hide prep' : 'Show meeting prep'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  prepOpen ? 'bg-accent text-foreground' : 'bg-background text-foreground hover:bg-accent',
                )}
              >
                <Sparkles className="size-3.5" />
                Prep
                <ChevronDown className={cn('size-3 transition-transform', prepOpen && 'rotate-180')} />
              </button>
            ) : null}
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
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <Mic className="size-3.5" />
                Take notes
              </button>
            )}
          </div>
        </div>
      </PopoverTrigger>
      <EventDetailsPopover event={event} onClose={() => setOpen(false)} onOpenNote={onOpenNote} />
    </Popover>
    <AnimatePresence initial={false}>
      {showPrep ? (
        <motion.div
          key="prep"
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          exit={{ height: 0, opacity: 0 }}
          transition={PREP_TRANSITION}
          className="overflow-hidden"
        >
          <InlineMeetingPrep event={event} onOpenNote={onOpenNote} />
        </motion.div>
      ) : null}
    </AnimatePresence>
    </div>
  )
}

function SplitJoinButton({ onJoinAndNotes, onNotesOnly }: {
  onJoinAndNotes: () => void
  onNotesOnly: () => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Fixed-position coords for the portaled menu so it isn't clipped by the
  // calendar card's `overflow-hidden`.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  const updatePos = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePos()
    const handler = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof globalThis.Node)) return
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [open, updatePos])

  return (
    <div ref={containerRef} className="relative inline-flex items-stretch">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onJoinAndNotes() }}
        className="inline-flex items-center gap-1.5 rounded-l-md border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        <Video className="size-3.5" />
        Join & take notes
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-label="More meeting options"
        className="inline-flex items-center justify-center rounded-r-md border border-l-0 bg-background px-1.5 py-1.5 text-foreground transition-colors hover:bg-accent"
      >
        <ChevronDown className="size-3" />
      </button>
      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 60 }}
              className="min-w-36 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg"
            >
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setOpen(false); onNotesOnly() }}
                className="flex w-full items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                <Mic className="size-3" />
                Take notes only
              </button>
            </div>,
            document.body,
          )
        : null}
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

// The calendar's list mode: the upcoming-events cards followed by the past
// meeting-notes table. Rendered inside CalendarView's content container (which
// provides the width cap and horizontal padding); the "Take meeting notes"
// button sits in the "Coming up" section header so the calendar's own header
// bar stays identical across modes.
export function AgendaView({ onOpenNote, onTakeMeetingNotes, meetingState, meetingSummarizing = false }: {
  onOpenNote: (path: string) => void
  onTakeMeetingNotes: () => void
  meetingState: MeetingTranscriptionState
  meetingSummarizing?: boolean
}) {
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
	        // Generated prep notes live under Meetings/prep/ — they're upcoming
	        // prep, not past meeting notes, so keep them out of this table.
	        .filter((entry) => !entry.path.startsWith(`${MEETINGS_ROOT}/prep/`))
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="pb-12">
        <UpcomingEvents
          onOpenNote={onOpenNote}
          onTakeMeetingNotes={onTakeMeetingNotes}
          meetingState={meetingState}
          meetingSummarizing={meetingSummarizing}
        />
        <div className="pt-6">
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
                        onClick={() => { analytics.meetingNoteOpened(); onOpenNote(note.path) }}
                        className="block w-full min-w-0 text-left text-sm font-medium text-foreground hover:underline"
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
