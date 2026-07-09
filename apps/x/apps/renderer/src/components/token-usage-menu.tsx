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
  const total = totalTokensOf(usage)
  const totalText = `${formatTokenCount(total)} tokens`
  const title = `Token usage for this ${scope}`

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex size-6 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
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
    </>
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
