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
  const [addressFocused, setAddressFocused] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

  // ── Subscribe to state updates from main ──────────────────────────────────
  useEffect(() => {
    const cleanup = window.ipc.on('browser:didUpdateState', (incoming) => {
      const next = incoming as BrowserState
      setState(next)
    })
    // Kick an initial state fetch so the chrome reflects wherever the view
    // was left from a previous session (or empty, if never loaded).
    void window.ipc.invoke('browser:getState', null).then((initial) => {
      setState(initial as BrowserState)
    })
    return cleanup
  }, [])

  // Keep the address bar in sync with the active page URL, but only when the
  // input isn't focused — don't clobber whatever the user is typing.
  useEffect(() => {
    if (!addressFocused) {
      setAddressValue(state.url)
    }
  }, [state.url, addressFocused])

  // ── Visibility lifecycle ──────────────────────────────────────────────────
  // Show on mount, hide on unmount. The WebContentsView is expensive to
  // create but cheap to show/hide.
  useEffect(() => {
    void window.ipc.invoke('browser:setVisible', { visible: true })
    return () => {
      void window.ipc.invoke('browser:setVisible', { visible: false })
    }
  }, [])

  // ── Bounds tracking ───────────────────────────────────────────────────────
  // The main process needs pixel-accurate bounds *relative to the window
  // content area*. getBoundingClientRect() returns viewport-relative coords,
  // which in Electron with no custom chrome equal content-area coords.
  const pushBounds = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
    const last = lastBoundsRef.current
    if (
      last &&
      last.x === bounds.x &&
      last.y === bounds.y &&
      last.width === bounds.width &&
      last.height === bounds.height
    ) {
      return
    }
    lastBoundsRef.current = bounds
    void window.ipc.invoke('browser:setBounds', bounds)
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    // Initial push + ResizeObserver for size changes.
    pushBounds()
    const ro = new ResizeObserver(() => pushBounds())
    ro.observe(el)

    // The container may move without resizing (sidebar collapse, window
    // resize). Listen on window resize for that case.
    const onWindowResize = () => pushBounds()
    window.addEventListener('resize', onWindowResize)

    // Also poll briefly during layout transitions (the sidebar uses CSS
    // transitions that don't fire ResizeObserver every frame).
    const interval = window.setInterval(pushBounds, 100)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWindowResize)
      window.clearInterval(interval)
    }
  }, [pushBounds])

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
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
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
              setAddressFocused(true)
              e.currentTarget.select()
            }}
            onBlur={() => setAddressFocused(false)}
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
        className="relative min-h-0 flex-1"
        data-browser-viewport
      />
    </div>
  )
}
