// Per-space read marks, kept on this install (localStorage). The protocol has
// no read cursors in v0 (a Latitude item per api.ts) — until it does, "unread"
// is what moved since the member last pressed Mark read / opened the space.

const KEY_PREFIX = 'spaces:lastRead:'

const listeners = new Set<() => void>()

function key(orgId: string, spaceId: string): string {
    return `${KEY_PREFIX}${orgId}/${spaceId}`
}

export function getLastReadAt(orgId: string, spaceId: string): string | null {
    try {
        return window.localStorage.getItem(key(orgId, spaceId))
    } catch {
        return null
    }
}

export function markRead(orgId: string, spaceId: string, at: string = new Date().toISOString()): void {
    try {
        window.localStorage.setItem(key(orgId, spaceId), at)
    } catch {
        // storage unavailable — unread just stays visible
    }
    for (const listener of listeners) listener()
}

export function subscribeReadState(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

// ---------------------------------------------------------------------------
// Per-topic marks (chat-first model): general and each thread keep their own.
// ---------------------------------------------------------------------------

function topicKey(orgId: string, spaceId: string, topicId: string): string {
    return `${KEY_PREFIX}${orgId}/${spaceId}/${topicId}`
}

export function getTopicLastReadAt(orgId: string, spaceId: string, topicId: string): string | null {
    try {
        return window.localStorage.getItem(topicKey(orgId, spaceId, topicId))
    } catch {
        return null
    }
}

export function markTopicRead(orgId: string, spaceId: string, topicId: string, at: string = new Date().toISOString()): void {
    try {
        window.localStorage.setItem(topicKey(orgId, spaceId, topicId), at)
    } catch {
        // storage unavailable — unread just stays visible
    }
    for (const listener of listeners) listener()
}
