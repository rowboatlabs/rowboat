import { useState } from 'react'
import { BarChart3, MoreHorizontal } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { TokenUsage } from '@/lib/chat-conversation'
import { formatTokenCount, totalTokensOf } from '@/lib/token-usage'

type TokenUsageMenuProps = {
  usage: TokenUsage
  scope: 'turn' | 'session'
  modelCallCount?: number
  className?: string
  align?: 'start' | 'center' | 'end'
}

export function TokenUsageMenu({
  usage,
  scope,
  modelCallCount,
  className,
  align = 'center',
}: TokenUsageMenuProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const title = `Token usage for this ${scope}`

  return (
    <>
      {scope === 'session' ? (
        // Header placement: a ghost icon button matching its siblings — hover
        // explains it, click opens the stats dialog directly.
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                className,
              )}
              aria-label="View token usage"
            >
              <BarChart3 className="size-4" strokeWidth={1.8} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">View token usage</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                className,
              )}
              aria-label={`${title} options`}
            >
              <MoreHorizontal className="size-3.5" strokeWidth={1.8} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={align} className="w-44">
            <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
              <BarChart3 className="size-4" />
              View token usage
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <TokenUsageDialog usage={usage} scope={scope} modelCallCount={modelCallCount} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

/** The usage breakdown on its own, for a menu item to open (the chat
 *  header's ⋯ menu, 2026-10-22). */
export function TokenUsageDialog({ usage, scope, modelCallCount, open, onOpenChange }: {
  usage: TokenUsage
  scope: 'turn' | 'session'
  modelCallCount?: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const totalText = `${formatTokenCount(totalTokensOf(usage))} tokens`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Token usage for this {scope}</DialogTitle>
          <DialogDescription>{totalText}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <UsageRow label="Input tokens" value={usage.inputTokens} />
          <UsageRow label="Output tokens" value={usage.outputTokens} />
          <UsageRow label="Cached input tokens" value={usage.cachedInputTokens} />
          <UsageRow label="Reasoning tokens" value={usage.reasoningTokens} />
          {modelCallCount !== undefined && modelCallCount > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">Model calls</span>
              <span className="tabular-nums">{modelCallCount}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function UsageRow({ label, value }: { label: string; value: number | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatTokenCount(value)}</span>
    </div>
  )
}
