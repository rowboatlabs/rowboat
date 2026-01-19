import { useMemo, useEffect, useState, useCallback } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { wikiLabel, stripKnowledgePrefix } from '@/lib/wiki-links'
import { FileTextIcon } from 'lucide-react'
import type { CaretCoordinates } from '@/lib/textarea-caret'

interface MentionPopoverProps {
  files: string[]
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
  query,
  position,
  containerRef,
  onSelect,
  onClose,
  open,
}: MentionPopoverProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Filter files based on query
  const filteredFiles = useMemo(() => {
    if (!query) return files.slice(0, MAX_VISIBLE_FILES)

    const lowerQuery = query.toLowerCase()
    return files
      .filter((path) => {
        const label = wikiLabel(path).toLowerCase()
        const normalized = stripKnowledgePrefix(path).toLowerCase()
        return label.includes(lowerQuery) || normalized.includes(lowerQuery)
      })
      .slice(0, MAX_VISIBLE_FILES)
  }, [files, query])

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredFiles.length, query])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => (prev + 1) % filteredFiles.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => (prev - 1 + filteredFiles.length) % filteredFiles.length)
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          if (filteredFiles[selectedIndex]) {
            const path = filteredFiles[selectedIndex]
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
          if (filteredFiles[selectedIndex]) {
            const path = filteredFiles[selectedIndex]
            onSelect(path, wikiLabel(path))
          }
          break
      }
    },
    [open, filteredFiles, selectedIndex, onSelect, onClose]
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

  if (!open || !position || filteredFiles.length === 0) {
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
            {filteredFiles.length === 0 ? (
              <CommandEmpty>No files found</CommandEmpty>
            ) : (
              filteredFiles.map((path, index) => (
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
