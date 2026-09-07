import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The shared shell for a section's secondary sidebar (Spaces' rail, Email's
// filter rail): everything about BEING a rail, nothing about what's in one.
//
// Open/close follows Notion. Docked: a sidebar in the flow (280px until its
// right edge is dragged; persisted per surface via widthStorageKey); the
// domain's header button closes it to a sliver at the edge. Collapsed:
// hovering the sliver slides the whole rail out as a drawer OVER the
// content — nothing shifts — and it slides back once the cursor leaves (an
// open row menu holds it, reported through the context's onMenuOpenChange
// since menus portal outside the rail). The drawer's header button is the
// lock: clicking it docks the rail, the only act that moves the content.
//
// The parent owns the docked/collapsed choice (open/onTogglePin) and its
// persistence; the shell owns width, peek, and the chrome. Domain content
// renders through a children function so its header can host the
// close/lock button (ctx.togglePin) and its menus can hold the drawer.

/** The collapsed rail: a sliver you hover, not a strip you read. */
const EDGE_W = 10
/** Docked width: 280 until the right edge is dragged (persisted), within these. */
const WIDTH_DEFAULT = 280
const WIDTH_MIN = 220
const WIDTH_MAX = 480

export interface SecondaryRailContext {
    /** Docked: close. Peeked: the lock — dock it. Clears the peek first. */
    togglePin: () => void
    /** Row menus portal outside the rail — report open/close so the peeked
     *  drawer holds while one is up. */
    onMenuOpenChange: (open: boolean) => void
}

export function SecondaryRail({ open, onTogglePin, widthStorageKey, edgeDot = false, persistent, onWidthChange, className, children }: {
    /** Docked (in the flow, pushing the content). False = the edge sliver + hover drawer. */
    open: boolean
    /** The lock: docks a peeked rail, closes a docked one. */
    onTogglePin: () => void
    /** localStorage key for the dragged width (e.g. 'spaces:railWidth'). */
    widthStorageKey: string
    /** Show the sliver's "something here is unread" dot. */
    edgeDot?: boolean
    /** Rendered directly in the <aside>, mounted in BOTH modes — for hidden
     *  inputs that must survive the dock/collapse remount of the body. */
    persistent?: ReactNode
    /** Reports the docked width — on mount and live through an edge drag —
     *  for a parent whose own pane must track the rail (Code's middle pane). */
    onWidthChange?: (width: number) => void
    /** Extra classes for the aside — e.g. `border-r-0` when the neighboring
     *  pane draws the divider itself. */
    className?: string
    children: (ctx: SecondaryRailContext) => ReactNode
}) {
    // Docked width: drag the rail's right edge. The drawer uses the same width.
    const [width, setWidth] = useState<number>(() => {
        const stored = Number(localStorage.getItem(widthStorageKey))
        return Number.isFinite(stored) && stored >= WIDTH_MIN && stored <= WIDTH_MAX ? stored : WIDTH_DEFAULT
    })
    // Layout effect so a tracking parent resizes in the same paint.
    useLayoutEffect(() => { onWidthChange?.(width) }, [width, onWidthChange])
    const [resizingWidth, setResizingWidth] = useState(false)
    const startWidthResize = (e: React.MouseEvent) => {
        e.preventDefault()
        const start = { x: e.clientX, width }
        setResizingWidth(true)
        const onMove = (ev: MouseEvent) => {
            setWidth(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, start.width + (ev.clientX - start.x))))
        }
        const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            setResizingWidth(false)
            setWidth((w) => {
                localStorage.setItem(widthStorageKey, String(w))
                return w
            })
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    // Peek: with the rail collapsed, hovering the edge slides the drawer out;
    // leaving slides it back after a beat, unless a row menu is holding it
    // (menus portal outside the rail, so the cursor "leaves" while using one).
    const [peek, setPeek] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const asideRef = useRef<HTMLElement | null>(null)
    const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clearPeekTimer = () => {
        if (peekTimer.current) clearTimeout(peekTimer.current)
        peekTimer.current = null
    }
    const scheduleClose = () => {
        clearPeekTimer()
        peekTimer.current = setTimeout(() => setPeek(false), 220)
    }
    const onEdgeEnter = () => {
        if (open) return
        clearPeekTimer()
        peekTimer.current = setTimeout(() => setPeek(true), 120)
    }
    const onEdgeLeave = () => {
        if (menuOpen) clearPeekTimer()
        else scheduleClose()
    }
    const onMenuOpenChange = (isOpen: boolean) => {
        setMenuOpen(isOpen)
        // The menu closed with the cursor already gone: slide back now.
        if (!isOpen && !open && !asideRef.current?.matches(':hover')) scheduleClose()
    }
    useEffect(() => {
        if (open) setPeek(false)
    }, [open])
    useEffect(() => clearPeekTimer, [])

    const togglePin = () => {
        setPeek(false)
        onTogglePin()
    }

    // The rail's content, rendered docked or inside the peek drawer. Fixed at
    // the open width so text doesn't reflow mid-slide. The ctx handlers run
    // on user events only — never during the children() call itself — so the
    // ref reads inside them are safe.
    // eslint-disable-next-line react-hooks/refs
    const content = children({ togglePin, onMenuOpenChange })
    const body = (
        <div style={{ width }} className={cn('flex h-full min-h-0 flex-col', resizingWidth && 'select-none')}>
            {content}
        </div>
    )

    return (
        <aside
            ref={asideRef}
            onMouseEnter={onEdgeEnter}
            onMouseLeave={onEdgeLeave}
            // No slide while the edge is being dragged — the width must track the cursor.
            style={{ width: open ? width : EDGE_W, transition: resizingWidth ? undefined : 'width 200ms cubic-bezier(0.2,0,0,1)' }}
            className={cn(
                'relative flex min-h-0 shrink-0 flex-col border-r border-border',
                // A step lighter than the main sidebar so the two rails read as
                // distinct layers; at this subtle a shift the hairline to the
                // canvas earns its place.
                open ? 'z-10 overflow-hidden bg-[var(--rowboat-panel-soft)]' : 'overflow-visible bg-background',
                // The drawer rides over the content's own sticky layers (z-20).
                !open && (peek ? 'z-30' : 'z-10'),
                className,
            )}
        >
            {persistent}
            {open ? (
                <>
                    {body}
                    {/* Docked: drag the right edge to resize. */}
                    <div
                        onMouseDown={startWidthResize}
                        title="Drag to resize"
                        className={cn(
                            'absolute inset-y-0 -right-px z-10 w-1 cursor-col-resize transition-colors hover:bg-primary/20',
                            resizingWidth && 'bg-primary/30',
                        )}
                    />
                </>
            ) : (
                <>
                    {/* The edge sliver: hover slides the drawer out. It says one
                        thing at rest — a dot when something here is unread. */}
                    <div aria-hidden className={cn('relative flex-1 transition-colors', peek ? 'bg-accent/60' : 'hover:bg-accent/60')}>
                        {edgeDot && <span className="absolute left-1/2 top-3 size-1 -translate-x-1/2 rounded-full bg-foreground" />}
                    </div>
                    {/* The drawer: the same rail, sliding out over the content from
                        the edge — nothing underneath moves. The outer box clips on
                        the left so the slide never shows over the shell dock, and is
                        wide enough to leave the shadow alone. Inert while hidden so
                        its rows never catch focus. */}
                    <div style={{ width: width + 50 }} className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden">
                        <div
                            inert={!peek}
                            style={{ width }}
                            className={cn(
                                'absolute bottom-1.5 left-0 top-1.5 overflow-hidden rounded-r-xl border border-border bg-[var(--rowboat-panel-soft)] shadow-2xl transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
                                peek ? 'pointer-events-auto translate-x-0' : '-translate-x-full',
                            )}
                        >
                            {body}
                        </div>
                    </div>
                </>
            )}
        </aside>
    )
}
