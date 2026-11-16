import { useEffect, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'

// Who replied in a thread when Harbor doesn't say (2026-10-25, "managing
// sessions" in Main: the Threads list showed only the starter). A Harbor from
// before replyAuthors parses to [] — the schema default — so a root with
// replies and no reply authors is a server that didn't tell us, never a real
// answer: a live reply always has an author. For those roots the list reads
// the thread's first page, oldest first, and takes its authors in order.

/** The oldest replies, so the first-reply order matches what Harbor would send. */
const PAGE = 200
/** Rows fetch a few at a time, so a long list doesn't fire every request at once. */
const CONCURRENCY = 4

interface Entry { replyCount: number; authors: string[] }

const known = new Map<string, Entry>()
const inFlight = new Set<string>()
const queue: { k: string; orgId: string; spaceId: string; root: spaces.Message }[] = []
const listeners = new Set<() => void>()
let version = 0

const entryKey = (orgId: string, spaceId: string, rootId: string) => `${orgId}/${spaceId}/${rootId}`

/** True when this root has replies but Harbor sent no reply authors for it. */
export function needsReplyAuthors(root: spaces.Message): boolean {
    return (root.replyCount ?? 0) > 0 && (root.replyAuthors?.length ?? 0) === 0
}

function pump(): void {
    while (inFlight.size < CONCURRENCY && queue.length > 0) {
        const { k, orgId, spaceId, root } = queue.shift()!
        inFlight.add(k)
        void window.ipc
            .invoke('spaces:listThread', { orgId, spaceId, rootMessageId: root.id, afterOffset: root.offset, limit: PAGE })
            .then((res) => {
                const authors = [...new Set(res.messages.map((m) => m.author.memberId))]
                known.set(k, { replyCount: root.replyCount ?? 0, authors })
                version++
                for (const l of listeners) l()
            })
            .catch(() => {})
            .finally(() => { inFlight.delete(k); pump() })
    }
}

/**
 * Fill in reply authors for the given roots wherever Harbor left them out,
 * and return a lookup the list reads through. A root refetches when its
 * reply count moves past what was read.
 */
export function useFallbackReplyAuthors(orgId: string, spaceId: string, roots: readonly spaces.Message[]): (root: spaces.Message) => readonly string[] {
    useSyncExternalStore(
        (l) => { listeners.add(l); return () => { listeners.delete(l) } },
        () => version,
    )
    useEffect(() => {
        for (const root of roots) {
            if (!needsReplyAuthors(root)) continue
            const k = entryKey(orgId, spaceId, root.id)
            if (inFlight.has(k) || queue.some((q) => q.k === k)) continue
            if ((known.get(k)?.replyCount ?? -1) >= (root.replyCount ?? 0)) continue
            queue.push({ k, orgId, spaceId, root })
        }
        pump()
    }, [orgId, spaceId, roots])
    return (root) => needsReplyAuthors(root) ? known.get(entryKey(orgId, spaceId, root.id))?.authors ?? [] : root.replyAuthors ?? []
}

/** Tests only: forget what was read. */
export function resetFallbackReplyAuthors(): void {
    known.clear()
    inFlight.clear()
    queue.length = 0
    version = 0
}
