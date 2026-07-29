import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { addDays, formatEventTimeRangeCompact, isEventNow, localDateKey, type UpcomingEvent } from '@/lib/calendar-events'
import { cn } from '@/lib/utils'
import { eventsByDayKey, eventSpansMultipleDays, layoutDayColumns, startOfWeek, visualEndMs, type PositionedEvent } from './date-grid'
import { EventDetailsPopover } from './event-details-popover'

const HOUR_PX = 48
const GUTTER_PX = 56
const SCROLL_TO_HOUR = 8

function isBannerEvent(ev: UpcomingEvent): boolean {
  return ev.isAllDay || eventSpansMultipleDays(ev)
}

function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })
}

export function WeekGrid({ anchor, events, now }: {
  anchor: Date
  events: UpcomingEvent[]
  now: Date
}) {
  const weekStart = useMemo(() => startOfWeek(anchor), [anchor])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const byDay = useMemo(
    () => eventsByDayKey(events, weekStart, addDays(weekStart, 7)),
    [events, weekStart],
  )
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
  const weekKey = localDateKey(weekStart)
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: SCROLL_TO_HOUR * HOUR_PX - 8 })
  }, [weekKey])

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
                  <AllDayChip key={`${ev.id}-${dayKey}`} event={ev} />
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
                positioned={layoutByDay.get(dayKey)?.timed ?? []}
                isToday={dayKey === todayKey}
                now={now}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DayColumn({ positioned, isToday, now }: {
  positioned: PositionedEvent[]
  isToday: boolean
  now: Date
}) {
  const nowOffset = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX
  return (
    <div className="relative min-w-0 flex-1 border-l border-border/40">
      {positioned.map(({ event, col, cols }) => (
        <WeekEventBlock key={event.id} event={event} col={col} cols={cols} />
      ))}
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

function WeekEventBlock({ event, col, cols }: {
  event: UpcomingEvent
  col: number
  cols: number
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
      <EventDetailsPopover event={event} onClose={() => setOpen(false)} />
    </Popover>
  )
}

function AllDayChip({ event }: { event: UpcomingEvent }) {
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
      <EventDetailsPopover event={event} onClose={() => setOpen(false)} />
    </Popover>
  )
}
