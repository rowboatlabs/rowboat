import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'
import { SPACES_ENABLED } from '@/lib/feature-flags'
import { getLastReadAt, subscribeReadState } from '@/lib/spaces-read-state'

export interface OrgWithSpaces extends spaces.SpacesOrgSummary {
    spaces: spaces.Space[]
    /** Set when the org could not be reached — the sidebar's "org unreachable" state. */
    error?: string
}

// ---------------------------------------------------------------------------
// Orgs store — one fetch shared by the sidebar's SPACES section and the space
// view (both render the same org/space list; one source keeps them in step).
// ---------------------------------------------------------------------------

interface OrgsState {
    orgs: OrgWithSpaces[]
    loading: boolean
}

let orgsState: OrgsState = { orgs: [], loading: true }
const orgsListeners = new Set<() => void>()
let orgsInflight: Promise<void> | null = null
let orgsFetchedOnce = false

function emitOrgs(): void {
    for (const listener of orgsListeners) listener()
}

export function refreshSpacesOrgs(): Promise<void> {
    if (orgsInflight) return orgsInflight
    orgsInflight = (async () => {
        try {
            const { orgs: records } = await window.ipc.invoke('spaces:listOrgs', null)
            const withSpaces = await Promise.all(
                records.map(async (org): Promise<OrgWithSpaces> => {
                    try {
                        const { spaces: list } = await window.ipc.invoke('spaces:listSpaces', { orgId: org.id })
                        return { ...org, spaces: list }
                    } catch (err) {
                        return { ...org, spaces: [], error: err instanceof Error ? err.message : String(err) }
                    }
                }),
            )
            orgsState = { orgs: withSpaces, loading: false }
        } catch {
            orgsState = { ...orgsState, loading: false }
        } finally {
            orgsFetchedOnce = true
            orgsInflight = null
            emitOrgs()
            syncFeedSubscriptions()
        }
    })()
    return orgsInflight
}

export function subscribeOrgs(listener: () => void): () => void {
    orgsListeners.add(listener)
    // With Spaces dark, passive subscribers (e.g. the App title crumb) must
    // not trigger the lazy fetch — the store just stays empty.
    if (SPACES_ENABLED && !orgsFetchedOnce && !orgsInflight) void refreshSpacesOrgs()
    return () => {
        orgsListeners.delete(listener)
    }
}

/** Non-React read of the orgs store. */
export function getSpacesOrgs(): OrgWithSpaces[] {
    return orgsState.orgs
}

/** The orgs this install is signed into, each with its live space list. */
export function useSpacesOrgs(): { orgs: OrgWithSpaces[]; loading: boolean; refresh: () => Promise<void> } {
    const state = useSyncExternalStore(subscribeOrgs, () => orgsState)
    const refresh = useCallback(() => refreshSpacesOrgs(), [])
    return { orgs: state.orgs, loading: state.loading, refresh }
}

// ---------------------------------------------------------------------------
// Live subscriptions — ref-counted per space so the sidebar (which watches
// every space for unread counts) and an open space pane share one socket
// subscription in main.
// ---------------------------------------------------------------------------

const liveRefs = new Map<string, number>()

function liveKey(orgId: string, spaceId: string): string {
    return `${orgId}/${spaceId}`
}

export function acquireSpaceLive(orgId: string, spaceId: string): () => void {
    const key = liveKey(orgId, spaceId)
    const count = liveRefs.get(key) ?? 0
    liveRefs.set(key, count + 1)
    if (count === 0) {
        void window.ipc.invoke('spaces:subscribeSpace', { orgId, spaceId }).catch(() => {
            // org unreachable — REST fetches surface the error state
        })
    }
    let released = false
    return () => {
        if (released) return
        released = true
        const current = liveRefs.get(key) ?? 0
        if (current <= 1) {
            liveRefs.delete(key)
            void window.ipc.invoke('spaces:unsubscribeSpace', { orgId, spaceId }).catch(() => {})
        } else {
            liveRefs.set(key, current - 1)
        }
    }
}

/**
 * Live frames for one space. Subscribes main's per-org socket to the space
 * (live-only; initial data comes from REST) and filters the broadcast feed.
 */
export function useSpaceLive(
    orgId: string | null,
    spaceId: string | null,
    onFrame: (frame: spaces.ServerFrame) => void,
): void {
    const handlerRef = useRef(onFrame)
    useEffect(() => {
        handlerRef.current = onFrame
    })

    useEffect(() => {
        if (!orgId || !spaceId) return
        let cancelled = false
        const release = acquireSpaceLive(orgId, spaceId)
        const unsubscribe = subscribeSpacesFeed((event) => {
            if (cancelled || event.orgId !== orgId) return
            const frame = event.frame
            if ('spaceId' in frame && frame.spaceId === spaceId) handlerRef.current(frame)
        })
        return () => {
            cancelled = true
            unsubscribe()
            release()
        }
    }, [orgId, spaceId])
}

// ---------------------------------------------------------------------------
// Feed store — topics + recent change-sets per space, refreshed on durable
// events. Feeds both the space pane and the sidebar's unread counts.
// ---------------------------------------------------------------------------

export interface SpaceFeedData {
    /** Listing entries — each topic carries its immutable first message. */
    topics: spaces.TopicListing[]
    /** Explicit labels — the "Topics" the rail shows (wire topics are threads). */
    labels: spaces.LabelListing[]
    changeSets: spaces.ChangeSet[]
    loaded: boolean
}

const EMPTY_FEED: SpaceFeedData = { topics: [], labels: [], changeSets: [], loaded: false }

let feedState: ReadonlyMap<string, SpaceFeedData> = new Map()
const feedListeners = new Set<() => void>()
const feedInflight = new Map<string, Promise<void>>()
const feedReleases = new Map<string, () => void>()
let feedBusWired = false

function emitFeed(): void {
    for (const listener of feedListeners) listener()
}

const feedDirty = new Set<string>()
const feedRefreshedAt = new Map<string, number>()

/**
 * True while a feed fetch is in flight or one landed moments ago — the
 * "already covered" test that keeps the boot-time `subscribed` resync from
 * double-fetching what the store just loaded.
 */
export function feedSyncedRecently(orgId: string, spaceId: string, withinMs = 5_000): boolean {
    const key = liveKey(orgId, spaceId)
    return feedInflight.has(key) || Date.now() - (feedRefreshedAt.get(key) ?? 0) < withinMs
}

export function refreshSpaceFeed(orgId: string, spaceId: string): Promise<void> {
    const key = liveKey(orgId, spaceId)
    const inflight = feedInflight.get(key)
    if (inflight) {
        // An event landed mid-fetch: run once more when this one settles.
        feedDirty.add(key)
        return inflight
    }
    const promise = (async () => {
        try {
            const [topicsRes, labelsRes, historyRes] = await Promise.all([
                window.ipc.invoke('spaces:listTopics', { orgId, spaceId }),
                // A pre-labels org (teammate's stale local Harbor) has no route
                // — the rail just shows no topics rather than killing the feed.
                window.ipc.invoke('spaces:listLabels', { orgId, spaceId }).catch(() => ({ labels: [] })),
                window.ipc.invoke('spaces:assetHistory', { orgId, spaceId, limit: 60 }),
            ])
            const next = new Map(feedState)
            next.set(key, { topics: topicsRes.topics, labels: labelsRes.labels, changeSets: historyRes.changeSets, loaded: true })
            feedState = next
            feedRefreshedAt.set(key, Date.now())
            emitFeed()
        } catch {
            // org unreachable; panes show their own error states
        } finally {
            feedInflight.delete(key)
            if (feedDirty.delete(key)) void refreshSpaceFeed(orgId, spaceId)
        }
    })()
    feedInflight.set(key, promise)
    return promise
}

const feedRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

function wireFeedBus(): void {
    if (feedBusWired) return
    feedBusWired = true
    subscribeSpacesFeed((event) => {
        const frame = event.frame
        if (frame.kind !== 'event') return
        const key = liveKey(event.orgId, frame.spaceId)
        if (!feedReleases.has(key) || feedRefreshTimers.has(key)) return
        // Trailing debounce: a burst of events (an agent replying, a thread's
        // seed + reply, a reaction volley) lands as ONE topics+history
        // refetch, not one per event.
        feedRefreshTimers.set(
            key,
            setTimeout(() => {
                feedRefreshTimers.delete(key)
                void refreshSpaceFeed(event.orgId, frame.spaceId)
            }, 400),
        )
    })
}

/** Keep every known space's feed loaded + live (unread counts need all of them). */
function syncFeedSubscriptions(): void {
    wireFeedBus()
    const wanted = new Set<string>()
    for (const org of orgsState.orgs) {
        for (const space of org.spaces) {
            const key = liveKey(org.id, space.id)
            wanted.add(key)
            if (!feedReleases.has(key)) {
                feedReleases.set(key, acquireSpaceLive(org.id, space.id))
                void refreshSpaceFeed(org.id, space.id)
            }
        }
    }
    for (const [key, release] of feedReleases) {
        if (!wanted.has(key)) {
            release()
            feedReleases.delete(key)
        }
    }
}

export function subscribeSpaceFeedStore(listener: () => void): () => void {
    feedListeners.add(listener)
    return () => {
        feedListeners.delete(listener)
    }
}
const subscribeFeed = subscribeSpaceFeedStore

/** Non-React read of the feed store (for sibling stores that derive from it). */
export function getSpaceFeed(orgId: string, spaceId: string): SpaceFeedData {
    return feedState.get(liveKey(orgId, spaceId)) ?? EMPTY_FEED
}

/** Topics + recent changes for one space, kept fresh by the live stream. */
export function useSpaceFeed(orgId: string | null, spaceId: string | null): SpaceFeedData {
    const state = useSyncExternalStore(subscribeFeed, () => feedState)
    useEffect(() => {
        if (orgId && spaceId) void refreshSpaceFeed(orgId, spaceId)
    }, [orgId, spaceId])
    if (!orgId || !spaceId) return EMPTY_FEED
    return state.get(liveKey(orgId, spaceId)) ?? EMPTY_FEED
}

export function useSpaceLastReadAt(orgId: string, spaceId: string): string | null {
    return useSyncExternalStore(subscribeReadState, () => getLastReadAt(orgId, spaceId))
}
