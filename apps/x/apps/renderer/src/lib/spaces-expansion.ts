import { useSyncExternalStore } from 'react'

// Which spaces are showing their discussions. Kept per session, keyed by
// org/space, so a space row's own chevron and the rail's expand-all control
// read and write one truth instead of each holding its own useState.

const listeners = new Set<() => void>()
let version = 0

const storageKey = (orgId: string, spaceId: string) => `spaces:spaceExpanded:${orgId}/${spaceId}`

function emit(): void {
    version += 1
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function isSpaceExpanded(orgId: string, spaceId: string): boolean {
    return sessionStorage.getItem(storageKey(orgId, spaceId)) === 'true'
}

/** One space, from its own chevron. */
export function setSpaceExpanded(orgId: string, spaceId: string, expanded: boolean): void {
    sessionStorage.setItem(storageKey(orgId, spaceId), String(expanded))
    emit()
}

/** Every space in one go, from the rail's expand-all / collapse-all. */
export function setSpacesExpanded(orgId: string, spaceIds: readonly string[], expanded: boolean): void {
    for (const spaceId of spaceIds) sessionStorage.setItem(storageKey(orgId, spaceId), String(expanded))
    emit()
}

/** Re-renders the caller on any expansion change; read the value with isSpaceExpanded. */
export function useSpaceExpansionVersion(): number {
    return useSyncExternalStore(subscribe, () => version)
}
