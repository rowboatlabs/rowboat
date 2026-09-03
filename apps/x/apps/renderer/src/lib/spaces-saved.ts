import { useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'

// Saved for later — personal bookmarks, kept on this install (localStorage,
// like the read marks). Shared pins are the 📌 reaction (on the wire, everyone
// sees them); saving is private: "I need to come back to this." The body is
// snapshotted at save time so the panel renders without a fetch — clicking
// through always shows the live message.

const KEY_PREFIX = 'spaces:saved:'

export interface SavedMessage {
    messageId: string
    /** The thread the message lives in (a root stands for its own thread). */
    threadRootId: string
    authorId: string
    body: string
    postedAt: string
    savedAt: string
}

const listeners = new Set<() => void>()
const cache = new Map<string, SavedMessage[]>()

function key(orgId: string, spaceId: string): string {
    return `${KEY_PREFIX}${orgId}/${spaceId}`
}

function emit(): void {
    for (const l of listeners) l()
}

export function getSaved(orgId: string, spaceId: string): SavedMessage[] {
    const k = key(orgId, spaceId)
    const cached = cache.get(k)
    if (cached) return cached
    let list: SavedMessage[] = []
    try {
        const raw = window.localStorage.getItem(k)
        if (raw) list = JSON.parse(raw) as SavedMessage[]
    } catch {
        // corrupt/unavailable — start empty
    }
    cache.set(k, list)
    return list
}

function put(orgId: string, spaceId: string, list: SavedMessage[]): void {
    cache.set(key(orgId, spaceId), list)
    try {
        window.localStorage.setItem(key(orgId, spaceId), JSON.stringify(list))
    } catch {
        // quota/private mode — the in-memory copy still works this session
    }
    emit()
}

export function isSaved(orgId: string, spaceId: string, messageId: string): boolean {
    return getSaved(orgId, spaceId).some((s) => s.messageId === messageId)
}

/** Add when absent, remove when present. Returns the new saved state. */
export function toggleSaved(orgId: string, spaceId: string, message: spaces.Message): boolean {
    const list = getSaved(orgId, spaceId)
    if (list.some((s) => s.messageId === message.id)) {
        put(orgId, spaceId, list.filter((s) => s.messageId !== message.id))
        return false
    }
    const entry: SavedMessage = {
        messageId: message.id,
        threadRootId: message.threadRoot ?? message.id,
        authorId: message.author.memberId,
        body: message.body,
        postedAt: message.postedAt,
        savedAt: new Date().toISOString(),
    }
    put(orgId, spaceId, [entry, ...list])
    return true
}

export function removeSaved(orgId: string, spaceId: string, messageId: string): void {
    const list = getSaved(orgId, spaceId)
    if (!list.some((s) => s.messageId === messageId)) return
    put(orgId, spaceId, list.filter((s) => s.messageId !== messageId))
}

export function subscribeSaved(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/** The saved list for one space, live. */
export function useSaved(orgId: string, spaceId: string): SavedMessage[] {
    return useSyncExternalStore(subscribeSaved, () => getSaved(orgId, spaceId))
}
