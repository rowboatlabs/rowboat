"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

// ─── Base Progress ────────────────────────────────────────

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full w-full flex-1 transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

// ─── Enhanced Progress ────────────────────────────────────

type ProgressSize = "sm" | "md" | "lg"
type ProgressVariant = "default" | "success" | "warning" | "error" | "gradient"

interface EnhancedProgressProps extends Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, "value"> {
  value?: number
  label?: string
  showPercentage?: boolean
  size?: ProgressSize
  variant?: ProgressVariant
  striped?: boolean
  animated?: boolean
  glow?: boolean
}

const sizes: Record<ProgressSize, { track: string; text: string }> = {
  sm: { track: "h-1.5", text: "text-xs" },
  md: { track: "h-2.5", text: "text-sm" },
  lg: { track: "h-4", text: "text-sm" },
}

const glowShadow = (color: string) => `shadow-[0_0_8px_-2px] shadow-${color}/40`

const variants: Record<ProgressVariant, { indicator: string; track: string; glow: string }> = {
  default:  { indicator: "bg-primary",      track: "bg-primary/15",      glow: glowShadow("primary") },
  success:  { indicator: "bg-emerald-500",  track: "bg-emerald-500/15",  glow: glowShadow("emerald-500") },
  warning:  { indicator: "bg-amber-500",    track: "bg-amber-500/15",    glow: glowShadow("amber-500") },
  error:    { indicator: "bg-red-500",      track: "bg-red-500/15",      glow: glowShadow("red-500") },
  gradient: { indicator: "bg-gradient-to-r from-primary via-primary/80 to-primary/60", track: "bg-primary/15", glow: glowShadow("primary") },
}

function EnhancedProgress({
  value = 0,
  label,
  showPercentage = false,
  size = "md",
  variant = "default",
  striped = false,
  animated = false,
  glow = false,
  className,
  ...props
}: EnhancedProgressProps) {
  const s = sizes[size]
  const v = variants[variant]
  const pct = Math.round(Math.min(100, Math.max(0, value)))

  return (
    <div className={cn("w-full space-y-1.5", className)}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between">
          {label && <span className={cn("font-medium text-foreground/80", s.text)}>{label}</span>}
          {showPercentage && <span className={cn("tabular-nums text-muted-foreground", s.text)}>{pct}%</span>}
        </div>
      )}

      <ProgressPrimitive.Root
        data-slot="progress"
        className={cn("relative w-full overflow-hidden rounded-full", s.track, v.track, glow && v.glow)}
        value={value}
        {...props}
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn(
            "h-full w-full flex-1 rounded-full transition-all duration-500 ease-out",
            v.indicator,
            striped && "progress-striped",
            striped && animated && "progress-striped-animated"
          )}
          style={{ transform: `translateX(-${100 - pct}%)` }}
        />
      </ProgressPrimitive.Root>
    </div>
  )
}

export { Progress, EnhancedProgress }
