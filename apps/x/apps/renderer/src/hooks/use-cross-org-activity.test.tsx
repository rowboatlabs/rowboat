import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { useCrossOrgActivity } from './use-cross-org-activity'

const feed = vi.hoisted(() => ({ listener: null as ((event: spaces.SpacesBusEvent) => void) | null }))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: (listener: typeof feed.listener) => { feed.listener = listener; return () => { feed.listener = null } } }))
const invoke = vi.fn()
const page = (minutes: number[]): spaces.SpacesActivityPage => ({ seenAt: null, names: { person: 'Teammate' },
    items: minutes.map((minute) => ({ id: `event-${minute}`, at: `2026-09-15T10:${String(minute).padStart(2, '0')}:00Z` } as spaces.SpacesActivityItem)),
})
beforeEach(() => {
    invoke.mockReset().mockImplementation(async (_channel, { orgId }) => page(orgId === 'one' ? [9, 7, 5, 3, 1] : [8, 6, 4, 2, 0]))
    vi.stubGlobal('ipc', { invoke })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('cross-org Activity', () => {
    it('merges the latest three globally, with independent names and no read acknowledgments', async () => {
        const { result } = renderHook(() => useCrossOrgActivity(['one', 'two'], true))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.items.map(({ orgId, item }) => [orgId, item.id])).toEqual([
            ['one', 'event-9'], ['two', 'event-8'], ['one', 'event-7'],
        ])
        expect(invoke).toHaveBeenCalledTimes(2)
        for (const orgId of ['one', 'two']) expect(invoke).toHaveBeenCalledWith('spaces:getActivity', { orgId, limit: 3 })
        expect(result.current.items[0].names.get('person')).toBe('Teammate')
    })
    it('shows successful orgs while another is pending or unavailable and supports retry', async () => {
        let reject!: (error: Error) => void
        invoke.mockImplementation(async (_channel, { orgId }) => orgId === 'one' ? page([9]) : new Promise((_, fail) => { reject = fail }))
        const { result } = renderHook(() => useCrossOrgActivity(['one', 'two'], true))
        await waitFor(() => expect(result.current.items).toHaveLength(1))
        expect(result.current.loading).toBe(true)
        await act(async () => reject(new Error('Offline')))
        expect(result.current.failedOrgIds).toEqual(['two'])
        invoke.mockResolvedValue(page([10]))
        act(() => result.current.retry())
        await waitFor(() => expect(result.current.failedOrgIds).toEqual([]))
        await waitFor(() => expect(result.current.loading).toBe(false))
    })
    it('drops removed orgs and ignores their outstanding responses', async () => {
        let resolve!: (value: spaces.SpacesActivityPage) => void
        invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
        const view = renderHook(({ ids }) => useCrossOrgActivity(ids, true), { initialProps: { ids: ['one', 'two'] } })
        await waitFor(() => expect(view.result.current.items.length).toBeGreaterThan(0))
        view.rerender({ ids: ['two'] })
        await act(async () => resolve(page([59])))
        expect(view.result.current.items.every((item) => item.orgId === 'two')).toBe(true)
    })
    it('refreshes only the affected org, coalesces bursts, and pauses while collapsed', async () => {
        vi.useFakeTimers()
        const view = renderHook(({ active }) => useCrossOrgActivity(['one', 'two'], active), { initialProps: { active: true } })
        await act(async () => {})
        const notify = (orgId: string) => feed.listener?.({ orgId, frame: { kind: 'notify' } } as spaces.SpacesBusEvent)
        act(() => { notify('one'); notify('one'); notify('unknown') })
        await act(async () => { vi.advanceTimersByTime(1_000) })
        expect(invoke).toHaveBeenCalledTimes(3)
        expect(invoke).toHaveBeenLastCalledWith('spaces:getActivity', { orgId: 'one', limit: 3 })
        act(() => notify('two'))
        view.rerender({ active: false })
        await act(async () => { vi.advanceTimersByTime(1_000) })
        expect(invoke).toHaveBeenCalledTimes(3)
        expect(feed.listener).toBeNull()
        view.rerender({ active: true })
        await act(async () => {})
        expect(invoke).toHaveBeenCalledTimes(5)
    })
})
