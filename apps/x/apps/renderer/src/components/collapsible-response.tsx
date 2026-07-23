import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'

// A response taller than this collapses to a preview of this height. The
// small slack keeps borderline messages from collapsing to nearly their
// full height and showing a pointless toggle.
const COLLAPSED_PX = 260
const OVERFLOW_SLACK_PX = 80

/**
 * Collapse long assistant replies to a preview with a fade + "Show more"
 * control. The latest reply arrives expanded (the user is reading it) and
 * auto-collapses when a newer one supersedes it; older replies start
 * collapsed. Short replies render untouched — no toggle.
 */
export function CollapsibleResponse({
  collapsedByDefault,
  children,
}: {
  collapsedByDefault: boolean
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(!collapsedByDefault)
  const [overflows, setOverflows] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)

  // Track whether the content is tall enough to bother collapsing.
  // scrollHeight reports the full content height even while clamped.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const check = () => setOverflows(el.scrollHeight > COLLAPSED_PX + OVERFLOW_SLACK_PX)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The message stopped being the latest (a newer reply landed): fold it
  // away. A later manual expand sticks — this only reacts to the flip.
  useEffect(() => {
    setExpanded(!collapsedByDefault)
  }, [collapsedByDefault])

  const collapsed = overflows && !expanded

  return (
    <div>
      <div
        ref={contentRef}
        className={cn('relative', collapsed && 'overflow-hidden')}
        style={collapsed ? { maxHeight: COLLAPSED_PX } : undefined}
      >
        {children}
        {collapsed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {collapsed ? (
            <>
              <ChevronDown className="h-3 w-3" />
              Show more
            </>
          ) : (
            <>
              <ChevronUp className="h-3 w-3" />
              Show less
            </>
          )}
        </button>
      )}
    </div>
  )
}
