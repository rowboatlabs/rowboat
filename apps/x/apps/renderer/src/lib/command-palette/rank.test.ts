import { describe, expect, it } from 'vitest'
import { rankItems, scoreMatch, scoreTexts } from './rank'

describe('scoreMatch', () => {
    it('tiers exact > prefix > word start > substring > subsequence', () => {
        const exact = scoreMatch('design', 'Design')
        const prefix = scoreMatch('des', 'Design reviews')
        const wordStart = scoreMatch('rev', 'Design reviews')
        const substring = scoreMatch('sig', 'Design')
        const subsequence = scoreMatch('dsg', 'Design')
        expect(exact).toBe(100)
        expect(prefix).toBeGreaterThan(wordStart)
        expect(wordStart).toBeGreaterThan(substring)
        expect(substring).toBeGreaterThan(subsequence)
        expect(subsequence).toBeGreaterThan(0)
    })
    it('returns 0 for no match, an empty query, or a subsequence that is too short to mean anything', () => {
        expect(scoreMatch('xyz', 'Design')).toBe(0)
        expect(scoreMatch('', 'Design')).toBe(0)
        expect(scoreMatch('   ', 'Design')).toBe(0)
        expect(scoreMatch('dg', 'Design')).toBe(0)
    })
    it('only counts a subsequence that starts a word and stays tight', () => {
        expect(scoreMatch('ptl', 'Pat Lee')).toBeGreaterThan(0)
        expect(scoreMatch('rdmp', 'Q4 roadmap')).toBeGreaterThan(0)
        expect(scoreMatch('des', 'Background agents')).toBe(0)
        expect(scoreMatch('des', 'Weekend hike ideas')).toBe(0)
        expect(scoreMatch('pat', 'Investor update draft')).toBe(0)
        expect(scoreMatch('pat', 'Planning the roadmap deck')).toBe(0)
    })
    it('treats #, -, / and _ as word breaks so "#engineering" and "q4-roadmap" match at a word start', () => {
        expect(scoreMatch('eng', '#engineering')).toBeGreaterThanOrEqual(79)
        expect(scoreMatch('road', 'q4-roadmap')).toBeGreaterThanOrEqual(79)
        expect(scoreMatch('notes', 'knowledge/meeting_notes.md')).toBeGreaterThanOrEqual(79)
    })
    it('matches a multi-word query when every word starts a word in the title, in any order', () => {
        const ordered = scoreMatch('design rev', 'Design reviews')
        const reordered = scoreMatch('rev design', 'Design reviews')
        expect(ordered).toBeGreaterThanOrEqual(89) // it is also a prefix
        expect(reordered).toBeGreaterThan(70)
        expect(scoreMatch('design nope', 'Design reviews')).toBe(0)
    })
    it('prefers the shorter title within a tier', () => {
        expect(scoreMatch('des', 'Design')).toBeGreaterThan(scoreMatch('des', 'Design systems weekly'))
    })
})

describe('scoreTexts', () => {
    it('lets a keyword hit count, but never over a title hit of the same tier', () => {
        expect(scoreTexts('knowledge', ['Brain', 'knowledge', 'notes'])).toBeGreaterThan(0)
        expect(scoreTexts('brain', ['Brain', 'knowledge'])).toBeGreaterThan(scoreTexts('knowledge', ['Brain', 'knowledge']))
    })
})

describe('rankItems', () => {
    const items = [
        { name: 'Design', kind: 2, at: '2026-09-01' },
        { name: 'Design', kind: 1, at: '2026-09-01' },
        { name: 'Design review', kind: 2, at: '2026-09-05' },
        { name: 'Design review', kind: 2, at: '2026-09-09' },
        { name: 'Marketing', kind: 1, at: '2026-09-09' },
    ]
    const opts = { texts: (i: (typeof items)[number]) => [i.name], priority: (i: (typeof items)[number]) => i.kind, recency: (i: (typeof items)[number]) => i.at }

    it('drops non-matches, orders by score, then priority, then recency', () => {
        const ranked = rankItems('design', items, opts).map((r) => `${r.item.name}/${r.item.kind}/${r.item.at}`)
        expect(ranked).toEqual([
            'Design/1/2026-09-01',
            'Design/2/2026-09-01',
            'Design review/2/2026-09-09',
            'Design review/2/2026-09-05',
        ])
    })
    it('honours the limit', () => {
        expect(rankItems('design', items, { ...opts, limit: 2 })).toHaveLength(2)
    })
})
