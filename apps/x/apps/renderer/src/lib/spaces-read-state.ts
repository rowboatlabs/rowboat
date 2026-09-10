import { useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// Read state, org-owned (2026-09-09). The org keeps per-member cursors in
// OFFSETS — a stream mark per space, a mark per FOLLOWED thread — so every
// device agrees. This store mirrors them per org: a snapshot from
// spaces:getUnread at boot and on every resync, live frames folded on top,
// and the reader's own marks applied optimistically before the org confirms
// (sent debounced — Slack's advice: don't mark on every scroll tick). Threads
// nobody follows have no unread state at all; the org decides what follows.

export interface ThreadReadState {
    following: boolean
    readOffset: number
    /** Newest live reply's offset known to us; 0 = none. */
    lastReplyOffset: number
    /** Live replies past readOffset by others, when the org told us; null = unknown (the pane derives it). */
    unreadReplies: number | null
    /** Of those, the ones addressed to me (a mention token naming me, or @here). 0 when unknown. */
    unreadMentions: number
}

export interface SpaceReadState {
    head: number
    readOffset: number
    unreadRoots: number
    /** Of the unread roots, the ones addressed to me (a mention token naming me, or @here). Threads keep their own. */
    unreadRootMentions: number
    threads: Map<string, ThreadReadState>
}

/**
 * What a row's badge shows (the dot-and-count design, 2026-09-10): messages
 * past the marks, and how many of them are for me — mentions, or every
 * message in a DM. The badge colours its dot when `forYou` > 0 and shows that
 * figure; otherwise a grey dot and the `unread` figure. Bold = unread > 0.
 * A space row collapsed carries its stream plus every followed discussion;
 * expanded, the stream alone, each discussion row carrying its own.
 */
export interface SpaceBadge {
    unread: number
    forYou: number
}

export const NO_BADGE: Readonly<SpaceBadge> = Object.freeze({ unread: 0, forYou: 0 })

const orgs = new Map<string, Map<string, SpaceReadState>>()
const memberIds = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

function emit(): void {
    version += 1
    for (const listener of listeners) listener()
}

export function subscribeReadState(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function space(orgId: string, spaceId: string, create: true): SpaceReadState
function space(orgId: string, spaceId: string, create?: false): SpaceReadState | undefined
function space(orgId: string, spaceId: string, create = false): SpaceReadState | undefined {
    let byOrg = orgs.get(orgId)
    if (!byOrg) {
        if (!create) return undefined
        byOrg = new Map()
        orgs.set(orgId, byOrg)
    }
    let state = byOrg.get(spaceId)
    if (!state && create) {
        state = { head: 0, readOffset: 0, unreadRoots: 0, unreadRootMentions: 0, threads: new Map() }
        byOrg.set(spaceId, state)
    }
    return state
}

// --- reads ------------------------------------------------------------------

export function getSpaceReadState(orgId: string, spaceId: string): SpaceReadState | undefined {
    return space(orgId, spaceId)
}

/** The stream mark; 0 = never marked. */
export function getStreamReadOffset(orgId: string, spaceId: string): number {
    return space(orgId, spaceId)?.readOffset ?? 0
}

export function getThreadReadState(orgId: string, spaceId: string, rootMessageId: string): ThreadReadState | undefined {
    return space(orgId, spaceId)?.threads.get(rootMessageId)
}

function threadUnread(t: ThreadReadState): boolean {
    return t.following && t.lastReplyOffset > t.readOffset && (t.unreadReplies === null || t.unreadReplies > 0)
}

/** Followed, with live replies past the mark. A thread you don't follow is never unread. */
export function isThreadUnread(orgId: string, spaceId: string, rootMessageId: string): boolean {
    const t = getThreadReadState(orgId, spaceId, rootMessageId)
    return !!t && threadUnread(t)
}

/** Unread roots plus followed threads with unread replies — "something happened here". */
export function countUnread(orgId: string, spaceId: string): number {
    const s = space(orgId, spaceId)
    if (!s) return 0
    let count = s.unreadRoots
    for (const t of s.threads.values()) if (threadUnread(t)) count += 1
    return count
}

/** Unread replies a followed thread carries; null from the org = at least one. */
function threadCount(t: ThreadReadState): number {
    return threadUnread(t) ? (t.unreadReplies ?? 1) : 0
}

/** The space's stream alone: new roots, and the ones for me (every root, in a DM). */
export function streamBadge(orgId: string, spaceId: string, direct: boolean): SpaceBadge {
    const s = space(orgId, spaceId)
    if (!s || s.unreadRoots === 0) return NO_BADGE
    return { unread: s.unreadRoots, forYou: direct ? s.unreadRoots : s.unreadRootMentions }
}

/** One followed discussion: its unread replies, and the ones for me. A thread I don't follow shows nothing. */
export function threadBadge(orgId: string, spaceId: string, rootMessageId: string, direct: boolean): SpaceBadge {
    const t = getThreadReadState(orgId, spaceId, rootMessageId)
    if (!t) return NO_BADGE
    const unread = threadCount(t)
    if (unread === 0) return NO_BADGE
    return { unread, forYou: direct ? unread : Math.min(unread, t.unreadMentions) }
}

/** The collapsed space row: the stream plus every followed discussion, summed. */
export function spaceBadge(orgId: string, spaceId: string, direct: boolean): SpaceBadge {
    const s = space(orgId, spaceId)
    if (!s) return NO_BADGE
    let unread = s.unreadRoots
    let forYou = direct ? s.unreadRoots : s.unreadRootMentions
    for (const t of s.threads.values()) {
        const n = threadCount(t)
        if (n === 0) continue
        unread += n
        forYou += direct ? n : Math.min(n, t.unreadMentions)
    }
    return unread === 0 ? NO_BADGE : { unread, forYou }
}

export function useStreamReadOffset(orgId: string, spaceId: string): number {
    return useSyncExternalStore(subscribeReadState, () => getStreamReadOffset(orgId, spaceId))
}

/** Bumps on every change — for components that read the store imperatively during render. */
export function useReadStateVersion(): number {
    return useSyncExternalStore(subscribeReadState, () => version)
}

// --- the snapshot -----------------------------------------------------------

const inflight = new Map<string, Promise<void>>()
const reloadTimers = new Map<string, ReturnType<typeof setTimeout>>()
let busWired = false

/** Fetch the org's snapshot and replace what we hold (panes' knowledge of quiet followed threads survives). */
export function loadUnread(orgId: string, memberId: string): Promise<void> {
    memberIds.set(orgId, memberId)
    wireBus()
    const running = inflight.get(orgId)
    if (running) return running
    const promise = (async () => {
        try {
            const snapshot = await window.ipc.invoke('spaces:getUnread', { orgId })
            const prev = orgs.get(orgId)
            const next = new Map<string, SpaceReadState>()
            for (const s of snapshot.spaces) {
                const threads = new Map<string, ThreadReadState>()
                // The org lists only followed threads with unread replies; a
                // followed thread we learned about from its pane and that the
                // org left out is, by that omission, read.
                for (const [root, t] of prev?.get(s.spaceId)?.threads ?? []) {
                    if (t.following) threads.set(root, { ...t, unreadReplies: 0, unreadMentions: 0 })
                }
                for (const t of s.threads) {
                    threads.set(t.rootMessageId, {
                        following: true,
                        readOffset: t.readOffset,
                        lastReplyOffset: t.lastReplyOffset,
                        unreadReplies: t.unreadReplies,
                        unreadMentions: t.unreadMentions,
                    })
                }
                // The org's per-space mention count folds followed threads in;
                // the roots' share is what is left after the threads take theirs.
                let threadMentions = 0
                for (const t of s.threads) threadMentions += t.unreadMentions
                next.set(s.spaceId, {
                    head: s.head,
                    readOffset: s.readOffset,
                    unreadRoots: s.unreadRoots,
                    unreadRootMentions: Math.max(0, s.unreadMentions - threadMentions),
                    threads,
                })
            }
            orgs.set(orgId, next)
            emit()
            migrateLegacyMarks(orgId, [...next.keys()])
        } catch {
            // org unreachable — keep what we hold; the next resync retries
        } finally {
            inflight.delete(orgId)
        }
    })()
    inflight.set(orgId, promise)
    return promise
}

/** Coalesced refetch — for moments the org knows more than the fold can (partial marks, unknown threads, resyncs). */
function scheduleReload(orgId: string, delayMs = 1_500): void {
    const memberId = memberIds.get(orgId)
    if (!memberId || reloadTimers.has(orgId)) return
    reloadTimers.set(
        orgId,
        setTimeout(() => {
            reloadTimers.delete(orgId)
            void loadUnread(orgId, memberId)
        }, delayMs),
    )
}

export function forgetOrg(orgId: string): void {
    orgs.delete(orgId)
    memberIds.delete(orgId)
    const t = reloadTimers.get(orgId)
    if (t) clearTimeout(t)
    reloadTimers.delete(orgId)
    emit()
}

// --- marking ----------------------------------------------------------------

const pendingMarks = new Map<string, { timer: ReturnType<typeof setTimeout>; offset: number }>()
const MARK_DEBOUNCE_MS = 1_200

function queueMark(orgId: string, spaceId: string, threadRootId: string | undefined, offset: number): void {
    const key = `${orgId}/${spaceId}/${threadRootId ?? 'stream'}`
    const pending = pendingMarks.get(key)
    if (pending) {
        pending.offset = Math.max(pending.offset, offset)
        return
    }
    const entry = {
        offset,
        timer: setTimeout(() => {
            pendingMarks.delete(key)
            void window.ipc
                .invoke('spaces:markRead', { orgId, spaceId, ...(threadRootId ? { threadRootId } : {}), offset: entry.offset })
                .catch(() => {
                    // the org disagreed or was unreachable — the next snapshot is the truth
                })
        }, MARK_DEBOUNCE_MS),
    }
    pendingMarks.set(key, entry)
}

/**
 * The reader has seen the stream up to `offset` (the newest root on screen —
 * never head, unless marking everything). Local state moves at once; the org
 * hears about it debounced. `sync: false` = the org already knows (a post).
 */
export function markStreamRead(orgId: string, spaceId: string, offset: number, opts?: { sync?: boolean }): void {
    const s = space(orgId, spaceId, true)
    if (offset > s.head) s.head = offset
    if (offset <= s.readOffset) return
    s.readOffset = offset
    if (offset >= s.head) streamCaughtUp(s)
    else scheduleReload(orgId) // a partial read — the org recounts what's left
    emit()
    if (opts?.sync !== false) queueMark(orgId, spaceId, undefined, offset)
}

/** Every root is read; followed threads keep their own numbers. */
function streamCaughtUp(s: SpaceReadState): void {
    s.unreadRoots = 0
    s.unreadRootMentions = 0
}

/** A followed thread is read through its newest reply. */
function threadCaughtUp(t: ThreadReadState): void {
    t.unreadReplies = 0
    t.unreadMentions = 0
}

/** Same for a followed thread. A thread we don't follow takes no mark (the org would record nothing either). */
export function markThreadRead(orgId: string, spaceId: string, rootMessageId: string, offset: number, opts?: { sync?: boolean }): void {
    const s = space(orgId, spaceId)
    const t = s?.threads.get(rootMessageId)
    if (!s || !t?.following || offset <= t.readOffset) return
    t.readOffset = offset
    if (offset >= t.lastReplyOffset) threadCaughtUp(t)
    else {
        t.unreadReplies = null
        scheduleReload(orgId)
    }
    emit()
    if (opts?.sync !== false) queueMark(orgId, spaceId, rootMessageId, offset)
}

/** The stream's mark as a page read carried it (listStream) — merged, never regressed. */
export function noteStreamReadOffset(orgId: string, spaceId: string, readOffset: number): void {
    const s = space(orgId, spaceId, true)
    if (readOffset <= s.readOffset) return
    s.readOffset = readOffset
    emit()
}

/**
 * What the org said about a thread for us (listThread, or our own reply which
 * follows it): the follow flag and the mark. Merged, never regressed.
 */
export function noteThread(
    orgId: string,
    spaceId: string,
    rootMessageId: string,
    info: { following: boolean; readOffset: number | null; lastReplyOffset?: number },
): void {
    const s = space(orgId, spaceId, true)
    const prev = s.threads.get(rootMessageId)
    const readOffset = Math.max(prev?.readOffset ?? 0, info.readOffset ?? 0)
    const lastReplyOffset = Math.max(prev?.lastReplyOffset ?? 0, info.lastReplyOffset ?? 0)
    const caughtUp = !info.following || readOffset >= lastReplyOffset
    const unreadReplies = caughtUp ? 0 : (prev?.unreadReplies ?? null)
    const unreadMentions = caughtUp ? 0 : (prev?.unreadMentions ?? 0)
    s.threads.set(rootMessageId, { following: info.following, readOffset, lastReplyOffset, unreadReplies, unreadMentions })
    emit()
}

// --- the live fold ----------------------------------------------------------

function applyFrame(orgId: string, frame: spaces.ServerFrame): void {
    switch (frame.kind) {
        case 'read_mark': {
            // One of our other connections moved a mark.
            const s = space(orgId, frame.spaceId, true)
            if (frame.threadRootId !== undefined) {
                const t = s.threads.get(frame.threadRootId)
                if (!t || frame.offset <= t.readOffset) return
                t.readOffset = frame.offset
                if (frame.offset >= t.lastReplyOffset) threadCaughtUp(t)
                else scheduleReload(orgId)
            } else {
                if (frame.offset <= s.readOffset) return
                s.readOffset = frame.offset
                if (frame.offset >= s.head) streamCaughtUp(s)
                else scheduleReload(orgId)
            }
            emit()
            return
        }
        case 'space_added':
            scheduleReload(orgId, 0)
            return
        case 'subscribed':
            // A (re)subscription is the resync moment: replay may have carried
            // things we folded blind. Boot subscriptions coalesce into the
            // snapshot the orgs store already asked for.
            if (orgs.has(orgId)) scheduleReload(orgId)
            return
        case 'event': {
            const s = space(orgId, frame.spaceId, true)
            if (frame.offset > s.head) s.head = frame.offset
            const event = frame.event
            if (event.type === 'message') {
                const m = event.message
                const me = memberIds.get(orgId)
                const mine = me !== undefined && m.author.memberId === me
                const direct = m.author.actingMode === 'direct'
                // The org's stamp, never the text: does this message address me?
                const addressesMe = me !== undefined && (m.mentionsHere || m.mentions.includes(me))
                if (m.threadRoot === undefined) {
                    // A root. Ours (posted directly) read the stream up to itself.
                    if (mine) {
                        if (direct && m.offset > s.readOffset) {
                            s.readOffset = m.offset
                            streamCaughtUp(s)
                        }
                    } else if (m.offset > s.readOffset) {
                        s.unreadRoots += 1
                        if (addressesMe) s.unreadRootMentions += 1
                    }
                } else {
                    const t = s.threads.get(m.threadRoot)
                    if (t) {
                        if (m.offset > t.lastReplyOffset) t.lastReplyOffset = m.offset
                        if (mine) {
                            if (direct) {
                                t.following = true
                                if (m.offset > t.readOffset) t.readOffset = m.offset
                                threadCaughtUp(t)
                            }
                        } else if (t.following && m.offset > t.readOffset) {
                            t.unreadReplies = (t.unreadReplies ?? 0) + 1
                            if (addressesMe) t.unreadMentions += 1
                        }
                    } else if (mine && direct) {
                        // Replying follows (the org's rule); our mark rides the reply.
                        s.threads.set(m.threadRoot, { following: true, readOffset: m.offset, lastReplyOffset: m.offset, unreadReplies: 0, unreadMentions: 0 })
                    } else if (!mine) {
                        // A reply in a thread we hold nothing on: we may follow it
                        // (a root of ours at its first reply, a mention of us) — the org knows.
                        scheduleReload(orgId)
                    }
                }
                emit()
                return
            }
            if (event.type === 'message_deleted' && event.deletion.threadRoot !== undefined && s.threads.has(event.deletion.threadRoot)) {
                scheduleReload(orgId) // the newest-live-reply offset may have moved back
            }
            if (event.type === 'message_edited') {
                // An edit can add or drop a mention of me on a message already
                // counted; the org holds the truth, refetch it.
                const me = memberIds.get(orgId)
                const edit = event.edit
                if (me !== undefined && edit.by.memberId !== me && (edit.mentionsHere || edit.mentions.includes(me))) scheduleReload(orgId)
            }
            emit() // head moved
            return
        }
        default:
            return
    }
}

function wireBus(): void {
    if (busWired) return
    busWired = true
    subscribeSpacesFeed((event) => {
        if ('frame' in event) applyFrame(event.orgId, event.frame)
    })
}

// --- one-time migration off the per-install marks ---------------------------
// Until 2026-09-09 marks were localStorage timestamps on this install. On the
// first snapshot after the switch, a space the org has no mark for yet takes
// its old mark: the cached stream tail says which offset that timestamp
// reached. Then the legacy keys go — nothing reads them any more.

function migrateLegacyMarks(orgId: string, spaceIds: string[]): void {
    const flag = `spaces:readMarksMigrated:${orgId}`
    try {
        if (window.localStorage.getItem(flag)) return
    } catch {
        return
    }
    for (const spaceId of spaceIds) {
        const s = space(orgId, spaceId)
        if (!s || s.readOffset > 0) continue
        try {
            const legacy =
                window.localStorage.getItem(`spaces:lastRead:${orgId}/${spaceId}/stream`) ??
                window.localStorage.getItem(`spaces:lastRead:${orgId}/${spaceId}`)
            const cache = window.localStorage.getItem(`spaces:general:${orgId}/${spaceId}`)
            if (!legacy || !cache) continue
            const parsed = JSON.parse(cache) as { messages?: Array<{ offset: number; postedAt: string }> }
            const offset = (parsed.messages ?? []).reduce((max, m) => (m.postedAt <= legacy && m.offset > max ? m.offset : max), 0)
            if (offset > 0) markStreamRead(orgId, spaceId, offset)
        } catch {
            // a corrupt entry migrates nothing
        }
    }
    try {
        window.localStorage.setItem(flag, '1')
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
            const key = window.localStorage.key(i)
            if (key?.startsWith(`spaces:lastRead:${orgId}/`)) window.localStorage.removeItem(key)
        }
    } catch {
        // storage unavailable — nothing to clean
    }
}
