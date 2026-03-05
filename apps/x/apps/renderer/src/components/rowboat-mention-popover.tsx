import { useState, useRef, useEffect } from 'react'

interface RowboatMentionPopoverProps {
  open: boolean
  anchor: { top: number; left: number; width: number } | null
  initialText?: string
  onAdd: (instruction: string) => void
  onRemove?: () => void
  onClose: () => void
}

export function RowboatMentionPopover({ open, anchor, initialText = '', onAdd, onRemove, onClose }: RowboatMentionPopoverProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setText(initialText)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    }
  }, [open, initialText])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open, onClose])

  if (!open || !anchor) return null

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setText('')
  }

  return (
    <div
      ref={containerRef}
      className="absolute z-50"
      style={{
        top: anchor.top,
        left: anchor.left,
        width: anchor.width,
      }}
    >
      <div className="relative border border-input rounded-md bg-popover shadow-sm">
        <div className="flex items-start gap-1.5 px-3 pt-2 pb-8">
          <span className="text-sm text-muted-foreground select-none shrink-0 leading-[1.5]">@rowboat</span>
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none resize-none leading-[1.5]"
            placeholder="Tell rowboat what to do..."
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
          />
        </div>
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5">
          {onRemove && (
            <button
              className="inline-flex items-center justify-center rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={onRemove}
            >
              Remove
            </button>
          )}
          <button
            className="inline-flex items-center justify-center rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={!text.trim()}
            onClick={handleSubmit}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
