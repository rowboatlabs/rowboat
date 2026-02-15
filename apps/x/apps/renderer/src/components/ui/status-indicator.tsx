import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

type StatusType = "online" | "offline" | "syncing" | "error" | "idle" | "busy"

interface StatusIndicatorProps extends ComponentProps<"div"> {
  status: StatusType
  label?: string
  size?: "sm" | "md" | "lg"
  showLabel?: boolean
}

const statusConfig: Record<StatusType, {
  dotClass: string
  pulseClass: string
  label: string
}> = {
  online: {
    dotClass: "bg-emerald-500",
    pulseClass: "animate-pulse bg-emerald-500/50",
    label: "Online",
  },
  offline: {
    dotClass: "bg-muted-foreground/40",
    pulseClass: "",
    label: "Offline",
  },
  syncing: {
    dotClass: "bg-primary",
    pulseClass: "animate-status-dot bg-primary/50",
    label: "Syncing",
  },
  error: {
    dotClass: "bg-red-500",
    pulseClass: "animate-pulse bg-red-500/50",
    label: "Error",
  },
  idle: {
    dotClass: "bg-amber-400",
    pulseClass: "",
    label: "Idle",
  },
  busy: {
    dotClass: "bg-primary",
    pulseClass: "animate-status-dot bg-primary/40",
    label: "Busy",
  },
}

const sizeConfig: Record<"sm" | "md" | "lg", {
  dot: string
  pulse: string
  text: string
  gap: string
}> = {
  sm: { dot: "size-1.5", pulse: "size-3", text: "text-xs", gap: "gap-1.5" },
  md: { dot: "size-2", pulse: "size-4", text: "text-sm", gap: "gap-2" },
  lg: { dot: "size-2.5", pulse: "size-5", text: "text-sm", gap: "gap-2.5" },
}

export function StatusIndicator({
  status,
  label,
  size = "md",
  showLabel = true,
  className,
  ...props
}: StatusIndicatorProps) {
  const config = statusConfig[status]
  const sizes = sizeConfig[size]
  const displayLabel = label ?? config.label

  return (
    <div
      className={cn("flex items-center", sizes.gap, className)}
      role="status"
      aria-label={displayLabel}
      {...props}
    >
      <span className="relative flex items-center justify-center">
        {config.pulseClass && (
          <span
            className={cn(
              "absolute rounded-full",
              sizes.pulse,
              config.pulseClass
            )}
          />
        )}
        <span className={cn("relative rounded-full", sizes.dot, config.dotClass)} />
      </span>
      {showLabel && (
        <span className={cn("text-muted-foreground", sizes.text)}>
          {displayLabel}
        </span>
      )}
    </div>
  )
}
