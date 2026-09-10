import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'

const FILES_MIN = 96
const NAVIGATION_MIN = 120

/** Spaces and Projects share the same 60/40 split, persisted file-pane
 * height, and collapse behavior. Keys are supplied to preserve existing
 * Spaces preferences and keep each section's preferences independent. */
export function useSecondaryRailSections({ collapsedKey, heightKey, topKey = 'navigation', bottomKey = 'files' }: {
    collapsedKey: string
    heightKey: string
    topKey?: string
    bottomKey?: string
}) {
    const [height, setHeight] = useState<number | null>(() => {
        const stored = Number(localStorage.getItem(heightKey))
        return Number.isFinite(stored) && stored >= FILES_MIN ? stored : null
    })
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
        try {
            const raw: unknown = JSON.parse(localStorage.getItem(collapsedKey) ?? '[]')
            return new Set(Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [])
        } catch { return new Set() }
    })
    const bodyRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLElement>(null)
    const dragCleanup = useRef<(() => void) | null>(null)
    const [resizing, setResizing] = useState(false)
    useEffect(() => () => dragCleanup.current?.(), [])

    const toggle = (key: string) => setCollapsed((previous) => {
        const next = new Set(previous)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        localStorage.setItem(collapsedKey, JSON.stringify([...next]))
        return next
    })
    const topCollapsed = collapsed.has(topKey)
    const bottomCollapsed = collapsed.has(bottomKey)
    const bothOpen = !topCollapsed && !bottomCollapsed
    const startResize = (event: MouseEvent) => {
        event.preventDefault()
        dragCleanup.current?.()
        const start = { y: event.clientY, height: bottomRef.current?.clientHeight ?? 0 }
        setResizing(true)
        const onMove = (move: globalThis.MouseEvent) => {
            const bodyHeight = bodyRef.current?.clientHeight ?? window.innerHeight
            const next = start.height + start.y - move.clientY
            setHeight(Math.min(Math.max(next, FILES_MIN), Math.max(FILES_MIN, bodyHeight - NAVIGATION_MIN)))
        }
        const cleanup = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            dragCleanup.current = null
        }
        const onUp = () => {
            cleanup()
            setResizing(false)
            setHeight((value) => {
                if (value !== null) localStorage.setItem(heightKey, String(value))
                return value
            })
        }
        dragCleanup.current = cleanup
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }
    const topStyle: CSSProperties = topCollapsed ? { flex: '0 0 auto' }
        : !bothOpen || height !== null ? { flex: '1 1 0%' } : { flex: '60 1 0%' }
    const bottomStyle: CSSProperties = bottomCollapsed ? { flex: '0 0 auto' }
        : !bothOpen ? { flex: '1 1 0%' }
        : height !== null ? { flex: `0 0 ${height}px`, maxHeight: `calc(100% - ${NAVIGATION_MIN}px)` }
        : { flex: '40 1 0%' }
    return {
        bodyRef, bottomRef, topStyle, bottomStyle, topCollapsed, bottomCollapsed, resizing,
        toggleTop: () => toggle(topKey), toggleBottom: () => toggle(bottomKey),
        dividerProps: { enabled: bothOpen, resizing, onMouseDown: startResize },
    }
}
