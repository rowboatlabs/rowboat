import type { ReactNode } from 'react'
import { Calendar, Copy, FileText, Mic, Video } from 'lucide-react'
import { toast } from '@/lib/toast'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu'

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast('Copied to clipboard', 'success')
  } catch {
    toast('Could not copy to clipboard', 'error')
  }
}

export function MeetingEventContextMenu({ children, conferenceLink, calendarLink, captureDisabled, onCapture }: {
  children: ReactNode
  conferenceLink: string | null
  calendarLink?: string | null
  captureDisabled: boolean
  onCapture: (openConference: boolean) => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {conferenceLink && (
          <ContextMenuItem disabled={captureDisabled} onSelect={() => onCapture(true)}>
            <Video /> Join & take notes
          </ContextMenuItem>
        )}
        <ContextMenuItem disabled={captureDisabled} onSelect={() => onCapture(false)}>
          <Mic /> Take notes
        </ContextMenuItem>
        {(calendarLink || conferenceLink) && <ContextMenuSeparator />}
        {calendarLink && (
          <ContextMenuItem onSelect={() => { window.open(calendarLink, '_blank') }}>
            <Calendar /> Open in Google Calendar
          </ContextMenuItem>
        )}
        {conferenceLink && (
          <ContextMenuItem onSelect={() => { void copy(conferenceLink) }}>
            <Copy /> Copy meeting link
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function MeetingNoteContextMenu({ children, path, onOpen }: {
  children: ReactNode
  path: string
  onOpen: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}><FileText /> Open note</ContextMenuItem>
        <ContextMenuItem onSelect={() => { void copy(path) }}><Copy /> Copy path</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
