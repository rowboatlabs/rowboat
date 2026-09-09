import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronUp, Loader2, MessageCircle, Plus, X } from 'lucide-react'
import { useSessionChat } from '@/hooks/useSessionChat'
import { useSessionTitle } from '@/lib/session-title'
import { cn } from '@/lib/utils'
import type { ChatTab } from './tab-bar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

interface AssistantChatDockProps {
  hidden?: boolean
  tabs: ChatTab[]
  activeId: string
  expanded: boolean
  getTitle: (tab: ChatTab) => string
  onSelect: (tab: ChatTab) => void
  onClose: (tabId: string) => void
  onNew: () => void
}

function DockTab({ tab, active, expanded, title, onSelect, onClose, onStatus }: {
  tab: ChatTab
  active: boolean
  expanded: boolean
  title: string
  onSelect: () => void
  onClose: () => void
  onStatus: (tabId: string, status: string) => void
}) {
  const session = useSessionChat(tab.runId)
  const sessionTitle = useSessionTitle(tab.runId)
  const working = session.chatState?.isProcessing ?? false
  const waiting = session.chatState?.isWaitingOnHuman ?? false
  const reading = active && expanded
  const [activity, setActivity] = useState({ working, reading, unread: false })
  if (activity.working !== working || activity.reading !== reading) {
    setActivity({ working, reading, unread: reading ? false : activity.unread || (activity.working && !working) })
  }
  const unread = activity.unread && !reading
  const status = waiting ? 'Needs your input' : working ? 'Working' : unread ? 'Unread response' : ''
  useEffect(() => onStatus(tab.id, status), [onStatus, tab.id, status])
  const label = sessionTitle ?? title
  return (
    <div className={cn('flex min-w-0 items-center rounded-t-lg border border-border bg-background shadow-sm', active && expanded && 'bg-accent')}>
      <button
        type="button"
        data-assistant-tab={tab.id}
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-tl-lg px-3 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
        aria-expanded={active && expanded}
        aria-label={`${label}${status ? ` — ${status}` : ''}`}
        title={`${label}${status ? ` — ${status}` : ''}`}
      >
        {working && !waiting ? <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /> : <MessageCircle className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {(waiting || unread) && <span className="shrink-0 text-xs font-medium">{waiting ? '!' : '●'}</span>}
        <span className="sr-only" role="status">{status}</span>
      </button>
      <button type="button" onClick={onClose} aria-label={`Close tab: ${label}`} title="Close tab — conversation stays in history" className="mr-1 flex size-7 shrink-0 items-center justify-center rounded hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function AssistantChatDock({ tabs, activeId, expanded, getTitle, onSelect, onClose, onNew, hidden = false }: AssistantChatDockProps) {
  const dockRef = useRef<HTMLDivElement>(null)
  const [capacity, setCapacity] = useState(3)
  const [menuOpen, setMenuOpen] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const onStatus = useCallback((tabId: string, status: string) => {
    setStatuses((previous) => previous[tabId] === status ? previous : { ...previous, [tabId]: status })
  }, [])
  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return
    const observer = new ResizeObserver(() => setCapacity(Math.max(1, Math.floor((dock.clientWidth - 140) / 190))))
    observer.observe(dock)
    return () => observer.disconnect()
  }, [])
  const activeIndex = tabs.findIndex((tab) => tab.id === activeId)
  const visibleIds = new Set(tabs.slice(0, capacity).map((tab) => tab.id))
  if (activeIndex >= capacity) {
    visibleIds.delete(tabs[capacity - 1]?.id)
    visibleIds.add(activeId)
  }
  const overflow = tabs.filter((tab) => !visibleIds.has(tab.id))
  return (
    <div ref={dockRef} data-assistant-dock={hidden ? undefined : ''} role="region" aria-label="Assistant chats" hidden={hidden} className={cn('titlebar-no-drag pointer-events-none fixed bottom-0 right-3 z-30 h-11 w-[min(760px,calc(100vw-88px))] items-end justify-end gap-1.5', hidden ? 'hidden' : 'flex')}>
      {tabs.map((tab) => (
        <div key={tab.id} className={visibleIds.has(tab.id) ? 'pointer-events-auto min-w-0 flex-[0_1_240px]' : 'hidden'}>
          <DockTab tab={tab} active={tab.id === activeId} expanded={expanded} title={getTitle(tab)} onSelect={() => onSelect(tab)} onClose={() => onClose(tab.id)} onStatus={onStatus} />
        </div>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="pointer-events-auto flex h-10 shrink-0 items-center gap-1 rounded-t-lg border border-border bg-background px-3 text-xs hover:bg-accent" aria-label={`More chats (${overflow.length})`}>
              <ChevronUp className="size-3.5" /> {overflow.length} more{overflow.some((tab) => statuses[tab.id] === 'Needs your input' || statuses[tab.id] === 'Unread response') ? ' ●' : ''}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="max-h-80 w-72 overflow-y-auto">
            {overflow.map((tab) => (
              <div key={tab.id} className="flex items-center">
                <DropdownMenuItem className="min-w-0 flex-1" onSelect={() => { onSelect(tab); setMenuOpen(false) }}>
                  <span className="min-w-0 truncate">{getTitle(tab)}{statuses[tab.id] ? ` — ${statuses[tab.id]}` : ''}</span>
                </DropdownMenuItem>
                <DropdownMenuItem aria-label={`Close tab: ${getTitle(tab)}`} onSelect={(event) => { event.preventDefault(); onClose(tab.id) }}><X className="size-3.5" /></DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button type="button" onClick={() => onNew()} aria-label="New assistant chat" title="New assistant chat" className="pointer-events-auto flex size-10 shrink-0 items-center justify-center rounded-t-lg border border-border bg-background hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><Plus className="size-4" /></button>
    </div>
  )
}
