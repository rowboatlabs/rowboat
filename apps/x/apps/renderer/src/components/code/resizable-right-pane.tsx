import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Mirror of ChatSidebar's resize behavior for the direct-mode code chat pane:
// same bounds, same drag handle, and the SAME persisted width key — so the
// assistant pane and the direct pane stay the same size as the user switches
// between session modes.
const MIN_WIDTH = 360
const MAX_WIDTH = 1600
const MIN_MAIN_PANE_WIDTH = 420
const MIN_MAIN_PANE_RATIO = 0.3
const RIGHT_PANE_WIDTH_STORAGE_KEY = 'x:right-pane-width'

function clampPaneWidth(width: number, maxWidth: number = MAX_WIDTH): number {
  const boundedMax = Math.max(0, Math.min(MAX_WIDTH, maxWidth))
  const boundedMin = Math.min(MIN_WIDTH, boundedMax)
  return Math.min(boundedMax, Math.max(boundedMin, width))
}

function readStoredWidth(defaultWidth: number): number {
  const fallback = clampPaneWidth(defaultWidth)
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(RIGHT_PANE_WIDTH_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return fallback
    return clampPaneWidth(parsed)
  } catch {
    return fallback
  }
}

export function ResizableRightPane({
  defaultWidth = 460,
  className,
  children,
  onActivate,
}: {
  defaultWidth?: number
  className?: string
  children: React.ReactNode
  /** Fired on any mouse-down inside the pane (keyboard-shortcut focus tracking). */
  onActivate?: () => void
}) {
  const paneRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(() => readStoredWidth(defaultWidth))
  const [isResizing, setIsResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  // Never let the pane squeeze the main content below a usable width.
  const getMaxAllowedWidth = useCallback(() => {
    if (typeof window === 'undefined') return MAX_WIDTH
    const paneElement = paneRef.current
    const splitContainer = paneElement?.parentElement
    const mainPane = splitContainer?.querySelector<HTMLElement>('[data-slot="sidebar-inset"]')
    const paneWidth = paneElement?.getBoundingClientRect().width ?? 0
    const mainPaneWidth = mainPane?.getBoundingClientRect().width ?? 0
    const splitWidth = paneWidth + mainPaneWidth
    const fallbackWidth = splitContainer?.clientWidth ?? window.innerWidth
    const availableSplitWidth = splitWidth > 0 ? splitWidth : fallbackWidth
    const minMainPaneWidth = Math.min(
      availableSplitWidth,
      Math.max(MIN_MAIN_PANE_WIDTH, Math.floor(availableSplitWidth * MIN_MAIN_PANE_RATIO)),
    )
    return Math.max(0, availableSplitWidth - minMainPaneWidth)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(RIGHT_PANE_WIDTH_STORAGE_KEY, String(width))
    } catch {
      // keep in-memory width on persistence failure
    }
  }, [width])

  useEffect(() => {
    const clampToAvailableWidth = () => {
      const maxAllowedWidth = getMaxAllowedWidth()
      setWidth((prev) => clampPaneWidth(prev, maxAllowedWidth))
    }
    clampToAvailableWidth()
    window.addEventListener('resize', clampToAvailableWidth)
    return () => window.removeEventListener('resize', clampToAvailableWidth)
  }, [getMaxAllowedWidth])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startXRef.current = e.clientX
    startWidthRef.current = width
    setIsResizing(true)

    const handleMouseMove = (event: MouseEvent) => {
      // Pane sits on the right: dragging left grows it.
      const delta = startXRef.current - event.clientX
      const maxAllowedWidth = getMaxAllowedWidth()
      setWidth(clampPaneWidth(startWidthRef.current + delta, maxAllowedWidth))
    }
    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [width, getMaxAllowedWidth])

  return (
    <div
      ref={paneRef}
      onMouseDownCapture={onActivate}
      className={cn(
        'relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background',
        className,
      )}
      style={{ width, flex: '0 0 auto' }}
    >
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute inset-y-0 left-0 z-20 w-4 -translate-x-1/2 cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:transition-colors',
          'hover:after:bg-sidebar-border',
          isResizing && 'after:bg-primary',
        )}
      />
      {children}
    </div>
  )
}
