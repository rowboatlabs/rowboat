import type { ReactNode } from 'react'
import { AlertCircle, CalendarClock, Loader2, Play, Square, Sunrise, Zap } from 'lucide-react'
import type { BackgroundTaskSummary } from '@x/shared/dist/background-task.js'
import { Switch } from '@/components/ui/switch'
import { isPlanner, scheduleWords } from '@/lib/schedule-words'

// One scheduled task, as a card (Baarali, 02/10/2026): what it does in one
// sentence, when it runs in plain words, how its last run went, and the two
// things one does with it, run it now or pause it. The upstream row was a
// table line with the task's file name and a cron expression.

function summaryOf(task: BackgroundTaskSummary): string {
  if (isPlanner(task)) return 'Suggests up to three to-dos each morning, from your important emails and your meetings. Nothing is added without your OK.'
  return task.instructions.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
}

export function BgTaskCard({ task, lastRun, running, stopping, busy, updating, onOpen, onToggleActive, onRun, onStop, menu }: {
  task: BackgroundTaskSummary
  /** « 5m ago », or null when it never ran. */
  lastRun: string | null
  running: boolean
  stopping: boolean
  busy: boolean
  updating: boolean
  onOpen: () => void
  onToggleActive: (active: boolean) => void
  onRun: () => void
  onStop: () => void
  menu: ReactNode
}) {
  const failed = !running && !!task.lastRunError
  const Icon = isPlanner(task) ? Sunrise : task.triggers?.eventMatchCriteria && !task.triggers.cronExpr && !task.triggers.windows?.length ? Zap : CalendarClock
  const summary = summaryOf(task)
  return (
    <div className={`grid grid-cols-[40px_1fr_auto] items-start gap-3 rounded-2xl border bg-card px-4 py-3.5 transition-colors ${running ? 'border-primary/40 bg-primary/5' : 'border-border/60 hover:border-primary/30'} ${task.active || running ? '' : 'opacity-70'}`}>
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <button type="button" onClick={onOpen} title={task.name}
          className="block max-w-full truncate text-left text-[15px] font-semibold text-foreground hover:text-primary">
          {task.name}
        </button>
        {summary && <p className="mt-0.5 line-clamp-2 text-[13px] text-foreground/75" title={task.instructions}>{summary}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          <span title={task.triggers?.eventMatchCriteria}>{scheduleWords(task.triggers).join(' · ')}</span>
          <span>{lastRun ? `Last run ${lastRun}` : 'Never run'}</span>
          {running ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">
              <Loader2 className="size-3 animate-spin" /> Running
            </span>
          ) : failed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-400" title={task.lastRunError}>
              <AlertCircle className="size-3" /> Last run failed
            </span>
          ) : !task.active ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium">Paused</span>
          ) : null}
        </div>
        {failed && task.lastRunError && (
          <p className="mt-1 truncate text-xs text-amber-700 dark:text-amber-400" title={task.lastRunError}>{task.lastRunError}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {running ? (
          <button type="button" onClick={onStop} disabled={stopping}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
            {stopping ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />} Stop
          </button>
        ) : (
          <button type="button" onClick={onRun} disabled={busy || updating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">
            <Play className="size-3" /> Run now
          </button>
        )}
        <Switch checked={task.active} disabled={updating || running}
          onCheckedChange={(checked) => onToggleActive(checked)}
          aria-label={task.active ? 'Pause' : 'Resume'} />
        {menu}
      </div>
    </div>
  )
}
