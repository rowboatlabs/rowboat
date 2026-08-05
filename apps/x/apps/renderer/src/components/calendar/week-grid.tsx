import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Popover, PopoverAnchor, PopoverTrigger } from '@/components/ui/popover'
import { addDays, formatEventTimeRangeCompact, hexAlpha, isEventNow, localDateKey, startOfDay, type UpcomingEvent } from '@/lib/calendar-events'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useCalendarWriteAccess } from '@/hooks/use-calendar-write'
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
// Pointer travel (px) before a press on an event block becomes a drag rather
// than a click that opens the details popover.
const DRAG_THRESHOLD_PX = 4

export type AvailabilitySlot = { start: Date; end: Date }

type DraftSlot = { start: Date; end: Date }
type DragState = { dayKey: string; day: Date; anchorMin: number; currentMin: number }

// Rescheduling drag on an existing block: 'move' from the block body,
// 'resize' from its bottom edge. Tracked in a ref (window-level listeners
// need the latest value) with a state mirror for rendering.
type EventDragState = {
  event: UpcomingEvent
  mode: 'move' | 'resize'
  grabOffsetMin: number // pointer minutes past event start at grab (move mode)
  durationMin: number
  originClientX: number
  originClientY: number
  active: boolean
  dayIdx: number
  startMin: number
  endMin: number
}

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

function minuteTimeLabel(day: Date, minutes: number): string {
  return dateAtMinutes(day, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function isBannerEvent(ev: UpcomingEvent): boolean {
  return ev.isAllDay || eventSpansMultipleDays(ev)
}

function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })
}

// Renders the week time-grid; `dayCount: 1` reuses it as the Day view.
// In `availabilityMode`, empty-slot drags collect shareable availability
// windows (rendered green, click to remove) instead of drafting an event.
export function WeekGrid({ anchor, events, now, dayCount = 7, onOpenNote, availabilityMode = false, availabilitySlots = [], onAddAvailabilitySlot, onRemoveAvailabilitySlot }: {
  anchor: Date
  events: UpcomingEvent[]
  now: Date
  dayCount?: 1 | 7
  onOpenNote?: (path: string) => void
  availabilityMode?: boolean
  availabilitySlots?: AvailabilitySlot[]
  onAddAvailabilitySlot?: (slot: AvailabilitySlot) => void
  onRemoveAvailabilitySlot?: (index: number) => void
}) {
  const rangeStart = useMemo(
    () => (dayCount === 1 ? startOfDay(anchor) : startOfWeek(anchor)),
    [anchor, dayCount],
  )
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, dayCount],
  )
  const canWrite = useCalendarWriteAccess()

  // Optimistic reschedules: applied over the synced events until the file
  // watcher delivers the server copy (or the write fails and they revert).
  const [pendingMoves, setPendingMoves] = useState<Map<string, { start: Date; end: Date }>>(new Map())
  useEffect(() => {
    setPendingMoves((prev) => {
      if (prev.size === 0) return prev
      const next = new Map(prev)
      for (const [id, times] of prev) {
        const ev = events.find((c) => c.id === id)
        if (!ev || (ev.start.getTime() === times.start.getTime() && ev.end?.getTime() === times.end.getTime())) {
          next.delete(id)
        }
      }
      return next.size === prev.size ? prev : next
    })
  }, [events])
  const effectiveEvents = useMemo(() => {
    if (pendingMoves.size === 0) return events
    return events.map((ev) => {
      const pending = pendingMoves.get(ev.id)
      return pending ? { ...ev, start: pending.start, end: pending.end, dateKey: localDateKey(pending.start) } : ev
    })
  }, [events, pendingMoves])

  const byDay = useMemo(
    () => eventsByDayKey(effectiveEvents, rangeStart, addDays(rangeStart, dayCount)),
    [effectiveEvents, rangeStart, dayCount],
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
  const gridRef = useRef<HTMLDivElement>(null)
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
    const slot = { start: dateAtMinutes(drag.day, startMin), end: dateAtMinutes(drag.day, endMin) }
    if (availabilityMode) {
      onAddAvailabilitySlot?.(slot)
      return
    }
    setDraft(slot)
  }
  const handleSlotPointerCancel = () => setDrag(null)
  const dragPreview = drag ? { dayKey: drag.dayKey, ...slotFromDrag(drag) } : null

  // --- Drag-to-reschedule / resize existing events ---
  const eventDragRef = useRef<EventDragState | null>(null)
  const [eventDrag, setEventDrag] = useState<EventDragState | null>(null)
  const suppressClickRef = useRef(false)
  const setEventDragBoth = (next: EventDragState | null) => {
    eventDragRef.current = next
    setEventDrag(next)
  }

  const handleEventDragStart = (event: UpcomingEvent, mode: 'move' | 'resize', e: React.PointerEvent) => {
    if (canWrite !== true || e.button !== 0 || isBannerEvent(event)) return
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return
    const dayIdx = days.findIndex((d) => localDateKey(d) === localDateKey(event.start))
    if (dayIdx === -1) return
    e.preventDefault()
    const startMin = event.start.getHours() * 60 + event.start.getMinutes()
    const durationMin = Math.max((visualEndMs(event) - event.start.getTime()) / 60000, SNAP_MIN)
    const pointerMin = ((e.clientY - rect.top) / HOUR_PX) * 60
    setEventDragBoth({
      event,
      mode,
      grabOffsetMin: pointerMin - startMin,
      durationMin,
      originClientX: e.clientX,
      originClientY: e.clientY,
      active: false,
      dayIdx,
      startMin,
      endMin: startMin + durationMin,
    })
  }

  const eventDragging = eventDrag !== null
  useEffect(() => {
    if (!eventDragging) return
    const onMove = (e: PointerEvent) => {
      const prev = eventDragRef.current
      const rect = gridRef.current?.getBoundingClientRect()
      if (!prev || !rect) return
      if (!prev.active && Math.hypot(e.clientX - prev.originClientX, e.clientY - prev.originClientY) < DRAG_THRESHOLD_PX) return
      const pointerMin = ((e.clientY - rect.top) / HOUR_PX) * 60
      if (prev.mode === 'resize') {
        const snapped = Math.round(pointerMin / SNAP_MIN) * SNAP_MIN
        const endMin = Math.min(Math.max(snapped, prev.startMin + SNAP_MIN), 24 * 60)
        setEventDragBoth({ ...prev, active: true, endMin })
        return
      }
      const dayWidth = (rect.width - GUTTER_PX) / days.length
      const dayIdx = Math.min(Math.max(Math.floor((e.clientX - rect.left - GUTTER_PX) / dayWidth), 0), days.length - 1)
      const snapped = Math.round((pointerMin - prev.grabOffsetMin) / SNAP_MIN) * SNAP_MIN
      const startMin = Math.min(Math.max(snapped, 0), Math.max(24 * 60 - prev.durationMin, 0))
      setEventDragBoth({ ...prev, active: true, dayIdx, startMin, endMin: Math.min(startMin + prev.durationMin, 24 * 60) })
    }
    const onUp = () => {
      const dragState = eventDragRef.current
      setEventDragBoth(null)
      if (!dragState?.active) return
      // Swallow the click that follows the drag so the popover stays closed.
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
      const day = days[dragState.dayIdx]
      const newStart = dateAtMinutes(day, dragState.startMin)
      const newEnd = dateAtMinutes(day, dragState.endMin)
      const prevEndMs = dragState.event.end?.getTime() ?? visualEndMs(dragState.event)
      if (newStart.getTime() === dragState.event.start.getTime() && newEnd.getTime() === prevEndMs) return
      setPendingMoves((prev) => new Map(prev).set(dragState.event.id, { start: newStart, end: newEnd }))
      void (async () => {
        const revert = () => setPendingMoves((prev) => {
          const next = new Map(prev)
          next.delete(dragState.event.id)
          return next
        })
        try {
          const result = await window.ipc.invoke('calendar:updateEvent', {
            eventId: dragState.event.id,
            startISO: newStart.toISOString(),
            endISO: newEnd.toISOString(),
            calendarId: dragState.event.calendarId,
          })
          if (!result.ok) {
            revert()
            toast(result.error ?? 'Could not move the event.', result.needsReconnect ? 'info' : 'error')
          }
        } catch {
          revert()
          toast('Could not move the event.', 'error')
        }
      })()
    }
    const onCancel = () => setEventDragBoth(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventDragging])

  const activeEventDrag = eventDrag?.active ? eventDrag : null

  const availabilityByDay = useMemo(() => {
    const map = new Map<string, Array<{ index: number; startMin: number; endMin: number }>>()
    availabilitySlots.forEach((slot, index) => {
      const key = localDateKey(slot.start)
      const startMin = slot.start.getHours() * 60 + slot.start.getMinutes()
      const endMin = Math.min((slot.end.getTime() - startOfDay(slot.start).getTime()) / 60000, 24 * 60)
      const list = map.get(key) ?? []
      list.push({ index, startMin, endMin: Math.max(endMin, startMin + 5) })
      map.set(key, list)
    })
    return map
  }, [availabilitySlots])

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
        <div ref={gridRef} className="relative flex" style={{ height: 24 * HOUR_PX }}>
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
                availabilityMode={availabilityMode}
                availability={availabilityByDay.get(dayKey) ?? []}
                onRemoveAvailabilitySlot={onRemoveAvailabilitySlot}
                draggable={canWrite === true}
                onEventDragStart={handleEventDragStart}
                suppressClickRef={suppressClickRef}
                draggingEventId={activeEventDrag?.event.id ?? null}
                eventDragPreview={
                  activeEventDrag && localDateKey(days[activeEventDrag.dayIdx]) === dayKey
                    ? { startMin: activeEventDrag.startMin, endMin: activeEventDrag.endMin, summary: activeEventDrag.event.summary }
                    : null
                }
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DayColumn({ day, positioned, isToday, now, onSlotPointerDown, onSlotPointerMove, onSlotPointerUp, onSlotPointerCancel, dragPreview, draft, onCloseDraft, onOpenNote, availabilityMode, availability, onRemoveAvailabilitySlot, draggable, onEventDragStart, suppressClickRef, draggingEventId, eventDragPreview }: {
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
  availabilityMode: boolean
  availability: Array<{ index: number; startMin: number; endMin: number }>
  onRemoveAvailabilitySlot?: (index: number) => void
  draggable: boolean
  onEventDragStart: (event: UpcomingEvent, mode: 'move' | 'resize', e: React.PointerEvent) => void
  suppressClickRef: React.MutableRefObject<boolean>
  draggingEventId: string | null
  eventDragPreview: { startMin: number; endMin: number; summary: string } | null
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
        <WeekEventBlock
          key={event.id}
          event={event}
          col={col}
          cols={cols}
          onOpenNote={onOpenNote}
          draggable={draggable}
          onDragStart={onEventDragStart}
          suppressClickRef={suppressClickRef}
          dimmed={draggingEventId === event.id}
        />
      ))}
      {availability.map((slot) => (
        <button
          key={slot.index}
          type="button"
          data-slot-ignore
          title="Remove this availability window"
          onClick={() => onRemoveAvailabilitySlot?.(slot.index)}
          className="absolute inset-x-0.5 z-[5] overflow-hidden rounded-md border border-emerald-500/60 bg-emerald-500/15 px-1.5 py-0.5 text-left text-[11px] leading-4 transition-colors hover:bg-emerald-500/25"
          style={{
            top: (slot.startMin / 60) * HOUR_PX,
            height: Math.max(((slot.endMin - slot.startMin) / 60) * HOUR_PX, 12),
          }}
        >
          <span className="block truncate font-medium text-emerald-700 dark:text-emerald-400">Free</span>
        </button>
      ))}
      {dragPreview ? (
        <div
          data-slot-ignore
          className={cn(
            'pointer-events-none absolute inset-x-0.5 z-[6] rounded-md border-[1.5px] border-dashed',
            availabilityMode ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-foreground/30 bg-foreground/[0.04]',
          )}
          style={{
            top: (dragPreview.startMin / 60) * HOUR_PX,
            height: Math.max(((dragPreview.endMin - dragPreview.startMin) / 60) * HOUR_PX, 12),
          }}
        />
      ) : null}
      {eventDragPreview ? (
        <div
          data-slot-ignore
          className="pointer-events-none absolute inset-x-0.5 z-[7] overflow-hidden rounded-md border border-primary/60 bg-primary/25 px-1.5 py-0.5 text-[11px] leading-4 shadow-md"
          style={{
            top: (eventDragPreview.startMin / 60) * HOUR_PX,
            height: Math.max(((eventDragPreview.endMin - eventDragPreview.startMin) / 60) * HOUR_PX, 12),
          }}
        >
          <span className="block truncate font-medium text-foreground">{eventDragPreview.summary}</span>
          <span className="block truncate text-muted-foreground">
            {minuteTimeLabel(day, eventDragPreview.startMin)} – {minuteTimeLabel(day, eventDragPreview.endMin)}
          </span>
        </div>
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

function WeekEventBlock({ event, col, cols, onOpenNote, draggable, onDragStart, suppressClickRef, dimmed }: {
  event: UpcomingEvent
  col: number
  cols: number
  onOpenNote?: (path: string) => void
  draggable: boolean
  onDragStart: (event: UpcomingEvent, mode: 'move' | 'resize', e: React.PointerEvent) => void
  suppressClickRef: React.MutableRefObject<boolean>
  dimmed: boolean
}) {
  const [open, setOpen] = useState(false)
  const startMinutes = event.start.getHours() * 60 + event.start.getMinutes()
  const durationMinutes = (visualEndMs(event) - event.start.getTime()) / (60 * 1000)
  const top = (startMinutes / 60) * HOUR_PX
  const height = Math.min(Math.max((durationMinutes / 60) * HOUR_PX, 20), 24 * HOUR_PX - top)
  const width = 100 / cols
  const isNow = isEventNow(event)
  const canDrag = draggable && !isBannerEvent(event) && !event.readOnly
  const colorStyle = event.color
    ? { backgroundColor: hexAlpha(event.color, isNow ? 0.22 : 0.13), borderColor: hexAlpha(event.color, 0.5) }
    : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${event.summary} · ${formatEventTimeRangeCompact(event)}`}
          onPointerDown={canDrag ? (e) => onDragStart(event, 'move', e) : undefined}
          onClickCapture={(e) => {
            if (suppressClickRef.current) {
              e.preventDefault()
              e.stopPropagation()
            }
          }}
          className={cn(
            'absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-4 transition-colors',
            isNow
              ? 'border-primary/50 bg-primary/20 ring-1 ring-primary/40'
              : 'border-primary/30 bg-primary/10 hover:bg-primary/20',
            canDrag && 'cursor-grab',
            dimmed && 'opacity-40',
          )}
          style={{
            top,
            height,
            left: `calc(${col * width}% + 1px)`,
            width: `calc(${width}% - 2px)`,
            ...colorStyle,
          }}
        >
          <span className="block truncate font-medium text-foreground">{event.summary}</span>
          {height >= 36 ? (
            <span className="block truncate text-muted-foreground">{formatEventTimeRangeCompact(event)}</span>
          ) : null}
          {canDrag ? (
            <span
              data-slot-ignore
              aria-hidden
              onPointerDown={(e) => {
                e.stopPropagation()
                onDragStart(event, 'resize', e)
              }}
              className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
            />
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
          style={event.color ? { backgroundColor: hexAlpha(event.color, 0.15) } : undefined}
        >
          {event.summary}
        </button>
      </PopoverTrigger>
      <EventDetailsPopover event={event} onClose={() => setOpen(false)} onOpenNote={onOpenNote} />
    </Popover>
  )
}
