import { useSyncExternalStore } from 'react'

// The Replicas agent's member ids, learned from the Space's Replicas config —
// never from a display name, which any agent could share.
const ids = new Set<string>()
const listeners = new Set<() => void>()

export function markReplicasMember(id: string): void {
    if (ids.has(id)) return
    ids.add(id)
    for (const listener of listeners) listener()
}

export function isReplicasMember(id: string | null | undefined): boolean {
    return !!id && ids.has(id)
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export function useIsReplicasMember(id: string | null | undefined): boolean {
    return useSyncExternalStore(subscribe, () => isReplicasMember(id))
}
