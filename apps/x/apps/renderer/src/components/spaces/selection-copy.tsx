import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Link } from 'lucide-react'
import { toast } from '@/lib/toast'

// A floating Copy chip over selected message text. The app replaces the
// browser's right-click menu with its own, so a plain selection needs its own
// copy affordance (Ctrl+C still works; this is the mouse path). One instance
// per space pane — it scopes itself to message rows by ancestry.
//
// Hovering a link in a message shows the same chip as "Copy link" (2026-11-06,
// Arjun): the message menu only copies the message's own link or its whole
// text, so a link inside it had no way out but a careful drag-select.

const LINK_SHOW_MS = 250
const LINK_HIDE_MS = 250

type Chip = { x: number; y: number; kind: 'selection' | 'link' }

/** The http(s) link under `target` inside a message row, if any. */
function messageLink(target: EventTarget | null): HTMLAnchorElement | null {
    if (!(target instanceof Element)) return null
    const a = target.closest('a[href]')
    if (!(a instanceof HTMLAnchorElement) || !a.closest('[class~="group/msg"]')) return null
    return /^https?:/i.test(a.href) ? a : null
}

export function SelectionCopy() {
    const [chip, setChip] = useState<Chip | null>(null)
    const chipStateRef = useRef<Chip | null>(null)
    const textRef = useRef('')
    const chipRef = useRef<HTMLButtonElement | null>(null)
    const linkTimer = useRef<number | undefined>(undefined)

    // The listeners read the chip through a ref; state alone would be stale.
    const show = useCallback((next: Chip | null) => {
        chipStateRef.current = next
        setChip(next)
    }, [])
    const setPos = useCallback((p: { x: number; y: number } | null) => show(p && { ...p, kind: 'selection' }), [show])
    const clearLinkTimer = () => window.clearTimeout(linkTimer.current)
    const hideLinkSoon = useCallback(() => {
        window.clearTimeout(linkTimer.current)
        linkTimer.current = window.setTimeout(() => {
            if (chipStateRef.current?.kind === 'link') show(null)
        }, LINK_HIDE_MS)
    }, [show])

    useEffect(() => {
        const readSelection = () => {
            const sel = window.getSelection()
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
            const text = sel.toString()
            if (!text.trim()) return null
            const range = sel.getRangeAt(0)
            const node = range.commonAncestorContainer
            const el = node instanceof Element ? node : node.parentElement
            // Message text only — not the composer, not file panes.
            if (!el?.closest('[class~="group/msg"]')) return null
            const rect = range.getBoundingClientRect()
            if (rect.width === 0 && rect.height === 0) return null
            return { text, rect }
        }
        // Appear when a drag-select finishes — not while the drag is running,
        // and not on a right-button release (the context menu owns that).
        const onMouseUp = (e: MouseEvent) => {
            if (e.button !== 0) return
            // The selection settles after mouseup — read it a tick later.
            window.setTimeout(() => {
                const s = readSelection()
                if (!s) return
                textRef.current = s.text
                setPos({ x: s.rect.left + s.rect.width / 2, y: s.rect.top })
            }, 0)
        }
        const onMouseDown = (e: MouseEvent) => {
            if (chipRef.current?.contains(e.target as Node)) return
            clearLinkTimer()
            setPos(null)
        }
        // A short dwell before showing, so sweeping the pointer across a
        // message doesn't flash a chip over every link it crosses.
        const onMouseOver = (e: MouseEvent) => {
            if (chipRef.current?.contains(e.target as Node)) return
            const a = messageLink(e.target)
            if (!a) return
            clearLinkTimer()
            // A live selection owns the chip.
            if (chipStateRef.current?.kind === 'selection') return
            const { clientX, clientY } = e
            linkTimer.current = window.setTimeout(() => {
                if (!a.isConnected) return
                // A wrapped link has a box per line — sit over the hovered one.
                const rects = Array.from(a.getClientRects())
                const rect = rects.find((r) => clientY >= r.top && clientY <= r.bottom && clientX >= r.left && clientX <= r.right)
                    ?? rects[0] ?? a.getBoundingClientRect()
                textRef.current = a.href
                show({ x: rect.left + rect.width / 2, y: rect.top, kind: 'link' })
            }, LINK_SHOW_MS)
        }
        const onMouseOut = (e: MouseEvent) => {
            if (!messageLink(e.target)) return
            if (messageLink(e.relatedTarget) === messageLink(e.target)) return
            if (chipRef.current?.contains(e.relatedTarget as Node)) return
            hideLinkSoon()
        }
        const onSelectionChange = () => {
            const sel = window.getSelection()
            if ((!sel || sel.isCollapsed) && chipStateRef.current?.kind === 'selection') setPos(null)
        }
        // Scrolling moves the selection under the fixed chip — hide, don't track.
        const onScroll = () => { clearLinkTimer(); setPos(null) }
        document.addEventListener('mouseup', onMouseUp)
        document.addEventListener('mousedown', onMouseDown)
        document.addEventListener('mouseover', onMouseOver)
        document.addEventListener('mouseout', onMouseOut)
        document.addEventListener('selectionchange', onSelectionChange)
        document.addEventListener('scroll', onScroll, true)
        return () => {
            document.removeEventListener('mouseup', onMouseUp)
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('mouseover', onMouseOver)
            document.removeEventListener('mouseout', onMouseOut)
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('scroll', onScroll, true)
            clearLinkTimer()
        }
    }, [setPos, show, hideLinkSoon])

    if (!chip) return null
    const link = chip.kind === 'link'
    return (
        <button
            ref={chipRef}
            type="button"
            style={{ position: 'fixed', left: chip.x, top: Math.max(8, chip.y - 36) }}
            // Without this the mousedown collapses the selection before click lands.
            onMouseDown={(e) => e.preventDefault()}
            // Crossing from the link to the chip must not dismiss it.
            onMouseEnter={() => { if (link) clearLinkTimer() }}
            onMouseLeave={() => { if (link) hideLinkSoon() }}
            onClick={() => {
                void navigator.clipboard.writeText(textRef.current).then(
                    () => toast(link ? 'Link copied' : 'Copied', 'success'),
                    () => toast('Could not copy', 'error'),
                )
                setPos(null)
            }}
            className="z-50 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-lg border-none bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-[var(--rowboat-shadow-soft)] hover:bg-accent"
        >
            {link ? <><Link className="size-3" /> Copy link</> : <><Copy className="size-3" /> Copy</>}
        </button>
    )
}
