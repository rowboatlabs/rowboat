import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Loader2, X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Embedded browser pane.
 *
 * Renders a transparent placeholder div whose bounds are reported to the
 * main process via `browser:setBounds`. The actual browsing surface is an
 * Electron WebContentsView layered on top of the renderer by the main
 * process — this component only owns the chrome (address bar, nav, spinner)
 * and the sizing/visibility lifecycle.
 */

interface BrowserState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

const EMPTY_STATE: BrowserState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  loading: false,
}

/** Placeholder height we subtract from the inner bounds for the chrome row. */
const CHROME_HEIGHT = 40

interface BrowserPaneProps {
  onClose: () => void
}

export function BrowserPane({ onClose }: BrowserPaneProps) {
  const [state, setState] = useState<BrowserState>(EMPTY_STATE)
  const [addressValue, setAddressValue] = useState('')

  const addressFocusedRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const viewVisibleRef = useRef(false)

  // ── Subscribe to state updates from main ──────────────────────────────────
  useEffect(() => {
    const cleanup = window.ipc.on('browser:didUpdateState', (incoming) => {
      const next = incoming as BrowserState
      setState(next)
      if (!addressFocusedRef.current) {
        setAddressValue(next.url)
      }
    })
    // Kick an initial state fetch so the chrome reflects wherever the view
    // was left from a previous session (or empty, if never loaded).
    void window.ipc.invoke('browser:getState', null).then((initial) => {
      const next = initial as BrowserState
      setState(next)
      if (!addressFocusedRef.current) {
        setAddressValue(next.url)
      }
    })
    return cleanup
  }, [])

  // ── Bounds tracking ───────────────────────────────────────────────────────
  // The main process needs pixel-accurate bounds *relative to the window
  // content area*. getBoundingClientRect() returns viewport-relative coords,
  // which in Electron with hiddenInset titleBar equal content-area coords.
  //
  // Reads layout synchronously and posts an IPC update only when the rect
  // actually changed. Cheap enough to call from a RAF loop or observer.
  const setViewVisible = useCallback((visible: boolean) => {
    if (viewVisibleRef.current === visible) return
    viewVisibleRef.current = visible
    void window.ipc.invoke('browser:setVisible', { visible })
  }, [])

  const measureBounds = useCallback(() => {
    const el = viewportRef.current
    if (!el) return null
    const zoomFactor = Math.max(window.electronUtils.getZoomFactor(), 0.01)
    const rect = el.getBoundingClientRect()
    const chatSidebar = el.ownerDocument.querySelector<HTMLElement>('[data-chat-sidebar-root]')
    const chatSidebarRect = chatSidebar?.getBoundingClientRect()
    const clampedRightCss = chatSidebarRect && chatSidebarRect.width > 0
      ? Math.min(rect.right, chatSidebarRect.left)
      : rect.right
    // `getBoundingClientRect()` is reported in zoomed CSS pixels. Electron's
    // native view bounds are in unzoomed window coordinates, so we have to
    // convert back using the renderer zoom factor.
    const left = Math.ceil(rect.left * zoomFactor)
    const top = Math.ceil(rect.top * zoomFactor)
    const right = Math.floor(clampedRightCss * zoomFactor)
    const bottom = Math.floor(rect.bottom * zoomFactor)
    const width = right - left
    const height = bottom - top
    // A zero-sized rect means the element isn't laid out yet or has been
    // collapsed behind the chat pane — hide the native view in that case.
    if (width <= 0 || height <= 0) return null
    const bounds = {
      x: left,
      y: top,
      width,
      height,
    }
    return bounds
  }, [])

  const pushBounds = useCallback((bounds: { x: number; y: number; width: number; height: number }) => {
    const last = lastBoundsRef.current
    if (
      last &&
      last.x === bounds.x &&
      last.y === bounds.y &&
      last.width === bounds.width &&
      last.height === bounds.height
    ) {
      return bounds
    }
    lastBoundsRef.current = bounds
    void window.ipc.invoke('browser:setBounds', bounds)
    return bounds
  }, [])

  const syncView = useCallback(() => {
    const bounds = measureBounds()
    if (!bounds) {
      lastBoundsRef.current = null
      setViewVisible(false)
      return null
    }
    pushBounds(bounds)
    setViewVisible(true)
    return bounds
  }, [measureBounds, pushBounds, setViewVisible])

  // Defensively re-push bounds whenever the underlying page state changes.
  // Electron's WebContentsView can drop its laid-out rect on navigation,
  // and even though main re-applies on the same events, pushing from the
  // renderer ensures we use the *current* layout (in case the chat sidebar
  // or window resized while the page was loading).
  useEffect(() => {
    syncView()
  }, [state.url, state.loading, syncView])

  // ── Visibility lifecycle ──────────────────────────────────────────────────
  // Order matters: push bounds FIRST so the WCV is created at the right
  // position, THEN setVisible. Otherwise the view gets attached at stale
  // (or zero) cached bounds and visually spills until the next bounds push.
  //
  // We wait one animation frame after mount so React's commit + the browser's
  // layout pass for any sibling that just mounted (e.g. the chat sidebar) are
  // both reflected in getBoundingClientRect. A single RAF is enough — by then
  // the renderer has painted the post-commit DOM at least once.
  useEffect(() => {
    let cancelled = false
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return
      syncView()
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      lastBoundsRef.current = null
      setViewVisible(false)
    }
  }, [setViewVisible, syncView])

  // Ongoing bounds tracking. Observes everything that can move our viewport:
  //   - the viewport div itself (local size changes)
  //   - the SidebarInset ancestor (changes when chat sidebar mounts/resizes)
  //   - the document root (window resize, devicePixelRatio changes)
  //
  // ResizeObserver fires after layout but before paint, so by the time we
  // call pushBounds the rect is current. Multiple observers may fire in the
  // same frame — RAF-coalesce them so we only post one IPC per frame.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    // The sidebar-inset main element is the immediate flex parent whose
    // width shrinks when a sibling appears. Walking up the tree is more
    // robust than passing a ref through props.
    const sidebarInset = el.closest<HTMLElement>('[data-slot="sidebar-inset"]')
    const chatSidebar = el.ownerDocument.querySelector<HTMLElement>('[data-chat-sidebar-root]')
    const documentElement = el.ownerDocument.documentElement

    let pendingRaf: number | null = null
    const schedule = () => {
      if (pendingRaf !== null) return
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = null
        syncView()
      })
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    if (sidebarInset) ro.observe(sidebarInset)
    if (chatSidebar) ro.observe(chatSidebar)
    ro.observe(documentElement)

    return () => {
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf)
      ro.disconnect()
    }
  }, [syncView])

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleSubmitAddress = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = addressValue.trim()
    if (!trimmed) return
    void window.ipc.invoke('browser:navigate', { url: trimmed }).then((res) => {
      const result = res as { ok: boolean; error?: string }
      if (!result.ok && result.error) {
        console.error('browser:navigate failed', result.error)
      }
    })
  }, [addressValue])

  const handleBack = useCallback(() => {
    void window.ipc.invoke('browser:back', null)
  }, [])

  const handleForward = useCallback(() => {
    void window.ipc.invoke('browser:forward', null)
  }, [])

  const handleReload = useCallback(() => {
    void window.ipc.invoke('browser:reload', null)
  }, [])

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {/* Chrome row: back / forward / reload / address bar */}
      <div
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2"
        style={{ minHeight: CHROME_HEIGHT }}
      >
        <button
          type="button"
          onClick={handleBack}
          disabled={!state.canGoBack}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
            state.canGoBack ? 'hover:bg-accent hover:text-foreground' : 'opacity-40',
          )}
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={!state.canGoForward}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
            state.canGoForward ? 'hover:bg-accent hover:text-foreground' : 'opacity-40',
          )}
          aria-label="Forward"
        >
          <ArrowRight className="size-4" />
        </button>
        <button
          type="button"
          onClick={handleReload}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Reload"
        >
          {state.loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCw className="size-4" />
          )}
        </button>
        <form onSubmit={handleSubmitAddress} className="flex-1 min-w-0">
          <input
            type="text"
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            onFocus={(e) => {
              addressFocusedRef.current = true
              e.currentTarget.select()
            }}
            onBlur={() => {
              addressFocusedRef.current = false
              setAddressValue(state.url)
            }}
            placeholder="Enter URL or search..."
            className={cn(
              'h-7 w-full rounded-md border border-transparent bg-background px-3 text-sm text-foreground',
              'placeholder:text-muted-foreground/60',
              'focus:border-border focus:outline-hidden',
            )}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </form>
        {state.title && (
          <div className="hidden max-w-[220px] shrink-0 truncate pl-2 text-xs text-muted-foreground sm:block">
            {state.title}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close browser"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Viewport placeholder — the WebContentsView is layered on top of this
          area from the main process. The div itself stays transparent so the
          user sees the web page, not a React element. */}
      <div
        ref={viewportRef}
        className="relative min-h-0 min-w-0 flex-1"
        data-browser-viewport
      />
    </div>
  )
}
