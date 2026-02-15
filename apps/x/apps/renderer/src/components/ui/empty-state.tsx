import { cn } from "@/lib/utils"
import type { ComponentProps, ReactNode } from "react"
import { Button } from "./button"

/**
 * Reusable empty state component with icon/illustration slot,
 * title, description, and optional action button.
 *
 * Usage:
 *   <EmptyState
 *     icon={<InboxIcon className="size-10" />}
 *     title="No messages yet"
 *     description="Start a conversation to get going."
 *     action={{ label: "New Chat", onClick: handleNew }}
 *   />
 */

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
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center animate-fade-in-up",
        compact ? "gap-3 py-8 px-4" : "gap-4 py-16 px-8",
        className
      )}
      {...props}
    >
      {/* Icon / Illustration */}
      {(icon || illustration) && (
        <div
          className={cn(
            "flex items-center justify-center",
            icon && !illustration && cn(
              "rounded-2xl bg-muted/50 border border-border/30",
              "text-muted-foreground",
              compact ? "size-12 p-2.5" : "size-16 p-3.5"
            )
          )}
        >
          {illustration ?? icon}
        </div>
      )}

      {/* Text */}
      <div className="space-y-1.5 max-w-sm">
        <h3
          className={cn(
            "font-semibold text-foreground/80",
            compact ? "text-sm" : "text-base"
          )}
        >
          {title}
        </h3>
        {description && (
          <p
            className={cn(
              "text-muted-foreground leading-relaxed",
              compact ? "text-xs" : "text-sm"
            )}
          >
            {description}
          </p>
        )}
      </div>

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {action && (
            <Button
              variant={action.variant ?? "default"}
              size={compact ? "sm" : "default"}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant={secondaryAction.variant ?? "outline"}
              size={compact ? "sm" : "default"}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}

      {/* Custom content slot */}
      {children}
    </div>
  )
}
