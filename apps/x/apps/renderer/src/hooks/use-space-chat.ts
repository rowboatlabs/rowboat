import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'
import {
    GENERAL_SEED_BODY, applyReaction, findGeneralTopic, isGeneralSeedMessage, parseThreadMarker, type ThreadMarker,
} from '@/lib/spaces-conventions'
import { getSpaceFeed, getSpacesOrgs, refreshSpaceFeed, subscribeOrgs, subscribeSpaceFeedStore, useSpaceFeed, useSpaceLive } from '@/hooks/use-spaces'
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

export interface GeneralState {
    topic: spaces.Topic | null
    messages: spaces.Message[]
    /** True once topics were loaded and general was found or seeded. */
    ready: boolean
    /** Set when seeding failed (org unreachable, not a member …). */
    error?: string
}

const EMPTY_GENERAL: GeneralState = { topic: null, messages: [], ready: false }

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
    emitGeneral()
}

async function loadGeneralMessages(orgId: string, spaceId: string, topic: spaces.Topic): Promise<void> {
    const k = key(orgId, spaceId)
    if (generalLoading.has(k)) return
    generalLoading.add(k)
    try {
        const res = await window.ipc.invoke('spaces:listMessages', { orgId, spaceId, topicId: topic.id })
        setGeneral(k, { topic: res.topic, messages: res.messages, ready: true })
    } catch (err) {
        setGeneral(k, { topic, ready: true, error: err instanceof Error ? err.message : String(err) })
    } finally {
        generalLoading.delete(k)
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
    setGeneral(k, { messages: [...state.messages, message].sort((a, b) => a.offset - b.offset) })
}

/** Find general in the feed store's topics; seed it when the space has none. */
async function ensureGeneral(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    const feed = getSpaceFeed(orgId, spaceId)
    if (!feed.loaded) return
    const found = findGeneralTopic(feed.topics)
    const current = generalState.get(k)
    if (found) {
        if (current?.topic?.id !== found.id || !current.ready) await loadGeneralMessages(orgId, spaceId, found)
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
            // resync the HTTP views so the stream is whole again.
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
            // their own tick; general keeps its messages live here).
            const { reaction, action } = frame.event
            if (state?.topic && state.messages.some((m) => m.id === reaction.messageId)) {
                setGeneral(k, {
                    messages: state.messages.map((m) =>
                        m.id === reaction.messageId
                            ? { ...m, reactions: applyReaction(m.reactions, { emoji: reaction.emoji, memberId: reaction.by.memberId, action }) }
                            : m,
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
            void indexThreads(orgId, spaceId)
        }
    })
}

const watched = new Set<string>()

/** General for one space: its topic and live messages. Seeds general on first open. */
export function useGeneral(orgId: string, spaceId: string): GeneralState {
    const feed = useSpaceFeed(orgId, spaceId)
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
const threadInflight = new Set<string>()

function emitThreads(): void {
    for (const l of threadListeners) l()
}

async function indexThreads(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    const feed = getSpaceFeed(orgId, spaceId)
    if (!feed.loaded) return
    const general = findGeneralTopic(feed.topics)
    const known = threadState.get(k) ?? new Map<string, ThreadInfo>()
    const pending = feed.topics.filter((t) => t.id !== general?.id && !known.has(t.id) && !threadInflight.has(`${k}:${t.id}`))
    if (pending.length === 0) return
    await Promise.all(
        pending.map(async (topic) => {
            const ik = `${k}:${topic.id}`
            threadInflight.add(ik)
            try {
                const res = await window.ipc.invoke('spaces:listMessages', { orgId, spaceId, topicId: topic.id })
                const first = res.messages[0] ?? null
                const marker = first ? parseThreadMarker(first.body) : null
                const info: ThreadInfo = { topicId: topic.id, firstMessage: first, marker, parentMessageId: threadParentOf(topic, marker) }
                const spaceMap = new Map(threadState.get(k) ?? [])
                spaceMap.set(topic.id, info)
                const next = new Map(threadState)
                next.set(k, spaceMap)
                threadState = next
                emitThreads()
            } catch {
                // unreachable right now; retried on the next feed refresh
            } finally {
                threadInflight.delete(ik)
            }
        }),
    )
}

/** Remember a parent→thread link the moment this client creates it (no fetch needed). */
export function rememberThread(orgId: string, spaceId: string, topic: spaces.Topic, firstMessage: spaces.Message): void {
    const k = key(orgId, spaceId)
    const spaceMap = new Map(threadState.get(k) ?? [])
    const marker = parseThreadMarker(firstMessage.body)
    spaceMap.set(topic.id, { topicId: topic.id, firstMessage, marker, parentMessageId: threadParentOf(topic, marker) })
    const next = new Map(threadState)
    next.set(k, spaceMap)
    threadState = next
    emitThreads()
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
        void indexThreads(orgId, spaceId)
    }, [orgId, spaceId, feed.topics])
    return useMemo(() => {
        const byTopic = state.get(key(orgId, spaceId))
        if (!byTopic) return EMPTY_INDEX
        const byParent = new Map<string, string>()
        // Oldest thread wins if two claim the same parent (only reachable via
        // pre-contract data — the server now enforces one topic per message).
        const ordered = [...byTopic.values()].sort((a, b) => (a.firstMessage?.postedAt ?? '').localeCompare(b.firstMessage?.postedAt ?? ''))
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
 * Human presence sender: `viewing` while mounted (renewed every 20s), `typing`
 * at most every 4s while `onType()` keeps being called, `idle` on unmount or
 * after 6s without typing (falls back to viewing).
 */
export function usePresenceSender(orgId: string, spaceId: string, topicId?: string): { onType: () => void } {
    const lastTypingRef = useRef(0)
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const send = useCallback(
        (state: 'viewing' | 'typing' | 'idle') => {
            void window.ipc.invoke('spaces:presence', { orgId, spaceId, state, ...(topicId ? { topicId } : {}) }).catch(() => {})
        },
        [orgId, spaceId, topicId],
    )

    useEffect(() => {
        send('viewing')
        const timer = setInterval(() => send('viewing'), 20_000)
        return () => {
            clearInterval(timer)
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
            send('idle')
        }
    }, [send])

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
