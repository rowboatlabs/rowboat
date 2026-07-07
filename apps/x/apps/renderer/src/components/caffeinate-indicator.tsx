import { useEffect, useState } from "react"
import { Coffee } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

/**
 * Titlebar indicator shown while Caffeinate (keep-system-awake) is on.
 * Always mounted and toggled invisible when off — a freshly-mounted no-drag
 * button inside the drag-region header has its first click swallowed by the
 * window drag (see the trailing layout control in App.tsx).
 */
export function CaffeinateIndicator() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.ipc
      .invoke("power:getCaffeinate", null)
      .then((res) => {
        if (!cancelled) setEnabled(res.enabled)
      })
      .catch(() => {})
    const unsubscribe = window.ipc.on("power:caffeinateChanged", ({ enabled }) => {
      setEnabled(enabled)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            void window.ipc.invoke("power:setCaffeinate", { enabled: false }).catch(() => {
              toast.error("Failed to turn off Caffeinate")
            })
          }}
          disabled={!enabled}
          aria-hidden={!enabled}
          aria-label="Caffeinate is on — click to turn off"
          className={cn(
            "titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-amber-500 transition-colors self-center shrink-0",
            enabled ? "hover:bg-accent hover:text-amber-600" : "invisible pointer-events-none",
          )}
        >
          <Coffee className="size-4" />
        </button>
      </TooltipTrigger>
      {enabled && (
        <TooltipContent side="bottom">
          Caffeinate is on — your Mac won't sleep. Click to turn off.
        </TooltipContent>
      )}
    </Tooltip>
  )
}
