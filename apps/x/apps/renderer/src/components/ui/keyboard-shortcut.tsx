import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

/**
 * Displays keyboard shortcuts as styled key badges.
 * Supports single keys, combos (⌘+K), and sequences (⌘K → ⌘S).
 *
 * Usage:
 *   <KeyboardShortcut keys={["⌘", "K"]} />
 *   <KeyboardShortcut keys={["Ctrl", "Shift", "P"]} size="lg" />
 */

interface KeyboardShortcutProps extends ComponentProps<"kbd"> {
  keys: string[]
  separator?: "+" | "→" | " "
  size?: "sm" | "md" | "lg"
}

const sizeConfig = {
  sm: {
    key: "min-w-5 h-5 px-1 text-[10px]",
    separator: "text-[10px] mx-0.5",
  },
  md: {
    key: "min-w-6 h-6 px-1.5 text-xs",
    separator: "text-xs mx-1",
  },
  lg: {
    key: "min-w-7 h-7 px-2 text-sm",
    separator: "text-sm mx-1",
  },
}

export function KeyboardShortcut({
  keys,
  separator = "+",
  size = "md",
  className,
  ...props
}: KeyboardShortcutProps) {
  const config = sizeConfig[size]

  return (
    <kbd
      className={cn(
        "inline-flex items-center gap-0 select-none font-sans",
        className
      )}
      {...props}
    >
      {keys.map((key, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && (
            <span className={cn(
              "text-muted-foreground/50 font-normal",
              config.separator
            )}>
              {separator}
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-md",
              "border border-border/60 bg-muted/50",
              "font-mono font-medium text-muted-foreground",
              "shadow-[0_1px_0_1px] shadow-border/30",
              "transition-all duration-100",
              config.key
            )}
          >
            {key}
          </span>
        </span>
      ))}
    </kbd>
  )
}

// ─── Shortcut Hint (key + description) ───────────────────

interface ShortcutHintProps extends ComponentProps<"div"> {
  keys: string[]
  label: string
  size?: "sm" | "md" | "lg"
}

export function ShortcutHint({
  keys,
  label,
  size = "sm",
  className,
  ...props
}: ShortcutHintProps) {
  return (
    <div
      className={cn("flex items-center gap-2 text-muted-foreground", className)}
      {...props}
    >
      <span className={cn(
        "text-muted-foreground/70",
        size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-base"
      )}>
        {label}
      </span>
      <KeyboardShortcut keys={keys} size={size} />
    </div>
  )
}
