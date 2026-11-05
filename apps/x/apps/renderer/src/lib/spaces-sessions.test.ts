import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { useMySessions } from './spaces-sessions'

// The sessions list (2026-11-05) is Harbor's answer, refetched when a frame
// says a session may have moved, and left alone for frames that cannot.

let feed: ((event: spaces.SpacesBusEvent) => void) | null = null
vi.mock('@/lib/spaces-feed', () => ({
    subscribeSpacesFeed: (listener: (event: spaces.SpacesBusEvent) => void) => {
        feed = listener
        return () => { feed = null }
    },
}))

const listing = (title: string) => ({ spaceId: 's', spaceName: 'Main', root: { id: title, session: { title } }, status: 'idle' }) as unknown as spaces.SessionListing
let answer: spaces.SessionListing[] = []
const invoke = vi.fn(async () => ({ sessions: answer }))
beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
})
afterEach(() => { vi.useRealTimers(); invoke.mockClear() })

describe('useMySessions', () => {
    it('loads, then refetches once for a burst of frames that move sessions', async () => {
        answer = [listing('one')]
        const { result } = renderHook(() => useMySessions('org-a'))
        await waitFor(() => expect(result.current.sessions.map((s) => s.root.id)).toEqual(['one']))
        expect(invoke).toHaveBeenCalledTimes(1)

        answer = [listing('two'), listing('one')]
        const frame = { kind: 'event', spaceId: 's', offset: 2, at: '', event: { type: 'thread_session', rootMessageId: 'two', session: { title: 'two' }, by: { memberId: 'me', actingMode: 'direct' } } }
        act(() => {
            feed!({ orgId: 'org-a', frame: frame as unknown as spaces.ServerFrame })
            feed!({ orgId: 'org-a', frame: { kind: 'read_mark', spaceId: 's', offset: 2, at: '' } as unknown as spaces.ServerFrame })
            feed!({ orgId: 'org-a', frame: { kind: 'presence', spaceId: 's' } as unknown as spaces.ServerFrame })
        })
        await act(async () => { await vi.advanceTimersByTimeAsync(600) })
        await waitFor(() => expect(result.current.sessions.map((s) => s.root.id)).toEqual(['two', 'one']))
        expect(invoke).toHaveBeenCalledTimes(2)
    })
})
