import { useSyncExternalStore } from 'react'

// Whether a server's rows are showing in the sidebar's Spaces section. Only
// the reader's OWN toggles live here: with no entry for a server the section
// decides for itself (resolveExpanded — the current space, or anything
// unread, opens it). A toggle is that reader's standing answer, so it is kept
// across relaunches rather than for the session.

const STORAGE_KEY = 'x:spaces-sidebar-fold'

const listeners = new Set<() => void>()
let version = 0
let overrides: Record<string, boolean> | null = null

function load(): Record<string, boolean> {
    if (overrides) return overrides
    overrides = {}
    try {
        const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
        if (raw && typeof raw === 'object') {
            for (const [orgId, expanded] of Object.entries(raw as Record<string, unknown>)) {
                if (typeof expanded === 'boolean') overrides[orgId] = expanded
            }
        }
    } catch {
        // unreadable storage — every server falls back to the automatic rule
    }
    return overrides
}

/** The reader's own answer for this server, or null while the automatic rule holds. */
export function serverFoldOverride(orgId: string): boolean | null {
    return load()[orgId] ?? null
}

/** The reader worked the chevron: their answer stands for this server from now on. */
export function setServerFoldOverride(orgId: string, expanded: boolean): void {
    overrides = { ...load(), [orgId]: expanded }
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
    } catch {
        // storage unavailable — the toggle still holds for this session
    }
    version += 1
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/** Re-renders the caller on every toggle; read the values with serverFoldOverride. */
export function useServerFoldVersion(): number {
    return useSyncExternalStore(subscribe, () => version)
}

/** Tests only — drops the in-memory mirror so the next read re-reads storage. */
export function resetServerFoldForTest(): void {
    overrides = null
    version += 1
}
