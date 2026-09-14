import { describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import { mergeSpaceSearch, type SpaceRef } from './spaces-search'

const design: SpaceRef = { orgId: 'org', orgName: 'Acme', spaceId: 'design', name: 'design', direct: false }
const eng: SpaceRef = { orgId: 'org', orgName: 'Acme', spaceId: 'eng', name: 'eng', direct: false }

const pat = { memberId: 'pat', actingMode: 'direct' as const }
function message(id: string, postedAt: string): spaces.MessageSearchHit {
    return { messageId: id, threadRootId: id, author: pat, snippet: id, postedAt, offset: 1 }
}
function topic(id: string): spaces.TopicSearchHit {
    return { topic: { id, spaceId: 'x', rootMessageId: id, title: id, createdBy: pat, createdAt: '2026-09-01T00:00:00Z', archived: false } }
}
function asset(path: string, updatedAt: string): spaces.AssetSearchHit {
    return { path, version: 1, updatedAt }
}
function page(space: SpaceRef, partial: Partial<spaces.SearchResults>, truncated = false) {
    return {
        space,
        results: {
            messages: [], topics: [], assets: [],
            truncated: { messages: truncated, topics: false, assets: false },
            ...partial,
        },
    }
}

describe('mergeSpaceSearch', () => {
    it('orders messages and files newest-first across spaces and tags each with its space', () => {
        const merged = mergeSpaceSearch([
            page(design, { messages: [message('d-old', '2026-09-01T00:00:00Z'), message('d-new', '2026-09-10T00:00:00Z')], assets: [asset('d.md', '2026-09-03T00:00:00Z')] }),
            page(eng, { messages: [message('e-mid', '2026-09-05T00:00:00Z')], assets: [asset('e.md', '2026-09-08T00:00:00Z')] }),
        ], 10)
        expect(merged.messages.map((m) => `${m.space.name}:${m.hit.messageId}`)).toEqual(['design:d-new', 'eng:e-mid', 'design:d-old'])
        expect(merged.assets.map((a) => a.hit.path)).toEqual(['e.md', 'd.md'])
        expect(merged.truncated).toBe(false)
    })
    it('interleaves discussions by rank so one space cannot monopolise the top', () => {
        const merged = mergeSpaceSearch([
            page(design, { topics: [topic('d1'), topic('d2'), topic('d3')] }),
            page(eng, { topics: [topic('e1')] }),
        ], 10)
        expect(merged.topics.map((t) => t.hit.topic.id)).toEqual(['d1', 'e1', 'd2', 'd3'])
    })
    it('caps each category at the limit and reports truncation from either the cap or the org', () => {
        const capped = mergeSpaceSearch([
            page(design, { messages: [message('a', '2026-09-03T00:00:00Z'), message('b', '2026-09-02T00:00:00Z'), message('c', '2026-09-01T00:00:00Z')] }),
        ], 2)
        expect(capped.messages.map((m) => m.hit.messageId)).toEqual(['a', 'b'])
        expect(capped.truncated).toBe(true)
        const orgSaysMore = mergeSpaceSearch([page(design, { messages: [message('a', '2026-09-03T00:00:00Z')] }, true)], 10)
        expect(orgSaysMore.truncated).toBe(true)
    })
    it('merges nothing into nothing', () => {
        expect(mergeSpaceSearch([], 5)).toEqual({ messages: [], topics: [], assets: [], truncated: false })
    })
})
