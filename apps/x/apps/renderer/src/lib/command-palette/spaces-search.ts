import type { spaces } from '@x/shared'

// Cross-space search for the ⌘K palette. The org's search route is per space
// (GET /v1/spaces/:spaceId/search — see harbor protocol search.ts), so one
// palette query fans out to every space you are in and merges the categorized
// pages here: messages and files by time (chat convention), discussions
// interleaved by rank so no one space monopolises the top.

export interface SpaceRef {
    orgId: string
    orgName: string
    spaceId: string
    /** The space's name, or the other person's name for a DM. */
    name: string
    direct: boolean
}

export interface SpaceHit<H> {
    space: SpaceRef
    hit: H
}

export interface CrossSpaceResults {
    messages: SpaceHit<spaces.MessageSearchHit>[]
    topics: SpaceHit<spaces.TopicSearchHit>[]
    assets: SpaceHit<spaces.AssetSearchHit>[]
    /** More existed than shown in some category: refine the query. */
    truncated: boolean
}

export const EMPTY_CROSS_SPACE: CrossSpaceResults = { messages: [], topics: [], assets: [], truncated: false }

/** Most spaces one query fans out to. Past the cap, a space is still searchable from its own header bar. */
export const FANOUT_CAP = 40

export function mergeSpaceSearch(
    pages: ReadonlyArray<{ space: SpaceRef; results: spaces.SearchResults }>,
    limit: number,
): CrossSpaceResults {
    const messages = pages
        .flatMap((p) => p.results.messages.map((hit) => ({ space: p.space, hit })))
        .sort((a, b) => b.hit.postedAt.localeCompare(a.hit.postedAt))
    const assets = pages
        .flatMap((p) => p.results.assets.map((hit) => ({ space: p.space, hit })))
        .sort((a, b) => b.hit.updatedAt.localeCompare(a.hit.updatedAt))
    // Each space's topic list is relevance-ordered; take every space's first,
    // then every space's second, and so on.
    const topics: SpaceHit<spaces.TopicSearchHit>[] = []
    for (let i = 0; ; i++) {
        let any = false
        for (const p of pages) {
            const hit = p.results.topics[i]
            if (!hit) continue
            topics.push({ space: p.space, hit })
            any = true
        }
        if (!any) break
    }
    const truncated =
        pages.some((p) => p.results.truncated.messages || p.results.truncated.topics || p.results.truncated.assets)
        || messages.length > limit
        || topics.length > limit
        || assets.length > limit
    return {
        messages: messages.slice(0, limit),
        topics: topics.slice(0, limit),
        assets: assets.slice(0, limit),
        truncated,
    }
}

/** One query across `targets` (unreachable orgs simply contribute nothing). */
export async function searchAllSpaces(
    targets: readonly SpaceRef[],
    q: string,
    opts: { perSpace: number; limit: number },
): Promise<CrossSpaceResults> {
    const settled = await Promise.allSettled(
        targets.slice(0, FANOUT_CAP).map(async (space) => ({
            space,
            results: await window.ipc.invoke('spaces:search', {
                orgId: space.orgId,
                spaceId: space.spaceId,
                q,
                limit: opts.perSpace,
            }),
        })),
    )
    const pages = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
    return mergeSpaceSearch(pages, opts.limit)
}
