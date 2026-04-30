import { useState, useEffect, useCallback, useRef } from 'react'
import posthog from 'posthog-js'
import * as analytics from '@/lib/analytics'
import { FileTextIcon, MessageSquareIcon, XIcon } from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
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

type SearchType = 'knowledge' | 'chat'
type Mode = 'chat' | 'search'

function activeTabToTypes(section: ActiveSection): SearchType[] {
  if (section === 'knowledge') return ['knowledge']
  return ['chat'] // "tasks" tab maps to chat
}

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
  // Search mode
  onSelectFile: (path: string) => void
  onSelectRun: (runId: string) => void
  // Chat mode
  initialContext?: CommandPaletteContext | null
  onChatSubmit: (text: string, mention: CommandPaletteMention | null) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  onSelectFile,
  onSelectRun,
  initialContext,
  onChatSubmit,
}: CommandPaletteProps) {
  const { activeSection } = useSidebarSection()
  const [mode, setMode] = useState<Mode>('chat')
  const [chatInput, setChatInput] = useState('')
  const [contextChip, setContextChip] = useState<CommandPaletteContext | null>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeTypes, setActiveTypes] = useState<Set<SearchType>>(
    () => new Set(activeTabToTypes(activeSection))
  )
  const debouncedQuery = useDebounce(query, 250)

  // On open: always reset to Chat mode (per spec — no mode persistence), sync context chip
  // and reset search filters.
  useEffect(() => {
    if (open) {
      setMode('chat')
      setChatInput('')
      setContextChip(initialContext ?? null)
      setActiveTypes(new Set(activeTabToTypes(activeSection)))
    }
  }, [open, activeSection, initialContext])

  // Tab cycles modes. Captured at document level so cmdk's internal Tab handling doesn't
  // swallow it. Only fires while the dialog is open.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      setMode(prev => (prev === 'chat' ? 'search' : 'chat'))
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open])

  // Refocus the appropriate input on mode change so the user can start typing immediately.
  useEffect(() => {
    if (!open) return
    const target = mode === 'chat' ? chatInputRef : searchInputRef
    target.current?.focus()
  }, [open, mode])

  const toggleType = useCallback((type: SearchType) => {
    setActiveTypes(new Set([type]))
  }, [])

  // Search query effect (only meaningful while in search mode, but the debounce keeps running
  // harmlessly otherwise — empty query skips the IPC call below).
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
        if (!cancelled) {
          setResults([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSearching(false)
        }
      })

    return () => { cancelled = true }
  }, [debouncedQuery, activeTypes])

  // Reset transient state on close.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setChatInput('')
    }
  }, [open])

  const handleSelect = useCallback((result: SearchResult) => {
    onOpenChange(false)
    if (result.type === 'knowledge') {
      onSelectFile(result.path)
    } else {
      onSelectRun(result.path)
    }
  }, [onOpenChange, onSelectFile, onSelectRun])

  const submitChat = useCallback(() => {
    const text = chatInput.trim()
    if (!text && !contextChip) return
    const mention: CommandPaletteMention | null = contextChip
      ? {
          path: contextChip.path,
          displayName: deriveDisplayName(contextChip.path),
          lineNumber: contextChip.lineNumber,
        }
      : null
    onChatSubmit(text, mention)
    onOpenChange(false)
  }, [chatInput, contextChip, onChatSubmit, onOpenChange])

  const knowledgeResults = results.filter(r => r.type === 'knowledge')
  const chatResults = results.filter(r => r.type === 'chat')

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'chat' ? 'Chat with copilot' : 'Search'}
      description={mode === 'chat' ? 'Start a chat — Tab to switch to search' : 'Search across knowledge and chats — Tab to switch to chat'}
      showCloseButton={false}
      className="top-[20%] translate-y-0"
    >
      {/* Mode strip */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b">
        <ModeButton
          active={mode === 'chat'}
          onClick={() => setMode('chat')}
          icon={<MessageSquareIcon className="size-3" />}
          label="Chat"
        />
        <ModeButton
          active={mode === 'search'}
          onClick={() => setMode('search')}
          icon={<FileTextIcon className="size-3" />}
          label="Search"
        />
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">Tab to switch</span>
      </div>

      {mode === 'chat' ? (
        <div className="flex flex-col">
          <input
            ref={chatInputRef}
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              // cmdk's Command component intercepts Enter for item selection — stop it
              // before bubbling so we control the chat submit ourselves.
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault()
                e.stopPropagation()
                submitChat()
              }
            }}
            placeholder="Ask copilot anything…"
            autoFocus
            className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          {contextChip && (
            <div className="flex items-center gap-2 px-3 pb-3">
              <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
                <FileTextIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-medium">{deriveDisplayName(contextChip.path)}</span>
                <span className="text-muted-foreground">· Line {contextChip.lineNumber}</span>
                <button
                  type="button"
                  onClick={() => setContextChip(null)}
                  aria-label="Remove context"
                  className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">Enter to send</span>
            </div>
          )}
          {!contextChip && (
            <div className="flex items-center px-3 pb-3">
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">Enter to send</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <CommandInput
            ref={searchInputRef}
            placeholder="Search..."
            value={query}
            onValueChange={setQuery}
          />
          <div className="flex items-center gap-1.5 px-3 py-2 border-b">
            <FilterToggle
              active={activeTypes.has('knowledge')}
              onClick={() => toggleType('knowledge')}
              icon={<FileTextIcon className="size-3" />}
              label="Knowledge"
            />
            <FilterToggle
              active={activeTypes.has('chat')}
              onClick={() => toggleType('chat')}
              icon={<MessageSquareIcon className="size-3" />}
              label="Chats"
            />
          </div>
          <CommandList>
            {!query.trim() && (
              <CommandEmpty>Type to search...</CommandEmpty>
            )}
            {query.trim() && !isSearching && results.length === 0 && (
              <CommandEmpty>No results found.</CommandEmpty>
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
        </>
      )}
    </CommandDialog>
  )
}

// Back-compat export so existing import sites don't break in one go; thin alias to CommandPalette.
export const SearchDialog = CommandPalette

function deriveDisplayName(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/, '')
}

function ModeButton({
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
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
      )}
    >
      {icon}
      {label}
    </button>
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
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}
