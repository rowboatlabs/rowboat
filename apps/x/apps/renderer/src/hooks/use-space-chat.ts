import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'
import {
    GENERAL_SEED_BODY, applyReaction, findGeneralTopic, isGeneralSeedMessage, mergeMessages, parseThreadMarker, type ThreadMarker,
} from '@/lib/spaces-conventions'
import { feedSyncedRecently, getSpaceFeed, getSpacesOrgs, refreshSpaceFeed, subscribeOrgs, subscribeSpaceFeedStore, useSpaceFeed, useSpaceLive } from '@/hooks/use-spaces'
import { getTopicLastReadAt, subscribeReadState } from '@/lib/spaces-read-state'

// Chat-first stores for one space (push-1 spike, see the daily-chat plan):
//   general    — the space's chat topic, found/seeded by convention, messages kept live
//   threads    — which topics are threads of which general message (first-message markers)
//   presence   — who is here / typing / whose agent is working, from ephemeral frames
// All module-level, keyed by `${orgId}/${spaceId}`, exposed through hooks.

function key(orgId: string, spaceId: string): string {
    return `${orgId}/${spaceId}`
}

// ---------------------------------------------------------------------------
// General
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
export function buildPendingMessage(spaceId: string, topicId: string, memberId: string, body: string): ChatMessage {
    pendingSeq += 1
    return {
        id: `pending-${pendingSeq}-${Date.now()}`,
        topicId,
        spaceId,
        author: { memberId, actingMode: 'direct' },
        body,
        postedAt: new Date().toISOString(),
        offset: Number.MAX_SAFE_INTEGER - 1_000_000 + pendingSeq,
        reactions: [],
        pending: true,
    }
}

export interface GeneralState {
    topic: spaces.Topic | null
    /** The loaded window (newest page first; older pages prepend on demand) plus optimistic rows. */
    messages: ChatMessage[]
    /** Older messages exist below the loaded window (scroll up to load them). */
    hasMore: boolean
    /** An older page is on its way. */
    loadingOlder: boolean
    /** True once topics were loaded and general was found or seeded. */
    ready: boolean
    /** Set when seeding failed (org unreachable, not a member …). */
    error?: string
}

const EMPTY_GENERAL: GeneralState = { topic: null, messages: [], hasMore: false, loadingOlder: false, ready: false }

let generalState: ReadonlyMap<string, GeneralState> = new Map()
const generalListeners = new Set<() => void>()
const generalSeeding = new Set<string>()
const generalLoading = new Set<string>()

function emitGeneral(): void {
    for (const l of generalListeners) l()
}
function setGeneral(k: string, patch: Partial<GeneralState>): void {
    const next = new Map(generalState)
    next.set(k, { ...(generalState.get(k) ?? EMPTY_GENERAL), ...patch })
    generalState = next
    persistGeneral(k)
    emitGeneral()
}

// ---------------------------------------------------------------------------
// Cold-open cache — the tail of general, persisted per install (localStorage,
// like the read marks). Opening a space paints the cached tail immediately;
// the network fetch still runs and merges over it, so the paint is stale for
// a round trip at most.
// ---------------------------------------------------------------------------

const CACHE_VERSION = 1
/** Enough settled rows to fill the first screen well past the render cap. */
const CACHE_TAIL = 60

function cacheKey(k: string): string {
    return `spaces:general:${k}`
}

interface GeneralCache {
    v: number
    topic: spaces.Topic
    messages: spaces.Message[]
    hasMore: boolean
}

function persistGeneral(k: string): void {
    const state = generalState.get(k)
    if (!state?.ready || !state.topic || state.error) return
    const settled = state.messages.filter((m) => !m.pending && !m.failed)
    if (settled.length === 0) return
    const tail = settled.slice(-CACHE_TAIL)
    const payload: GeneralCache = { v: CACHE_VERSION, topic: state.topic, messages: tail, hasMore: state.hasMore || tail.length < settled.length }
    try {
        window.localStorage.setItem(cacheKey(k), JSON.stringify(payload))
    } catch {
        // Best-effort (quota, private mode) — cold opens just fetch.
    }
}

/** Keys painted from the cache and not yet confirmed by the org. */
const generalCacheOnly = new Set<string>()

/**
 * Seed module state from the persisted cache. Render-safe on purpose: it
 * swaps the snapshot WITHOUT notifying listeners, so useGeneral can call it
 * during render and the space's very first frame already holds messages —
 * no loading commit at all. Already-mounted subscribers catch up on the next
 * emit (the network fetch right behind it). Idempotent once state exists.
 */
function hydrateGeneral(k: string): void {
    if (generalState.has(k)) return
    try {
        const raw = window.localStorage.getItem(cacheKey(k))
        if (!raw) return
        const cached = JSON.parse(raw) as GeneralCache
        if (cached.v !== CACHE_VERSION || !cached.topic || !Array.isArray(cached.messages)) return
        generalCacheOnly.add(k)
        const next = new Map(generalState)
        next.set(k, { ...EMPTY_GENERAL, topic: cached.topic, messages: cached.messages, hasMore: cached.hasMore, ready: true })
        generalState = next
    } catch {
        // A corrupt entry paints nothing; the fetch rebuilds it.
    }
}

/**
 * Warm a space's chat before it opens (the sidebar calls this on hover):
 * hydrate the cached tail into module state and start the network refresh,
 * so the click that follows finds everything already in. Never seeds — a
 * hover must not post anything; seeding stays with the real open.
 */
export function prefetchGeneral(orgId: string, spaceId: string): void {
    const k = key(orgId, spaceId)
    hydrateGeneral(k)
    const feed = getSpaceFeed(orgId, spaceId)
    if (!feed.loaded) return
    const found = findGeneralTopic(feed.topics)
    const current = generalState.get(k)
    if (found && (current?.topic?.id !== found.id || !current.ready || generalCacheOnly.has(k))) {
        void loadGeneralMessages(orgId, spaceId, found)
    }
}

async function loadGeneralMessages(orgId: string, spaceId: string, topic: spaces.Topic): Promise<void> {
    const k = key(orgId, spaceId)
    if (generalLoading.has(k)) return
    generalLoading.add(k)
    try {
        // The latest page (the server windows newest-first). A refetch merges:
        // older pages the reader scrolled to stay put, hasMore keeps describing
        // OUR oldest edge, and optimistic pending/failed rows the response
        // doesn't already contain are carried over.
        const res = await window.ipc.invoke('spaces:listMessages', { orgId, spaceId, topicId: topic.id })
        const prev = generalState.get(k)
        const sameTopic = prev?.topic?.id === res.topic.id
        const settled = sameTopic ? prev.messages.filter((m) => !m.pending && !m.failed) : []
        const carried = (sameTopic ? prev.messages : []).filter(
            (m) => (m.pending || m.failed) && !res.messages.some((r) => r.author.memberId === m.author.memberId && r.body === m.body),
        )
        const reachesDeeper = (settled[0]?.offset ?? Infinity) < (res.messages[0]?.offset ?? Infinity)
        generalCacheOnly.delete(k)
        setGeneral(k, {
            topic: res.topic,
            messages: [...mergeMessages(settled, res.messages), ...carried],
            hasMore: reachesDeeper && sameTopic ? prev.hasMore : res.hasMore,
            ready: true,
            // A fresh page clears an old failure (the merge would keep it).
            error: undefined,
        })
    } catch (err) {
        // The attempt settled either way — a cached paint with an error badge
        // behaves like today's error state; the reconnect resync retries.
        generalCacheOnly.delete(k)
        setGeneral(k, { topic, ready: true, error: err instanceof Error ? err.message : String(err) })
    } finally {
        generalLoading.delete(k)
    }
}

const olderLoading = new Set<string>()

/** Scroll-up pagination: fetch the page below the loaded window and prepend it. */
export async function loadOlderGeneralMessages(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    const state = generalState.get(k)
    const topic = state?.topic
    const oldest = state?.messages.find((m) => !m.pending && !m.failed)
    if (!topic || !oldest || !state.hasMore || olderLoading.has(k)) return
    olderLoading.add(k)
    setGeneral(k, { loadingOlder: true })
    try {
        const res = await window.ipc.invoke('spaces:listMessages', { orgId, spaceId, topicId: topic.id, beforeOffset: oldest.offset })
        const cur = generalState.get(k)
        setGeneral(k, {
            messages: mergeMessages(cur?.messages ?? [], res.messages),
            hasMore: res.hasMore,
            loadingOlder: false,
        })
    } catch {
        setGeneral(k, { loadingOlder: false })
    } finally {
        olderLoading.delete(k)
    }
}

/** Replace one general message in place (e.g. the folded result of a reaction toggle). */
export function updateGeneralMessage(orgId: string, spaceId: string, message: spaces.Message): void {
    const k = key(orgId, spaceId)
    const state = generalState.get(k)
    if (!state?.messages.some((m) => m.id === message.id)) return
    setGeneral(k, { messages: state.messages.map((m) => (m.id === message.id ? message : m)) })
}

/**
 * Append a general message to the store. The live bus and post handlers both
 * land here: a post handler echoes its own HTTP result IMMEDIATELY (the WS
 * event may be seconds away — or the socket half-open after sleep, in which
 * case it never comes) and the dedupe makes whichever copy arrives second a
 * no-op.
 */
export function ingestGeneralMessage(orgId: string, spaceId: string, message: spaces.Message): void {
    const k = key(orgId, spaceId)
    const state = generalState.get(k)
    if (!state?.topic || message.topicId !== state.topic.id) return
    if (state.messages.some((m) => m.id === message.id)) return
    // The live frame can beat our own HTTP response: an arriving copy of an
    // optimistic send replaces its pending row instead of doubling it. (A
    // pending row being ADDED never matches — sending the same text twice is
    // two messages.)
    const echoed =
        message.author.actingMode === 'direct' && !(message as ChatMessage).pending
            ? state.messages.find((m) => m.pending && m.author.memberId === message.author.memberId && m.body === message.body)
            : undefined
    const rest = echoed ? state.messages.filter((m) => m.id !== echoed.id) : state.messages
    setGeneral(k, { messages: [...rest, message].sort((a, b) => a.offset - b.offset) })
}

/** The write confirmed: swap the pending row for the org's message (a no-op side if the live frame landed it first). */
export function resolvePendingGeneralMessage(orgId: string, spaceId: string, pendingId: string, message: spaces.Message): void {
    const k = key(orgId, spaceId)
    const state = generalState.get(k)
    if (!state) return
    const rest = state.messages.filter((m) => m.id !== pendingId)
    setGeneral(k, {
        messages: rest.some((m) => m.id === message.id) ? rest : [...rest, message].sort((a, b) => a.offset - b.offset),
    })
}

/** The write failed: the row stays, marked, with retry/discard in the stream. */
export function failPendingGeneralMessage(orgId: string, spaceId: string, pendingId: string): void {
    const k = key(orgId, spaceId)
    const state = generalState.get(k)
    if (!state?.messages.some((m) => m.id === pendingId)) return
    setGeneral(k, { messages: state.messages.map((m) => (m.id === pendingId ? { ...m, pending: false, failed: true } : m)) })
}

/** Drop a message row outright (discarding a failed send, or re-sending it). */
export function removeGeneralMessage(orgId: string, spaceId: string, messageId: string): void {
    const k = key(orgId, spaceId)
    const state = generalState.get(k)
    if (!state?.messages.some((m) => m.id === messageId)) return
    setGeneral(k, { messages: state.messages.filter((m) => m.id !== messageId) })
}

/** Find general in the feed store's topics; seed it when the space has none. */
async function ensureGeneral(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    // Paint the cached tail first — it needs no feed, so a cold open shows
    // messages while topics are still on the wire.
    hydrateGeneral(k)
    const feed = getSpaceFeed(orgId, spaceId)
    if (!feed.loaded) return
    const found = findGeneralTopic(feed.topics)
    const current = generalState.get(k)
    if (found) {
        if (current?.topic?.id !== found.id || !current.ready || generalCacheOnly.has(k)) await loadGeneralMessages(orgId, spaceId, found)
        else if (current.topic && (current.topic.title !== found.title || current.topic.archived !== found.archived)) setGeneral(k, { topic: found })
        return
    }
    if (generalSeeding.has(k)) return
    generalSeeding.add(k)
    try {
        await window.ipc.invoke('spaces:postMessage', { orgId, spaceId, body: GENERAL_SEED_BODY })
        await refreshSpaceFeed(orgId, spaceId)
        const seeded = findGeneralTopic(getSpaceFeed(orgId, spaceId).topics)
        if (seeded) await loadGeneralMessages(orgId, spaceId, seeded)
        else setGeneral(k, { ready: true, error: 'general could not be created' })
    } catch (err) {
        setGeneral(k, { ready: true, error: err instanceof Error ? err.message : String(err) })
    } finally {
        generalSeeding.delete(k)
    }
}

let busWired = false
function wireBus(): void {
    if (busWired) return
    busWired = true
    // Live: messages for general append in place; topic/membership events re-check general
    // (a rename or archive) through the feed store, which refreshes on the same event.
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
            const state = generalState.get(k)
            void refreshSpaceFeed(event.orgId, frame.spaceId)
            if (state?.topic) void loadGeneralMessages(event.orgId, frame.spaceId, state.topic)
            return
        }
        if (frame.kind !== 'event') return
        const k = key(event.orgId, frame.spaceId)
        const state = generalState.get(k)
        if (frame.event.type === 'message') {
            const message = frame.event.message
            if (state?.topic && message.topicId === state.topic.id) {
                ingestGeneralMessage(event.orgId, frame.spaceId, message)
            } else if (state?.topic) {
                // A message on another topic: a thread reply or a new thread's seed.
                noteThreadActivity(event.orgId, frame.spaceId, message)
            }
        } else if (frame.event.type === 'reaction') {
            // Fold the toggle into the message in place (thread panes refetch on
            // their own tick; general keeps its messages live here). The
            // viewer's own toggles are EXCLUDED: those reconcile through their
            // HTTP response, and this echo can arrive seconds later — folding
            // it would resurrect a reaction the optimistic remove just cleared.
            const { reaction, action } = frame.event
            const selfId = getSpacesOrgs().find((o) => o.id === event.orgId)?.memberId
            if (reaction.by.memberId === selfId) return
            if (state?.topic && state.messages.some((m) => m.id === reaction.messageId)) {
                setGeneral(k, {
                    messages: state.messages.map((m) =>
                        m.id === reaction.messageId
                            ? { ...m, reactions: applyReaction(m.reactions, { emoji: reaction.emoji, memberId: reaction.by.memberId, action }) }
                            : m,
                    ),
                })
            }
        } else if (frame.event.type === 'message_edited') {
            // Rewrite in place. Own edits are NOT excluded (unlike reactions):
            // the fold is idempotent — re-applying the same body is harmless.
            const { edit } = frame.event
            if (state?.topic && state.messages.some((m) => m.id === edit.messageId)) {
                setGeneral(k, {
                    messages: state.messages.map((m) =>
                        m.id === edit.messageId ? { ...m, body: edit.body, editedAt: edit.at } : m,
                    ),
                })
            }
        } else if (frame.event.type === 'message_deleted') {
            // Tombstone in place — the row stays (threads may anchor to it), the
            // body is gone. Thread panes pick theirs up on the feed-refresh tick.
            const { deletion } = frame.event
            if (state?.topic && state.messages.some((m) => m.id === deletion.messageId)) {
                setGeneral(k, {
                    messages: state.messages.map((m) =>
                        m.id === deletion.messageId ? { ...m, body: '', deletedAt: deletion.at } : m,
                    ),
                })
            }
        }
    })
    // Feed store changes (topics list) → re-evaluate general + the thread index.
    subscribeSpaceFeedStore(() => {
        for (const k of watched) {
            const [orgId, spaceId] = k.split('/') as [string, string]
            void ensureGeneral(orgId, spaceId)
            indexThreads(orgId, spaceId)
        }
    })
}

const watched = new Set<string>()

/** General for one space: its topic and live messages. Seeds general on first open. */
export function useGeneral(orgId: string, spaceId: string): GeneralState {
    const feed = useSpaceFeed(orgId, spaceId)
    // Before the snapshot read, not in an effect: a space with a persisted
    // tail must paint messages in its FIRST frame (the Slack feel). The call
    // is idempotent and never emits, so it is safe during render.
    hydrateGeneral(key(orgId, spaceId))
    const state = useSyncExternalStore(
        (l) => {
            generalListeners.add(l)
            return () => {
                generalListeners.delete(l)
            }
        },
        () => generalState,
    )
    useEffect(() => {
        wireBus()
        const k = key(orgId, spaceId)
        watched.add(k)
        void ensureGeneral(orgId, spaceId)
        return () => {
            watched.delete(k)
        }
    }, [orgId, spaceId, feed.loaded, feed.topics])
    return state.get(key(orgId, spaceId)) ?? EMPTY_GENERAL
}

// ---------------------------------------------------------------------------
// Thread index — topic id → its first message (immutable, fetched once) and
// the parsed marker (null = not a thread). Rebuilt incrementally as topics appear.
// ---------------------------------------------------------------------------

export interface ThreadInfo {
    topicId: string
    /** Orders contested parents (legacy data only) and thread rows deterministically. */
    createdAt: string
    /**
     * The topic's seed message. Only populated when this client created the
     * thread, or on the legacy (pre-004 server) fetch path — contract servers
     * carry parentage on the topic itself, so the index never downloads every
     * topic's messages. Title/preview consumers fall back to the parent
     * message (same first line) or the topic title.
     */
    firstMessage: spaces.Message | null
    marker: ThreadMarker | null
    /** The message this topic grew from — the contract field, else the legacy marker. */
    parentMessageId: string | null
}

function threadParentOf(topic: spaces.Topic, marker: ThreadMarker | null): string | null {
    return topic.anchorMessageId ?? marker?.parentMessageId ?? null
}

let threadState: ReadonlyMap<string, ReadonlyMap<string, ThreadInfo>> = new Map()
const threadListeners = new Set<() => void>()

function emitThreads(): void {
    for (const l of threadListeners) l()
}

function putThreadInfos(k: string, infos: ThreadInfo[]): void {
    if (infos.length === 0) return
    const spaceMap = new Map(threadState.get(k) ?? [])
    for (const info of infos) spaceMap.set(info.topicId, info)
    const next = new Map(threadState)
    next.set(k, spaceMap)
    threadState = next
    emitThreads()
}

function indexThreads(orgId: string, spaceId: string): void {
    const k = key(orgId, spaceId)
    const feed = getSpaceFeed(orgId, spaceId)
    if (!feed.loaded) return
    const general = findGeneralTopic(feed.topics)
    const known = threadState.get(k) ?? new Map<string, ThreadInfo>()
    const pending = feed.topics.filter((t) => t.id !== general?.id && !known.has(t.id))
    if (pending.length === 0) return

    // listTopics carries every topic's (immutable) first message, so the index
    // is a pure projection of the topics list — zero message fetches. This was
    // the boot-time request storm: one full listMessages per topic. A bare
    // Topic without the field (a pre-pagination server) still projects its
    // parentage from anchorMessageId; only marker-era parentage would be lost.
    putThreadInfos(
        k,
        pending.map((topic) => {
            const first = topic.firstMessage ?? null
            const marker = first ? parseThreadMarker(first.body) : null
            return {
                topicId: topic.id,
                createdAt: topic.createdAt,
                firstMessage: first,
                marker,
                parentMessageId: threadParentOf(topic, marker),
            }
        }),
    )
}

/** Remember a parent→thread link the moment this client creates it (no fetch needed). */
export function rememberThread(orgId: string, spaceId: string, topic: spaces.Topic, firstMessage: spaces.Message): void {
    const marker = parseThreadMarker(firstMessage.body)
    putThreadInfos(key(orgId, spaceId), [{ topicId: topic.id, createdAt: topic.createdAt, firstMessage, marker, parentMessageId: threadParentOf(topic, marker) }])
}

function noteThreadActivity(orgId: string, spaceId: string, message: spaces.Message): void {
    // A first message on an unknown topic: index it right away (it may be a thread seed).
    const k = key(orgId, spaceId)
    if (threadState.get(k)?.has(message.topicId)) return
    void refreshSpaceFeed(orgId, spaceId).then(() => indexThreads(orgId, spaceId))
}

export interface ThreadIndex {
    /** topicId → info for every non-general topic seen so far. */
    byTopic: ReadonlyMap<string, ThreadInfo>
    /** parent general message id → thread topic id. */
    byParent: ReadonlyMap<string, string>
}

const EMPTY_INDEX: ThreadIndex = { byTopic: new Map(), byParent: new Map() }

export function useThreadIndex(orgId: string, spaceId: string): ThreadIndex {
    const state = useSyncExternalStore(
        (l) => {
            threadListeners.add(l)
            return () => {
                threadListeners.delete(l)
            }
        },
        () => threadState,
    )
    const feed = useSpaceFeed(orgId, spaceId)
    useEffect(() => {
        wireBus()
        indexThreads(orgId, spaceId)
    }, [orgId, spaceId, feed.topics])
    return useMemo(() => {
        const byTopic = state.get(key(orgId, spaceId))
        if (!byTopic) return EMPTY_INDEX
        const byParent = new Map<string, string>()
        // Oldest thread wins if two claim the same parent (only reachable via
        // pre-contract data — the server now enforces one topic per message).
        const ordered = [...byTopic.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.topicId.localeCompare(b.topicId))
        for (const info of ordered) {
            if (info.parentMessageId && !byParent.has(info.parentMessageId)) byParent.set(info.parentMessageId, info.topicId)
        }
        return { byTopic, byParent }
    }, [state, orgId, spaceId])
}

// ---------------------------------------------------------------------------
// Presence — ephemeral frames folded into "here", "typing", "agent working".
// Leases: senders renew, we prune (humans 45s, agents 30s).
// ---------------------------------------------------------------------------

export interface SpacePresence {
    /** Members with a live viewing/typing lease anywhere in the space. */
    here: string[]
    /** topicId ('' = space-wide) → members typing there. */
    typing: ReadonlyMap<string, string[]>
    /** topicId → members whose agent holds an agent_working lease there. */
    working: ReadonlyMap<string, string[]>
}

const HUMAN_TTL_MS = 45_000
const AGENT_TTL_MS = 30_000

interface Lease { state: 'viewing' | 'typing' | 'agent_working'; topicId: string; at: number }

const EMPTY_PRESENCE: SpacePresence = { here: [], typing: new Map(), working: new Map() }

function foldLeases(leases: Map<string, Lease>, selfMemberId: string): SpacePresence {
    const here = new Set<string>()
    const typing = new Map<string, string[]>()
    const working = new Map<string, string[]>()
    for (const [k, lease] of leases) {
        const memberId = k.slice(0, k.indexOf('|'))
        if (lease.state === 'agent_working') {
            working.set(lease.topicId, [...(working.get(lease.topicId) ?? []), memberId])
            continue
        }
        here.add(memberId)
        if (lease.state === 'typing' && memberId !== selfMemberId) typing.set(lease.topicId, [...(typing.get(lease.topicId) ?? []), memberId])
    }
    return { here: [...here], typing, working }
}

export function useSpacePresence(orgId: string, spaceId: string, selfMemberId: string): SpacePresence {
    const leasesRef = useRef<Map<string, Lease>>(new Map())
    const [presence, setPresence] = useState<SpacePresence>(EMPTY_PRESENCE)

    useSpaceLive(orgId, spaceId, (frame) => {
        if (frame.kind !== 'presence') return
        const leases = leasesRef.current
        // Human and agent leases are independent per (member, topic) — the frame's
        // state says which one this is (agent_working/agent_idle vs the rest).
        const agent = frame.state === 'agent_working' || frame.state === 'agent_idle'
        const k = `${frame.memberId}|${frame.topicId ?? ''}|${agent ? 'agent' : 'human'}`
        if (frame.state === 'idle' || frame.state === 'agent_idle') leases.delete(k)
        else leases.set(k, { state: frame.state, topicId: frame.topicId ?? '', at: Date.now() })
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
export function usePresenceSender(orgId: string, spaceId: string, topicId?: string, active = true): { onType: () => void } {
    const lastTypingRef = useRef(0)
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const send = useCallback(
        (state: 'viewing' | 'typing' | 'idle') => {
            void window.ipc.invoke('spaces:presence', { orgId, spaceId, state, ...(topicId ? { topicId } : {}) }).catch(() => {})
        },
        [orgId, spaceId, topicId],
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
// Unread for the sidebar — new general messages (exact once general is loaded,
// else "1" when it moved) + threads/topics with new replies. Activity (file
// changes) is not chat and does not count here.
// ---------------------------------------------------------------------------

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
    generalListeners.add(bumpUnread)
}

export function countSpaceUnread(orgId: string, spaceId: string, selfMemberId: string): number {
    const feed = getSpaceFeed(orgId, spaceId)
    if (!feed.loaded) return 0
    const general = findGeneralTopic(feed.topics)
    let count = 0
    if (general) {
        const mark = getTopicLastReadAt(orgId, spaceId, general.id)
        const state = generalState.get(key(orgId, spaceId))
        if (state?.ready && state.topic?.id === general.id) {
            count += state.messages.filter((m, i) => !m.deletedAt && !isGeneralSeedMessage(general, m, i) && (!mark || m.postedAt > mark) && m.author.memberId !== selfMemberId).length
        } else if ((!mark || general.lastActivityAt > mark) && general.messageCount > 1) {
            count += 1
        }
    }
    for (const t of feed.topics) {
        if (t.archived || t.id === general?.id) continue
        const mark = getTopicLastReadAt(orgId, spaceId, t.id)
        if (mark && t.lastActivityAt <= mark) continue
        if (t.messageCount > 1 || t.createdBy.memberId !== selfMemberId) count += 1
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
