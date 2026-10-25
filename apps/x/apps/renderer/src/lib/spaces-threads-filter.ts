import { useCallback, useMemo, useSyncExternalStore } from 'react'

// The Threads view's filter, remembered per space (2026-10-25, Ro's request
// in Main): the page unmounts whenever you open a thread or a file, and
// re-picking "Ana, By me" every time you come back is the whole complaint.
// Kept in localStorage, not on the org: a filter is this person's reading
// position on this install, like the rail's pinned state — nothing another
// device needs to agree with.

export type ThreadsTab = 'all' | 'named' | 'mine'

export interface ThreadsFilter {
    tab: ThreadsTab
    /** Member ids a thread must have a participant from; empty = anyone. */
    participants: string[]
}

export const DEFAULT_THREADS_FILTER: ThreadsFilter = { tab: 'all', participants: [] }

const keyFor = (orgId: string, spaceId: string) => `spaces:threads-filter:${orgId}/${spaceId}`

/** The one listener set: every mounted view re-reads when any of them writes. */
const listeners = new Set<() => void>()

/** Cached per storage key so useSyncExternalStore's snapshot stays referentially stable. */
const cache = new Map<string, ThreadsFilter>()

function isTab(value: unknown): value is ThreadsTab {
    return value === 'all' || value === 'named' || value === 'mine'
}

function readStored(key: string): ThreadsFilter {
    try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return DEFAULT_THREADS_FILTER
        const parsed = JSON.parse(raw) as Partial<ThreadsFilter>
        const participants = Array.isArray(parsed.participants) ? parsed.participants.filter((id) => typeof id === 'string') : []
        return { tab: isTab(parsed.tab) ? parsed.tab : 'all', participants }
    } catch {
        // Unreadable or unparseable storage reads as the default filter.
        return DEFAULT_THREADS_FILTER
    }
}

function snapshot(key: string): ThreadsFilter {
    const held = cache.get(key)
    if (held) return held
    const stored = readStored(key)
    cache.set(key, stored)
    return stored
}

export function getThreadsFilter(orgId: string, spaceId: string): ThreadsFilter {
    return snapshot(keyFor(orgId, spaceId))
}

export function setThreadsFilter(orgId: string, spaceId: string, next: ThreadsFilter): void {
    const key = keyFor(orgId, spaceId)
    cache.set(key, next)
    try {
        if (next.tab === 'all' && next.participants.length === 0) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, JSON.stringify(next))
    } catch {
        // Quota/private mode: the choice holds for this session and no longer.
    }
    for (const listener of listeners) listener()
}

/** The space's remembered filter, and the setter that writes it through. */
export function useThreadsFilter(orgId: string, spaceId: string): [ThreadsFilter, (next: ThreadsFilter) => void] {
    const key = keyFor(orgId, spaceId)
    const subscribe = useCallback((listener: () => void) => {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    }, [])
    const filter = useSyncExternalStore(subscribe, () => snapshot(key))
    const set = useCallback((next: ThreadsFilter) => setThreadsFilter(orgId, spaceId, next), [orgId, spaceId])
    return useMemo(() => [filter, set], [filter, set])
}
