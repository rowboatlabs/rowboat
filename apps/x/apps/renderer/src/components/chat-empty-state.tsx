import { ArrowRight, BookOpen, Mail, Zap } from 'lucide-react'

import { cn } from '@/lib/utils'
import { ToolConnectionsCard } from '@/components/tool-connections-card'

interface ChatEmptyStateProps {
  /** Fill the composer with a starter prompt (does not submit). */
  onPickPrompt: (prompt: string) => void
  /** Use a wider column — for the full-screen chat where the narrow column looks cramped. */
  wide?: boolean
}

const SUGGESTED_ACTIONS: { icon: typeof Mail; title: string; sub: string; prompt: string }[] = [
  { icon: Mail, title: 'Draft a reply', sub: 'to an email', prompt: "Let's draft a reply to [name]'s email" },
  { icon: Zap, title: 'Set up a background agent', sub: 'that automates tasks', prompt: 'Set up a background agent that automates [task]' },
  { icon: BookOpen, title: 'Research a topic', sub: 'create a local wiki for me', prompt: 'Research [topic] and create a local wiki for me' },
]

/**
 * Empty-state body for the chat surface: greeting and starter action cards.
 * Shown in both the side-pane copilot and full-screen chat.
 */
export function ChatEmptyState({
  onPickPrompt,
  wide = false,
}: ChatEmptyStateProps) {
  return (
    <div className={cn('mx-auto flex w-full flex-col gap-5 py-6', wide ? 'max-w-4xl px-4' : 'max-w-md px-2')}>
      <div>
        <div className="text-2xl font-semibold tracking-tight">What are we working on?</div>
        <div className="mt-1 text-[15px] text-muted-foreground">Ask anything, or start with a suggestion.</div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        {SUGGESTED_ACTIONS.map((action, i) => (
          <button
            key={action.title}
            type="button"
            onClick={() => onPickPrompt(action.prompt)}
            className={cn(
              'group flex w-full items-center gap-1.5 px-3.5 py-3 text-left transition-colors hover:bg-accent/50',
              i > 0 && 'border-t border-border/60',
            )}
          >
            <action.icon className="mr-2 size-4 shrink-0 text-foreground/80" strokeWidth={1.75} />
            <span className="shrink-0 text-sm font-medium text-foreground">{action.title}</span>
            <span className="truncate text-[13px] text-muted-foreground">{action.sub}</span>
            <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
          </button>
        ))}
      </div>

      <ToolConnectionsCard />
    </div>
  )
}
