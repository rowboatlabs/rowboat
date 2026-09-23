import { useSyncExternalStore } from 'react'

// When this install last opened each channel or DM. The sidebar's working set
// falls back to it once nothing is unread ("the ones you keep coming back
// to"), so it is written from App's one route into Spaces — every navigation
// funnels through there, and a correction the Spaces view makes to its own
// selection is not a visit.

const STORAGE_KEY = 'x:space-visits'
/** Enough to outlive any working set; the oldest entries fall off the write. */
const MAX_ENTRIES = 200

const listeners = new Set<() => void>()
let version = 0
let visits: Record<string, number> | null = null

const key = (orgId: string, spaceId: string) => `${orgId}/${spaceId}`

function load(): Record<string, number> {
    if (visits) return visits
    visits = {}
    try {
        const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
        if (raw && typeof raw === 'object') {
            for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
                if (typeof at === 'number' && Number.isFinite(at)) visits[id] = at
            }
        }
    } catch {
        // unreadable storage — the working set backfills deterministically
    }
    return visits
}

function persist(next: Record<string, number>): void {
    const entries = Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES)
    visits = Object.fromEntries(entries)
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visits))
    } catch {
        // storage full or unavailable — the in-memory record still serves this session
    }
}

/** This install opened the space just now. */
export function noteSpaceVisit(orgId: string, spaceId: string, at = Date.now()): void {
    if (!orgId || !spaceId) return
    const current = load()
    if (current[key(orgId, spaceId)] === at) return
    persist({ ...current, [key(orgId, spaceId)]: at })
    version += 1
    for (const listener of listeners) listener()
}

/** When the space was last opened here, or null if it never was. */
export function spaceVisitedAt(orgId: string, spaceId: string): number | null {
    return load()[key(orgId, spaceId)] ?? null
}

/**
 * Of these channels and DMs, the one this install opened most recently — null
 * if none of them ever was. This is what "open this server" lands on, so
 * coming back to a server returns to the room it was left in.
 */
export function lastVisitedSpaceId(orgId: string, spaceIds: readonly string[]): string | null {
    const current = load()
    let last: string | null = null
    let lastAt = -Infinity
    for (const spaceId of spaceIds) {
        const at = current[key(orgId, spaceId)]
        if (typeof at === 'number' && at > lastAt) {
            last = spaceId
            lastAt = at
        }
    }
    return last
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/** Re-renders the caller on every visit; read the values with spaceVisitedAt. */
export function useSpaceVisitsVersion(): number {
    return useSyncExternalStore(subscribe, () => version)
}

/** Tests only — drops the in-memory mirror so the next read re-reads storage. */
export function resetSpaceVisitsForTest(): void {
    visits = null
    version += 1
}
