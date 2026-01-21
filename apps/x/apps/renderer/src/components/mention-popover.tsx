import { useMemo, useEffect, useState, useCallback } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { wikiLabel, stripKnowledgePrefix } from '@/lib/wiki-links'
import { FileTextIcon } from 'lucide-react'
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

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [orderedAndFilteredFiles.length, query])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => (prev + 1) % orderedAndFilteredFiles.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => (prev - 1 + orderedAndFilteredFiles.length) % orderedAndFilteredFiles.length)
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          if (orderedAndFilteredFiles[selectedIndex]) {
            const path = orderedAndFilteredFiles[selectedIndex]
            onSelect(path, wikiLabel(path))
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
          if (orderedAndFilteredFiles[selectedIndex]) {
            const path = orderedAndFilteredFiles[selectedIndex]
            onSelect(path, wikiLabel(path))
          }
          break
      }
    },
    [open, orderedAndFilteredFiles, selectedIndex, onSelect, onClose]
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

  if (!open || !position || orderedAndFilteredFiles.length === 0) {
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
            {orderedAndFilteredFiles.length === 0 ? (
              <CommandEmpty>No files found</CommandEmpty>
            ) : (
              orderedAndFilteredFiles.map((path, index) => (
                <CommandItem
                  key={path}
                  value={path}
                  onSelect={() => onSelect(path, wikiLabel(path))}
                  className={index === selectedIndex ? 'bg-accent' : ''}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <FileTextIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{wikiLabel(path)}</span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
