import { useSyncExternalStore } from 'react'
import type { autoRoute } from '@x/shared'
import type { StreamState } from '@/hooks/use-space-chat'
import { getSpaceFeed } from '@/hooks/use-spaces'
import { resolveMentions } from '@/lib/spaces-presentation'

// The stream composer's Auto toggle (2026-09-22): with it on, Jev (TypeSafe's
// System One model) decides at send time whether the draft is a new stream
// message or a reply to one of the space's open threads. This module owns the
// toggle's per-install state, the candidate set the renderer already holds,
// and the IPC call; the questions, thresholds and key live in core.

const STORAGE_KEY = 'spaces:auto-route'
const listeners = new Set<() => void>()

function readStored(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

let enabled = readStored()

export function isAutoRouteEnabled(): boolean {
    return enabled
}

export function setAutoRouteEnabled(next: boolean): void {
    enabled = next
    try {
        if (next) window.localStorage.setItem(STORAGE_KEY, '1')
        else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
        // Quota/private mode: the toggle just does not persist.
    }
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function useAutoRouteEnabled(): boolean {
    return useSyncExternalStore(subscribe, isAutoRouteEnabled)
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
 * store keeps them all loaded) plus the loaded stream roots that have replies
 * but no topic row. One entry per root, newest activity first; tombstoned
 * roots and unconfirmed rows are not destinations.
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
        if ((message.replyCount ?? 0) === 0 || message.deletedAt || !message.body) continue
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
