import type { spaces } from '@x/shared'
import { getSpaceFeed } from '@/hooks/use-spaces'

// The search corpus for one space: the newest page of the stream plus the
// active discussions' threads, fetched on demand and cached briefly. The
// protocol has no search route (a Latitude item), so search — and the
// pinned-messages panel — work over what a client can reach: the same
// windows the panes themselves load.
// Results are therefore "recent history", not an archive crawl; honest and
// cheap. The cache keeps the quick switcher responsive while typing without
// refetching per keystroke.

const CACHE_TTL_MS = 45_000
/** Most-recently-active topics fetched per space — a page each. */
const TOPIC_CAP = 30

interface CorpusEntry {
    at: number
    messages: spaces.Message[]
    loading: Promise<spaces.Message[]> | null
}

const cache = new Map<string, CorpusEntry>()

function key(orgId: string, spaceId: string): string {
    return `${orgId}/${spaceId}`
}

/**
 * Fetch (or reuse) the corpus. Topics come from the feed store — already
 * loaded for every known space. One listMessages per topic, concurrent,
 * newest page only; failures just drop that topic from the corpus.
 */
export function loadSpaceCorpus(orgId: string, spaceId: string): Promise<spaces.Message[]> {
    const k = key(orgId, spaceId)
    const entry = cache.get(k)
    if (entry?.loading) return entry.loading
    if (entry && Date.now() - entry.at < CACHE_TTL_MS) return Promise.resolve(entry.messages)

    const topics = [...getSpaceFeed(orgId, spaceId).topics]
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
        .slice(0, TOPIC_CAP)
    // The corpus is the stream's roots plus the replies under the most
    // active discussions — the annotation model has no per-topic message
    // list to walk, so one stream page stands in for what listMessages gave.
    const loading = Promise.all([
        window.ipc
            .invoke('spaces:listStream', { orgId, spaceId })
            .then((res) => res.messages)
            .catch(() => [] as spaces.Message[]),
        ...topics.map((t) =>
            window.ipc
                .invoke('spaces:listThread', { orgId, spaceId, rootMessageId: t.rootMessageId })
                .then((res) => res.messages)
                .catch(() => [] as spaces.Message[]),
        ),
    ]).then((pages) => {
        const messages = pages.flat().filter((m) => !m.deletedAt)
        cache.set(k, { at: Date.now(), messages, loading: null })
        return messages
    })
    cache.set(k, { at: entry?.at ?? 0, messages: entry?.messages ?? [], loading })
    return loading
}

/** The cached corpus, if fresh enough to paint immediately (search-as-you-type). */
export function peekSpaceCorpus(orgId: string, spaceId: string): spaces.Message[] | null {
    const entry = cache.get(key(orgId, spaceId))
    return entry && entry.messages.length > 0 ? entry.messages : null
}

// ---------------------------------------------------------------------------
// Query syntax — the Discord/Slack filter grammar over the corpus:
//   from:<name>      author's display name contains <name> ('me' = you)
//   in:<topic>       the topic's title contains <topic> ('messages' = the stream)
//   has:link|image|file   the body carries one
//   mentions:<name>  the body @-mentions <name> ('me' = you)
// Everything else is a free-text term; all terms and filters must hit.
// ---------------------------------------------------------------------------

export interface ParsedQuery {
    /** Free-text terms — every one must hit the resolved body or author name. */
    terms: string[]
    from: string[]
    inTopic: string[]
    has: string[]
    mentions: string[]
    /** True when any from:/in:/has:/mentions: token was present. */
    filtered: boolean
}

const FILTER_RE = /^(from|in|has|mentions):(.+)$/

export function parseSearchQuery(query: string): ParsedQuery {
    const parsed: ParsedQuery = { terms: [], from: [], inTopic: [], has: [], mentions: [], filtered: false }
    for (const token of query.toLowerCase().split(/\s+/).filter(Boolean)) {
        const m = FILTER_RE.exec(token)
        if (!m) {
            parsed.terms.push(token)
        } else if (m[1] === 'from') parsed.from.push(m[2]!)
        else if (m[1] === 'in') parsed.inTopic.push(m[2]!)
        else if (m[1] === 'has') parsed.has.push(m[2]!)
        else parsed.mentions.push(m[2]!)
    }
    parsed.filtered = parsed.from.length + parsed.inTopic.length + parsed.has.length + parsed.mentions.length > 0
    return parsed
}

/** has:<kind> detectors over raw wire text (a body or a search snippet; blob links carry /b/<hash>). */
export function hasKind(body: string, kind: string): boolean {
    if (kind === 'link') return /https?:\/\//.test(body)
    if (kind === 'image') return /!\[[^\]]*\]\(/.test(body)
    if (kind === 'file') return /(?<!!)\[[^\]]*\]\([^)]*\/b\//.test(body)
    return false
}

/**
 * Pins ride the reaction wire: pinned = anyone's 📌 on the message. Shared,
 * durable, attributed — and zero protocol change. Unpinning removes YOUR 📌
 * (reaction semantics); someone else's pin stays theirs.
 */
export const PIN_EMOJI = '📌'

/** Messages anyone pinned (the 📌 reaction), newest first. */
export function pinnedMessages(messages: readonly spaces.Message[]): spaces.Message[] {
    return messages
        .filter((m) => (m.reactions ?? []).some((g) => g.emoji === PIN_EMOJI && g.memberIds.length > 0))
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
}
