import { Mail, Calendar, FolderOpen, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Suggestion {
  id: string
  label: string
  prompt: string
  icon: React.ReactNode
}

const defaultSuggestions: Suggestion[] = [
  {
    id: 'email-draft',
    label: 'Draft an email',
    prompt: "Let's draft an email response to [name]",
    icon: <Mail className="h-4 w-4" />,
  },
  {
    id: 'meeting-prep',
    label: 'Prep for a meeting',
    prompt: 'Help me prep for my next meeting with [name]',
    icon: <Calendar className="h-4 w-4" />,
  },
  {
    id: 'doc-collab',
    label: 'Work on a document',
    prompt: "Let's work on [document name]",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    id: 'organize-files',
    label: 'Organize files',
    prompt: 'Help me organize [folder or files]',
    icon: <FolderOpen className="h-4 w-4" />,
  },
]

interface SuggestionsProps {
  suggestions?: Suggestion[]
  onSelect: (prompt: string) => void
  className?: string
  vertical?: boolean
}

export function Suggestions({
  suggestions = defaultSuggestions,
  onSelect,
  className,
  vertical = false,
}: SuggestionsProps) {
  return (
    <div className={cn(
      'flex gap-2',
      vertical ? 'flex-col items-end' : 'flex-wrap justify-center',
      className
    )}>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          onClick={() => onSelect(suggestion.prompt)}
          className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full',
            'text-sm text-muted-foreground',
            'border border-border bg-background',
            'hover:bg-muted hover:text-foreground hover:border-muted-foreground/30',
            'transition-colors duration-150',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          {suggestion.icon}
          <span>{suggestion.label}</span>
        </button>
      ))}
    </div>
  )
}
