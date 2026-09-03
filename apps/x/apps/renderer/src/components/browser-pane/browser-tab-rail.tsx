import { useState } from 'react'
import { Globe, Loader2, PanelLeftClose, Plus, X } from 'lucide-react'

import type { BrowserTabState } from '@x/shared/dist/browser-control.js'

import { cn } from '@/lib/utils'

// The browser's edge rail: vertical tabs, following the Spaces rail pattern
// (spaces/space-rail.tsx) — a plain sticky sidebar that collapses to a 28px
// edge strip. Starts collapsed; clicking the strip opens it, the header
// button collapses it back. No hover behavior — the rail moves only on
// explicit clicks. Open/closed state lives in BrowserPane (persisted), the
// same way the Spaces rail's lives in SpacesView.

const RAIL_OPEN_WIDTH = 240
const RAIL_STRIP_WIDTH = 28
/** The collapsed strip previews at most this many favicons; the count pill carries the rest. */
const STRIP_FAVICON_PREVIEW = 6

export const getBrowserTabTitle = (tab: BrowserTabState) => {
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

/**
 * Favicon slot: spinner while the page loads, the page's icon once reported,
 * a globe when there is none (or the icon URL failed to fetch).
 */
function TabFavicon({ tab, className }: { tab: BrowserTabState; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (tab.loading) {
    return <Loader2 className={cn('size-4 shrink-0 animate-spin text-muted-foreground', className)} />
  }
  const src = tab.favicon
  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        className={cn('size-4 shrink-0', className)}
        onError={() => setFailedSrc(src)}
      />
    )
  }
  return <Globe className={cn('size-4 shrink-0 text-muted-foreground', className)} />
}

export function BrowserTabRail({
  tabs,
  activeTabId,
  open,
  onTogglePin,
  onSwitchTab,
  onCloseTab,
  onNewTab,
}: {
  tabs: BrowserTabState[]
  activeTabId: string | null
  open: boolean
  onTogglePin: () => void
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onNewTab: () => void
}) {
  return (
    <aside
      style={{ width: open ? RAIL_OPEN_WIDTH : RAIL_STRIP_WIDTH, transition: 'width 200ms cubic-bezier(0.2,0,0,1)' }}
      className={cn(
        'relative z-10 shrink-0 min-h-0 overflow-hidden flex flex-col',
        // Same layering as the Spaces rail: a step lighter than the main
        // sidebar when open, flush with the canvas when collapsed.
        open ? 'border-r border-border bg-[var(--rowboat-panel-soft)]' : 'border-r border-border bg-background',
      )}
    >
      {!open ? (
        // The collapsed edge strip: click to reopen. Deliberately not
        // hover-triggered — the rail appears only on an explicit act.
        <button
          type="button"
          onClick={onTogglePin}
          title="Show tabs"
          className="flex flex-1 flex-col items-center gap-2.5 py-3.5 hover:bg-accent/50"
        >
          {tabs.slice(0, STRIP_FAVICON_PREVIEW).map((tab) => (
            <span
              key={tab.id}
              className={cn(
                'flex size-5 items-center justify-center rounded',
                tab.id === activeTabId && 'bg-accent ring-1 ring-border',
              )}
            >
              <TabFavicon tab={tab} className="size-[15px]" />
            </span>
          ))}
          <div className="w-px flex-1 bg-border/70" />
          {tabs.length > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9.5px] font-semibold text-background tabular-nums">
              {tabs.length}
            </span>
          )}
        </button>
      ) : (
        // Inner content is fixed at the open width so rows don't reflow mid-slide.
        <div className="flex h-full w-[240px] flex-col">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pl-3 pr-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">Tabs</span>
            <button
              type="button"
              onClick={onNewTab}
              title="New tab"
              aria-label="New browser tab"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onTogglePin}
              title="Collapse — reopen from the edge strip"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelLeftClose className="size-3.5" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
            {tabs.map((tab) => {
              const title = getBrowserTabTitle(tab)
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSwitchTab(tab.id)}
                  title={title}
                  className={cn(
                    'group/tab flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-[13.5px]',
                    tab.id === activeTabId
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-foreground/90 hover:bg-accent/50',
                  )}
                >
                  <TabFavicon tab={tab} />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  {/* Main refuses to close the last tab, so don't offer it (same as the old strip). */}
                  {tabs.length > 1 && (
                    <span
                      role="button"
                      aria-label="Close tab"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCloseTab(tab.id)
                      }}
                      className="flex shrink-0 items-center justify-center rounded-sm p-0.5 opacity-0 transition-all group-hover/tab:opacity-60 hover:opacity-100! hover:bg-foreground/10"
                    >
                      <X className="size-3" />
                    </span>
                  )}
                </button>
              )
            })}
            <button
              type="button"
              onClick={onNewTab}
              className="flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              <Plus className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">New tab</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
