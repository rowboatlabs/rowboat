import type { ReactNode } from 'react'
import { Archive, CheckCheck, Mail, Star, StarOff, Trash2 } from 'lucide-react'
import type { EmailLabelInfo } from '@/lib/email-labels'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuRadioGroup,
  ContextMenuRadioItem, ContextMenuSeparator, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu'

export function EmailThreadContextMenu({
  children, threadId, unread, category, section, labels,
  onMarkRead, onSetImportance, onSetCategory, onArchive, onTrash,
}: {
  children: ReactNode
  threadId: string
  unread: boolean
  category?: string | null
  section: 'important' | 'other' | null
  labels: EmailLabelInfo[]
  onMarkRead: (threadId: string, read?: boolean) => Promise<void>
  onSetImportance: (threadId: string, importance: 'important' | 'other') => Promise<void>
  onSetCategory?: (threadId: string, category: string) => Promise<void>
  onArchive: (threadId: string) => Promise<void>
  onTrash: (threadId: string) => Promise<void>
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/* Menu typeahead must not trigger the inbox's document-level shortcuts. */}
      <ContextMenuContent className="font-sans" onKeyDown={(event) => event.stopPropagation()}>
        <ContextMenuItem onSelect={() => { void onMarkRead(threadId, unread) }}>
          {unread ? <CheckCheck /> : <Mail />}
          {unread ? 'Mark as read' : 'Mark as unread'}
        </ContextMenuItem>
        {section && (
          <ContextMenuItem onSelect={() => { void onSetImportance(threadId, section === 'important' ? 'other' : 'important') }}>
            {section === 'important' ? <StarOff /> : <Star />}
            {section === 'important' ? 'Mark as not important' : 'Mark as important'}
          </ContextMenuItem>
        )}
        {onSetCategory && labels.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Category</ContextMenuSubTrigger>
            <ContextMenuSubContent className="font-sans" onKeyDown={(event) => event.stopPropagation()}>
              <ContextMenuRadioGroup value={category ?? ''} onValueChange={(value) => { void onSetCategory(threadId, value) }}>
                {labels.map((label) => (
                  <ContextMenuRadioItem key={label.id} value={label.id}>{label.name}</ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => { void onArchive(threadId) }}>
          <Archive /> Archive
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => { void onTrash(threadId) }}>
          <Trash2 /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
