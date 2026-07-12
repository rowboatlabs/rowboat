import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { updatePrompted } from "@/lib/analytics"

// How often to re-evaluate the snooze while an update stays pending. The
// snooze itself (24h) is owned by main — see updater.ts snoozeUpdateNotice —
// so "Later" survives window reloads and reopens.
const RECHECK_MS = 60 * 60 * 1000

const TOAST_ID = "update-ready"

/**
 * Non-modal "restart to update" card (gap: the native update dialog used to
 * interrupt mid-call). Renders nothing; drives a persistent sonner toast.
 *
 * `busy` defers the card while the user is in a call or a turn is running —
 * it appears at the first idle moment after the update is staged, and is
 * retracted if a call/turn starts while it's on screen.
 */
export function UpdateReadyNotice({ busy }: { busy: boolean }) {
  const [ready, setReady] = useState<{ newVersion?: string; snoozedUntil?: number } | null>(null)
  const promptedRef = useRef(false)
  // Distinguishes our own toast.dismiss (retraction) from the user dismissing
  // the card — sonner fires onDismiss for both, and only the latter snoozes.
  const retractedRef = useRef(false)

  useEffect(() => {
    void window.ipc.invoke("updater:getStatus", null).then((s) => {
      if (s.state === "ready") setReady({ newVersion: s.newVersion, snoozedUntil: s.snoozedUntil })
    })
    return window.ipc.on("updater:status", (s) => {
      setReady(s.state === "ready" ? { newVersion: s.newVersion, snoozedUntil: s.snoozedUntil } : null)
    })
  }, [])

  useEffect(() => {
    if (busy) {
      // Retract the card if a call/turn starts while it's up. Only on busy —
      // `ready` briefly clears during the periodic re-check cycle
      // (ready → checking → ready), and dismissing there would blink the card.
      retractedRef.current = true
      toast.dismiss(TOAST_ID)
      return
    }
    if (!ready) return

    // Main persists the snooze and pushes the refreshed status, which updates
    // `ready.snoozedUntil` here (and in any other open window).
    const snooze = () => {
      if (retractedRef.current) return
      void window.ipc.invoke("updater:snooze", null)
    }
    const show = () => {
      if (ready.snoozedUntil && Date.now() < ready.snoozedUntil) return
      if (!promptedRef.current) {
        updatePrompted()
        promptedRef.current = true
      }
      retractedRef.current = false
      const notesUrl = ready.newVersion
        ? `https://github.com/rowboatlabs/rowboat/releases/tag/v${ready.newVersion}`
        : "https://github.com/rowboatlabs/rowboat/releases/latest"
      toast("Update ready", {
        id: TOAST_ID, // stable id: re-shows update in place, never stacks
        description: (
          <>
            {ready.newVersion
              ? `Rowboat ${ready.newVersion} has been downloaded. `
              : "A new version of Rowboat has been downloaded. "}
            {"Restart to finish updating — you'll come right back to where you are. "}
            <a
              href={notesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground transition-colors"
            >
              {"See what's new"}
            </a>
          </>
        ),
        duration: Infinity,
        action: {
          label: "Restart now",
          onClick: () => void window.ipc.invoke("updater:quitAndInstall", null),
        },
        cancel: {
          label: "Later",
          onClick: snooze,
        },
        onDismiss: snooze,
      })
    }

    show()
    // The app can stay open for weeks (macOS especially) — quietly re-offer
    // once per day while the update is still pending.
    const interval = setInterval(show, RECHECK_MS)
    return () => clearInterval(interval)
  }, [ready, busy])

  return null
}
