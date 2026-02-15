import { cn } from "@/lib/utils"
import type { ComponentProps, ReactNode } from "react"
import { Button } from "./button"

interface EmptyStateAction {
  label: string
  onClick: () => void
  variant?: "default" | "outline" | "secondary" | "ghost"
}

interface EmptyStateProps extends ComponentProps<"div"> {
  icon?: ReactNode
  illustration?: ReactNode
  title: string
  description?: string
  action?: EmptyStateAction
  secondaryAction?: EmptyStateAction
  compact?: boolean
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className,
  children,
  ...props
}: EmptyStateProps) {
  const visual = illustration ?? icon
  const showIconBadge = icon && !illustration

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center animate-fade-in-up",
        compact ? "gap-3 py-8 px-4" : "gap-4 py-16 px-8",
        className
      )}
      {...props}
    >
      {visual && (
        <div
          className={cn(
            "flex items-center justify-center",
            showIconBadge && "rounded-2xl bg-muted/50 border border-border/30 text-muted-foreground",
            showIconBadge && (compact ? "size-12 p-2.5" : "size-16 p-3.5")
          )}
        >
          {visual}
        </div>
      )}

      <div className="space-y-1.5 max-w-sm">
        <h3 className={cn("font-semibold text-foreground/80", compact ? "text-sm" : "text-base")}>
          {title}
        </h3>
        {description && (
          <p className={cn("text-muted-foreground leading-relaxed", compact ? "text-xs" : "text-sm")}>
            {description}
          </p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {[action, secondaryAction].filter(Boolean).map((act, i) => (
            <Button
              key={act!.label}
              variant={act!.variant ?? (i === 0 ? "default" : "outline")}
              size={compact ? "sm" : "default"}
              onClick={act!.onClick}
            >
              {act!.label}
            </Button>
          ))}
        </div>
      )}

      {children}
    </div>
  )
}
