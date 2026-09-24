import { useSyncExternalStore } from 'react'
import type { autoRoute } from '@x/shared'
import { getStreamState, getThreadSnapshot, type StreamState } from '@/hooks/use-space-chat'
import { getSpaceFeed } from '@/hooks/use-spaces'
import { threadLabelOf } from '@/lib/spaces-conventions'
import { resolveMentions } from '@/lib/spaces-presentation'

// The stream composer's Auto toggle (2026-09-22): with it on, Jev (TypeSafe's
// System One model) decides at send time whether the draft is a new stream
// message or a reply to one of the space's open threads. This module owns the
// toggle's per-install state, the candidate set the renderer already holds,
// and the IPC call; the questions, thresholds and key live in core.

/**
 * Off, or on in one of two modes (2026-09-23). Preview, the default whenever
 * Auto is turned on, opens the thread Jev picked with the reply staged in its
 * composer for a look before sending; Post sends it there straight away.
 * Persisted per install as the mode itself; absent = off.
 */
export type AutoRouteMode = 'off' | 'preview' | 'post'

/**
 * Where Auto's notices go (2026-09-23): the app's toaster stacks bottom-right,
 * which is straight over the thread composer Auto just opened. Top-center
 * keeps them off every composer without moving any other toast in the app.
 */
export const AUTO_TOAST = { position: 'top-center' } as const

const STORAGE_KEY = 'spaces:auto-route'
const listeners = new Set<() => void>()

function readStored(): AutoRouteMode {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === 'preview' || raw === 'post') return raw
        // '1' was the on/off flag before modes existed (2026-09-22). It posted
        // directly, but Preview is the default the person asked for, and Post
        // is the mode to opt into, never to inherit.
        if (raw === '1') return 'preview'
    } catch {
        // Unreadable storage reads as off.
    }
    return 'off'
}

let mode = readStored()

export function getAutoRouteMode(): AutoRouteMode {
    return mode
}

export function setAutoRouteMode(next: AutoRouteMode): void {
    mode = next
    try {
        if (next === 'off') window.localStorage.removeItem(STORAGE_KEY)
        else window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
        // Quota/private mode: the choice just does not persist.
    }
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function useAutoRouteMode(): AutoRouteMode {
    return useSyncExternalStore(subscribe, getAutoRouteMode)
}

/** A root for the model: names for mention tokens, embeds dropped (images and blob cards are bytes, not words). */
function gist(body: string, memberNames: ReadonlyMap<string, string>, spaceNames: ReadonlyMap<string, string>): string {
    return resolveMentions(body, memberNames, spaceNames)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * The threads a draft could land in: every open topic of the space (the feed
 * store keeps them all loaded) plus every loaded stream root without a topic
 * row. Under the annotation model a root with no replies yet IS a thread
 * (replying creates nothing), and it is the one people most often answer,
 * so a reply count is no filter (2026-09-23; the first cut required replies,
 * which left a fresh space with nothing to route into). One entry per root,
 * newest activity first; tombstoned roots and unconfirmed rows are not
 * destinations. Core keeps the newest 40.
 */
export function collectRouteCandidates(
    orgId: string,
    spaceId: string,
    stream: Pick<StreamState, 'messages' | 'topicsByRoot'>,
    memberNames: ReadonlyMap<string, string>,
    spaceNames: ReadonlyMap<string, string>,
): autoRoute.RouteCandidate[] {
    const out = new Map<string, autoRoute.RouteCandidate>()
    for (const topic of getSpaceFeed(orgId, spaceId).topics) {
        if (topic.archived) continue
        const root = topic.rootMessage
        const author = root ? memberNames.get(root.author.memberId) : undefined
        out.set(topic.rootMessageId, {
            rootMessageId: topic.rootMessageId,
            title: resolveMentions(topic.title, memberNames, spaceNames),
            rootText: root && !root.deletedAt ? gist(root.body, memberNames, spaceNames) : '',
            ...(author ? { rootAuthor: author } : {}),
            replyCount: root?.replyCount ?? 0,
            lastActivityAt: topic.lastActivityAt,
        })
    }
    for (const message of stream.messages) {
        if (message.pending || message.failed || out.has(message.id)) continue
        if (message.deletedAt || !message.body) continue
        const topic = stream.topicsByRoot.get(message.id)
        if (topic?.archived) continue
        const author = memberNames.get(message.author.memberId)
        out.set(message.id, {
            rootMessageId: message.id,
            title: topic ? resolveMentions(topic.title, memberNames, spaceNames) : null,
            rootText: gist(message.body, memberNames, spaceNames),
            ...(author ? { rootAuthor: author } : {}),
            replyCount: message.replyCount,
            lastActivityAt: message.lastReplyAt ?? message.postedAt,
        })
    }
    return [...out.values()].sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0))
}

/** What to call a thread in a toast or banner: its topic title, else its root's first line. */
export function routeThreadLabel(
    orgId: string,
    spaceId: string,
    rootMessageId: string,
    memberNames: ReadonlyMap<string, string>,
    spaceNames: ReadonlyMap<string, string>,
): string {
    const stream = getStreamState(orgId, spaceId)
    const topic = stream.topicsByRoot.get(rootMessageId) ?? getSpaceFeed(orgId, spaceId).topics.find((t) => t.rootMessageId === rootMessageId)
    if (topic) return resolveMentions(topic.title, memberNames, spaceNames)
    const root = stream.messages.find((m) => m.id === rootMessageId) ?? getThreadSnapshot(orgId, spaceId, rootMessageId)?.root
    return root?.body ? threadLabelOf(resolveMentions(root.body, memberNames, spaceNames)) : 'the thread'
}

export type AutoRouteOutcome = autoRoute.AutoRouteDecision | { destination: 'stream'; reason: 'error'; error: string }

// Past this the person is staring at a spinner; the stream is the answer.
const ROUTE_TIMEOUT_MS = 12_000

/** Ask Jev where the draft belongs. Never throws: any failure is the stream, with the error for the caller to mention. */
export async function routeDraft(request: autoRoute.AutoRouteRequest): Promise<AutoRouteOutcome> {
    try {
        const decision = await Promise.race([
            window.ipc.invoke('spaces:autoRoute', request),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), ROUTE_TIMEOUT_MS)),
        ])
        if (!decision) return { destination: 'stream', reason: 'error', error: 'TypeSafe took too long' }
        return decision
    } catch (err) {
        return { destination: 'stream', reason: 'error', error: err instanceof Error ? err.message : 'TypeSafe request failed' }
    }
}
