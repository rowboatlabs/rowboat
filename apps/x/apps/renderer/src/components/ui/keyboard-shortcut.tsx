import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

interface KeyboardShortcutProps extends ComponentProps<"kbd"> {
  keys: string[]
  separator?: "+" | "→" | " "
  size?: "sm" | "md" | "lg"
}

const sizeConfig = {
  sm: { key: "min-w-5 h-5 px-1 text-[10px]", sep: "text-[10px] mx-0.5", label: "text-xs" },
  md: { key: "min-w-6 h-6 px-1.5 text-xs", sep: "text-xs mx-1", label: "text-sm" },
  lg: { key: "min-w-7 h-7 px-2 text-sm", sep: "text-sm mx-1", label: "text-base" },
}

const keyBase = "inline-flex items-center justify-center rounded-md border border-border/60 bg-muted/50 font-mono font-medium text-muted-foreground shadow-[0_1px_0_1px] shadow-border/30"

export function KeyboardShortcut({
  keys,
  separator = "+",
  size = "md",
  className,
  ...props
}: KeyboardShortcutProps) {
  const s = sizeConfig[size]

  return (
    <kbd className={cn("inline-flex items-center select-none font-sans", className)} {...props}>
      {keys.map((key, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && (
            <span className={cn("text-muted-foreground/50 font-normal", s.sep)}>{separator}</span>
          )}
          <span className={cn(keyBase, s.key)}>{key}</span>
        </span>
      ))}
    </kbd>
  )
}

// ─── Shortcut Hint (label + keys) ────────────────────────

interface ShortcutHintProps extends ComponentProps<"div"> {
  keys: string[]
  label: string
  size?: "sm" | "md" | "lg"
}

export function ShortcutHint({ keys, label, size = "sm", className, ...props }: ShortcutHintProps) {
  return (
    <div className={cn("flex items-center gap-2 text-muted-foreground", className)} {...props}>
      <span className={cn("text-muted-foreground/70", sizeConfig[size].label)}>{label}</span>
      <KeyboardShortcut keys={keys} size={size} />
    </div>
  )
}
