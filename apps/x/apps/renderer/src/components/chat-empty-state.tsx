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
 * Shown in both the side-pane copilot and full-screen chat; the side pane
 * (`wide` unset) uses slightly smaller type to fit the narrow column.
 */
export function ChatEmptyState({
  onPickPrompt,
  wide = false,
}: ChatEmptyStateProps) {
  return (
    <div className={cn('mx-auto flex w-full flex-col gap-5 py-6', wide ? 'max-w-4xl px-4' : 'max-w-md px-2')}>
      <div>
        <div className={cn('font-semibold tracking-tight', wide ? 'text-2xl' : 'text-lg')}>
          What are we working on?
        </div>
        <div className={cn('mt-1 text-muted-foreground', wide ? 'text-[15px]' : 'text-[13px]')}>
          Ask anything, or start with a suggestion.
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        {SUGGESTED_ACTIONS.map((action, i) => (
          <button
            key={action.title}
            type="button"
            onClick={() => onPickPrompt(action.prompt)}
            className={cn(
              'group flex w-full items-center gap-1.5 text-left transition-colors hover:bg-accent/50',
              wide ? 'px-3.5 py-3' : 'px-3 py-2.5',
              i > 0 && 'border-t border-border/60',
            )}
          >
            <action.icon className={cn('mr-2 shrink-0 text-foreground/80', wide ? 'size-4' : 'size-3.5')} strokeWidth={1.75} />
            <span className={cn('shrink-0 font-medium text-foreground', wide ? 'text-sm' : 'text-[13px]')}>
              {action.title}
            </span>
            <span className={cn('truncate text-muted-foreground', wide ? 'text-[13px]' : 'text-[12px]')}>
              {action.sub}
            </span>
            <ArrowRight className={cn('ml-auto shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground', wide ? 'size-3.5' : 'size-3')} />
          </button>
        ))}
      </div>

      <ToolConnectionsCard compact={!wide} />
    </div>
  )
}
