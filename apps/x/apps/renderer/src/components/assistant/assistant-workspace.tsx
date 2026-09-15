import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircle, X } from 'lucide-react'
import { WorkspaceChatAdapter } from './workspace-chat-adapter'
import type { ChatTab } from '@/components/tab-bar'
import { Chat, type ChatServices } from './chat'
import { FloatingChatWindow, RowGrip } from './floating-chat-window'
import { chatLocation, fitWindow, type AssistantLayout, type ChatLocation, type LayoutAction, type WindowSize } from '@/lib/assistant-layout'
import { useSessionChat } from '@/hooks/useSessionChat'
import { useSessionTitle } from '@/lib/session-title'
import { cn } from '@/lib/utils'

interface AssistantWorkspaceProps extends ChatServices {
  layout: AssistantLayout
  dispatch: Dispatch<LayoutAction>
  pageHost: HTMLElement | null
  pageVisible: boolean
  legacyPane: boolean
  workspaceSessionId?: string | null
  onMoveChat: (id: string, location: ChatLocation) => void
  onNewChatAt: (location: ChatLocation, replacing?: string) => void
  onSelectChatAt: (id: string, location: ChatLocation, replacing?: string) => void
  onFocusChat: (id: string) => void
  onHideSidebar: () => void
  onCloseChat: (id: string) => void
}

/** A minimized floating chat: it sits in the bottom row where its window would. */
function FloatingTab({ tab, title, grip, onSelect, onClose }: {
  tab: ChatTab; title: string; grip: React.ReactNode; onSelect: () => void; onClose: () => void
}) {
  const session = useSessionChat(tab.runId)
  const label = useSessionTitle(tab.runId) ?? title
  const status = session.chatState?.isWaitingOnHuman ? 'Needs your input' : session.chatState?.isProcessing ? 'Working' : ''
  return <div data-floating-tab={tab.id} data-row-item={tab.id} className="pointer-events-auto flex shrink-0 items-center rounded-t-lg border-b-0 bg-background border border-black/10 shadow-[0_-6px_28px_-6px_rgba(0,0,0,0.28),0_0_0_1px_rgba(255,255,255,0.6)_inset] dark:border-white/15 dark:shadow-[0_-8px_32px_-6px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.04)_inset]" style={{ width: TAB_WIDTH, height: TAB_HEIGHT }}>
    {grip}
    <button type="button" data-assistant-tab={tab.id} aria-label={`${label}${status ? ` — ${status}` : ''}`} title={`${label} — click to open`}
      onClick={onSelect} className="flex h-10 min-w-0 flex-1 items-center gap-2 pr-3 text-xs hover:bg-accent">
      <MessageCircle className="size-3.5 shrink-0" /><span className="truncate">{label}</span>
      {status && <span className="ml-auto shrink-0" role="status" aria-label={status}>{status === 'Working' ? '…' : '!'}</span>}
    </button>
    <button type="button" aria-label={`Close tab: ${label}`} title="Close chat — conversation stays in history" onClick={onClose} className="mr-1 rounded p-1 hover:bg-accent"><X className="size-3.5" /></button>
  </div>
}

const WINDOW_GAP = 12
const TAB_WIDTH = 192
const TAB_HEIGHT = 40
/** Room above the tallest window for its shadow inside the clipped row. */
const ROW_HEADROOM = 24

/** A stable portal target preserves the React subtree when its DOM host changes. */
function MountedChat({ host, children }: { host: HTMLElement | null; children: React.ReactNode }) {
  const [element] = useState(() => {
    const node = document.createElement('div')
    node.className = 'h-full min-h-0 rounded-[inherit]'
    return node
  })
  useLayoutEffect(() => {
    host?.appendChild(element)
    return () => { element.remove() }
  }, [element, host])
  return createPortal(children, element)
}

function ChatHost({ id, register }: { id: string; register: (id: string, element: HTMLDivElement | null) => void }) {
  const ref = useCallback((element: HTMLDivElement | null) => register(id, element), [id, register])
  return <div ref={ref} className="h-full min-h-0 flex-1 overflow-hidden rounded-[inherit]" />
}

export function AssistantWorkspace(p: AssistantWorkspaceProps) {
  const { layout, dispatch } = p
  const [hosts, setHosts] = useState<Record<string, HTMLElement | null>>({})
  const [sidebarWidth, setSidebarWidth] = useState(460)
  const [resizePreviews, setResizePreviews] = useState<Record<string, WindowSize>>({})
  const previewResize = useCallback((id: string, size: WindowSize | null) => {
    setResizePreviews((previous) => {
      if (size) return { ...previous, [id]: size }
      if (!(id in previous)) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
  }, [])
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  // One bottom row, newest at the right, like mail compose windows: each
  // floating chat is either an open window pegged to the bottom edge or a
  // minimized tab in the same row. The row hugs the right edge while it fits
  // and scrolls sideways once it doesn't.
  // Include live sizes so the scroll row never clips a growing window while
  // its persisted layout size is still waiting for pointer release.
  const fitted = layout.floating.map((entry) => entry.minimized ? { width: TAB_WIDTH, height: TAB_HEIGHT } : fitWindow(resizePreviews[entry.id] ?? entry, viewport.width, viewport.height))
  const rowWidth = fitted.reduce((total, size) => total + size.width + WINDOW_GAP, WINDOW_GAP)
  const rowHeight = Math.max(TAB_HEIGHT, ...fitted.map((size) => size.height)) + ROW_HEADROOM
  const overflowing = rowWidth > viewport.width
  const rowRef = useRef<HTMLDivElement>(null)
  // Reordering: the grip in a window's hover bar or on a tab moves that chat
  // along the row. The slot follows the pointer past its neighbours' midpoints
  // (the row reflows as it goes); arrow keys step one slot at a time.
  const dragging = useRef<string | null>(null)
  const moveTo = (id: string, index: number) => {
    if (index !== layout.floating.findIndex((entry) => entry.id === id)) dispatch({ type: 'reorder', id, index })
  }
  const gripFor = (id: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragging.current = id
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current !== id) return
      const others = Array.from(rowRef.current?.querySelectorAll<HTMLElement>('[data-row-item]') ?? []).filter((element) => !element.hidden && element.dataset.rowItem !== id)
      moveTo(id, others.filter((element) => { const rect = element.getBoundingClientRect(); return rect.left + rect.width / 2 < event.clientX }).length)
    },
    onPointerUp: () => { dragging.current = null },
    onPointerCancel: () => { dragging.current = null },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      if (!delta) return
      event.preventDefault()
      event.stopPropagation()
      moveTo(id, layout.floating.findIndex((entry) => entry.id === id) + delta)
    },
  })
  useEffect(() => {
    if (!layout.focused) return
    const target = Array.from(rowRef.current?.querySelectorAll<HTMLElement>('[data-floating-chat]') ?? []).find((element) => element.dataset.floatingChat === layout.focused)
    target?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [layout.focused, layout.floating])
  const register = useCallback((id: string, element: HTMLDivElement | null) => {
    setHosts((previous) => previous[id] === element ? previous : { ...previous, [id]: element })
  }, [])
  const sidebarRef = useCallback((element: HTMLDivElement | null) => register('sidebar', element), [register])
  const focus = (id: string) => { if (layout.focused !== id) dispatch({ type: 'focus', id }); p.onFocusChat(id) }
  const close = p.onCloseChat
  return <>
    {p.legacyPane && <WorkspaceChatAdapter services={p} sessionId={p.workspaceSessionId ?? null} onFocus={p.onFocusChat} />}
    {layout.sidebar && layout.sidebarVisible && <aside aria-label="Chat sidebar" className="order-4 flex min-h-0 shrink-0 flex-col border-l border-border bg-background" style={{ width: sidebarWidth, maxWidth: '65vw' }}>
      {/* The pane is its own container, so its divider runs the full height,
          title bar included. Its top row is the title bar's continuation: the
          same 40px and bottom rule as the main content header, titled like the
          Assistant page, so the chat's header below lines up with the Assistant
          page's own chat row. */}
      <div className="rowboat-titlebar titlebar-drag-region flex h-10 shrink-0 items-center border-b border-border px-4">
        <span className="truncate text-sm font-medium">Assistant</span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div role="separator" aria-label="Resize chat sidebar" aria-orientation="vertical" tabIndex={0}
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20"
          onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(Math.max(320, Math.min(window.innerWidth * .65, window.innerWidth - event.clientX))) }}
          onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSidebarWidth((width) => Math.max(320, Math.min(window.innerWidth * .65, width + (event.key === 'ArrowLeft' ? 20 : -20)))) } }} />
        <div ref={sidebarRef} className="min-h-0 flex-1" onFocusCapture={() => focus(layout.sidebar!)} onPointerDownCapture={() => focus(layout.sidebar!)} />
      </div>
    </aside>}
    {layout.floating.length > 0 && <div ref={rowRef} role="region" aria-label="Floating chats" data-assistant-dock
      className={cn('fixed inset-x-0 bottom-0 z-30 flex', overflowing ? 'pointer-events-auto overflow-x-auto overflow-y-hidden' : 'pointer-events-none overflow-visible')}
      style={{ height: rowHeight }}>
      <div className="ml-auto flex shrink-0 items-end gap-3 px-3" style={{ paddingTop: ROW_HEADROOM }}>
        {layout.floating.map((entry) => {
          const tab = p.chatTabs.find((tab) => tab.id === entry.id)
          return <Fragment key={entry.id}>
            <FloatingChatWindow entry={entry} viewport={viewport} grip={<RowGrip {...gripFor(entry.id)} />}
              onFocus={() => focus(entry.id)} onSize={(size) => dispatch({ type: 'resize', id: entry.id, size })}
              onResizePreview={previewResize}
              onMinimize={() => dispatch({ type: 'minimize', id: entry.id })} onClose={() => close(entry.id)}>
              <div className="flex h-full min-h-0 flex-col rounded-[inherit]" onFocusCapture={() => focus(entry.id)}>
                <ChatHost id={entry.id} register={register} />
              </div>
            </FloatingChatWindow>
            {entry.minimized && tab && <FloatingTab tab={tab} title={p.getChatTabTitle(tab)} grip={<RowGrip className="h-full opacity-60 hover:opacity-100" {...gripFor(entry.id)} />}
              onSelect={() => { dispatch({ type: 'focus', id: entry.id }); p.onFocusChat(entry.id) }} onClose={() => close(entry.id)} />}
          </Fragment>
        })}
      </div>
    </div>}
    {/* Only chats that live in a container render; a hidden draft tab mounts
        fresh (draft and selection restored from storage) when placed. */}
    {p.chatTabs.flatMap((tab) => {
      const location = chatLocation(layout, tab.id)
      if (!location) return []
      const floating = layout.floating.find((entry) => entry.id === tab.id)
      const visible = location === 'assistant' ? p.pageVisible : location === 'sidebar' ? layout.sidebarVisible : !floating?.minimized
      const host = location === 'assistant' ? p.pageHost : location === 'sidebar' ? hosts.sidebar : hosts[tab.id]
      // Closing is the sidebar's job, not the chat's: the container hands its
      // button into the chat's header row rather than stacking a strip above it.
      const controls = location === 'sidebar'
        ? <button type="button" aria-label="Close sidebar" title="Close" onClick={p.onHideSidebar}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-4" /></button>
        : undefined
      return [<MountedChat key={tab.chatId} host={host ?? null}>
        <Chat tab={tab} location={location} visible={visible} focused={layout.focused === tab.id} services={p} controls={controls}
          onMove={(destination) => p.onMoveChat(tab.id, destination)} onNew={() => p.onNewChatAt(location, tab.id)}
          onSelect={(id) => p.onSelectChatAt(id, location, tab.id)} />
      </MountedChat>]
    })}
  </>
}
