import type { ReactElement } from 'react'
import { MessageSquare, Pencil, Pin, Trash2 } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'

export function SidebarChatContextMenu({ children, pinned, onOpen, onTogglePin, onRename, onRequestDelete }: {
  children: ReactElement
  pinned: boolean
  onOpen?: () => void
  onTogglePin: () => void
  onRename?: () => void
  onRequestDelete?: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onKeyDown={(event) => event.stopPropagation()}>
        {onOpen && <ContextMenuItem onSelect={onOpen}><MessageSquare />Open chat</ContextMenuItem>}
        <ContextMenuItem onSelect={onTogglePin}><Pin />{pinned ? 'Unpin' : 'Pin'}</ContextMenuItem>
        {onRename && <ContextMenuItem onSelect={onRename}><Pencil />Rename</ContextMenuItem>}
        {onRequestDelete && <>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onRequestDelete}><Trash2 />Delete</ContextMenuItem>
        </>}
      </ContextMenuContent>
    </ContextMenu>
  )
}
