import { useState, useEffect, useCallback, useRef } from 'react'
import posthog from 'posthog-js'
import * as analytics from '@/lib/analytics'
import { FileTextIcon, MessageSquareIcon } from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { useDebounce } from '@/hooks/use-debounce'
import { useSidebarSection, type ActiveSection } from '@/contexts/sidebar-context'
import { cn } from '@/lib/utils'

interface SearchResult {
  type: 'knowledge' | 'chat'
  title: string
  preview: string
  path: string
}

export type SearchType = 'knowledge' | 'chat'

function activeTabToTypes(section: ActiveSection): SearchType[] {
  if (section === 'knowledge') return ['knowledge']
  return ['chat']
}

// Retained for any remaining programmatic Copilot entry points (background-agent
// setup button, prompt-block run, etc.) — Cmd+K no longer invokes Copilot.
export type CommandPaletteContext = {
  path: string
  lineNumber: number
}

export type CommandPaletteMention = {
  path: string
  displayName: string
  lineNumber?: number
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectFile: (path: string) => void
  onSelectRun: (runId: string) => void
  // Overrides the sidebar-section default for the initial scope (e.g. the
  // knowledge view opens search scoped to knowledge).
  defaultScope?: SearchType
}

export function CommandPalette({
  open,
  onOpenChange,
  onSelectFile,
  onSelectRun,
  defaultScope,
}: CommandPaletteProps) {
  const { activeSection } = useSidebarSection()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeTypes, setActiveTypes] = useState<Set<SearchType>>(
    () => new Set(defaultScope ? [defaultScope] : activeTabToTypes(activeSection))
  )
  const debouncedQuery = useDebounce(query, 250)

  // Sync filters and clear query when the dialog opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveTypes(new Set(defaultScope ? [defaultScope] : activeTabToTypes(activeSection)))
    }
  }, [open, activeSection, defaultScope])

  useEffect(() => {
    if (!open) return
    analytics.searchOpened()
    searchInputRef.current?.focus()
  }, [open])

  const toggleType = useCallback((type: SearchType) => {
    setActiveTypes(new Set([type]))
  }, [])

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([])
      return
    }

    let cancelled = false
    setIsSearching(true)

    const types = Array.from(activeTypes) as ('knowledge' | 'chat')[]
    window.ipc.invoke('search:query', { query: debouncedQuery, limit: 20, types })
      .then((res) => {
        if (!cancelled) {
          setResults(res.results)
          analytics.searchExecuted(types)
          posthog.people.set_once({ has_used_search: true })
        }
      })
      .catch((err) => {
        console.error('Search failed:', err)
        if (!cancelled) setResults([])
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false)
      })

    return () => { cancelled = true }
  }, [debouncedQuery, activeTypes])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
    }
  }, [open])

  const handleSelect = useCallback((result: SearchResult) => {
    analytics.searchResultSelected(result.type)
    onOpenChange(false)
    if (result.type === 'knowledge') {
      onSelectFile(result.path)
    } else {
      onSelectRun(result.path)
    }
  }, [onOpenChange, onSelectFile, onSelectRun])

  const knowledgeResults = results.filter(r => r.type === 'knowledge')
  const chatResults = results.filter(r => r.type === 'chat')

  const scope: SearchType = activeTypes.has('knowledge') ? 'knowledge' : 'chat'
  const otherScope: SearchType = scope === 'knowledge' ? 'chat' : 'knowledge'
  const scopeLabel = scope === 'knowledge' ? 'knowledge' : 'chats'

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search across knowledge and chats"
      showCloseButton={false}
      className="top-[20%] translate-y-0"
    >
      <CommandInput
        ref={searchInputRef}
        placeholder={scope === 'knowledge' ? 'Search notes and files…' : 'Search chats…'}
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            toggleType(otherScope)
          }
        }}
      />
      <div className="flex items-center px-3 py-2">
        <div className="inline-flex items-center rounded-lg bg-muted/60 p-0.5">
          <FilterToggle
            active={scope === 'knowledge'}
            onClick={() => toggleType('knowledge')}
            icon={<FileTextIcon className="size-3" />}
            label="Knowledge"
          />
          <FilterToggle
            active={scope === 'chat'}
            onClick={() => toggleType('chat')}
            icon={<MessageSquareIcon className="size-3" />}
            label="Chats"
          />
        </div>
      </div>
      <CommandList>
        {!query.trim() && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {scope === 'knowledge' ? 'Search your notes and files' : 'Search your chat history'}
            </p>
          </div>
        )}
        {query.trim() && isSearching && results.length === 0 && (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">Searching…</div>
        )}
        {query.trim() && !isSearching && results.length === 0 && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">No matches in {scopeLabel}.</p>
            <button
              type="button"
              onClick={() => toggleType(otherScope)}
              className="mt-1.5 text-xs text-primary hover:underline"
            >
              Search {otherScope === 'knowledge' ? 'knowledge' : 'chats'} instead
            </button>
          </div>
        )}
        {knowledgeResults.length > 0 && (
          <CommandGroup heading="Knowledge">
            {knowledgeResults.map((result) => (
              <CommandItem
                key={`knowledge-${result.path}`}
                value={`knowledge-${result.title}-${result.path}`}
                onSelect={() => handleSelect(result)}
              >
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="truncate font-medium">{result.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{result.preview}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {chatResults.length > 0 && (
          <CommandGroup heading="Chats">
            {chatResults.map((result) => (
              <CommandItem
                key={`chat-${result.path}`}
                value={`chat-${result.title}-${result.path}`}
                onSelect={() => handleSelect(result)}
              >
                <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="truncate font-medium">{result.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{result.preview}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Kbd>↑↓</Kbd> Navigate</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> Open</span>
        <span className="flex items-center gap-1"><Kbd>Tab</Kbd> Switch scope</span>
        <span className="ml-auto flex items-center gap-1"><Kbd>esc</Kbd> Close</span>
      </div>
    </CommandDialog>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  )
}

function FilterToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// Back-compat export: thin alias to CommandPalette.
export const SearchDialog = CommandPalette
