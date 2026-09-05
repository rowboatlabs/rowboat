import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'
import { applyReaction, mergeMessages, threadRootOf } from '@/lib/spaces-conventions'
import { applyPollVote } from '@/lib/spaces-poll'
import { feedSyncedRecently, getSpaceFeed, getSpacesOrgs, refreshSpaceFeed, subscribeOrgs, subscribeSpaceFeedStore, useSpaceLive } from '@/hooks/use-spaces'
import { effectiveNotifyLevel, ensureNotifyPrefs, subscribeNotifyPrefs } from '@/hooks/use-spaces-notify'
import { getTopicLastReadAt, subscribeReadState } from '@/lib/spaces-read-state'

// Chat stores for one space under the annotation model (spec §7, 2026-09-01):
//   stream     — the space's ROOT messages (one flat log; replies live behind
//                reply chips), plus the topic annotations for loaded roots
//   presence   — who is here / typing / whose agent is working, from ephemeral frames
// All module-level, keyed by `${orgId}/${spaceId}`, exposed through hooks.

function key(orgId: string, spaceId: string): string {
    return `${orgId}/${spaceId}`
}

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

/**
 * A message as chat surfaces hold it: the wire shape plus optimistic-send
 * state. `pending` renders the instant Enter lands and clears when the org's
 * write confirms; `failed` keeps the row with retry/discard. Client-only —
 * never on the wire.
 */
export type ChatMessage = spaces.Message & { pending?: boolean; failed?: boolean }

let pendingSeq = 0

/** A local echo of a send: a temp id no ULID collides with, sorted after every server offset. */
export function buildPendingMessage(spaceId: string, memberId: string, body: string, threadRoot?: string): ChatMessage {
    pendingSeq += 1
    return {
        id: `pending-${pendingSeq}-${Date.now()}`,
        spaceId,
        ...(threadRoot !== undefined ? { threadRoot } : {}),
        author: { memberId, actingMode: 'direct' },
        body,
        postedAt: new Date().toISOString(),
        offset: Number.MAX_SAFE_INTEGER - 1_000_000 + pendingSeq,
        replyCount: 0,
        reactions: [],
        pending: true,
    }
}

export interface StreamState {
    /** The loaded window of ROOTS (newest page first; older pages prepend on demand) plus optimistic rows. */
    messages: ChatMessage[]
    /** Topic annotations for loaded roots, by rootMessageId. */
    topicsByRoot: ReadonlyMap<string, spaces.Topic>
    /** Older roots exist below the loaded window (scroll up to load them). */
    hasMore: boolean
    /** An older page is on its way. */
    loadingOlder: boolean
    /** True once the first page landed (or the cached tail painted). */
    ready: boolean
    /** Set when the load failed (org unreachable, not a member …). */
    error?: string
}

const EMPTY_STREAM: StreamState = { messages: [], topicsByRoot: new Map(), hasMore: false, loadingOlder: false, ready: false }

let streamState: ReadonlyMap<string, StreamState> = new Map()
const streamListeners = new Set<() => void>()
const streamLoading = new Set<string>()

function emitStream(): void {
    for (const l of streamListeners) l()
}
function setStream(k: string, patch: Partial<StreamState>): void {
    const next = new Map(streamState)
    next.set(k, { ...(streamState.get(k) ?? EMPTY_STREAM), ...patch })
    streamState = next
    persistStream(k)
    emitStream()
}

/** Fold a page's topic rows into the per-root map (annotation removed = caller deletes). */
function withTopics(current: ReadonlyMap<string, spaces.Topic>, incoming: spaces.Topic[]): ReadonlyMap<string, spaces.Topic> {
    if (incoming.length === 0) return current
    const next = new Map(current)
    for (const t of incoming) next.set(t.rootMessageId, t)
    return next
}

// ---------------------------------------------------------------------------
// Cold-open cache — the tail of the stream, persisted per install
// (localStorage, like the read marks). Opening a space paints the cached tail
// immediately; the network fetch still runs and merges over it, so the paint
// is stale for a round trip at most.
// ---------------------------------------------------------------------------

// v2: the annotation model (v1 cached the container world — ignored, rebuilt).
const CACHE_VERSION = 2
/** Enough settled rows to fill the first screen well past the render cap. */
const CACHE_TAIL = 60

function cacheKey(k: string): string {
    return `spaces:general:${k}`
}

interface StreamCache {
    v: number
    messages: spaces.Message[]
    topics: spaces.Topic[]
    hasMore: boolean
}

function persistStream(k: string): void {
    const state = streamState.get(k)
    if (!state?.ready || state.error) return
    const settled = state.messages.filter((m) => !m.pending && !m.failed)
    if (settled.length === 0) return
    const tail = settled.slice(-CACHE_TAIL)
    const payload: StreamCache = {
        v: CACHE_VERSION,
        messages: tail,
        topics: tail.map((m) => state.topicsByRoot.get(m.id)).filter((t): t is spaces.Topic => !!t),
        hasMore: state.hasMore || tail.length < settled.length,
    }
    try {
        window.localStorage.setItem(cacheKey(k), JSON.stringify(payload))
    } catch {
        // Best-effort (quota, private mode) — cold opens just fetch.
    }
}

/** Keys painted from the cache and not yet confirmed by the org. */
const streamCacheOnly = new Set<string>()

/**
 * Seed module state from the persisted cache. Render-safe on purpose: it
 * swaps the snapshot WITHOUT notifying listeners, so useStream can call it
 * during render and the space's very first frame already holds messages —
 * no loading commit at all. Already-mounted subscribers catch up on the next
 * emit (the network fetch right behind it). Idempotent once state exists.
 */
function hydrateStream(k: string): void {
    if (streamState.has(k)) return
    try {
        const raw = window.localStorage.getItem(cacheKey(k))
        if (!raw) return
        const cached = JSON.parse(raw) as StreamCache
        if (cached.v !== CACHE_VERSION || !Array.isArray(cached.messages)) return
        streamCacheOnly.add(k)
        const next = new Map(streamState)
        next.set(k, {
            ...EMPTY_STREAM,
            messages: cached.messages,
            topicsByRoot: new Map((cached.topics ?? []).map((t) => [t.rootMessageId, t])),
            hasMore: cached.hasMore,
            ready: true,
        })
        streamState = next
    } catch {
        // A corrupt entry paints nothing; the fetch rebuilds it.
    }
}

/**
 * Warm a space's chat before it opens (the sidebar calls this on hover):
 * hydrate the cached tail into module state and start the network refresh,
 * so the click that follows finds everything already in.
 */
export function prefetchStream(orgId: string, spaceId: string): void {
    const k = key(orgId, spaceId)
    hydrateStream(k)
    const current = streamState.get(k)
    if (!current?.ready || streamCacheOnly.has(k)) void loadStream(orgId, spaceId)
}

async function loadStream(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    if (streamLoading.has(k)) return
    streamLoading.add(k)
    try {
        // The latest page (the server windows newest-first). A refetch merges:
        // older pages the reader scrolled to stay put, hasMore keeps describing
        // OUR oldest edge, and optimistic pending/failed rows the response
        // doesn't already contain are carried over.
        const res = await window.ipc.invoke('spaces:listStream', { orgId, spaceId })
        const prev = streamState.get(k)
        const settled = (prev?.messages ?? []).filter((m) => !m.pending && !m.failed)
        const carried = (prev?.messages ?? []).filter(
            (m) => (m.pending || m.failed) && !res.messages.some((r) => r.author.memberId === m.author.memberId && r.body === m.body),
        )
        const reachesDeeper = (settled[0]?.offset ?? Infinity) < (res.messages[0]?.offset ?? Infinity)
        streamCacheOnly.delete(k)
        setStream(k, {
            messages: [...mergeMessages(settled, res.messages), ...carried],
            topicsByRoot: withTopics(prev?.topicsByRoot ?? new Map(), res.topics),
            hasMore: reachesDeeper && prev ? prev.hasMore : res.hasMore,
            ready: true,
            // A fresh page clears an old failure (the merge would keep it).
            error: undefined,
        })
    } catch (err) {
        // The attempt settled either way — a cached paint with an error badge
        // behaves like today's error state; the reconnect resync retries.
        streamCacheOnly.delete(k)
        setStream(k, { ready: true, error: err instanceof Error ? err.message : String(err) })
    } finally {
        streamLoading.delete(k)
    }
}

const olderLoading = new Set<string>()

/** Scroll-up pagination: fetch the page below the loaded window and prepend it. */
export async function loadOlderStreamMessages(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    const oldest = state?.messages.find((m) => !m.pending && !m.failed)
    if (!oldest || !state?.hasMore || olderLoading.has(k)) return
    olderLoading.add(k)
    setStream(k, { loadingOlder: true })
    try {
        const res = await window.ipc.invoke('spaces:listStream', { orgId, spaceId, beforeOffset: oldest.offset })
        const cur = streamState.get(k)
        setStream(k, {
            messages: mergeMessages(cur?.messages ?? [], res.messages),
            topicsByRoot: withTopics(cur?.topicsByRoot ?? new Map(), res.topics),
            hasMore: res.hasMore,
            loadingOlder: false,
        })
    } catch {
        setStream(k, { loadingOlder: false })
    } finally {
        olderLoading.delete(k)
    }
}

/** Replace one stream message in place (e.g. the folded result of a reaction toggle). */
export function updateStreamMessage(orgId: string, spaceId: string, message: spaces.Message): void {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    if (!state?.messages.some((m) => m.id === message.id)) return
    setStream(k, { messages: state.messages.map((m) => (m.id === message.id ? message : m)) })
}

/**
 * A ROOT message lands in the store. The live bus and post handlers both come
 * here: a post handler echoes its own HTTP result IMMEDIATELY (the WS event
 * may be seconds away — or the socket half-open after sleep, in which case it
 * never comes) and the dedupe makes whichever copy arrives second a no-op.
 */
export function ingestStreamMessage(orgId: string, spaceId: string, message: spaces.Message): void {
    if (message.threadRoot !== undefined) return
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    if (!state) return
    if (state.messages.some((m) => m.id === message.id)) return
    // The live frame can beat our own HTTP response: an arriving copy of an
    // optimistic send replaces its pending row instead of doubling it. (A
    // pending row being ADDED never matches — sending the same text twice is
    // two messages.)
    const echoed =
        message.author.actingMode === 'direct' && !(message as ChatMessage).pending
            ? state.messages.find((m) => m.pending && !m.threadRoot && m.author.memberId === message.author.memberId && m.body === message.body)
            : undefined
    const rest = echoed ? state.messages.filter((m) => m.id !== echoed.id) : state.messages
    setStream(k, { messages: [...rest, message].sort((a, b) => a.offset - b.offset) })
}

/** A reply landed somewhere: bump its root's chip denorm in place (no refetch). */
function noteReplyActivity(orgId: string, spaceId: string, reply: spaces.Message): void {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    const rootId = reply.threadRoot
    if (!state || !rootId) return
    const root = state.messages.find((m) => m.id === rootId)
    if (!root) return
    setStream(k, {
        messages: state.messages.map((m) =>
            m.id === rootId ? { ...m, replyCount: (m.replyCount ?? 0) + 1, lastReplyAt: reply.postedAt } : m,
        ),
    })
}

/** The write confirmed: swap the pending row for the org's message (a no-op side if the live frame landed it first). */
export function resolvePendingStreamMessage(orgId: string, spaceId: string, pendingId: string, message: spaces.Message): void {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    if (!state) return
    const rest = state.messages.filter((m) => m.id !== pendingId)
    setStream(k, {
        messages: rest.some((m) => m.id === message.id) ? rest : [...rest, message].sort((a, b) => a.offset - b.offset),
    })
}

/** The write failed: the row stays, marked, with retry/discard in the stream. */
export function failPendingStreamMessage(orgId: string, spaceId: string, pendingId: string): void {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    if (!state?.messages.some((m) => m.id === pendingId)) return
    setStream(k, { messages: state.messages.map((m) => (m.id === pendingId ? { ...m, pending: false, failed: true } : m)) })
}

/** Drop a message row outright (discarding a failed send, or re-sending it). */
export function removeStreamMessage(orgId: string, spaceId: string, messageId: string): void {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    if (!state?.messages.some((m) => m.id === messageId)) return
    setStream(k, { messages: state.messages.filter((m) => m.id !== messageId) })
}

/** Fold a topic annotation change in (create/retitle/archive from any surface or the live bus). */
export function ingestTopic(orgId: string, spaceId: string, topic: spaces.Topic): void {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    if (!state) return
    setStream(k, { topicsByRoot: withTopics(state.topicsByRoot, [topic]) })
}

/** The annotation was removed ("convert back to thread") — the root stays, the badge goes. */
export function removeTopicByRoot(orgId: string, spaceId: string, rootMessageId: string): void {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    if (!state?.topicsByRoot.has(rootMessageId)) return
    const next = new Map(state.topicsByRoot)
    next.delete(rootMessageId)
    setStream(k, { topicsByRoot: next })
}

async function ensureStream(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    // Paint the cached tail first — a cold open shows messages while the
    // network round-trips.
    hydrateStream(k)
    const current = streamState.get(k)
    if (!current?.ready || streamCacheOnly.has(k)) await loadStream(orgId, spaceId)
}

let busWired = false
function wireBus(): void {
    if (busWired) return
    busWired = true
    subscribeSpacesFeed((event) => {
        const frame = event.frame
        if (frame.kind === 'subscribed') {
            // A (re)connected subscription. Whatever was published while the
            // socket was dead may be gone for good (a subscription that never
            // saw an event resumes live-only, with no offset to replay from) —
            // resync the HTTP views so the stream is whole again. The BOOT
            // subscribe is exempt: it lands right behind the store's own first
            // fetch, and resyncing then just doubles every request.
            if (feedSyncedRecently(event.orgId, frame.spaceId)) return
            const k = key(event.orgId, frame.spaceId)
            void refreshSpaceFeed(event.orgId, frame.spaceId)
            if (streamState.get(k)?.ready) void loadStream(event.orgId, frame.spaceId)
            return
        }
        if (frame.kind !== 'event') return
        const k = key(event.orgId, frame.spaceId)
        const state = streamState.get(k)
        if (!state) return
        if (frame.event.type === 'message') {
            const message = frame.event.message
            if (message.threadRoot === undefined) {
                ingestStreamMessage(event.orgId, frame.spaceId, message)
            } else {
                // Cache the body first (while the chip denorm still reflects
                // the count BEFORE this reply), then bump the chip.
                ingestThreadReply(event.orgId, frame.spaceId, message)
                noteReplyActivity(event.orgId, frame.spaceId, message)
            }
        } else if (frame.event.type === 'topic') {
            ingestTopic(event.orgId, frame.spaceId, frame.event.topic)
        } else if (frame.event.type === 'topic_removed') {
            removeTopicByRoot(event.orgId, frame.spaceId, frame.event.removal.rootMessageId)
        } else if (frame.event.type === 'reaction') {
            // Fold the toggle into the message in place (thread panes refetch on
            // their own tick; the stream keeps its messages live here). The
            // viewer's own toggles are EXCLUDED: those reconcile through their
            // HTTP response, and this echo can arrive seconds later — folding
            // it would resurrect a reaction the optimistic remove just cleared.
            const { reaction, action } = frame.event
            const selfId = getSpacesOrgs().find((o) => o.id === event.orgId)?.memberId
            if (reaction.by.memberId === selfId) return
            if (state.messages.some((m) => m.id === reaction.messageId)) {
                setStream(k, {
                    messages: state.messages.map((m) =>
                        m.id === reaction.messageId
                            ? { ...m, reactions: applyReaction(m.reactions, { emoji: reaction.emoji, memberId: reaction.by.memberId, action }) }
                            : m,
                    ),
                })
            }
        } else if (frame.event.type === 'poll_vote') {
            // Fold like reactions — and like them, the viewer's own toggles
            // are EXCLUDED (they reconcile through their HTTP response; a
            // late echo would fight the optimistic fold).
            const { vote, action } = frame.event
            const selfId = getSpacesOrgs().find((o) => o.id === event.orgId)?.memberId
            if (vote.by.memberId === selfId) return
            if (state.messages.some((m) => m.id === vote.messageId)) {
                setStream(k, {
                    messages: state.messages.map((m) =>
                        m.id === vote.messageId && m.poll
                            ? { ...m, poll: applyPollVote(m.poll, { answerId: vote.answerId, memberId: vote.by.memberId, action }) }
                            : m,
                    ),
                })
            }
        } else if (frame.event.type === 'poll_ended') {
            // Idempotent stamp — own ends included, like edits.
            const { end } = frame.event
            if (state.messages.some((m) => m.id === end.messageId)) {
                setStream(k, {
                    messages: state.messages.map((m) =>
                        m.id === end.messageId && m.poll ? { ...m, poll: { ...m.poll, endedAt: end.at } } : m,
                    ),
                })
            }
        } else if (frame.event.type === 'message_edited') {
            // Rewrite in place. Own edits are NOT excluded (unlike reactions):
            // the fold is idempotent — re-applying the same body is harmless.
            const { edit } = frame.event
            if (state.messages.some((m) => m.id === edit.messageId)) {
                setStream(k, {
                    messages: state.messages.map((m) =>
                        m.id === edit.messageId ? { ...m, body: edit.body, editedAt: edit.at } : m,
                    ),
                })
            }
        } else if (frame.event.type === 'message_deleted') {
            // Tombstone in place — the row stays (threads may hang under it),
            // the body is gone. Thread panes pick theirs up on their own tick.
            // The org redacts a poll with the body (and drops its votes) —
            // mirror it, so a refetch never disagrees with the live fold.
            const { deletion } = frame.event
            if (state.messages.some((m) => m.id === deletion.messageId)) {
                setStream(k, {
                    messages: state.messages.map((m) => {
                        if (m.id !== deletion.messageId) return m
                        const tombstone = { ...m, body: '', deletedAt: deletion.at }
                        delete tombstone.poll
                        return tombstone
                    }),
                })
            }
        }
    })
    // Feed store changes (the topics rail list) → fold annotations for loaded roots.
    subscribeSpaceFeedStore(() => {
        for (const k of watched) {
            const [orgId, spaceId] = k.split('/') as [string, string]
            const feed = getSpaceFeed(orgId, spaceId)
            const state = streamState.get(k)
            if (!feed.loaded || !state) continue
            // The rail list is the annotation truth: fold rows in AND drop the
            // ones it no longer has (removed elsewhere while we were away).
            const next = new Map<string, spaces.Topic>()
            for (const t of feed.topics) next.set(t.rootMessageId, t)
            const changed =
                next.size !== state.topicsByRoot.size ||
                [...next.entries()].some(([root, t]) => {
                    const cur = state.topicsByRoot.get(root)
                    return !cur || cur.title !== t.title || cur.archived !== t.archived
                })
            if (changed) setStream(k, { topicsByRoot: next })
        }
    })
}

const watched = new Set<string>()

/** The stream for one space: roots + annotations, kept live. */
export function useStream(orgId: string, spaceId: string): StreamState {
    // Before the snapshot read, not in an effect: a space with a persisted
    // tail must paint messages in its FIRST frame (the Slack feel). The call
    // is idempotent and never emits, so it is safe during render.
    hydrateStream(key(orgId, spaceId))
    const state = useSyncExternalStore(
        (l) => {
            streamListeners.add(l)
            return () => {
                streamListeners.delete(l)
            }
        },
        () => streamState,
    )
    useEffect(() => {
        wireBus()
        const k = key(orgId, spaceId)
        watched.add(k)
        void ensureStream(orgId, spaceId)
        return () => {
            watched.delete(k)
        }
    }, [orgId, spaceId])
    return state.get(key(orgId, spaceId)) ?? EMPTY_STREAM
}

// ---------------------------------------------------------------------------
// Thread cache — the replies behind each chip. ThreadPane owns its working
// copy (optimistic sends, edits and votes fold into its local state), so this
// is not a live store: it is what lets a thread PAINT before its fetch lands.
// The pane seeds from here on mount and writes back what it settles; live
// replies land here even while no pane is open (they used to be dropped after
// bumping the chip, and re-fetched on every open); hovering a chip warms it.
// Persisted per space (bounded) like the stream's tail.
// ---------------------------------------------------------------------------

export interface ThreadSnapshot {
    root: spaces.Message
    topic: spaces.Topic | null
    /** Settled replies only — pending/failed rows never cache. */
    messages: spaces.Message[]
    hasMore: boolean
    /** Grafted from live replies without a full fetch — earlier replies may be missing. */
    partial?: boolean
}

const THREAD_CACHE_VERSION = 1
/** Most-recently-touched threads persisted per space. */
const THREAD_CACHE_MAX = 10
/** Newest replies kept per persisted thread. */
const THREAD_CACHE_TAIL = 30
/** Hover fires often — one warm fetch per thread per half-minute is plenty. */
const THREAD_PREFETCH_MIN_MS = 30_000

interface ThreadCacheEntry { snapshot: ThreadSnapshot; touchedAt: number }
interface ThreadsCache { v: number; threads: Record<string, ThreadCacheEntry> }

function threadCacheKey(k: string): string {
    return `spaces:threads:${k}`
}

/** `${orgId}/${spaceId}` → rootMessageId → cached thread. */
const threadCaches = new Map<string, Map<string, ThreadCacheEntry>>()
const threadsHydrated = new Set<string>()
const threadPrefetching = new Set<string>()
const threadFetchedAt = new Map<string, number>()

/** Seed a space's thread cache from the persisted copy. Render-safe: no emits, idempotent. */
function hydrateThreads(k: string): void {
    if (threadsHydrated.has(k)) return
    threadsHydrated.add(k)
    try {
        const raw = window.localStorage.getItem(threadCacheKey(k))
        if (!raw) return
        const cached = JSON.parse(raw) as ThreadsCache
        if (cached.v !== THREAD_CACHE_VERSION || typeof cached.threads !== 'object' || cached.threads === null) return
        threadCaches.set(k, new Map(Object.entries(cached.threads)))
    } catch {
        // A corrupt entry paints nothing; opens just fetch.
    }
}

function threadSpaceCache(k: string): Map<string, ThreadCacheEntry> {
    hydrateThreads(k)
    let cache = threadCaches.get(k)
    if (!cache) {
        cache = new Map()
        threadCaches.set(k, cache)
    }
    return cache
}

function persistThreads(k: string): void {
    const cache = threadCaches.get(k)
    if (!cache) return
    const kept = [...cache.entries()].sort((a, b) => b[1].touchedAt - a[1].touchedAt).slice(0, THREAD_CACHE_MAX)
    const threads: Record<string, ThreadCacheEntry> = {}
    for (const [rootId, entry] of kept) {
        const tail = entry.snapshot.messages.slice(-THREAD_CACHE_TAIL)
        threads[rootId] = {
            touchedAt: entry.touchedAt,
            snapshot: {
                ...entry.snapshot,
                messages: tail,
                // A truncated tail reaches less deep than what was loaded.
                hasMore: entry.snapshot.hasMore || tail.length < entry.snapshot.messages.length,
            },
        }
    }
    try {
        window.localStorage.setItem(threadCacheKey(k), JSON.stringify({ v: THREAD_CACHE_VERSION, threads } satisfies ThreadsCache))
    } catch {
        // Best-effort (quota, private mode) — cold opens just fetch.
    }
}

/** The cached thread behind a chip, if any — ThreadPane seeds from this so opening paints instantly. */
export function getThreadSnapshot(orgId: string, spaceId: string, rootMessageId: string): ThreadSnapshot | undefined {
    return threadSpaceCache(key(orgId, spaceId)).get(rootMessageId)?.snapshot
}

/** ThreadPane writes back what it settled (prefetch writes too); the next open paints from it. */
export function putThreadSnapshot(orgId: string, spaceId: string, rootMessageId: string, snapshot: ThreadSnapshot): void {
    const k = key(orgId, spaceId)
    threadSpaceCache(k).set(rootMessageId, { snapshot, touchedAt: Date.now() })
    // A full snapshot counts as a fetch for the hover-prefetch throttle.
    if (!snapshot.partial) threadFetchedAt.set(`${k}/${rootMessageId}`, Date.now())
    persistThreads(k)
}

/**
 * Warm a thread before it opens (hovering its chip calls this): fetch the
 * newest page into the cache, so the click that follows paints everything.
 * Throttled — hover is a noisy signal.
 */
export function prefetchThread(orgId: string, spaceId: string, rootMessageId: string): void {
    const k = key(orgId, spaceId)
    const tk = `${k}/${rootMessageId}`
    if (threadPrefetching.has(tk)) return
    if (Date.now() - (threadFetchedAt.get(tk) ?? 0) < THREAD_PREFETCH_MIN_MS) return
    threadPrefetching.add(tk)
    void window.ipc
        .invoke('spaces:listThread', { orgId, spaceId, rootMessageId })
        .then((res) => {
            putThreadSnapshot(orgId, spaceId, rootMessageId, {
                root: res.root,
                topic: res.topic ?? null,
                messages: res.messages,
                hasMore: res.hasMore,
            })
        })
        .catch(() => {})
        .finally(() => threadPrefetching.delete(tk))
}

/**
 * A reply streamed in over the live bus: keep the body. Into the cached
 * snapshot when the thread has one; otherwise grafted onto the stream's copy
 * of the root as a PARTIAL snapshot, so even a first open paints this reply
 * while its fetch runs.
 */
function ingestThreadReply(orgId: string, spaceId: string, reply: spaces.Message): void {
    const rootId = reply.threadRoot
    if (!rootId) return
    const k = key(orgId, spaceId)
    const cache = threadSpaceCache(k)
    const entry = cache.get(rootId)
    if (entry) {
        if (entry.snapshot.messages.some((m) => m.id === reply.id)) return
        cache.set(rootId, {
            touchedAt: Date.now(),
            snapshot: { ...entry.snapshot, messages: mergeMessages(entry.snapshot.messages, [reply]) },
        })
    } else {
        const state = streamState.get(k)
        const root = state?.messages.find((m) => m.id === rootId)
        if (!root || root.pending || root.failed) return
        cache.set(rootId, {
            touchedAt: Date.now(),
            snapshot: {
                root,
                topic: state?.topicsByRoot.get(rootId) ?? null,
                messages: [reply],
                // Replies before this one may exist below the graft.
                hasMore: (root.replyCount ?? 0) > 0,
                partial: true,
            },
        })
    }
    persistThreads(k)
}

// ---------------------------------------------------------------------------
// Presence — ephemeral frames folded into "here", "typing", "agent working".
// Leases: senders renew, we prune (humans 45s, agents 30s).
// ---------------------------------------------------------------------------

export interface SpacePresence {
    /** Members with a live viewing/typing lease anywhere in the space. */
    here: string[]
    /** threadRootId ('' = the stream) → members typing there. */
    typing: ReadonlyMap<string, string[]>
    /** threadRootId → members whose agent holds an agent_working lease there. */
    working: ReadonlyMap<string, string[]>
}

const HUMAN_TTL_MS = 45_000
const AGENT_TTL_MS = 30_000

interface Lease { state: 'viewing' | 'typing' | 'agent_working'; threadRootId: string; at: number }

const EMPTY_PRESENCE: SpacePresence = { here: [], typing: new Map(), working: new Map() }

function foldLeases(leases: Map<string, Lease>, selfMemberId: string): SpacePresence {
    const here = new Set<string>()
    const typing = new Map<string, string[]>()
    const working = new Map<string, string[]>()
    for (const [k, lease] of leases) {
        const memberId = k.slice(0, k.indexOf('|'))
        if (lease.state === 'agent_working') {
            working.set(lease.threadRootId, [...(working.get(lease.threadRootId) ?? []), memberId])
            continue
        }
        here.add(memberId)
        if (lease.state === 'typing' && memberId !== selfMemberId) typing.set(lease.threadRootId, [...(typing.get(lease.threadRootId) ?? []), memberId])
    }
    return { here: [...here], typing, working }
}

export function useSpacePresence(orgId: string, spaceId: string, selfMemberId: string): SpacePresence {
    const leasesRef = useRef<Map<string, Lease>>(new Map())
    const [presence, setPresence] = useState<SpacePresence>(EMPTY_PRESENCE)

    useSpaceLive(orgId, spaceId, (frame) => {
        if (frame.kind !== 'presence') return
        const leases = leasesRef.current
        // Human and agent leases are independent per (member, thread) — the frame's
        // state says which one this is (agent_working/agent_idle vs the rest).
        const agent = frame.state === 'agent_working' || frame.state === 'agent_idle'
        const k = `${frame.memberId}|${frame.threadRootId ?? ''}|${agent ? 'agent' : 'human'}`
        if (frame.state === 'idle' || frame.state === 'agent_idle') leases.delete(k)
        else leases.set(k, { state: frame.state, threadRootId: frame.threadRootId ?? '', at: Date.now() })
        setPresence(foldLeases(leases, selfMemberId))
    })

    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now()
            let changed = false
            for (const [k, lease] of leasesRef.current) {
                const ttl = lease.state === 'agent_working' ? AGENT_TTL_MS : HUMAN_TTL_MS
                if (now - lease.at > ttl) {
                    leasesRef.current.delete(k)
                    changed = true
                }
            }
            if (changed) setPresence(foldLeases(leasesRef.current, selfMemberId))
        }, 5_000)
        return () => clearInterval(timer)
    }, [selfMemberId])

    return presence
}

/**
 * Human presence sender: `viewing` while mounted AND active (renewed every
 * 20s), `typing` at most every 4s while `onType()` keeps being called, `idle`
 * on unmount, on going inactive (a kept-alive pane hidden off screen), or
 * after 6s without typing (falls back to viewing).
 */
export function usePresenceSender(orgId: string, spaceId: string, threadRootId?: string, active = true): { onType: () => void } {
    const lastTypingRef = useRef(0)
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const send = useCallback(
        (state: 'viewing' | 'typing' | 'idle') => {
            void window.ipc.invoke('spaces:presence', { orgId, spaceId, state, ...(threadRootId ? { threadRootId } : {}) }).catch(() => {})
        },
        [orgId, spaceId, threadRootId],
    )

    useEffect(() => {
        if (!active) return
        send('viewing')
        const timer = setInterval(() => send('viewing'), 20_000)
        return () => {
            clearInterval(timer)
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
            send('idle')
        }
    }, [send, active])

    const onType = useCallback(() => {
        const now = Date.now()
        if (now - lastTypingRef.current > 4_000) {
            lastTypingRef.current = now
            send('typing')
        }
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        idleTimerRef.current = setTimeout(() => send('viewing'), 6_000)
    }, [send])

    return { onType }
}

// ---------------------------------------------------------------------------
// Unread for the sidebar — read marks key on thread roots ('stream' for the
// open stream). New roots count exactly against the loaded window; threads
// count once each when replies moved past their mark. Activity (file changes)
// is not chat and does not count here.
// ---------------------------------------------------------------------------

/** The read-mark key for the space's open stream. */
export const STREAM_READ_KEY = 'stream'

let unreadVersion = 0
const unreadListeners = new Set<() => void>()
function bumpUnread(): void {
    unreadVersion += 1
    for (const l of unreadListeners) l()
}
let unreadWired = false
function wireUnread(): void {
    if (unreadWired) return
    unreadWired = true
    subscribeSpaceFeedStore(bumpUnread)
    subscribeReadState(bumpUnread)
    subscribeOrgs(bumpUnread)
    subscribeNotifyPrefs(bumpUnread)
    streamListeners.add(bumpUnread)
}

export function countSpaceUnread(orgId: string, spaceId: string, selfMemberId: string): number {
    const k = key(orgId, spaceId)
    const state = streamState.get(k)
    let count = 0
    // Muted destinations don't badge (the Slack posture) — the messages stay
    // unread in the pane, they just don't count here. The stream itself mutes
    // under STREAM_READ_KEY; each thread mutes under its own root.
    ensureNotifyPrefs(orgId, spaceId)
    const muted = (dest: string) => effectiveNotifyLevel(orgId, spaceId, dest) === 'mute'
    const streamMark = getTopicLastReadAt(orgId, spaceId, STREAM_READ_KEY)
    if (state?.ready) {
        // New roots since the stream mark (loaded window — exact enough).
        if (!muted(STREAM_READ_KEY)) {
            count += state.messages.filter(
                (m) => !m.pending && !m.failed && !m.deletedAt && (!streamMark || m.postedAt > streamMark) && m.author.memberId !== selfMemberId,
            ).length
        }
        // Threads with replies past their own mark count once each.
        for (const m of state.messages) {
            if (m.pending || m.failed || !m.lastReplyAt || (m.replyCount ?? 0) === 0) continue
            const root = threadRootOf(m)
            if (muted(root)) continue
            const mark = getTopicLastReadAt(orgId, spaceId, root)
            if (!mark || m.lastReplyAt > mark) count += 1
        }
        return count
    }
    // Stream not loaded: the rail's topic list still says whether anything moved.
    const feed = getSpaceFeed(orgId, spaceId)
    if (!feed.loaded) return 0
    for (const t of feed.topics) {
        if (t.archived || muted(t.rootMessageId)) continue
        const mark = getTopicLastReadAt(orgId, spaceId, t.rootMessageId)
        if (!mark || t.lastActivityAt > mark) count += 1
    }
    return count
}

/** `${orgId}/${spaceId}` → unread count, for the sidebar badges. */
export function useSpacesUnreadCounts(): Map<string, number> {
    const version = useSyncExternalStore(
        (l) => {
            wireUnread()
            unreadListeners.add(l)
            return () => {
                unreadListeners.delete(l)
            }
        },
        () => unreadVersion,
    )
    return useMemo(() => {
        const counts = new Map<string, number>()
        for (const org of getSpacesOrgs()) {
            for (const space of org.spaces) counts.set(key(org.id, space.id), countSpaceUnread(org.id, space.id, org.memberId))
        }
        return counts
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version])
}
