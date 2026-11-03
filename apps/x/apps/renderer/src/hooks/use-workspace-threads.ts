import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// 2026-11-03: keep loaded pages across navigation; live refreshes reconcile
// the loaded window so reading a thread does not discard the list beneath it.
const pages = new Map<string, spaces.ThreadsPage>()
export function useWorkspaceThreads(orgId: string, memberId: string, query: spaces.ThreadsQuery, active: boolean) {
    const key = JSON.stringify([orgId, memberId, query])
    const request = useMemo(() => ({ orgId, ...query, limit: 40 }), [key])
    const [state, setState] = useState(() => ({ key, page: pages.get(key), loading: false, more: false, error: null as string | null }))
    if (state.key !== key) setState({ key, page: pages.get(key), loading: false, more: false, error: null })
    const shown = state.key === key ? state : { key, page: pages.get(key), loading: false, more: false, error: null }
    const generation = useRef(0)
    const morePending = useRef(false)
    const load = useCallback(async () => {
        const gen = ++generation.current
        setState((s) => ({ ...s, loading: true, more: false, error: null }))
        morePending.current = false
        try {
            const count = pages.get(key)?.items.length ?? 0
            let next = await window.ipc.invoke('spaces:listThreads', request)
            while (next.items.length < count && next.nextCursor && gen === generation.current) {
                const older = await window.ipc.invoke('spaces:listThreads', { ...request, cursor: next.nextCursor })
                const ids = new Set(next.items.map((item) => item.root.id))
                next = { ...older, items: [...next.items, ...older.items.filter((item) => !ids.has(item.root.id))], names: { ...next.names, ...older.names } }
            }
            if (gen !== generation.current) return
            pages.set(key, next)
            setState({ key, page: next, loading: false, more: false, error: null })
        } catch (err) {
            if (gen === generation.current) setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Could not load threads' }))
        }
    }, [key, request])
    useEffect(() => {
        if (!active) return
        void load()
        let timer: ReturnType<typeof setTimeout> | undefined
        const off = subscribeSpacesFeed((event) => {
            if (event.orgId !== orgId || !('frame' in event)) return
            const frame = event.frame
            if (frame.kind !== 'event' && frame.kind !== 'notify' && frame.kind !== 'subscribed' && frame.kind !== 'space_added' && frame.kind !== 'space_removed') return
            if (!timer) timer = setTimeout(() => { timer = undefined; void load() }, 1000)
        })
        return () => { generation.current++; off(); clearTimeout(timer) }
    }, [active, orgId, load])
    const loadMore = useCallback(async () => {
        const page = pages.get(key)
        if (!page?.nextCursor || morePending.current) return
        const gen = generation.current
        morePending.current = true
        setState((s) => ({ ...s, more: true, error: null }))
        try {
            const next = await window.ipc.invoke('spaces:listThreads', { ...request, cursor: page.nextCursor })
            if (gen !== generation.current) return
            const ids = new Set(page.items.map((item) => item.root.id))
            const merged = { ...next, items: [...page.items, ...next.items.filter((item) => !ids.has(item.root.id))], names: { ...page.names, ...next.names } }
            pages.set(key, merged)
            setState({ key, page: merged, loading: false, more: false, error: null })
        } catch (err) {
            if (gen === generation.current) setState((s) => ({ ...s, more: false, error: err instanceof Error ? err.message : 'Could not load older threads' }))
        } finally { if (gen === generation.current) morePending.current = false }
    }, [key, request])
    return { ...shown, reload: load, loadMore }
}
export function resetWorkspaceThreadsCache() { pages.clear() }
