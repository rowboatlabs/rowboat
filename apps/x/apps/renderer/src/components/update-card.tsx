import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { Streamdown } from "streamdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { updatePrompted } from "@/lib/analytics"
import type { ipc as ipcShared } from "@x/shared"

type UpdaterStatus = ipcShared.IPCChannels["updater:status"]["req"]

const RELEASES_URL = "https://github.com/rowboatlabs/rowboat/releases"

/**
 * Bottom-left "Update available" card, shown once an update is staged. By
 * that point Squirrel has already installed it — the card only asks for the
 * restart (Chrome-style) and shows the release notes so new features aren't
 * shipped silently. "Later"/× dismiss it for this session; the update still
 * applies on the next natural restart.
 */
export function UpdateCard() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  // The version the user dismissed — if a newer update stages afterwards,
  // the card re-offers itself for that one.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const promptedForRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.ipc
      .invoke("updater:getStatus", null)
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {})
    const unsubscribe = window.ipc.on("updater:status", setStatus)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const ready = status?.state === "ready"
  // newVersion may be "1.4.0" (Squirrel.Windows) or "v1.4.0" (GitHub tag).
  const version = ready ? status.newVersion?.replace(/^v/, "") : undefined
  const versionKey = version ?? "unknown"
  const visible = ready && dismissedFor !== versionKey

  useEffect(() => {
    if (visible && promptedForRef.current !== versionKey) {
      updatePrompted()
      promptedForRef.current = versionKey
    }
  }, [visible, versionKey])

  if (!visible || status?.state !== "ready") return null

  const releaseUrl = version ? `${RELEASES_URL}/tag/v${version}` : `${RELEASES_URL}/latest`
  // Release bodies usually open with their own "What's new" heading, which
  // would duplicate the card's label above the box — drop it.
  const releaseNotes = status.releaseNotes
    ?.replace(/^\s*#{1,6}[ \t]*what[’']?s new[ \t]*\r?\n+/i, "")
    .trim()

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 w-[340px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-xl p-4 shadow-xl shadow-black/10 animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-blue-500 shrink-0" aria-hidden />
        <h4 className="text-sm font-semibold">Update available</h4>
        <div className="ml-auto flex items-center gap-1.5">
          {version && <Badge variant="secondary">v{version}</Badge>}
          <button
            type="button"
            onClick={() => setDismissedFor(versionKey)}
            aria-label="Dismiss"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        A new version is ready to install. Restart to start using it.
      </p>
      <div className="mt-3">
        <h5 className="text-xs font-semibold">What&apos;s new</h5>
        {releaseNotes ? (
          // A bordered, fixed-height scroll box (not a bare max-h clip): the
          // frame and inset scrollbar signal there is more content below the
          // fold on every platform.
          <div className="mt-1.5 max-h-56 overflow-y-auto overscroll-contain rounded-md border border-border/60 bg-muted/30 p-2.5">
            <Streamdown className="prose prose-sm dark:prose-invert max-w-none text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              {releaseNotes}
            </Streamdown>
          </div>
        ) : (
          // Releases are expected to carry notes; if this one doesn't, show
          // a static line instead of an empty pane.
          <p className="mt-1.5 text-xs text-muted-foreground">Bug fixes and improvements.</p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setDismissedFor(versionKey)}>
          Later
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => window.open(releaseUrl, "_blank")}
        >
          Release notes
        </Button>
        <Button size="sm" onClick={() => void window.ipc.invoke("updater:quitAndInstall", null)}>
          Restart now
        </Button>
      </div>
    </div>
  )
}
