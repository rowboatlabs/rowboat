import { useEffect, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// Your open sessions in an org (harbor mySessions, 2026-11-05, "coding
// session: threads" in Main): the rail's Sessions section and the /session
// picker read one list per org. Harbor decides the list and each status; the
// app refetches when a frame says something moved (a message, a mark, an
// end, an agent's state), and once a minute for spaces whose frames it is not
// subscribed to.

type Entry = { sessions: spaces.SessionListing[]; loaded: boolean }

const EMPTY: Entry = { sessions: [], loaded: false }
const REFRESH_MS = 60_000
const DEBOUNCE_MS = 500

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
const inFlight = new Map<string, Promise<void>>()
const pending = new Map<string, ReturnType<typeof setTimeout>>()

function emit(): void {
    for (const l of listeners) l()
}

export function refreshMySessions(orgId: string): Promise<void> {
    const running = inFlight.get(orgId)
    if (running) return running
    const run = window.ipc.invoke('spaces:mySessions', { orgId })
        .then(({ sessions }) => {
            entries.set(orgId, { sessions, loaded: true })
            emit()
        })
        .catch(() => {
            // An older Harbor has no route: no sessions, never an error in the rail.
            if (!entries.get(orgId)?.loaded) {
                entries.set(orgId, { sessions: [], loaded: true })
                emit()
            }
        })
        .finally(() => inFlight.delete(orgId))
    inFlight.set(orgId, run)
    return run
}

function refreshSoon(orgId: string): void {
    if (!entries.has(orgId) || pending.has(orgId)) return
    pending.set(orgId, setTimeout(() => {
        pending.delete(orgId)
        void refreshMySessions(orgId)
    }, DEBOUNCE_MS))
}

/** Frames that can change a session's place in the list or its status. */
function moves(frame: spaces.ServerFrame): boolean {
    if (frame.kind === 'read_mark' || frame.kind === 'notify' || frame.kind === 'invocation_state') return true
    if (frame.kind !== 'event') return false
    const type = frame.event.type
    return type === 'message' || type === 'thread_session' || type === 'thread_archive' || type === 'message_deleted'
}

let wired = false
function wire(): void {
    if (wired) return
    wired = true
    subscribeSpacesFeed((event) => {
        if ('frame' in event && moves(event.frame)) refreshSoon(event.orgId)
    })
}

/** The open sessions an org's member started or follows, newest activity first. */
export function useMySessions(orgId: string | null | undefined): Entry {
    const entry = useSyncExternalStore(
        (l) => {
            listeners.add(l)
            return () => listeners.delete(l)
        },
        () => (orgId ? entries.get(orgId) ?? EMPTY : EMPTY),
    )
    useEffect(() => {
        if (!orgId) return
        wire()
        if (!entries.has(orgId)) entries.set(orgId, EMPTY)
        void refreshMySessions(orgId)
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') void refreshMySessions(orgId)
        }, REFRESH_MS)
        return () => clearInterval(timer)
    }, [orgId])
    return entry
}

/**
 * One session's listing, read from what the rail already fetched: no fetch
 * of its own, so every stream row can ask. Absent = not one of yours.
 */
export function useSessionListing(orgId: string | undefined, rootMessageId: string): spaces.SessionListing | undefined {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l)
            return () => listeners.delete(l)
        },
        () => (orgId ? entries.get(orgId)?.sessions.find((s) => s.root.id === rootMessageId) : undefined),
    )
}

/** What a session's status says, in the words the rail and picker show. */
export function sessionStatusLabel(status: spaces.SessionStatus): string {
    return status === 'needs_you' ? 'Needs you' : status === 'working' ? 'Working' : 'Idle'
}
