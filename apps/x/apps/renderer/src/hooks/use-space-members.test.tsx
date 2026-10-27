import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { applyProfileUpdate, useOrgRoster, useSpaceMembers } from './use-space-members'

const person = { id: 'me', displayName: 'Before', role: 'member', kind: 'human' } as spaces.Member
const changed = { ...person, displayName: 'After', title: 'Designer' }
const invoke = vi.fn()
beforeEach(() => { invoke.mockReset(); Object.assign(window, { ipc: { invoke } }) })
afterEach(cleanup)

it('updates existing member records across rosters without changing membership or other orgs', async () => {
    invoke.mockImplementation(async (_channel, args) => ({ members: args.spaceId === 'empty' ? [] : [person] }))
    const { result } = renderHook(() => ({
        org: useOrgRoster('profile-cache', []),
        space: useSpaceMembers('profile-cache', 'joined'),
        empty: useSpaceMembers('profile-cache', 'empty'),
        other: useOrgRoster('different-org', []),
    }))
    await waitFor(() => expect(result.current.space).toEqual([person]))
    await waitFor(() => expect(result.current.other).toEqual([person]))
    act(() => applyProfileUpdate('profile-cache', changed))
    expect(result.current.org).toEqual([changed])
    expect(result.current.space).toEqual([changed])
    expect(result.current.empty).toEqual([])
    expect(result.current.other).toEqual([person])
})

it('discards an in-flight stale roster and fetches again after a live profile change', async () => {
    let finish: (value: { members: spaces.Member[] }) => void = () => {}
    invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    invoke.mockResolvedValue({ members: [changed] })
    const { result } = renderHook(() => useOrgRoster('profile-race', []))
    act(() => applyProfileUpdate('profile-race', changed))
    await act(async () => finish({ members: [person] }))
    await waitFor(() => expect(result.current).toEqual([changed]))
    expect(invoke).toHaveBeenCalledTimes(2)
})
