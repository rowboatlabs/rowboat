import { Bot, Mail, Sparkles, Telescope } from 'lucide-react'

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
  { icon: Bot, title: 'Set up a background agent', sub: 'that automates tasks', prompt: 'Set up a background agent that automates [task]' },
  { icon: Telescope, title: 'Research a topic', sub: 'create a local wiki for me', prompt: 'Research [topic] and create a local wiki for me' },
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
    <div className={cn('mx-auto flex w-full flex-col gap-6 px-2 py-6', wide ? 'max-w-2xl' : 'max-w-md')}>
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-foreground">
          <Sparkles className="size-[17px]" />
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight">What are we working on?</div>
          <div className="text-xs text-muted-foreground">Ask anything, or start with a suggestion.</div>
        </div>
      </div>

      <div>
        <div className="px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Get started
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

      <ToolConnectionsCard />
    </div>
  )
}
