import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { applyMemberPresence, usePeopleOnline, refreshOrgRoster, applyProfileUpdate, useOrgRoster, useSpaceMembers } from './use-space-members'

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

it('hydrates online people, applies live changes per org, and repairs missed changes from the roster', async () => {
    invoke.mockResolvedValue({ members: [person], onlinePeople: ['me'] })
    const { result } = renderHook(() => {
        useOrgRoster('online-dots', [])
        return { online: usePeopleOnline('online-dots'), other: usePeopleOnline('other-online-dots') }
    })
    await waitFor(() => expect(result.current.online.has('me')).toBe(true))
    act(() => applyMemberPresence('online-dots', 'me', false))
    expect(result.current.online.has('me')).toBe(false)
    act(() => applyMemberPresence('online-dots', 'friend', true))
    expect(result.current.online.has('friend')).toBe(true)
    expect(result.current.other.size).toBe(0)
    invoke.mockResolvedValue({ members: [person], onlinePeople: [] })
    act(() => refreshOrgRoster('online-dots'))
    await waitFor(() => expect(result.current.online.size).toBe(0))
})

it('does not let an in-flight snapshot overwrite a newer presence frame', async () => {
    let finish: (value: unknown) => void = () => {}
    invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    invoke.mockResolvedValue({ members: [person], onlinePeople: ['friend'] })
    const { result } = renderHook(() => {
        useOrgRoster('online-race', [])
        return usePeopleOnline('online-race')
    })
    act(() => applyMemberPresence('online-race', 'friend', true))
    await act(async () => finish({ members: [person], onlinePeople: [] }))
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(result.current.has('friend')).toBe(true)
})

it('shows no online dots for older servers without onlinePeople', async () => {
    invoke.mockResolvedValue({ members: [person] })
    const { result } = renderHook(() => {
        const roster = useOrgRoster('online-old-server', [])
        return { roster, online: usePeopleOnline('online-old-server') }
    })
    await waitFor(() => expect(result.current.roster).toEqual([person]))
    expect(result.current.online.size).toBe(0)
})
