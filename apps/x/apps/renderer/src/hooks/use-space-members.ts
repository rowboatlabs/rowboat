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

/** The org-wide roster lives in the same store, under a key no space id can take. */
function orgKey(orgId: string): string {
    return `org:${orgId}`
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
    if (Date.now() - (lastLoadedAt.get(k) ?? 0) >= REFRESH_MIN_MS) void loadMembers(orgId, spaceId)
    // Membership changes in any space change who is in the org's directory too.
    if (Date.now() - (lastLoadedAt.get(orgKey(orgId)) ?? 0) >= REFRESH_MIN_MS) void loadOrgRoster(orgId, [])
}

/** The union of whatever per-space rosters are already in, A–Z. */
function unionOfRosters(orgId: string, spaceIds: readonly string[]): spaces.Member[] {
    const byId = new Map<string, spaces.Member>()
    for (const id of spaceIds) for (const m of memberState.get(key(orgId, id)) ?? []) if (!byId.has(m.id)) byId.set(m.id, m)
    return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}

async function loadOrgRoster(orgId: string, spaceIds: readonly string[]): Promise<void> {
    const k = orgKey(orgId)
    if (membersLoading.has(k)) return
    membersLoading.add(k)
    try {
        const res = await window.ipc.invoke('spaces:listOrgMembers', { orgId })
        membersCacheOnly.delete(k)
        lastLoadedAt.set(k, Date.now())
        setMembers(k, res.members)
    } catch {
        // Org unreachable, or an older org without the route: the per-space
        // rosters the app has already fetched stand in for the directory.
        if (!memberState.has(k) || membersCacheOnly.has(k)) setMembers(k, unionOfRosters(orgId, spaceIds))
    } finally {
        membersLoading.delete(k)
    }
}

function subscribeMembers(l: () => void): () => void {
    listeners.add(l)
    return () => {
        listeners.delete(l)
    }
}

/** The space's roster: cached names in the first frame, refreshed behind. */
export function useSpaceMembers(orgId: string, spaceId: string): spaces.Member[] {
    // Before the snapshot read, not in an effect: a revisited space must
    // resolve names in its FIRST frame, beside the stream's cached tail.
    hydrateMembers(key(orgId, spaceId))
    const state = useSyncExternalStore(subscribeMembers, () => memberState)
    useEffect(() => {
        void loadMembers(orgId, spaceId)
    }, [orgId, spaceId])
    return state.get(key(orgId, spaceId)) ?? EMPTY_MEMBERS
}

/**
 * Your own display name on an org — the sidebar's self-DM row shows it the
 * way Slack does ("<name>  you"). Read from the org roster (cached, then
 * refreshed); null until it lands.
 */
export function useSelfDisplayName(orgId: string, memberId: string, spaceIds: readonly string[]): string | null {
    const roster = useOrgRoster(orgId, spaceIds)
    return roster.find((m) => m.id === memberId)?.displayName ?? null
}

/**
 * Everyone your person shares a space with on this org, A–Z — the people a
 * DM can be opened with. The org computes it (GET /v1/members: the union of
 * your space rosters, DMs included, deduped — Discord's "people you share a
 * server with" rule, by construction rather than policy). Cached per org
 * like the per-space rosters, so the picker's first frame is already full;
 * refreshed on mount and, throttled, on live activity (refreshMembers).
 * `spaceIds` only feeds the fallback for an org that does not serve the route.
 */
export function useOrgRoster(orgId: string, spaceIds: readonly string[]): spaces.Member[] {
    const idsKey = spaceIds.join('|')
    hydrateMembers(orgKey(orgId))
    const state = useSyncExternalStore(subscribeMembers, () => memberState)
    useEffect(() => {
        void loadOrgRoster(orgId, spaceIds)
        // The joined key IS the dependency — the array identity changes every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, idsKey])
    return state.get(orgKey(orgId)) ?? EMPTY_MEMBERS
}
