import { useSyncExternalStore } from 'react'
import type { find } from '@x/shared'
import { STREAM_READ_KEY, getStreamState } from '@/hooks/use-space-chat'
import { collectRouteCandidates } from '@/lib/spaces-auto-route'
import { requestJump } from '@/lib/spaces-jump'
import { resolveMentions } from '@/lib/spaces-presentation'

// /find (2026-09-24): "take me there, correct me if I am wrong". Candidates
// are the recent roots the composer already holds (no word match needed)
// plus the org's word-search hits (further back, and replies inside
// threads). Jev ranks them by meaning; the first lands, and "not this, next"
// walks the ranking locally, since the Choice returned every probability at
// once. One session at a time, app-wide: whichever pane the current pick
// landed in shows the banner, and a pick that lands elsewhere moves it.

export interface FindSession {
    orgId: string
    spaceId: string
    query: string
    /** Jev's order, strongest first. */
    ranked: find.FindCandidate[]
    index: number
}

/** Below this share of the distribution a candidate is not worth walking to. */
const WALK_MIN_PROBABILITY = 0.05
const WALK_MAX = 8
/** Hits per kind asked of the org's search; the recent roots come free. */
const SEARCH_LIMIT = 20

let session: FindSession | null = null
const listeners = new Set<() => void>()
function emit(): void {
    for (const listener of listeners) listener()
}

export function getFindSession(): FindSession | null {
    return session
}

export function useFindSession(): FindSession | null {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        getFindSession,
    )
}

export function clearFindSession(): void {
    if (!session) return
    session = null
    emit()
}

export type FindLanding = { pane: 'stream' } | { pane: 'thread'; rootMessageId: string }

/** Where a pick lands: a reply, a topic, or a root with replies opens as a thread; a lone root scrolls the stream, neighbours in view. */
export function landingOf(c: find.FindCandidate): FindLanding {
    const isRoot = c.messageId === c.threadRootId
    if (!isRoot || c.title || (c.replyCount ?? 0) > 0) return { pane: 'thread', rootMessageId: c.threadRootId }
    return { pane: 'stream' }
}

export interface FindNav {
    openThread: (rootMessageId: string) => void
    openStream: () => void
}

/** Land on a candidate: the jump is requested first so the pane consumes it as it opens (or where it already is). */
export function landOn(c: find.FindCandidate, nav: FindNav): void {
    const landing = landingOf(c)
    const offset = c.offset !== undefined ? { offset: c.offset } : {}
    if (landing.pane === 'thread') {
        requestJump({ topicId: landing.rootMessageId, messageId: c.messageId, ...offset })
        nav.openThread(landing.rootMessageId)
    } else {
        requestJump({ topicId: STREAM_READ_KEY, messageId: c.messageId, ...offset })
        nav.openStream()
    }
}

/** "Not this": the next pick, landed on; null when the ranking is spent (the session ends). */
export function findNext(nav: FindNav): find.FindCandidate | null {
    if (!session) return null
    if (session.index + 1 >= session.ranked.length) {
        session = null
        emit()
        return null
    }
    session = { ...session, index: session.index + 1 }
    emit()
    const next = session.ranked[session.index]!
    landOn(next, nav)
    return next
}

/** The candidates: recent roots, then the org's search hits (topics and messages), one entry per message. */
export async function gatherFindCandidates(
    orgId: string,
    spaceId: string,
    query: string,
    memberNames: ReadonlyMap<string, string>,
    spaceNames: ReadonlyMap<string, string>,
): Promise<find.FindCandidate[]> {
    const out = new Map<string, find.FindCandidate>()
    for (const r of collectRouteCandidates(orgId, spaceId, getStreamState(orgId, spaceId), memberNames, spaceNames)) {
        out.set(r.rootMessageId, {
            messageId: r.rootMessageId,
            threadRootId: r.rootMessageId,
            title: r.title,
            text: r.rootText,
            ...(r.rootAuthor ? { author: r.rootAuthor } : {}),
            at: r.lastActivityAt,
            replyCount: r.replyCount,
            source: 'recent',
        })
    }
    try {
        const results = await window.ipc.invoke('spaces:search', { orgId, spaceId, q: query, kinds: ['messages', 'topics'], limit: SEARCH_LIMIT })
        for (const { topic } of results.topics) {
            if (topic.archived || out.has(topic.rootMessageId)) continue
            out.set(topic.rootMessageId, {
                messageId: topic.rootMessageId,
                threadRootId: topic.rootMessageId,
                title: resolveMentions(topic.title, memberNames, spaceNames),
                text: '',
                at: topic.createdAt,
                source: 'search',
            })
        }
        for (const m of results.messages) {
            if (out.has(m.messageId)) continue
            const author = memberNames.get(m.author.memberId)
            out.set(m.messageId, {
                messageId: m.messageId,
                threadRootId: m.threadRootId,
                title: m.topicTitle ? resolveMentions(m.topicTitle, memberNames, spaceNames) : null,
                text: resolveMentions(m.snippet, memberNames, spaceNames),
                ...(author ? { author } : {}),
                at: m.postedAt,
                offset: m.offset,
                source: 'search',
            })
        }
    } catch {
        // The org's search is a bonus; the recent roots stand on their own.
    }
    return [...out.values()]
}

export type FindOutcome =
    | { outcome: 'landed'; candidate: find.FindCandidate; total: number }
    | { outcome: 'not-found' }
    | { outcome: 'no-key' }
    | { outcome: 'error'; error: string }

/** Run a find end to end: gather, ask Jev, land on the top pick, open a session for "next". */
export async function runFind(args: {
    orgId: string
    spaceId: string
    spaceName: string
    query: string
    memberNames: ReadonlyMap<string, string>
    spaceNames: ReadonlyMap<string, string>
    nav: FindNav
}): Promise<FindOutcome> {
    clearFindSession()
    const candidates = await gatherFindCandidates(args.orgId, args.spaceId, args.query, args.memberNames, args.spaceNames)
    let result: find.FindResult
    try {
        result = await window.ipc.invoke('spaces:findMessage', { spaceName: args.spaceName, query: args.query, candidates })
    } catch (err) {
        return { outcome: 'error', error: err instanceof Error ? err.message : 'TypeSafe request failed' }
    }
    if (result.reason === 'no-key') return { outcome: 'no-key' }
    if (!result.found) return { outcome: 'not-found' }
    const byId = new Map(candidates.map((c) => [c.messageId, c]))
    const ranked = result.ranked
        .filter((r, i) => i === 0 || r.probability >= WALK_MIN_PROBABILITY)
        .slice(0, WALK_MAX)
        .map((r) => byId.get(r.messageId))
        .filter((c): c is find.FindCandidate => !!c)
    const top = ranked[0]
    if (!top) return { outcome: 'not-found' }
    session = { orgId: args.orgId, spaceId: args.spaceId, query: args.query, ranked, index: 0 }
    emit()
    landOn(top, args.nav)
    return { outcome: 'landed', candidate: top, total: ranked.length }
}

/** Hand a query to the space's search bar: it prefills, focuses, and searches. */
export const FIND_SEARCH_EVENT = 'rowboat:spaces-search'
export function searchInstead(query: string): void {
    window.dispatchEvent(new CustomEvent(FIND_SEARCH_EVENT, { detail: { query } }))
}
