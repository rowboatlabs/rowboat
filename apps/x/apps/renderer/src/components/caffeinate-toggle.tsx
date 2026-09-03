import { useEffect, useState } from "react"
import { Coffee } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Caffeinate (keep-system-awake) toggle for the fixed top-left control
 * cluster, beside New chat. Grey when off, amber with rising steam when on;
 * one click either way. The Settings switch drives the same main-process
 * state and both follow `power:caffeinateChanged`.
 */
export function CaffeinateToggle() {
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

  const toggle = () => {
    const next = !enabled
    void window.ipc
      .invoke("power:setCaffeinate", { enabled: next })
      .then((res) => {
        setEnabled(res.enabled)
        // There is no time limit, so say so at the moment of the click —
        // the amber icon covers the rest of the time it is on.
        if (res.enabled) toast.success("Caffeinate on — your Mac won't sleep until you turn this off.")
      })
      .catch(() => {
        toast.error(next ? "Failed to turn on Caffeinate" : "Failed to turn off Caffeinate")
      })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={enabled}
          aria-label={enabled ? "Caffeinate is on — click to turn off" : "Caffeinate — keep your Mac awake"}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent",
            enabled ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Coffee className={cn("size-[17px]", enabled && "caffeinate-steam")} strokeWidth={1.5} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {enabled ? (
          "Caffeinate is on — your Mac won't sleep. Click to turn off."
        ) : (
          <>
            <p>Keep your Mac awake</p>
            {/* The tooltip is dark, so "muted" here is the light text dimmed. */}
            <p className="text-background/70">Useful while a long task or code session runs.</p>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
