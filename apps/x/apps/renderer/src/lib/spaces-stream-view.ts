import { useSyncExternalStore } from 'react'

// How a space shows replies (2026-10-25, the threads discussion in Main):
// 'threads' is the stream of roots with reply chips and a thread pane, as it
// always was; 'inline' has no threads at all — every reply shows in the
// stream in time order under a line quoting what it answers, the way Discord
// and WhatsApp show replies. A view, not a structure: on the org a reply is a
// reply either way. Chosen per space, from the space's menu, and kept on this
// device.

export type StreamView = 'threads' | 'inline'

const PREFIX = 'spaces:streamView:'
const listeners = new Set<(orgId: string, spaceId: string) => void>()
const views = new Map<string, StreamView>()

const key = (orgId: string, spaceId: string) => `${orgId}/${spaceId}`

function read(k: string): StreamView {
    try {
        return window.localStorage.getItem(PREFIX + k) === 'inline' ? 'inline' : 'threads'
    } catch {
        return 'threads'
    }
}

export function getStreamView(orgId: string, spaceId: string): StreamView {
    const k = key(orgId, spaceId)
    let view = views.get(k)
    if (view === undefined) {
        view = read(k)
        views.set(k, view)
    }
    return view
}

export function setStreamView(orgId: string, spaceId: string, next: StreamView): void {
    if (next === getStreamView(orgId, spaceId)) return
    const k = key(orgId, spaceId)
    views.set(k, next)
    try {
        if (next === 'threads') window.localStorage.removeItem(PREFIX + k)
        else window.localStorage.setItem(PREFIX + k, next)
    } catch {
        // Quota/private mode: the choice just does not persist.
    }
    for (const listener of listeners) listener(orgId, spaceId)
}

export function subscribeStreamView(listener: (orgId: string, spaceId: string) => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function useStreamView(orgId: string, spaceId: string): StreamView {
    return useSyncExternalStore(
        (notify) => subscribeStreamView(notify),
        () => getStreamView(orgId, spaceId),
    )
}
