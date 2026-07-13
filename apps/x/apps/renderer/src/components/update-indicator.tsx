import { useEffect, useRef, useState } from "react"
import { LoaderIcon, RefreshCw, X } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { updatePrompted } from "@/lib/analytics"

type UpdaterStatus = {
  state: string
  newVersion?: string
  snoozedUntil?: number
}

/**
 * Titlebar update indicator (Zed-style): invisible while idle, a spinner
 * while an update downloads, and a "Restart to update" chip once it's staged.
 * Clicking the chip restarts into the new version; the small × snoozes the
 * chip for 24h (owned by main — see updater.ts snoozeUpdateNotice — so it
 * survives window reloads and reopens).
 *
 * Both buttons stay mounted and are toggled invisible when inactive — a
 * freshly-mounted no-drag button inside the drag-region header has its first
 * click swallowed by the window drag (see CaffeinateIndicator).
 */
export function UpdateIndicator() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  // Bumped when a snooze expires so the chip re-appears without new IPC.
  const [now, setNow] = useState(() => Date.now())
  const promptedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void window.ipc
      .invoke("updater:getStatus", null)
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {})
    const unsubscribe = window.ipc.on("updater:status", (s) => {
      setStatus(s)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const snoozed = !!status?.snoozedUntil && status.snoozedUntil > now
  const downloading = status?.state === "downloading"
  const ready = status?.state === "ready" && !snoozed

  // Wake up when the snooze lapses so the chip re-offers itself.
  useEffect(() => {
    if (status?.state !== "ready" || !status.snoozedUntil) return
    const delay = status.snoozedUntil - Date.now()
    if (delay <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), delay + 1000)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    if (ready && !promptedRef.current) {
      updatePrompted()
      promptedRef.current = true
    }
  }, [ready])

  const description = status?.newVersion
    ? `Rowboat ${status.newVersion} has been downloaded.`
    : "A new version of Rowboat has been downloaded."

  return (
    <div className="flex items-center self-center shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={ready ? () => void window.ipc.invoke("updater:quitAndInstall", null) : undefined}
            disabled={!ready && !downloading}
            aria-hidden={!ready && !downloading}
            aria-label={ready ? "Restart to update" : downloading ? "Downloading update" : undefined}
            className={cn(
              "titlebar-no-drag flex h-8 items-center justify-center rounded-md transition-colors self-center shrink-0",
              ready
                ? "gap-1.5 px-2.5 text-xs font-medium bg-accent/60 text-foreground hover:bg-accent"
                : downloading
                  ? "w-8 text-muted-foreground cursor-default"
                  : "w-0 invisible pointer-events-none",
            )}
          >
            {downloading ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : ready ? (
              <>
                <RefreshCw className="size-3.5" />
                <span>Restart to update</span>
              </>
            ) : null}
          </button>
        </TooltipTrigger>
        {downloading && <TooltipContent side="bottom">Downloading update…</TooltipContent>}
        {ready && (
          <TooltipContent side="bottom" className="max-w-64">
            {description} Restart to finish updating — you'll come right back to where you are.
          </TooltipContent>
        )}
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void window.ipc.invoke("updater:snooze", null)}
            disabled={!ready}
            aria-hidden={!ready}
            aria-label="Remind me later"
            className={cn(
              "titlebar-no-drag flex h-8 items-center justify-center rounded-md text-muted-foreground transition-colors self-center shrink-0",
              ready ? "w-5 hover:text-foreground" : "w-0 invisible pointer-events-none",
            )}
          >
            <X className={cn("size-3.5", !ready && "hidden")} />
          </button>
        </TooltipTrigger>
        {ready && <TooltipContent side="bottom">Remind me later</TooltipContent>}
      </Tooltip>
    </div>
  )
}
