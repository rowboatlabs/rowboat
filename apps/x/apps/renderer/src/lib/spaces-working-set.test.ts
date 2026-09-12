import { describe, expect, it } from 'vitest'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { NO_BADGE } from '@/lib/spaces-read-state'
import {
    ITEMS_PER_SERVER, resolveExpanded, selectServerItems, serverItems, sumBadges, type WorkingSetItem,
} from '@/lib/spaces-working-set'

const K = ITEMS_PER_SERVER

function item(id: string, over: Partial<WorkingSetItem> = {}): WorkingSetItem {
    return {
        id,
        kind: 'channel',
        name: id,
        badge: NO_BADGE,
        lastActivityAt: '2026-09-01T00:00:00.000Z',
        lastVisitedAt: null,
        ...over,
    }
}

const ids = (items: readonly WorkingSetItem[]) => items.map((i) => i.id)

describe('selectServerItems', () => {
    it('pins the open item and never evicts it, however cold it is', () => {
        const items = [
            item('cold'),
            item('loud', { badge: { unread: 9, forYou: 2 }, lastActivityAt: '2026-09-10T00:00:00.000Z' }),
            item('louder', { badge: { unread: 4, forYou: 0 }, lastActivityAt: '2026-09-11T00:00:00.000Z' }),
            item('recent', { lastVisitedAt: 5_000 }),
            item('alsoRecent', { lastVisitedAt: 4_000 }),
        ]
        expect(ids(selectServerItems(items, 'cold', K))).toEqual(['cold', 'louder', 'loud'])
    })

    it('takes unread before recent, and recent before the backfill', () => {
        const items = [
            item('default', { isDefault: true }),
            item('zebra'),
            item('unread', { badge: { unread: 2, forYou: 0 } }),
            item('visited', { lastVisitedAt: 1_000 }),
        ]
        expect(ids(selectServerItems(items, null, K))).toEqual(['unread', 'visited', 'default'])
    })

    it('orders unread by activity and recent by last visit', () => {
        const items = [
            item('old-unread', { badge: { unread: 1, forYou: 0 }, lastActivityAt: '2026-09-02T00:00:00.000Z' }),
            item('new-unread', { badge: { unread: 1, forYou: 0 }, lastActivityAt: '2026-09-09T00:00:00.000Z' }),
            item('older-visit', { lastVisitedAt: 10 }),
            item('newer-visit', { lastVisitedAt: 99 }),
        ]
        expect(ids(selectServerItems(items, null, 4))).toEqual(['new-unread', 'old-unread', 'newer-visit', 'older-visit'])
    })

    it('backfills to exactly K: the default channel, then channels A-Z, then DMs A-Z', () => {
        const items = [
            item('d1', { kind: 'direct', name: 'Ada' }),
            item('c2', { name: 'beta' }),
            item('c3', { name: 'alpha' }),
            item('c1', { name: 'general', isDefault: true }),
            item('d2', { kind: 'direct', name: 'Zoe' }),
        ]
        const rows = selectServerItems(items, null, K)
        expect(rows).toHaveLength(K)
        expect(rows.map((r) => r.name)).toEqual(['general', 'alpha', 'beta'])
        expect(selectServerItems(items, null, 5).map((r) => r.name)).toEqual(['general', 'alpha', 'beta', 'Ada', 'Zoe'])
    })

    it('shows everything a server has when it has fewer than K items', () => {
        const items = [item('only'), item('other')]
        expect(ids(selectServerItems(items, null, K))).toEqual(['only', 'other'])
        expect(selectServerItems([], null, K)).toEqual([])
    })

    it('holds a showing row in place when it is revisited or goes unread', () => {
        const items = [
            item('a', { isDefault: true }),
            item('b', { name: 'b' }),
            item('c', { name: 'c' }),
            item('d', { name: 'd' }),
        ]
        const first = ids(selectServerItems(items, null, K))
        expect(first).toEqual(['a', 'b', 'c'])
        // 'c' is opened and read: it now outranks the others, but it is already showing.
        const revisited = items.map((i) => (i.id === 'c' ? { ...i, lastVisitedAt: 9_000 } : i))
        expect(ids(selectServerItems(revisited, 'c', K, first))).toEqual(['a', 'b', 'c'])
        // And again once it is unread rather than current.
        const noisy = items.map((i) => (i.id === 'c' ? { ...i, badge: { unread: 3, forYou: 1 } } : i))
        expect(ids(selectServerItems(noisy, null, K, first))).toEqual(['a', 'b', 'c'])
    })

    it('reorders only when an item enters, placing it by rank', () => {
        const items = [item('a', { isDefault: true }), item('b'), item('c'), item('d')]
        const first = ids(selectServerItems(items, null, K)) // a, b, c
        // 'd' goes unread: it enters at the top and evicts the last backfill row.
        const entering = items.map((i) => (i.id === 'd' ? { ...i, badge: { unread: 1, forYou: 0 } } : i))
        const second = ids(selectServerItems(entering, null, K, first))
        expect(second).toEqual(['d', 'a', 'b'])
        // Opening it reads it and records the visit: it keeps its row, in place.
        const read = items.map((i) => (i.id === 'd' ? { ...i, lastVisitedAt: 9_000 } : i))
        expect(ids(selectServerItems(read, null, K, second))).toEqual(['d', 'a', 'b'])
    })

    it('drops ids that are gone and survives a stale previous list', () => {
        const items = [item('a'), item('b')]
        expect(ids(selectServerItems(items, null, K, ['gone', 'b', 'b']))).toEqual(['a', 'b'])
    })
})

describe('serverItems', () => {
    const org = {
        id: 'server',
        memberId: 'me',
        directLabels: { dm: 'Ada' },
        spaces: [
            { id: 'general', name: 'general', createdAt: '2026-09-01T00:00:00.000Z', kind: 'shared' },
            { id: 'design', name: 'design', createdAt: '2026-09-02T00:00:00.000Z', kind: 'shared' },
        ],
        directs: [{ id: 'dm', name: 'direct', createdAt: '2026-09-03T00:00:00.000Z', kind: 'direct', participants: ['me', 'ada'] }],
    } as unknown as OrgWithSpaces

    const read = {
        badge: () => NO_BADGE,
        visitedAt: () => null,
        activityAt: () => null,
        label: () => 'Ada',
    }

    it('lists channels and DMs only — a discussion is never an item', () => {
        const items = serverItems(org, read)
        expect(items.map((i) => i.id)).toEqual(['general', 'design', 'dm'])
        expect(items.filter((i) => i.kind === 'channel').map((i) => i.isDefault)).toEqual([true, false])
        expect(items[2]).toMatchObject({ kind: 'direct', name: 'Ada' })
    })

    it('falls back to the space\'s createdAt until something happens in it', () => {
        expect(serverItems(org, read)[0].lastActivityAt).toBe('2026-09-01T00:00:00.000Z')
        expect(serverItems(org, { ...read, activityAt: () => '2026-09-12T00:00:00.000Z' })[0].lastActivityAt)
            .toBe('2026-09-12T00:00:00.000Z')
    })
})

describe('sumBadges', () => {
    it('is the sum of the server\'s item badges', () => {
        expect(sumBadges([
            item('a', { badge: { unread: 3, forYou: 1 } }),
            item('b', { badge: { unread: 4, forYou: 0 } }),
            item('c'),
        ])).toEqual({ unread: 7, forYou: 1 })
        expect(sumBadges([item('a'), item('b')])).toEqual(NO_BADGE)
        expect(sumBadges([])).toEqual(NO_BADGE)
    })
})

describe('resolveExpanded', () => {
    const quiet = { items: [item('a'), item('b')] }
    const noisy = { items: [item('a'), item('b', { badge: { unread: 1, forYou: 0 } })] }

    it('opens the server holding the open item', () => {
        expect(resolveExpanded(quiet, 'a', null)).toBe(true)
        expect(resolveExpanded(quiet, 'elsewhere', null)).toBe(false)
    })

    it('opens a server with anything unread, and closes every other', () => {
        expect(resolveExpanded(noisy, null, null)).toBe(true)
        expect(resolveExpanded({ items: [item('a', { badge: { unread: 0, forYou: 2 } })] }, null, null)).toBe(true)
        expect(resolveExpanded(quiet, null, null)).toBe(false)
        expect(resolveExpanded({ items: [] }, null, null)).toBe(false)
    })

    it('lets the reader\'s own toggle stand over either rule', () => {
        expect(resolveExpanded(noisy, 'a', false)).toBe(false)
        expect(resolveExpanded(quiet, null, true)).toBe(true)
    })
})
