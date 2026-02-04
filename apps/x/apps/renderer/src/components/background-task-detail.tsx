import { Bot, Calendar, Clock, AlertCircle, CheckCircle } from "lucide-react"
import { Switch } from "@/components/ui/switch"

interface BackgroundTaskSchedule {
  type: "cron" | "window" | "once"
  expression?: string
  cron?: string
  startTime?: string
  endTime?: string
  runAt?: string
}

interface BackgroundTaskDetailProps {
  name: string
  description?: string
  schedule: BackgroundTaskSchedule
  enabled: boolean
  status?: "scheduled" | "running" | "finished" | "failed" | "triggered"
  nextRunAt?: string | null
  lastRunAt?: string | null
  lastError?: string | null
  runCount?: number
  onToggleEnabled: (enabled: boolean) => void
}

function formatScheduleDescription(schedule: BackgroundTaskSchedule): string {
  switch (schedule.type) {
    case "cron":
      return `Runs on cron schedule: ${schedule.expression}`
    case "window":
      return `Runs once between ${schedule.startTime} and ${schedule.endTime} based on: ${schedule.cron}`
    case "once":
      return `Runs once at ${schedule.runAt}`
    default:
      return "Unknown schedule type"
  }
}

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "Never"
  try {
    const date = new Date(isoString)
    return date.toLocaleString()
  } catch {
    return isoString
  }
}

export function BackgroundTaskDetail({
  name,
  description,
  schedule,
  enabled,
  status,
  nextRunAt,
  lastRunAt,
  lastError,
  runCount = 0,
  onToggleEnabled,
}: BackgroundTaskDetailProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10">
            <Bot className="size-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate">{name}</h1>
            <p className="text-sm text-muted-foreground">Background Agent</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Description */}
        {description && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Description</h2>
            <p className="text-sm">{description}</p>
          </section>
        )}

        {/* Schedule */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Schedule</h2>
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium capitalize">{schedule.type} Schedule</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatScheduleDescription(schedule)}
            </p>
          </div>
        </section>

        {/* Enabled Toggle - hide for completed one-time schedules */}
        {status === "triggered" ? (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Status</h2>
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="size-4 text-green-500" />
                <p className="text-sm font-medium">Completed</p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                This one-time agent has finished running and will not run again.
              </p>
            </div>
          </section>
        ) : (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Status</h2>
            <div className="flex items-center justify-between bg-muted/50 rounded-lg p-4">
              <div>
                <p className="text-sm font-medium">{enabled ? "Enabled" : "Disabled"}</p>
                <p className="text-xs text-muted-foreground">
                  {enabled ? "This agent will run according to its schedule" : "This agent is paused and will not run"}
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={onToggleEnabled}
              />
            </div>
          </section>
        )}

        {/* Run Statistics */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Run History</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-2xl font-semibold">{runCount}</p>
              <p className="text-xs text-muted-foreground">Total Runs</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm font-medium">{formatDateTime(lastRunAt)}</p>
              <p className="text-xs text-muted-foreground">Last Run</p>
            </div>
          </div>
        </section>

        {/* Next Run */}
        {nextRunAt && schedule.type !== "once" && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Next Scheduled Run</h2>
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span className="text-sm">{formatDateTime(nextRunAt)}</span>
              </div>
            </div>
          </section>
        )}

        {/* Last Error */}
        {lastError && (
          <section>
            <h2 className="text-sm font-medium text-red-500 mb-2">Last Error</h2>
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="size-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{lastError}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
