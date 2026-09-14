import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

// The live listing store (2026-09-14): one fetch per space shared by the @
// menus and the open-board context, primed by the open pane, refreshed once
// a burst of changes in that space settles. Boards are a view over it.

type Listener = (event: unknown) => void
const feed = vi.hoisted(() => ({ listeners: new Set<Listener>() }))
vi.mock('@/lib/spaces-feed', () => ({
    subscribeSpacesFeed: (listener: Listener) => {
        feed.listeners.add(listener)
        return () => feed.listeners.delete(listener)
    },
}))
const emit = (event: unknown) => {
    for (const l of feed.listeners) l(event)
}

const entries: spaces.SpacesAssetEntry[] = [
    { id: 'A-plan', path: 'plan.md', version: 1, updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'A-board', path: 'whiteboards/roadmap.excalidraw', version: 3, updatedAt: '2026-09-03T00:00:00.000Z' },
    { id: 'A-gone', path: 'old.md', version: 1, updatedAt: '2026-09-02T00:00:00.000Z', state: 'deleted' },
]
const invoke = vi.fn()
const listings = () => invoke.mock.calls.filter(([c]) => c === 'spaces:listAssets').length

beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    feed.listeners.clear()
    invoke.mockReset()
    invoke.mockImplementation(async (channel: string) => {
        if (channel === 'spaces:listAssets') return { entries }
        throw new Error(`unexpected ${channel}`)
    })
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})
afterEach(() => {
    vi.useRealTimers()
})

describe('useOrgListings', () => {
    it('fetches each listed space once, keeps live entries only, and derives boards and paths from the same store', async () => {
        const mod = await import('./use-space-boards')
        const orgs = [{ id: 'org', spaceIds: ['s1', 's2'] }]
        const { result } = renderHook(() => ({ listings: mod.useOrgListings(orgs), boards: mod.useOrgBoards(orgs) }))
        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(result.current.listings.get('org')?.get('s1')?.map((e) => e.id)).toEqual(['A-plan', 'A-board'])
        expect(listings()).toBe(2)
        expect(result.current.boards.get('org')?.get('s2')).toEqual([{ id: 'A-board', path: 'whiteboards/roadmap.excalidraw', name: 'roadmap' }])
        expect(mod.boardPathById('org', 's1', 'A-board')).toBe('whiteboards/roadmap.excalidraw')
        expect(mod.boardPathById('org', 's9', 'A-board')).toBeNull()
    })

    it('the open pane primes its space without a fetch; a change there refetches once the burst settles', async () => {
        const mod = await import('./use-space-boards')
        mod.noteListingFromEntries('org', 's1', entries)
        const orgs = [{ id: 'org', spaceIds: ['s1'] }]
        const { result } = renderHook(() => mod.useOrgListings(orgs))
        expect(result.current.get('org')?.get('s1')?.map((e) => e.id)).toEqual(['A-plan', 'A-board'])
        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(listings()).toBe(0)
        const change = (assetPath: string) => ({ orgId: 'org', frame: { kind: 'event', spaceId: 's1', event: { type: 'change', changeSet: { assetPath } } } })
        emit(change('plan.md'))
        emit(change('notes.md'))
        await vi.advanceTimersByTimeAsync(999)
        expect(listings()).toBe(0)
        await vi.advanceTimersByTimeAsync(1)
        expect(listings()).toBe(1)
        // A change in a space the store does not hold is not its business.
        emit({ orgId: 'org', frame: { kind: 'event', spaceId: 's7', event: { type: 'change', changeSet: { assetPath: 'x.md' } } } })
        await vi.advanceTimersByTimeAsync(1_000)
        expect(listings()).toBe(1)
    })

    it('a change that lands while a fetch is in flight runs one more fetch after it — the first snapshot predates the change', async () => {
        let release: (() => void) | null = null
        invoke.mockImplementation((channel: string) => {
            if (channel !== 'spaces:listAssets') throw new Error(`unexpected ${channel}`)
            if (release) return Promise.resolve({ entries })
            return new Promise((resolve) => { release = () => resolve({ entries }) })
        })
        const mod = await import('./use-space-boards')
        mod.noteListingFromEntries('org', 's1', entries)
        renderHook(() => mod.useOrgListings([{ id: 'org', spaceIds: ['s1'] }]))
        const change = { orgId: 'org', frame: { kind: 'event', spaceId: 's1', event: { type: 'change', changeSet: { assetPath: 'a.md' } } } }
        emit(change)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(listings()).toBe(1) // in flight, slow
        emit(change)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(listings()).toBe(1) // not dropped: parked as dirty
        await act(async () => { release!(); await vi.advanceTimersByTimeAsync(0) })
        expect(listings()).toBe(2)
    })
})
