import { useCallback, useEffect, useSyncExternalStore } from 'react'

// Notification levels for spaces (main owns the durable store — the mention
// watcher notifies with the renderer closed). One module-level mirror shared
// by every consumer: the header menu, the rail's per-topic menus, AND the
// sidebar unread counter (muted topics don't badge), so a change anywhere
// reflects everywhere at once. Optimistic: the menu check moves immediately,
// the IPC write follows.

export type NotifyLevel = 'all' | 'mentions' | 'mute'

export interface SpaceNotifyPrefs {
    /** Space-wide level; null = the 'mentions' default. */
    spaceLevel: NotifyLevel | null
    /**
     * Per-thread overrides keyed by the thread's ROOT MESSAGE id (never a
     * Topic row id — main's watcher resolves `threadRoot ?? id`); absent =
     * inherit the space level.
     */
    topics: Record<string, NotifyLevel>
}

const EMPTY: SpaceNotifyPrefs = { spaceLevel: null, topics: {} }

let state: ReadonlyMap<string, SpaceNotifyPrefs> = new Map()
const listeners = new Set<() => void>()
const fetched = new Set<string>()

function key(orgId: string, spaceId: string): string {
    return `${orgId}/${spaceId}`
}

function emit(): void {
    for (const l of listeners) l()
}

function put(k: string, prefs: SpaceNotifyPrefs): void {
    const next = new Map(state)
    next.set(k, prefs)
    state = next
    emit()
}

/** Kick the one fetch per space (idempotent; a failure allows a retry). */
export function ensureNotifyPrefs(orgId: string, spaceId: string): void {
    const k = key(orgId, spaceId)
    if (fetched.has(k)) return
    fetched.add(k)
    void window.ipc
        .invoke('spaces:getNotifyPrefs', { orgId, spaceId })
        .then((res) => put(k, { spaceLevel: res.spaceLevel, topics: res.topics }))
        .catch(() => {
            fetched.delete(k)
        })
}

/** Non-React read (the unread counter). Defaults until the fetch lands. */
export function getNotifyPrefs(orgId: string, spaceId: string): SpaceNotifyPrefs {
    return state.get(key(orgId, spaceId)) ?? EMPTY
}

/** Topic override → space level → 'mentions'. */
export function effectiveNotifyLevel(orgId: string, spaceId: string, topicId: string): NotifyLevel {
    const prefs = getNotifyPrefs(orgId, spaceId)
    return prefs.topics[topicId] ?? prefs.spaceLevel ?? 'mentions'
}

export function subscribeNotifyPrefs(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function setSpaceNotifyLevel(orgId: string, spaceId: string, level: NotifyLevel | null): void {
    const k = key(orgId, spaceId)
    put(k, { ...getNotifyPrefs(orgId, spaceId), spaceLevel: level })
    void window.ipc.invoke('spaces:setNotifyPref', { orgId, spaceId, level }).catch(() => {})
}

export function setTopicNotifyLevel(orgId: string, spaceId: string, topicId: string, level: NotifyLevel | null): void {
    const k = key(orgId, spaceId)
    const prefs = getNotifyPrefs(orgId, spaceId)
    const topics = { ...prefs.topics }
    if (level) topics[topicId] = level
    else delete topics[topicId]
    put(k, { ...prefs, topics })
    void window.ipc.invoke('spaces:setNotifyPref', { orgId, spaceId, topicId, level }).catch(() => {})
}

export interface SpaceNotifyHandle extends SpaceNotifyPrefs {
    setSpaceLevel: (level: NotifyLevel | null) => void
    setTopicLevel: (topicId: string, level: NotifyLevel | null) => void
}

export function useSpaceNotifyPrefs(orgId: string, spaceId: string): SpaceNotifyHandle {
    useEffect(() => ensureNotifyPrefs(orgId, spaceId), [orgId, spaceId])
    const prefs = useSyncExternalStore(subscribeNotifyPrefs, () => getNotifyPrefs(orgId, spaceId))
    const setSpaceLevel = useCallback((level: NotifyLevel | null) => setSpaceNotifyLevel(orgId, spaceId, level), [orgId, spaceId])
    const setTopicLevel = useCallback(
        (topicId: string, level: NotifyLevel | null) => setTopicNotifyLevel(orgId, spaceId, topicId, level),
        [orgId, spaceId],
    )
    return { ...prefs, setSpaceLevel, setTopicLevel }
}
