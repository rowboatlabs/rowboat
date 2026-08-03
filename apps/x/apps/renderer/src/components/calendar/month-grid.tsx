import { useMemo, useState } from 'react'

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addDays, localDateKey, type UpcomingEvent } from '@/lib/calendar-events'
import { cn } from '@/lib/utils'
import { buildMonthGrid, eventsByDayKey, eventSpansMultipleDays } from './date-grid'
import { EventDetailsContent, EventDetailsPopover } from './event-details-popover'
import { QuickCreatePopover, nextHalfHour } from './quick-create'

type DraftSlot = { dayKey: string; start: Date; end: Date }

// Default slot for a clicked day: the next free half-hour when it's today,
// otherwise 9:00–9:30 that morning.
function defaultSlotForDay(day: Date, todayKey: string): DraftSlot {
  const dayKey = localDateKey(day)
  if (dayKey === todayKey) {
    const { start, end } = nextHalfHour(new Date())
    return { dayKey, start, end }
  }
  const start = new Date(day)
  start.setHours(9, 0, 0, 0)
  return { dayKey, start, end: new Date(start.getTime() + 30 * 60 * 1000) }
}

// Max chips per day cell before collapsing into "+N more" (a lone 4th chip
// renders instead of a pointless "+1 more").
const MAX_CHIPS = 3

function chipTimeLabel(d: Date): string {
  const opts: Intl.DateTimeFormatOptions = d.getMinutes() === 0
    ? { hour: 'numeric' }
    : { hour: 'numeric', minute: '2-digit' }
  return d.toLocaleTimeString([], opts)
}

export function MonthGrid({ anchor, events, now, onOpenNote }: {
  anchor: Date
  events: UpcomingEvent[]
  now: Date
  onOpenNote?: (path: string) => void
}) {
  const weeks = useMemo(() => buildMonthGrid(anchor), [anchor])
  const byDay = useMemo(() => {
    const rangeStart = weeks[0][0]
    const rangeEnd = addDays(weeks[weeks.length - 1][6], 1)
    return eventsByDayKey(events, rangeStart, rangeEnd)
  }, [events, weeks])
  const todayKey = localDateKey(now)
  const anchorMonth = anchor.getMonth()
  // Empty-cell click → quick-create anchored inside that day.
  const [draft, setDraft] = useState<DraftSlot | null>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="grid shrink-0 grid-cols-7 border-b border-border/60 bg-muted/30">
        {weeks[0].map((day) => (
          <div key={day.getDay()} className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {day.toLocaleDateString([], { weekday: 'short' })}
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 gap-px bg-border/60"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.flat().map((day) => {
          const dayKey = localDateKey(day)
          return (
            <DayCell
              key={dayKey}
              day={day}
              events={byDay.get(dayKey) ?? []}
              isToday={dayKey === todayKey}
              inMonth={day.getMonth() === anchorMonth}
              draft={draft && draft.dayKey === dayKey ? draft : null}
              onDayClick={() => setDraft(defaultSlotForDay(day, todayKey))}
              onCloseDraft={() => setDraft(null)}
              onOpenNote={onOpenNote}
            />
          )
        })}
      </div>
    </div>
  )
}

function DayCell({ day, events, isToday, inMonth, draft, onDayClick, onCloseDraft, onOpenNote }: {
  day: Date
  events: UpcomingEvent[]
  isToday: boolean
  inMonth: boolean
  draft: DraftSlot | null
  onDayClick: () => void
  onCloseDraft: () => void
  onOpenNote?: (path: string) => void
}) {
  const visible = events.length <= MAX_CHIPS + 1 ? events : events.slice(0, MAX_CHIPS)
  const hiddenCount = events.length - visible.length

  return (
    <div
      className={cn('relative flex min-h-0 flex-col gap-0.5 overflow-hidden p-1', inMonth ? 'bg-card' : 'bg-muted/30')}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        onDayClick()
      }}
    >
      <div className="flex shrink-0 justify-end px-1 pt-0.5">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-[12px] tabular-nums',
            isToday ? 'bg-primary font-semibold text-primary-foreground' : inMonth ? 'text-foreground' : 'text-muted-foreground/40',
          )}
        >
          {day.getDate()}
        </span>
      </div>
      {visible.map((ev) => (
        <MonthEventChip key={`${ev.id}-${localDateKey(day)}`} event={ev} onOpenNote={onOpenNote} />
      ))}
      {hiddenCount > 0 ? <DayOverflowButton day={day} events={events} hiddenCount={hiddenCount} onOpenNote={onOpenNote} /> : null}
      {draft ? (
        <Popover open onOpenChange={(open) => { if (!open) onCloseDraft() }}>
          <PopoverAnchor asChild>
            <span aria-hidden className="pointer-events-none absolute left-1 top-7" />
          </PopoverAnchor>
          <QuickCreatePopover key={draft.start.toISOString()} start={draft.start} end={draft.end} onClose={onCloseDraft} />
        </Popover>
      ) : null}
    </div>
  )
}

function MonthEventChip({ event, onOpenNote }: { event: UpcomingEvent; onOpenNote?: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const isBanner = event.isAllDay || eventSpansMultipleDays(event)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={event.summary}
          className={cn(
            'flex w-full shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] leading-4 transition-colors',
            isBanner
              ? 'bg-primary/10 font-medium text-foreground hover:bg-primary/20'
              : 'text-foreground hover:bg-muted',
          )}
        >
          {!isBanner ? (
            <span className="shrink-0 tabular-nums text-muted-foreground">{chipTimeLabel(event.start)}</span>
          ) : null}
          <span className="truncate">{event.summary}</span>
        </button>
      </PopoverTrigger>
      <EventDetailsPopover event={event} onClose={() => setOpen(false)} onOpenNote={onOpenNote} />
    </Popover>
  )
}

// "+N more" for a crowded day: lists the whole day inside one popover and
// swaps to the event details (with a back chevron) on click — no nested popovers.
function DayOverflowButton({ day, events, hiddenCount, onOpenNote }: {
  day: Date
  events: UpcomingEvent[]
  hiddenCount: number
  onOpenNote?: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [detailEvent, setDetailEvent] = useState<UpcomingEvent | null>(null)
  const close = () => {
    setOpen(false)
    setDetailEvent(null)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setDetailEvent(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full shrink-0 rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          +{hiddenCount} more
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[min(380px,calc(100vw-32px))] rounded-lg p-0 shadow-xl"
        style={{
          backgroundColor: 'var(--muted, #f4f4f5)',
          borderColor: 'var(--border, #e4e4e7)',
          color: 'var(--popover-foreground, #09090b)',
        }}
      >
        {detailEvent ? (
          <EventDetailsContent event={detailEvent} onClose={close} onBack={() => setDetailEvent(null)} onOpenNote={onOpenNote} />
        ) : (
          <>
            <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--border, #e4e4e7)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--foreground, #09090b)' }}>
                {day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
            </div>
            <div className="max-h-72 overflow-auto py-1">
              {events.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => setDetailEvent(ev)}
                  className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors hover:bg-background/60"
                >
                  <span className="w-16 shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--muted-foreground, #71717a)' }}>
                    {ev.isAllDay ? 'All day' : chipTimeLabel(ev.start)}
                  </span>
                  <span className="truncate" style={{ color: 'var(--foreground, #27272a)' }}>{ev.summary}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
