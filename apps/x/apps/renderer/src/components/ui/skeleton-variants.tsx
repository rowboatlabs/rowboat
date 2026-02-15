import { cn } from "@/lib/utils"
import { Skeleton } from "./skeleton"
import type { ComponentProps } from "react"

// ─── Text Lines ───────────────────────────────────────────

interface SkeletonTextProps extends ComponentProps<"div"> {
  lines?: number
  widths?: string[]
}

const defaultWidths = ["w-full", "w-[85%]", "w-[70%]", "w-[90%]", "w-[60%]"]

export function SkeletonText({ lines = 3, widths = defaultWidths, className, ...props }: SkeletonTextProps) {
  return (
    <div className={cn("space-y-2.5", className)} {...props}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5 rounded-md", widths[i % widths.length])}
          style={{ animationDelay: `${i * 75}ms` }}
        />
      ))}
    </div>
  )
}

// ─── Avatar ───────────────────────────────────────────────

interface SkeletonAvatarProps extends ComponentProps<"div"> {
  size?: "sm" | "md" | "lg" | "xl"
  shape?: "circle" | "square"
}

const avatarSizes = { sm: "size-8", md: "size-10", lg: "size-12", xl: "size-16" }

export function SkeletonAvatar({ size = "md", shape = "circle", className, ...props }: SkeletonAvatarProps) {
  return (
    <Skeleton
      className={cn(avatarSizes[size], shape === "circle" ? "rounded-full" : "rounded-xl", className)}
      {...props}
    />
  )
}

// ─── Shared: Avatar + meta header ─────────────────────────

function AvatarHeader({ size = "sm" as "sm" | "md", titleWidth = "w-24", subtitleWidth = "w-16" }) {
  return (
    <div className="flex items-center gap-3">
      <SkeletonAvatar size={size} />
      <div className="flex-1 space-y-1.5">
        <Skeleton className={cn("h-3.5 rounded-md", titleWidth)} />
        <Skeleton className={cn("h-3 rounded-md", subtitleWidth)} />
      </div>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────

interface SkeletonCardProps extends ComponentProps<"div"> {
  showImage?: boolean
  showAvatar?: boolean
}

export function SkeletonCard({ showImage = true, showAvatar = false, className, ...props }: SkeletonCardProps) {
  return (
    <div className={cn("rounded-xl border border-border/40 bg-card/50 p-4 space-y-4", className)} {...props}>
      {showImage && <Skeleton className="h-32 w-full rounded-lg" />}
      <div className="space-y-3">
        {showAvatar && <AvatarHeader />}
        <SkeletonText lines={2} widths={["w-[80%]", "w-[60%]"]} />
      </div>
    </div>
  )
}

// ─── Paragraph / Article ──────────────────────────────────

interface SkeletonParagraphProps extends ComponentProps<"div"> {
  heading?: boolean
  avatar?: boolean
  rows?: number
}

export function SkeletonParagraph({ heading = true, avatar = false, rows = 4, className, ...props }: SkeletonParagraphProps) {
  return (
    <div className={cn("space-y-4", className)} {...props}>
      {(heading || avatar) && (
        avatar
          ? <AvatarHeader size="md" titleWidth="w-[45%]" subtitleWidth="w-[30%]" />
          : <Skeleton className="h-5 w-[45%] rounded-md" />
      )}
      <SkeletonText lines={rows} />
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────

interface SkeletonMessageProps extends ComponentProps<"div"> {
  align?: "left" | "right"
}

export function SkeletonMessage({ align = "left", className, ...props }: SkeletonMessageProps) {
  const isRight = align === "right"
  return (
    <div className={cn("flex gap-3 max-w-[80%]", isRight && "ml-auto flex-row-reverse", className)} {...props}>
      <SkeletonAvatar size="sm" />
      <div className={cn("space-y-2 rounded-2xl border border-border/30 px-4 py-3 flex-1", isRight ? "bg-secondary/40" : "bg-card/50")}>
        <SkeletonText lines={2} widths={["w-full", "w-[65%]"]} />
      </div>
    </div>
  )
}

// ─── List ─────────────────────────────────────────────────

interface SkeletonListProps extends ComponentProps<"div"> {
  items?: number
  showIcon?: boolean
}

export function SkeletonList({ items = 3, showIcon = true, className, ...props }: SkeletonListProps) {
  return (
    <div className={cn("space-y-3", className)} {...props}>
      {Array.from({ length: items }, (_, i) => (
        <div key={i} className="flex items-center gap-3" style={{ animationDelay: `${i * 100}ms` }}>
          {showIcon && <Skeleton className="size-8 shrink-0 rounded-lg" />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-[60%] rounded-md" />
            <Skeleton className="h-3 w-[40%] rounded-md" />
          </div>
        </div>
      ))}
    </div>
  )
}
