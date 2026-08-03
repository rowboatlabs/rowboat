import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Popover, PopoverAnchor, PopoverTrigger } from '@/components/ui/popover'
import { addDays, formatEventTimeRangeCompact, isEventNow, localDateKey, startOfDay, type UpcomingEvent } from '@/lib/calendar-events'
import { cn } from '@/lib/utils'
import { eventsByDayKey, eventSpansMultipleDays, layoutDayColumns, startOfWeek, visualEndMs, type PositionedEvent } from './date-grid'
import { EventDetailsPopover } from './event-details-popover'
import { QuickCreatePopover } from './quick-create'

const HOUR_PX = 48
const GUTTER_PX = 56
const SCROLL_TO_HOUR = 8
const WORK_START_HOUR = 9
const WORK_END_HOUR = 18
// Drag-created slots snap to quarter hours; a plain click gets a half-hour block.
const SNAP_MIN = 15
const CLICK_SLOT_MIN = 30

type DraftSlot = { start: Date; end: Date }
type DragState = { dayKey: string; day: Date; anchorMin: number; currentMin: number }

// The [startMin, endMin) a drag gesture resolves to: the snapped selection,
// or a half-hour block at the press point when the pointer barely moved.
function slotFromDrag(drag: DragState): { startMin: number; endMin: number } {
  const lo = Math.min(drag.anchorMin, drag.currentMin)
  const hi = Math.max(drag.anchorMin, drag.currentMin)
  if (hi - lo < SNAP_MIN) {
    const startMin = Math.min(Math.floor(drag.anchorMin / CLICK_SLOT_MIN) * CLICK_SLOT_MIN, 24 * 60 - CLICK_SLOT_MIN)
    return { startMin, endMin: startMin + CLICK_SLOT_MIN }
  }
  return { startMin: lo, endMin: hi }
}

function dateAtMinutes(day: Date, minutes: number): Date {
  const out = new Date(day)
  out.setHours(0, minutes, 0, 0)
  return out
}

function isBannerEvent(ev: UpcomingEvent): boolean {
  return ev.isAllDay || eventSpansMultipleDays(ev)
}

function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })
}

// Renders the week time-grid; `dayCount: 1` reuses it as the Day view.
export function WeekGrid({ anchor, events, now, dayCount = 7, onOpenNote }: {
  anchor: Date
  events: UpcomingEvent[]
  now: Date
  dayCount?: 1 | 7
  onOpenNote?: (path: string) => void
}) {
  const rangeStart = useMemo(
    () => (dayCount === 1 ? startOfDay(anchor) : startOfWeek(anchor)),
    [anchor, dayCount],
  )
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, dayCount],
  )
  const byDay = useMemo(
    () => eventsByDayKey(events, rangeStart, addDays(rangeStart, dayCount)),
    [events, rangeStart, dayCount],
  )
  const [draft, setDraft] = useState<DraftSlot | null>(null)
  const layoutByDay = useMemo(() => {
    const out = new Map<string, { banners: UpcomingEvent[]; timed: PositionedEvent[] }>()
    for (const day of days) {
      const key = localDateKey(day)
      const list = byDay.get(key) ?? []
      out.set(key, {
        banners: list.filter(isBannerEvent),
        timed: layoutDayColumns(list.filter((ev) => !isBannerEvent(ev))),
      })
    }
    return out
  }, [byDay, days])
  const todayKey = localDateKey(now)
  const hasBanners = days.some((day) => (layoutByDay.get(localDateKey(day))?.banners.length ?? 0) > 0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const rangeKey = localDateKey(rangeStart)
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: SCROLL_TO_HOUR * HOUR_PX - 8 })
  }, [rangeKey])

  // Empty-slot press-and-drag → snapped draft range (plain click → 30-minute
  // block), with the quick-create popover anchored to it on release. Pointer
  // capture keeps move/up events on the origin column, so minutes stay
  // relative to it even when the pointer strays sideways.
  const [drag, setDrag] = useState<DragState | null>(null)

  const minutesFromPointer = (e: React.PointerEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    return ((e.clientY - rect.top) / HOUR_PX) * 60
  }
  const handleSlotPointerDown = (day: Date, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, [data-slot-ignore]')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const anchorMin = Math.max(0, Math.min(Math.floor(minutesFromPointer(e) / SNAP_MIN) * SNAP_MIN, 24 * 60 - SNAP_MIN))
    setDrag({ dayKey: localDateKey(day), day, anchorMin, currentMin: anchorMin })
  }
  const handleSlotPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const currentMin = Math.max(0, Math.min(Math.round(minutesFromPointer(e) / SNAP_MIN) * SNAP_MIN, 24 * 60))
    if (currentMin !== drag.currentMin) setDrag({ ...drag, currentMin })
  }
  const handleSlotPointerUp = () => {
    if (!drag) return
    const { startMin, endMin } = slotFromDrag(drag)
    setDrag(null)
    setDraft({ start: dateAtMinutes(drag.day, startMin), end: dateAtMinutes(drag.day, endMin) })
  }
  const handleSlotPointerCancel = () => setDrag(null)
  const dragPreview = drag ? { dayKey: drag.dayKey, ...slotFromDrag(drag) } : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex shrink-0 border-b border-border/60 bg-muted/30">
        <div className="shrink-0" style={{ width: GUTTER_PX }} />
        {days.map((day) => {
          const isToday = localDateKey(day) === todayKey
          return (
            <div key={localDateKey(day)} className="flex min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-border/40 py-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {day.toLocaleDateString([], { weekday: 'short' })}
              </span>
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-[13px] tabular-nums',
                  isToday ? 'bg-primary font-semibold text-primary-foreground' : 'text-foreground',
                )}
              >
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {hasBanners ? (
        <div className="flex shrink-0 border-b border-border/60">
          <div className="flex shrink-0 items-center justify-end pr-2 text-[10px] uppercase tracking-wide text-muted-foreground" style={{ width: GUTTER_PX }}>
            all-day
          </div>
          {days.map((day) => {
            const dayKey = localDateKey(day)
            const banners = layoutByDay.get(dayKey)?.banners ?? []
            return (
              <div key={dayKey} className="flex min-w-0 flex-1 flex-col gap-0.5 border-l border-border/40 p-1">
                {banners.map((ev) => (
                  <AllDayChip key={`${ev.id}-${dayKey}`} event={ev} onOpenNote={onOpenNote} />
                ))}
              </div>
            )
          })}
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
          <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <div
                key={hour}
                className="absolute right-0 border-t border-border/40"
                style={{ top: hour * HOUR_PX, left: GUTTER_PX }}
              />
            ))}
          </div>
          <div className="relative shrink-0" style={{ width: GUTTER_PX }}>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <span
                key={hour}
                className="absolute right-2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: hour * HOUR_PX - 7 }}
              >
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const dayKey = localDateKey(day)
            return (
              <DayColumn
                key={dayKey}
                day={day}
                positioned={layoutByDay.get(dayKey)?.timed ?? []}
                isToday={dayKey === todayKey}
                now={now}
                onSlotPointerDown={handleSlotPointerDown}
                onSlotPointerMove={handleSlotPointerMove}
                onSlotPointerUp={handleSlotPointerUp}
                onSlotPointerCancel={handleSlotPointerCancel}
                dragPreview={dragPreview && dragPreview.dayKey === dayKey ? dragPreview : null}
                draft={draft && localDateKey(draft.start) === dayKey ? draft : null}
                onCloseDraft={() => setDraft(null)}
                onOpenNote={onOpenNote}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DayColumn({ day, positioned, isToday, now, onSlotPointerDown, onSlotPointerMove, onSlotPointerUp, onSlotPointerCancel, dragPreview, draft, onCloseDraft, onOpenNote }: {
  day: Date
  positioned: PositionedEvent[]
  isToday: boolean
  now: Date
  onSlotPointerDown: (day: Date, e: React.PointerEvent<HTMLDivElement>) => void
  onSlotPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onSlotPointerUp: () => void
  onSlotPointerCancel: () => void
  dragPreview: { startMin: number; endMin: number } | null
  draft: DraftSlot | null
  onCloseDraft: () => void
  onOpenNote?: (path: string) => void
}) {
  const nowOffset = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX
  const isWeekend = day.getDay() === 0 || day.getDay() === 6
  const draftTop = draft ? ((draft.start.getHours() * 60 + draft.start.getMinutes()) / 60) * HOUR_PX : 0
  const draftHeight = draft ? Math.max(((draft.end.getTime() - draft.start.getTime()) / 60000 / 60) * HOUR_PX, 12) : 0
  return (
    <div
      className={cn('relative min-w-0 flex-1 select-none border-l border-border/40', isWeekend && 'bg-foreground/[0.02]')}
      onPointerDown={(e) => onSlotPointerDown(day, e)}
      onPointerMove={onSlotPointerMove}
      onPointerUp={onSlotPointerUp}
      onPointerCancel={onSlotPointerCancel}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-foreground/[0.03]" style={{ height: WORK_START_HOUR * HOUR_PX }} />
      <div className="pointer-events-none absolute inset-x-0 bg-foreground/[0.03]" style={{ top: WORK_END_HOUR * HOUR_PX, height: (24 - WORK_END_HOUR) * HOUR_PX }} />
      {positioned.map(({ event, col, cols }) => (
        <WeekEventBlock key={event.id} event={event} col={col} cols={cols} onOpenNote={onOpenNote} />
      ))}
      {dragPreview ? (
        <div
          data-slot-ignore
          className="pointer-events-none absolute inset-x-0.5 z-[6] rounded-md border-[1.5px] border-dashed border-foreground/30 bg-foreground/[0.04]"
          style={{
            top: (dragPreview.startMin / 60) * HOUR_PX,
            height: Math.max(((dragPreview.endMin - dragPreview.startMin) / 60) * HOUR_PX, 12),
          }}
        />
      ) : null}
      {draft ? (
        <Popover open onOpenChange={(open) => { if (!open) onCloseDraft() }}>
          <PopoverAnchor asChild>
            <div
              data-slot-ignore
              className="absolute inset-x-0.5 z-[6] rounded-md border-[1.5px] border-dashed border-foreground/30 bg-foreground/[0.04]"
              style={{ top: draftTop, height: draftHeight }}
            />
          </PopoverAnchor>
          <QuickCreatePopover key={draft.start.toISOString()} start={draft.start} end={draft.end} onClose={onCloseDraft} />
        </Popover>
      ) : null}
      {isToday ? (
        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowOffset }}>
          <div className="relative border-t-2 border-red-500">
            <span className="absolute -top-[5px] left-0 size-2 rounded-full bg-red-500" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function WeekEventBlock({ event, col, cols, onOpenNote }: {
  event: UpcomingEvent
  col: number
  cols: number
  onOpenNote?: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const startMinutes = event.start.getHours() * 60 + event.start.getMinutes()
  const durationMinutes = (visualEndMs(event) - event.start.getTime()) / (60 * 1000)
  const top = (startMinutes / 60) * HOUR_PX
  const height = Math.min(Math.max((durationMinutes / 60) * HOUR_PX, 20), 24 * HOUR_PX - top)
  const width = 100 / cols
  const isNow = isEventNow(event)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${event.summary} · ${formatEventTimeRangeCompact(event)}`}
          className={cn(
            'absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-4 transition-colors',
            isNow
              ? 'border-primary/50 bg-primary/20 ring-1 ring-primary/40'
              : 'border-primary/30 bg-primary/10 hover:bg-primary/20',
          )}
          style={{
            top,
            height,
            left: `calc(${col * width}% + 1px)`,
            width: `calc(${width}% - 2px)`,
          }}
        >
          <span className="block truncate font-medium text-foreground">{event.summary}</span>
          {height >= 36 ? (
            <span className="block truncate text-muted-foreground">{formatEventTimeRangeCompact(event)}</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <EventDetailsPopover event={event} onClose={() => setOpen(false)} onOpenNote={onOpenNote} />
    </Popover>
  )
}

function AllDayChip({ event, onOpenNote }: { event: UpcomingEvent; onOpenNote?: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={event.summary}
          className="w-full truncate rounded bg-primary/10 px-1.5 py-0.5 text-left text-[11px] font-medium leading-4 text-foreground transition-colors hover:bg-primary/20"
        >
          {event.summary}
        </button>
      </PopoverTrigger>
      <EventDetailsPopover event={event} onClose={() => setOpen(false)} onOpenNote={onOpenNote} />
    </Popover>
  )
}
