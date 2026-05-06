import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Plus, RotateCw, X } from 'lucide-react'

import { TabBar } from '@/components/tab-bar'
import { cn } from '@/lib/utils'

/**
 * Embedded browser pane.
 *
 * Renders a transparent placeholder div whose bounds are reported to the
 * main process via `browser:setBounds`. The actual browsing surface is an
 * Electron WebContentsView layered on top of the renderer by the main
 * process — this component only owns the chrome (tabs, address bar, nav
 * buttons) and the sizing/visibility lifecycle.
 */

interface BrowserTabState {
  id: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

interface BrowserState {
  activeTabId: string | null
  tabs: BrowserTabState[]
}

const EMPTY_STATE: BrowserState = {
  activeTabId: null,
  tabs: [],
}

const CHROME_HEIGHT = 40
const BLOCKING_OVERLAY_SLOTS = new Set([
  'alert-dialog-content',
  'context-menu-content',
  'context-menu-sub-content',
  'dialog-content',
  'dropdown-menu-content',
  'dropdown-menu-sub-content',
  'hover-card-content',
  'popover-content',
  'select-content',
  'sheet-content',
])

interface BrowserPaneProps {
  onClose: () => void
  forceHidden?: boolean
}

const getActiveTab = (state: BrowserState) =>
  state.tabs.find((tab) => tab.id === state.activeTabId) ?? null

const isVisibleOverlayElement = (el: HTMLElement) => {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false
  }
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

const hasBlockingOverlay = (doc: Document) => {
  const openContent = doc.querySelectorAll<HTMLElement>('[data-slot][data-state="open"]')
  return Array.from(openContent).some((el) => {
    const slot = el.dataset.slot
    if (!slot || !BLOCKING_OVERLAY_SLOTS.has(slot)) return false
    return isVisibleOverlayElement(el)
  })
}

const getBrowserTabTitle = (tab: BrowserTabState) => {
  const title = tab.title.trim()
  if (title) return title
  const url = tab.url.trim()
  if (!url) return 'New tab'
  try {
    const parsed = new URL(url)
    return parsed.hostname || parsed.href
  } catch {
    return url.replace(/^https?:\/\//i, '') || 'New tab'
  }
}

export function BrowserPane({ onClose, forceHidden = false }: BrowserPaneProps) {
  const [state, setState] = useState<BrowserState>(EMPTY_STATE)
  const [addressValue, setAddressValue] = useState('')

  const activeTabIdRef = useRef<string | null>(null)
  const addressFocusedRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const viewVisibleRef = useRef(false)

  const activeTab = getActiveTab(state)

  const applyState = useCallback((next: BrowserState) => {
    const previousActiveTabId = activeTabIdRef.current
    activeTabIdRef.current = next.activeTabId
    setState(next)

    const nextActiveTab = getActiveTab(next)
    if (!addressFocusedRef.current || next.activeTabId !== previousActiveTabId) {
      setAddressValue(nextActiveTab?.url ?? '')
    }
  }, [])

  useEffect(() => {
    const cleanup = window.ipc.on('browser:didUpdateState', (incoming) => {
      applyState(incoming as BrowserState)
    })

    void window.ipc.invoke('browser:getState', null).then((initial) => {
      applyState(initial as BrowserState)
    })

    return cleanup
  }, [applyState])

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
    // native view bounds are in unzoomed window coordinates, so convert back
    // using the renderer zoom factor before calling into the main process.
    const left = Math.ceil(rect.left * zoomFactor)
    const top = Math.ceil(rect.top * zoomFactor)
    const right = Math.floor(clampedRightCss * zoomFactor)
    const bottom = Math.floor(rect.bottom * zoomFactor)
    const width = right - left
    const height = bottom - top

    if (width <= 0 || height <= 0) return null

    return {
      x: left,
      y: top,
      width,
      height,
    }
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
    if (forceHidden) {
      lastBoundsRef.current = null
      setViewVisible(false)
      return null
    }

    const doc = viewportRef.current?.ownerDocument
    if (doc && hasBlockingOverlay(doc)) {
      lastBoundsRef.current = null
      setViewVisible(false)
      return null
    }

    const bounds = measureBounds()
    if (!bounds) {
      lastBoundsRef.current = null
      setViewVisible(false)
      return null
    }
    pushBounds(bounds)
    setViewVisible(true)
    return bounds
  }, [forceHidden, measureBounds, pushBounds, setViewVisible])

  useEffect(() => {
    syncView()
  }, [activeTab?.id, activeTab?.loading, activeTab?.url, syncView])

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

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

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

  useEffect(() => {
    const doc = viewportRef.current?.ownerDocument
    if (!doc?.body) return

    let pendingRaf: number | null = null
    const schedule = () => {
      if (pendingRaf !== null) return
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = null
        syncView()
      })
    }

    const observer = new MutationObserver(schedule)
    observer.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'style', 'hidden', 'aria-hidden', 'open'],
    })

    return () => {
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf)
      observer.disconnect()
    }
  }, [syncView])

  const handleNewTab = useCallback(() => {
    void window.ipc.invoke('browser:newTab', {}).then((res) => {
      const result = res as { ok: boolean; error?: string }
      if (!result.ok && result.error) {
        console.error('browser:newTab failed', result.error)
      }
    })
  }, [])

  const handleSwitchTab = useCallback((tabId: string) => {
    void window.ipc.invoke('browser:switchTab', { tabId })
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    void window.ipc.invoke('browser:closeTab', { tabId })
  }, [])

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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-sidebar">
        <TabBar
          tabs={state.tabs}
          activeTabId={state.activeTabId ?? ''}
          getTabTitle={getBrowserTabTitle}
          getTabId={(tab) => tab.id}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          layout="scroll"
        />
        <button
          type="button"
          onClick={handleNewTab}
          className="flex h-9 w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="New browser tab"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2"
        style={{ minHeight: CHROME_HEIGHT }}
      >
        <button
          type="button"
          onClick={handleBack}
          disabled={!activeTab?.canGoBack}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
            activeTab?.canGoBack ? 'hover:bg-accent hover:text-foreground' : 'opacity-40',
          )}
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={!activeTab?.canGoForward}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
            activeTab?.canGoForward ? 'hover:bg-accent hover:text-foreground' : 'opacity-40',
          )}
          aria-label="Forward"
        >
          <ArrowRight className="size-4" />
        </button>
        <button
          type="button"
          onClick={handleReload}
          disabled={!activeTab}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
            activeTab ? 'hover:bg-accent hover:text-foreground' : 'opacity-40',
          )}
          aria-label="Reload"
        >
          {activeTab?.loading ? (
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
              setAddressValue(activeTab?.url ?? '')
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
        <button
          type="button"
          onClick={onClose}
          className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close browser"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-0 min-w-0 flex-1"
        data-browser-viewport
      />
    </div>
  )
}
