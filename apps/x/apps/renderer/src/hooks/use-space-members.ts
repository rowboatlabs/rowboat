import { useEffect, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'

// The space roster, module-level and persisted per install (localStorage),
// like the stream's cached tail: names must paint in the same first frame as
// the messages beside them. A roster held in component state arrives a round
// trip after the cached messages, so every (re)mount of the pane showed raw
// member ids in the author lines until the fetch landed.

function key(orgId: string, spaceId: string): string {
    return `${orgId}/${spaceId}`
}

const CACHE_VERSION = 1

function cacheKey(k: string): string {
    return `spaces:members:${k}`
}

interface MembersCache {
    v: number
    members: spaces.Member[]
}

const EMPTY_MEMBERS: spaces.Member[] = []

let memberState: ReadonlyMap<string, spaces.Member[]> = new Map()
const listeners = new Set<() => void>()
const membersLoading = new Set<string>()
/** Keys painted from the cache and not yet confirmed by the org. */
const membersCacheOnly = new Set<string>()
const lastLoadedAt = new Map<string, number>()
/** Live activity is coarse (every event ticks) — one roster refetch per burst is plenty. */
const REFRESH_MIN_MS = 5_000

function emitMembers(): void {
    for (const l of listeners) l()
}

function setMembers(k: string, members: spaces.Member[]): void {
    const prev = memberState.get(k)
    // Identity-stable: a refetch that changed nothing must not re-render
    // every name in the pane (or rewrite the cache entry).
    if (prev && JSON.stringify(prev) === JSON.stringify(members)) return
    const next = new Map(memberState)
    next.set(k, members)
    memberState = next
    try {
        window.localStorage.setItem(cacheKey(k), JSON.stringify({ v: CACHE_VERSION, members } satisfies MembersCache))
    } catch {
        // Best-effort (quota, private mode) — cold opens just fetch.
    }
    emitMembers()
}

/**
 * Seed module state from the persisted cache. Render-safe on purpose: it
 * swaps the snapshot WITHOUT notifying listeners, so useSpaceMembers can call
 * it during render and the pane's very first frame already resolves names.
 * Idempotent once state exists.
 */
function hydrateMembers(k: string): void {
    if (memberState.has(k)) return
    try {
        const raw = window.localStorage.getItem(cacheKey(k))
        if (!raw) return
        const cached = JSON.parse(raw) as MembersCache
        if (cached.v !== CACHE_VERSION || !Array.isArray(cached.members)) return
        membersCacheOnly.add(k)
        const next = new Map(memberState)
        next.set(k, cached.members)
        memberState = next
    } catch {
        // A corrupt entry resolves nothing; the fetch rebuilds it.
    }
}

async function loadMembers(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    if (membersLoading.has(k)) return
    membersLoading.add(k)
    try {
        const res = await window.ipc.invoke('spaces:listMembers', { orgId, spaceId })
        membersCacheOnly.delete(k)
        lastLoadedAt.set(k, Date.now())
        setMembers(k, res.members)
    } catch {
        // org unreachable — cached names (or ids) stand until a retry.
    } finally {
        membersLoading.delete(k)
    }
}

/**
 * Warm a space's roster before it opens (the sidebar calls this on hover,
 * beside prefetchStream): hydrate the cached copy and start the refresh, so
 * the click that follows finds every name already in.
 */
export function prefetchMembers(orgId: string, spaceId: string): void {
    const k = key(orgId, spaceId)
    hydrateMembers(k)
    if (!memberState.has(k) || membersCacheOnly.has(k)) void loadMembers(orgId, spaceId)
}

/**
 * Refetch on live activity. The pane's tick fires on EVERY event (and on
 * resubscribe), so this throttles: membership changes ride the next quiet
 * moment, not every message in a burst.
 */
export function refreshMembers(orgId: string, spaceId: string): void {
    const k = key(orgId, spaceId)
    if (Date.now() - (lastLoadedAt.get(k) ?? 0) < REFRESH_MIN_MS) return
    void loadMembers(orgId, spaceId)
}

/** The space's roster: cached names in the first frame, refreshed behind. */
export function useSpaceMembers(orgId: string, spaceId: string): spaces.Member[] {
    // Before the snapshot read, not in an effect: a revisited space must
    // resolve names in its FIRST frame, beside the stream's cached tail.
    hydrateMembers(key(orgId, spaceId))
    const state = useSyncExternalStore(
        (l) => {
            listeners.add(l)
            return () => {
                listeners.delete(l)
            }
        },
        () => memberState,
    )
    useEffect(() => {
        void loadMembers(orgId, spaceId)
    }, [orgId, spaceId])
    return state.get(key(orgId, spaceId)) ?? EMPTY_MEMBERS
}
