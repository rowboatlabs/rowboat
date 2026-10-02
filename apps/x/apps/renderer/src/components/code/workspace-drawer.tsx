import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TerminalPane } from './terminal-pane'
import type { CodePanel } from './code-panels'

const WIDTH_STORAGE_KEY = 'x:code-drawer-width'
const DEFAULT_WIDTH = 560
const MIN_WIDTH = 380
const MAX_WIDTH = 1200
// The chat is the main surface — the drawer never squeezes it below this.
const MIN_CHAT_WIDTH = 440

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const raw = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw))
}

export function CodeWorkspaceDrawer({ session, onClose, placement = 'right', className }: {
  session: CodeSession
  panel: CodePanel
  onClose: () => void
  placement?: 'middle' | 'right'
  className?: string
}) {
  const [width, setWidth] = useState(readStoredWidth)
  const [isResizing, setIsResizing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width)) }, [width])
  const maxAllowedWidth = useCallback(() => {
    const root = rootRef.current
    const chat = root?.parentElement?.querySelector<HTMLElement>('[data-chat-sidebar-root]')
    const chatWidth = chat?.getBoundingClientRect().width ?? 0
    const split = chatWidth + (root?.getBoundingClientRect().width ?? 0)
    if (split <= 0) return MAX_WIDTH
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, split - MIN_CHAT_WIDTH))
  }, [])

  // The chat is the main surface: whenever it gets squeezed (window resized,
  // app sidebar expanded) give width back from the drawer, never from the
  // chat. Shrink-only, so it can't fight the user's own resize.
  useEffect(() => {
    const root = rootRef.current
    const chat = root?.parentElement?.querySelector<HTMLElement>('[data-chat-sidebar-root]')
    if (!chat) return
    const clamp = () => setWidth((w) => Math.min(w, maxAllowedWidth()))
    clamp()
    const observer = new ResizeObserver(clamp)
    observer.observe(chat)
    return () => observer.disconnect()
  }, [maxAllowedWidth])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    setIsResizing(true)
    const onMove = (event: MouseEvent) => {
      // The handle is on the left edge: dragging left grows the drawer.
      const next = startWidth + (startX - event.clientX)
      setWidth(Math.min(maxAllowedWidth(), Math.max(MIN_WIDTH, next)))
    }
    const onUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, maxAllowedWidth])

  return <div ref={rootRef} data-code-drawer className={cn('relative flex shrink-0 flex-col overflow-hidden bg-background', placement === 'middle' ? 'border-r border-border' : 'border-l border-border', className)} style={{ width, flex: '0 0 auto' }}>
    <div onMouseDown={handleResizeStart} className={cn('absolute inset-y-0 left-0 z-20 w-4 -translate-x-1/2 cursor-col-resize', isResizing && 'bg-primary/10')} />
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <span className="text-xs font-medium">Terminal</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={session.cwd}>{session.cwd}</span>
      <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close terminal"><X className="size-4" /></Button>
    </div>
    <div className="min-h-0 flex-1 pb-2 dark:bg-black"><TerminalPane key={session.id} terminalId={session.id} cwd={session.cwd} /></div>
  </div>
}
