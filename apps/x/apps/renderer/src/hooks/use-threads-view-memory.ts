import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export function useThreadsPreference<T extends string | null>(key: string, parse: (raw: string | null) => T): [T, (value: T) => void] {
    const read = () => { try { return parse(localStorage.getItem(key)) } catch { return parse(null) } }
    const [state, setState] = useState(() => ({ key, value: read() }))
    const value = state.key === key ? state.value : read()
    if (state.key !== key) setState({ key, value })
    const set = useCallback((next: T) => {
        try {
            if (next === null) localStorage.removeItem(key)
            else localStorage.setItem(key, next)
        } catch { /* Storage can be unavailable; keep the current visit usable. */ }
        setState({ key, value: next })
    }, [key])
    return [value, set]
}

// 2026-11-03, Threads navigation: restore after layout/data arrive, including
// older pages, instead of replacing the saved position with a loading-page zero.
export function useThreadsScroll(key: string, { loaded, hasMore, loadingOlder, onLoadOlder, rowCount }: {
    loaded: boolean
    hasMore: boolean
    loadingOlder: boolean
    onLoadOlder: () => void
    rowCount: number
}) {
    const ref = useRef<HTMLElement>(null)
    const restore = useRef<{ key: string; top: number; pending: boolean } | null>(null)
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        if (restore.current?.key !== key) {
            let top = 0
            try { top = Number(localStorage.getItem(key)) } catch { /* use the top */ }
            restore.current = { key, top: Number.isFinite(top) ? Math.max(0, top) : 0, pending: true }
        }
        const position = restore.current
        const apply = () => {
            if (!position.pending || !loaded || el.clientHeight === 0) return
            el.scrollTop = position.top
            if (el.scrollTop >= position.top || !hasMore) position.pending = false
            else if (!loadingOlder) onLoadOlder()
        }
        apply()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(apply)
        observer.observe(el)
        if (el.firstElementChild) observer.observe(el.firstElementChild)
        return () => observer.disconnect()
    }, [key, loaded, hasMore, loadingOlder, onLoadOlder, rowCount])
    const onScroll = useCallback(() => {
        const position = restore.current
        if (!ref.current || !position || position.key !== key || position.pending || ref.current.clientHeight === 0) return
        position.top = ref.current.scrollTop
        try { localStorage.setItem(key, String(position.top)) } catch { /* retain the position for this visit */ }
    }, [key])
    return { ref, onScroll }
}
