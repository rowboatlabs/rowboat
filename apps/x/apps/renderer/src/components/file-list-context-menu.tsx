import type { ReactNode } from 'react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'

export function FileListContextMenu({ children, actions, onOpenChange }: {
  children: ReactNode
  actions: { label: string; onSelect: () => void; disabled?: boolean }[]
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild onContextMenuCapture={(event) => {
        // Leave editor and input menus to their own controls.
        if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) event.stopPropagation()
      }} onContextMenu={(event) => {
        if (event.defaultPrevented) return // An item's own menu takes priority.
        if (event.target instanceof Element && event.target.closest('button, a')) event.preventDefault()
      }}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((action) => <ContextMenuItem key={action.label} disabled={action.disabled} onSelect={action.onSelect}>{action.label}</ContextMenuItem>)}
      </ContextMenuContent>
    </ContextMenu>
  )
}
