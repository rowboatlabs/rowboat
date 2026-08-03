import { useEffect, useMemo, useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { SettingsDialog } from '@/components/settings-dialog'
import { addDays, localDateKey } from '@/lib/calendar-events'
import { cn } from '@/lib/utils'
import { useCalendarEvents } from '@/hooks/use-calendar-events'
import type { MeetingTranscriptionState } from '@/hooks/useMeetingTranscription'
import { AgendaView } from './agenda-view'
import { startOfWeek } from './date-grid'
import { MonthGrid } from './month-grid'
import { QuickCreatePopover, nextHalfHour } from './quick-create'
import { WeekGrid } from './week-grid'

const VIEW_MODE_STORAGE_KEY = 'calendar-view-mode'

export type CalendarMode = 'day' | 'week' | 'month' | 'agenda'

// Toggle order (zoom level: day → week → month → agenda) — switching to a
// mode further right slides content leftward, and vice versa, so the motion
// matches the segmented control.
const MODE_ORDER: CalendarMode[] = ['day', 'week', 'month', 'agenda']

// Direction-aware slide-and-fade for view/period changes. `custom` is +1
// (forward/next: new content enters from the right) or -1 (backward/prev).
const slideVariants = {
  enter: (direction: number) => ({ x: direction >= 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction >= 0 ? -48 : 48, opacity: 0 }),
}

function loadStoredMode(): CalendarMode {
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored === 'day' || stored === 'week' || stored === 'agenda' ? stored : 'month'
  } catch {
    return 'month'
  }
}

type CalendarViewProps = {
  onOpenNote: (path: string) => void
  onTakeMeetingNotes: () => void
  meetingState: MeetingTranscriptionState
  meetingSummarizing?: boolean
  /** Old meetings entry points ask for agenda mode; bump the version to re-apply. */
  requestedMode?: CalendarMode | null
  requestedModeVersion?: number
}

export function CalendarView({
  onOpenNote,
  onTakeMeetingNotes,
  meetingState,
  meetingSummarizing = false,
  requestedMode,
  requestedModeVersion = 0,
}: CalendarViewProps) {
  const [mode, setMode] = useState<CalendarMode>(loadStoredMode)
  const [anchor, setAnchor] = useState(() => new Date())
  const [now, setNow] = useState(() => new Date())
  const [slideDirection, setSlideDirection] = useState(1)
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  // Recomputed each time the header popover opens: the next free half-hour.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const quickCreateSlot = useMemo(() => nextHalfHour(new Date()), [quickCreateOpen])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { events, loading, error, connected } = useCalendarEvents()

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60 * 1000)
    return () => clearInterval(tick)
  }, [])

  const selectMode = (next: CalendarMode) => {
    setSlideDirection(MODE_ORDER.indexOf(next) >= MODE_ORDER.indexOf(mode) ? 1 : -1)
    setMode(next)
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next)
    } catch {
      // localStorage unavailable — the toggle still works for this session.
    }
  }

  useEffect(() => {
    if (requestedModeVersion > 0 && requestedMode) selectMode(requestedMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedModeVersion])

  const headerLabel = useMemo(() => {
    if (mode === 'agenda') {
      return 'Upcoming events and meeting notes.'
    }
    if (mode === 'day') {
      return anchor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    }
    if (mode === 'month') {
      return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
    }
    const weekStart = startOfWeek(anchor)
    const weekEnd = addDays(weekStart, 6)
    const sameYear = weekStart.getFullYear() === weekEnd.getFullYear()
    if (sameYear && weekStart.getMonth() === weekEnd.getMonth()) {
      return `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
    }
    const startLabel = weekStart.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
    const endLabel = weekEnd.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    return `${startLabel} – ${endLabel}`
  }, [anchor, mode])

  const periodStep = mode === 'day' ? 1 : 7
  const goPrev = () => {
    setSlideDirection(-1)
    setAnchor((a) => (mode === 'month' ? new Date(a.getFullYear(), a.getMonth() - 1, 1) : addDays(a, -periodStep)))
  }
  const goNext = () => {
    setSlideDirection(1)
    setAnchor((a) => (mode === 'month' ? new Date(a.getFullYear(), a.getMonth() + 1, 1) : addDays(a, periodStep)))
  }
  const goToday = () => {
    setSlideDirection(new Date() >= anchor ? 1 : -1)
    setAnchor(new Date())
  }

  // What the sliding container shows: one key per mode + visible period, so
  // both mode toggles and prev/next/Today navigation animate.
  const contentKey =
    mode === 'agenda' ? 'agenda'
    : mode === 'day' ? `day-${localDateKey(anchor)}`
    : mode === 'month' ? `month-${anchor.getFullYear()}-${anchor.getMonth()}`
    : `week-${localDateKey(startOfWeek(anchor))}`

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f8f8f9] dark:bg-[#0b0b0d]">
      <div className="mx-auto w-full max-w-[1120px] shrink-0 px-[30px] pt-[34px] pb-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[24px] font-[650] tracking-[-0.02em] text-[#0d0e11] dark:text-[#f4f5f7]">Calendar</h2>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border">
              {MODE_ORDER.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectMode(m)}
                  aria-pressed={mode === m}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                    mode === m ? 'bg-accent text-foreground' : 'bg-background text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            {/* Same controls in every mode so the bar never jumps; navigation
                doesn't apply to the agenda list, so those buttons just disable. */}
            <Button type="button" size="sm" variant="outline" onClick={goToday} disabled={mode === 'agenda'}>
              Today
            </Button>
            <div className="flex items-center">
              <Button type="button" size="icon" variant="ghost" onClick={goPrev} disabled={mode === 'agenda'} aria-label={`Previous ${mode}`}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" onClick={goNext} disabled={mode === 'agenda'} aria-label={`Next ${mode}`}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <Popover open={quickCreateOpen} onOpenChange={setQuickCreateOpen}>
              <PopoverTrigger asChild>
                <Button type="button" size="sm">
                  <Plus className="mr-1.5 size-4" />
                  New event
                </Button>
              </PopoverTrigger>
              {quickCreateOpen ? (
                <QuickCreatePopover
                  start={quickCreateSlot.start}
                  end={quickCreateSlot.end}
                  onClose={() => setQuickCreateOpen(false)}
                />
              ) : null}
            </Popover>
          </div>
        </div>
        <p className="mt-1 text-[14px] text-black/50 dark:text-white/[0.52]">{headerLabel}</p>
      </div>

      <div className="mx-auto flex w-full max-w-[1120px] flex-1 min-h-0 flex-col px-[30px] pb-6">
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout" custom={slideDirection}>
            <motion.div
              key={contentKey}
              custom={slideDirection}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.24, ease: [0.32, 0.72, 0.25, 1] }}
              className="flex h-full min-h-0 flex-col"
            >
        {mode === 'agenda' ? (
          <AgendaView
            onOpenNote={onOpenNote}
            onTakeMeetingNotes={onTakeMeetingNotes}
            meetingState={meetingState}
            meetingSummarizing={meetingSummarizing}
          />
        ) : connected === false && events.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <CalendarIcon className="size-7 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Connect your calendar to see your events here.</p>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <CalendarIcon className="size-4" />
              Connect your calendar
            </button>
          </div>
        ) : loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{error}</div>
        ) : mode === 'month' ? (
          <MonthGrid anchor={anchor} events={events} now={now} onOpenNote={onOpenNote} />
        ) : (
          <WeekGrid anchor={anchor} events={events} now={now} dayCount={mode === 'day' ? 1 : 7} onOpenNote={onOpenNote} />
        )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab="connections" />
    </div>
  )
}
