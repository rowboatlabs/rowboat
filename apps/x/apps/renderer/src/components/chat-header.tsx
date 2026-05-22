import { ArrowUpRight, ChevronDown, MessageSquare, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  onSelectRun?: (runId: string) => void
  onOpenChatHistory?: () => void
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
  onSelectRun,
  onOpenChatHistory,
}: ChatHeaderProps) {
  const hasHistory = recentRuns.length > 0 || Boolean(onOpenChatHistory)

  return (
    <>
      {hasHistory ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="titlebar-no-drag flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground outline-none hover:bg-accent/60"
              aria-label="Chat history"
            >
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{activeTitle}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {recentRuns.length > 0 && (
              <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
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
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-sm font-medium text-foreground">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{activeTitle}</span>
        </div>
      )}
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
        <TooltipContent side="bottom">New chat</TooltipContent>
      </Tooltip>
    </>
  )
}
