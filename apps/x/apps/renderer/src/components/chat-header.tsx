import { useCallback, useState, type ReactNode } from 'react'
import { ArrowUpRight, BarChart3, Bug, ChevronDown, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TokenUsageDialog } from '@/components/token-usage-menu'
import { Keys } from '@/components/keys'
import { SHORTCUTS } from '@/lib/shortcuts'
import type { TokenUsage } from '@/lib/chat-conversation'
import { formatTokenCount, hasTokenUsage, totalTokensOf } from '@/lib/token-usage'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatRelativeTime } from '@/lib/relative-time'

export interface ChatHeaderRecentRun {
  id: string
  title?: string
  createdAt: string
}

export interface ChatHeaderProps {
  activeTitle: string
  onNewChatTab: () => void
  recentRuns?: ChatHeaderRecentRun[]
  activeRunId?: string | null
  sessionUsage?: TokenUsage
  onSelectRun?: (runId: string) => void
  onOpenChatHistory?: () => void
  /** Where this chat can move (sidebar, Assistant, a floating window) — items
   *  in the ⋯ menu rather than icons of their own (2026-10-22). */
  moveTargets?: ReadonlyArray<{ label: string; icon: ReactNode; onSelect: () => void }>
}

/**
 * Header controls for the copilot/chat surface: the active-chat title with a
 * recent-chats history dropdown, plus the new-chat button. Rendered identically
 * whether the chat lives in the side pane (ChatSidebar) or full screen (App
 * content header). There is a single chat conversation at a time — switching
 * between chats happens through the history dropdown.
 */
export function ChatHeader({
  activeTitle,
  onNewChatTab,
  recentRuns = [],
  activeRunId,
  sessionUsage,
  onSelectRun,
  onOpenChatHistory,
  moveTargets = [],
}: ChatHeaderProps) {
  const [usageOpen, setUsageOpen] = useState(false)
  const hasHistory = recentRuns.length > 0 || Boolean(onOpenChatHistory)
  const showUsage = hasTokenUsage(sessionUsage)

  const handleDownloadChatLog = useCallback(async () => {
    if (!activeRunId) {
      toast.error('No chat log available yet')
      return
    }
    try {
      // Session-first (new runtime); legacy runs fallback covers old
      // background tabs until stage 7 removes the runs runtime.
      let result: { success: boolean; error?: string }
      try {
        result = await window.ipc.invoke('sessions:downloadLog', { sessionId: activeRunId })
      } catch {
        result = await window.ipc.invoke('runs:downloadLog', { runId: activeRunId })
      }
      if (result.success) {
        toast.success('Chat log saved')
      } else if (result.error) {
        toast.error(result.error)
      }
    } catch (err) {
      console.error('Download chat log failed:', err)
      toast.error('Failed to download chat log')
    }
  }, [activeRunId])

  return (
    <>
      {hasHistory ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              // Hugs the title (2026-10-22): stretched across the bar, its hover
              // lit the whole header once the header became the top bar.
              className="titlebar-no-drag flex h-8 min-w-0 max-w-full shrink items-center gap-2 rounded-md px-2.5 text-sm font-medium text-foreground outline-none hover:bg-accent/60"
              aria-label="Chat history"
            >
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{activeTitle}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
            {recentRuns.length > 0 && (
              <DropdownMenuLabel className="text-[13px] font-normal text-muted-foreground">
                Recent
              </DropdownMenuLabel>
            )}
            {recentRuns.slice(0, 6).map((run) => (
              <DropdownMenuItem
                key={run.id}
                onClick={() => onSelectRun?.(run.id)}
                className={cn('gap-2', activeRunId === run.id && 'bg-accent')}
              >
                <span className="min-w-0 flex-1 truncate">{run.title || '(Untitled chat)'}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatRelativeTime(run.createdAt)}
                </span>
              </DropdownMenuItem>
            ))}
            {onOpenChatHistory && (
              <>
                {recentRuns.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={onOpenChatHistory} className="gap-2 text-primary">
                  <ArrowUpRight className="size-4" />
                  View all chats
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex min-w-0 shrink items-center gap-2 px-2.5 text-sm font-medium text-foreground">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{activeTitle}</span>
        </div>
      )}
      <span className="min-w-2 flex-1" aria-hidden="true" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewChatTab}
            className="titlebar-no-drag my-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="New chat"
          >
            <Plus className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">New chat <Keys keys={SHORTCUTS.newChat} tone="dark" /></TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="titlebar-no-drag my-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Chat options"
              >
                <MoreHorizontal className="size-5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Chat options</TooltipContent>
        </Tooltip>
        {/* One menu for the less frequent actions (2026-10-22): usage, where
            the chat lives, and the debug log — five icons became New chat + ⋯. */}
        <DropdownMenuContent align="end" className="min-w-52">
          {showUsage && sessionUsage && (
            <DropdownMenuItem onSelect={() => setUsageOpen(true)}>
              <BarChart3 className="size-4" />
              Token usage
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{formatTokenCount(totalTokensOf(sessionUsage))}</span>
            </DropdownMenuItem>
          )}
          {moveTargets.map((target) => (
            <DropdownMenuItem key={target.label} onSelect={target.onSelect}>
              {target.icon}
              {target.label}
            </DropdownMenuItem>
          ))}
          {(showUsage || moveTargets.length > 0) && <DropdownMenuSeparator />}
          <DropdownMenuItem
            disabled={!activeRunId}
            onSelect={() => {
              void handleDownloadChatLog()
            }}
          >
            <Bug className="size-4" />
            Download chat log
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {showUsage && sessionUsage && (
        <TokenUsageDialog usage={sessionUsage} scope="session" open={usageOpen} onOpenChange={setUsageOpen} />
      )}
    </>
  )
}
