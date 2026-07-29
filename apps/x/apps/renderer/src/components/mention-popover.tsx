import { useMemo, useEffect, useState, useCallback } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { wikiLabel, stripKnowledgePrefix } from '@/lib/wiki-links'
import { Bot, FileTextIcon } from 'lucide-react'
import type { CaretCoordinates } from '@/lib/textarea-caret'

interface MentionPopoverProps {
  files: string[]
  recentFiles?: string[]
  visibleFiles?: string[]
  query: string
  position: CaretCoordinates | null
  containerRef: React.RefObject<HTMLElement | null>
  onSelect: (path: string, displayName: string) => void
  onClose: () => void
  open: boolean
}

const MAX_VISIBLE_FILES = 8

/** Sentinel entry for mentioning the agent itself — always offered first
 * while the query is a prefix of "rowboat". Selecting it inserts the
 * literal @rowboat mention, never a file mention. */
export const ROWBOAT_MENTION_SENTINEL = '::rowboat::'

export function MentionPopover({
  files,
  recentFiles = [],
  visibleFiles = [],
  query,
  position,
  containerRef: _containerRef,
  onSelect,
  onClose,
  open,
}: MentionPopoverProps) {
  void _containerRef // Reserved for future positioning logic
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Order files: visible > recent > rest, then filter by query
  const orderedAndFilteredFiles = useMemo(() => {
    const lowerQuery = query.toLowerCase()

    // Create sets for quick lookup
    const visibleSet = new Set(visibleFiles)
    const recentSet = new Set(recentFiles)
    const allFiles = new Set(files)

    // Categorize files
    const visible: string[] = []
    const recent: string[] = []
    const rest: string[] = []

    for (const file of files) {
      if (visibleSet.has(file)) {
        visible.push(file)
      } else if (recentSet.has(file)) {
        recent.push(file)
      } else {
        rest.push(file)
      }
    }

    // Maintain recent order for recent files
    const orderedRecent = recentFiles.filter(f => allFiles.has(f) && !visibleSet.has(f))

    // Combine in order: visible > recent > rest
    const ordered = [...visible, ...orderedRecent, ...rest]

    // Filter by query if present
    if (!query) return ordered.slice(0, MAX_VISIBLE_FILES)

    return ordered
      .filter((path) => {
        const label = wikiLabel(path).toLowerCase()
        const normalized = stripKnowledgePrefix(path).toLowerCase()
        return label.includes(lowerQuery) || normalized.includes(lowerQuery)
      })
      .slice(0, MAX_VISIBLE_FILES)
  }, [files, recentFiles, visibleFiles, query])

  // @rowboat leads the list whenever it still matches what's typed.
  const entries = useMemo(() => {
    const showRowboat = 'rowboat'.startsWith(query.toLowerCase())
    return showRowboat
      ? [ROWBOAT_MENTION_SENTINEL, ...orderedAndFilteredFiles].slice(0, MAX_VISIBLE_FILES)
      : orderedAndFilteredFiles
  }, [orderedAndFilteredFiles, query])

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [entries.length, query])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => (prev + 1) % entries.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => (prev - 1 + entries.length) % entries.length)
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          if (entries[selectedIndex]) {
            const path = entries[selectedIndex]
            onSelect(path, path === ROWBOAT_MENTION_SENTINEL ? 'rowboat' : wikiLabel(path))
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onClose()
          break
        case 'Tab':
          e.preventDefault()
          e.stopPropagation()
          if (entries[selectedIndex]) {
            const path = entries[selectedIndex]
            onSelect(path, path === ROWBOAT_MENTION_SENTINEL ? 'rowboat' : wikiLabel(path))
          }
          break
      }
    },
    [open, entries, selectedIndex, onSelect, onClose]
  )

  // Attach keyboard listener
  useEffect(() => {
    if (!open) return

    // Use capture phase to intercept before textarea handles it
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, handleKeyDown])

  if (!open || !position || entries.length === 0) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <PopoverAnchor asChild>
        <span
          className="mention-popover-anchor"
          style={{
            position: 'absolute',
            left: position.left,
            top: position.top + position.height + 4,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-64 p-1"
        align="start"
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            {entries.length === 0 ? (
              <CommandEmpty>No files found</CommandEmpty>
            ) : (
              entries.map((path, index) => (
                <CommandItem
                  key={path}
                  value={path}
                  onSelect={() => onSelect(path, path === ROWBOAT_MENTION_SENTINEL ? 'rowboat' : wikiLabel(path))}
                  className={index === selectedIndex ? 'bg-accent' : ''}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {path === ROWBOAT_MENTION_SENTINEL ? (
                    <>
                      <Bot className="mr-2 h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate font-medium">rowboat</span>
                      <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">hand off a task</span>
                    </>
                  ) : (
                    <>
                      <FileTextIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{wikiLabel(path)}</span>
                    </>
                  )}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
