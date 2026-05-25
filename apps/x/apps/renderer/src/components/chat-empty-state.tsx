import { ArrowUpRight, Bot, Mail, MessageSquare, Sparkles, Telescope } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'

export interface ChatEmptyStateRun {
  id: string
  title?: string
  createdAt: string
}

interface ChatEmptyStateProps {
  recentRuns?: ChatEmptyStateRun[]
  onSelectRun?: (runId: string) => void
  onOpenChatHistory?: () => void
  /** Fill the composer with a starter prompt (does not submit). */
  onPickPrompt: (prompt: string) => void
  /** Use a wider column — for the full-screen chat where the narrow column looks cramped. */
  wide?: boolean
}

const SUGGESTED_ACTIONS: { icon: typeof Mail; title: string; sub: string; prompt: string }[] = [
  { icon: Mail, title: 'Draft a reply', sub: 'to an email', prompt: "Let's draft a reply to [name]'s email" },
  { icon: Bot, title: 'Set up a background agent', sub: 'that automates tasks', prompt: 'Set up a background agent that automates [task]' },
  { icon: Telescope, title: 'Research a topic', sub: 'create a local wiki for me', prompt: 'Research [topic] and create a local wiki for me' },
]

/**
 * Empty-state body for the chat surface: greeting, recent chats, and starter
 * action cards. Shown in both the side-pane copilot and full-screen chat.
 */
export function ChatEmptyState({
  recentRuns = [],
  onSelectRun,
  onOpenChatHistory,
  onPickPrompt,
  wide = false,
}: ChatEmptyStateProps) {
  return (
    <div className={cn('mx-auto flex w-full flex-col gap-6 px-2 py-6', wide ? 'max-w-2xl' : 'max-w-md')}>
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-foreground">
          <Sparkles className="size-[17px]" />
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight">What are we working on?</div>
          <div className="text-xs text-muted-foreground">Ask anything, or pick up where you left off.</div>
        </div>
      </div>

      {recentRuns.length > 0 && (
        <div>
          <div className="flex items-center px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex-1">Recent chats</span>
            {onOpenChatHistory && (
              <button
                type="button"
                onClick={onOpenChatHistory}
                className="inline-flex items-center gap-0.5 text-[11px] font-medium normal-case tracking-normal text-primary hover:underline"
              >
                View all
                <ArrowUpRight className="size-3" />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {recentRuns.slice(0, 4).map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onSelectRun?.(run.id)}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-accent"
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{run.title || '(Untitled chat)'}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(run.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {recentRuns.length > 0 ? 'Or start fresh' : 'Get started'}
        </div>
        <div className="flex flex-col gap-2">
          {SUGGESTED_ACTIONS.map((action) => (
            <button
              key={action.title}
              type="button"
              onClick={() => onPickPrompt(action.prompt)}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent"
            >
              <action.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.8px] font-medium">{action.title}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">{action.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
