import { useState, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { toast } from '@/lib/toast'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu'

export function MessageContextMenu({ text, children }: { text: string; children: ReactNode }) {
  const [selectionText, setSelectionText] = useState('')
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast('Copied to clipboard', 'success')
    } catch {
      toast('Could not copy to clipboard', 'error')
    }
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenuCapture={(event) => {
          // Embedded editors retain their own editing menus.
          if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) {
            event.stopPropagation()
          }
        }}
        onContextMenu={(event) => {
          // Snapshot before the menu takes focus, and ignore selections in other messages.
          const selection = window.getSelection()
          setSelectionText(selection && !selection.isCollapsed
            && event.currentTarget.contains(selection.anchorNode)
            && event.currentTarget.contains(selection.focusNode)
            ? selection.toString() : '')
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {selectionText && (
          <>
            <ContextMenuItem onSelect={() => { void copy(selectionText) }}>
              <Copy /> Copy selected text
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem disabled={!text} onSelect={() => { void copy(text) }}>
          <Copy /> Copy message
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
