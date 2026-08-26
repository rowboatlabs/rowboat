import { useEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { toast } from '@/lib/toast'

// A floating Copy chip over selected message text. The app replaces the
// browser's right-click menu with its own, so a plain selection needs its own
// copy affordance (Ctrl+C still works; this is the mouse path). One instance
// per space pane — it scopes itself to message rows by ancestry.

export function SelectionCopy() {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
    const textRef = useRef('')
    const chipRef = useRef<HTMLButtonElement | null>(null)

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
            setPos(null)
        }
        const onSelectionChange = () => {
            const sel = window.getSelection()
            if (!sel || sel.isCollapsed) setPos(null)
        }
        // Scrolling moves the selection under the fixed chip — hide, don't track.
        const onScroll = () => setPos(null)
        document.addEventListener('mouseup', onMouseUp)
        document.addEventListener('mousedown', onMouseDown)
        document.addEventListener('selectionchange', onSelectionChange)
        document.addEventListener('scroll', onScroll, true)
        return () => {
            document.removeEventListener('mouseup', onMouseUp)
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('scroll', onScroll, true)
        }
    }, [])

    if (!pos) return null
    return (
        <button
            ref={chipRef}
            type="button"
            style={{ position: 'fixed', left: pos.x, top: Math.max(8, pos.y - 36) }}
            // Without this the mousedown collapses the selection before click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
                void navigator.clipboard.writeText(textRef.current).then(
                    () => toast('Copied', 'success'),
                    () => toast('Could not copy', 'error'),
                )
                setPos(null)
            }}
            className="z-50 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-md hover:bg-accent"
        >
            <Copy className="size-3" /> Copy
        </button>
    )
}
