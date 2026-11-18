import { useEffect, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// Your threads in an org (harbor myThreads, 2026-11-05, "coding session:
// threads" in Main): the rail's Threads row and page, and the /session
// picker, read one list per org; sessions are the ones marked. Harbor decides
// the list and each status; the app refetches when a frame says something
// moved (a message, a mark, an end, an agent's state), and once a minute for
// spaces whose frames it is not subscribed to.

type Entry = { threads: spaces.ThreadListing[]; loaded: boolean }

const EMPTY: Entry = { threads: [], loaded: false }
const REFRESH_MS = 60_000
const DEBOUNCE_MS = 500

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
const inFlight = new Map<string, Promise<void>>()
const pending = new Map<string, ReturnType<typeof setTimeout>>()

function emit(): void {
    for (const l of listeners) l()
}

export function refreshMyThreads(orgId: string): Promise<void> {
    const running = inFlight.get(orgId)
    if (running) return running
    const run = window.ipc.invoke('spaces:myThreads', { orgId })
        .then(({ threads }) => {
            entries.set(orgId, { threads, loaded: true })
            emit()
        })
        .catch(() => {
            // An older Harbor has no route: an empty list, never an error in the rail.
            if (!entries.get(orgId)?.loaded) {
                entries.set(orgId, { threads: [], loaded: true })
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
        void refreshMyThreads(orgId)
    }, DEBOUNCE_MS))
}

/** Frames that can change a thread's place in the list or its status. */
function moves(frame: spaces.ServerFrame): boolean {
    if (frame.kind === 'read_mark' || frame.kind === 'notify' || frame.kind === 'invocation_state') return true
    if (frame.kind !== 'event') return false
    const type = frame.event.type
    return type === 'message' || type === 'thread_session' || type === 'thread_archive' || type === 'message_deleted' || type === 'topic' || type === 'topic_removed'
}

let wired = false
function wire(): void {
    if (wired) return
    wired = true
    subscribeSpacesFeed((event) => {
        if ('frame' in event && moves(event.frame)) refreshSoon(event.orgId)
    })
}

/** The active threads an org's member started or follows, newest activity first. */
export function useMyThreads(orgId: string | null | undefined): Entry {
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
        void refreshMyThreads(orgId)
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') void refreshMyThreads(orgId)
        }, REFRESH_MS)
        return () => clearInterval(timer)
    }, [orgId])
    return entry
}

/** The sessions among your threads: the /session picker's list. */
export function sessionsOf(threads: readonly spaces.ThreadListing[]): spaces.ThreadListing[] {
    return threads.filter((t) => t.root.session)
}

/** How many of your threads need you: the rail row's number. */
export function needsYouCount(threads: readonly spaces.ThreadListing[]): number {
    return threads.filter((t) => t.status === 'needs_you').length
}

/**
 * One thread's listing, read from what the rail already fetched: no fetch
 * of its own, so every stream row can ask. Absent = not one of yours.
 */
export function useThreadListing(orgId: string | undefined, rootMessageId: string): spaces.ThreadListing | undefined {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l)
            return () => listeners.delete(l)
        },
        () => (orgId ? entries.get(orgId)?.threads.find((t) => t.root.id === rootMessageId) : undefined),
    )
}

/** What a thread's status says, in the words the page and picker show. */
export function threadStatusLabel(status: spaces.ThreadStatus): string {
    return status === 'needs_you' ? 'Needs you' : status === 'working' ? 'Working' : 'Idle'
}
