import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

interface TypingIndicatorProps extends ComponentProps<"div"> {
  label?: string
}

/**
 * Animated typing indicator with 3 bouncing dots.
 * Shows when the assistant is generating a response.
 * Uses CSS-only animation defined in App.css (.typing-indicator).
 * Respects prefers-reduced-motion automatically.
 */
export function TypingIndicator({
  label = "Thinking",
  className,
  ...props
}: TypingIndicatorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 animate-fade-in-up",
        className
      )}
      role="status"
      aria-label={label}
      {...props}
    >
      <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 backdrop-blur-sm border border-border/30 px-4 py-3 shadow-sm">
        <div className="typing-indicator flex items-center gap-1">
          <span />
          <span />
          <span />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
