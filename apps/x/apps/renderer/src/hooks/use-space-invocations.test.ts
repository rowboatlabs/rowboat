import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

const feed = vi.hoisted(() => ({ listener: undefined as ((event: unknown) => void) | undefined }))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: (listener: (event: unknown) => void) => { feed.listener = listener; return () => {} } }))
import { useSpaceInvocations } from './use-space-invocations'

afterEach(cleanup)
const entry = (id: string): spaces.InvocationActivity => ({ id, at: '2026-11-01T10:00:00.000Z', state: 'working', activity: `Step ${id}` })
const invocation = (updatedAt: string, extra: Partial<spaces.Invocation> = {}): spaces.Invocation => ({
    id: 'turn', agentId: 'agent', conversation: { spaceId: 'space', threadRootId: 'message' },
    trigger: { messageId: 'message', authorId: 'person', body: 'Go' }, where: { spaceKind: 'shared', spaceName: 'Test' },
    state: 'working', depth: 0, createdAt: '2026-11-01T10:00:00.000Z', updatedAt, ...extra,
})

describe('turn activity snapshots and live updates', () => {
    it('fills earlier history from a slow snapshot without losing newer frames, deduplicates reconnects and clears finished turns', async () => {
        let resolve!: (value: { invocations: spaces.Invocation[] }) => void
        const snapshot = new Promise<{ invocations: spaces.Invocation[] }>((done) => { resolve = done })
        const invoke = vi.fn().mockReturnValueOnce(snapshot).mockResolvedValue({ invocations: [invocation('2026-11-01T10:00:01.000Z', { activityHistory: [entry('1'), entry('2')] })] })
        ;(window as unknown as { ipc: unknown }).ipc = { invoke }
        const { result } = renderHook(() => useSpaceInvocations('history-org', 'space'))
        const current = () => result.current.get('message')?.[0]
        act(() => feed.listener?.({ orgId: 'history-org', frame: { kind: 'invocation_state', spaceId: 'space', invocation: invocation('2026-11-01T10:00:02.000Z', { activity: 'Step 2' }), activityEntry: entry('2') } }))
        await act(async () => resolve({ invocations: [invocation('2026-11-01T10:00:01.000Z', { activityHistory: [entry('1')] })] }))
        expect(current()?.activityHistory?.map((e) => e.id)).toEqual(['1', '2'])
        expect(current()?.activity).toBe('Step 2')
        act(() => feed.listener?.({ orgId: 'history-org', frame: { kind: 'subscribed', spaceId: 'space' } }))
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
        expect(current()?.activityHistory?.map((e) => e.id)).toEqual(['1', '2'])
        act(() => feed.listener?.({ orgId: 'history-org', frame: { kind: 'invocation_state', spaceId: 'space', invocation: invocation('2026-11-01T10:00:03.000Z', { state: 'done' }) } }))
        expect(current()?.activityHistory).toBeUndefined()
        // A delayed running snapshot can have the same millisecond timestamp as completion.
        invoke.mockResolvedValue({ invocations: [invocation('2026-11-01T10:00:03.000Z', { activityHistory: [entry('1')] })] })
        act(() => feed.listener?.({ orgId: 'history-org', frame: { kind: 'subscribed', spaceId: 'space' } }))
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
        expect(current()?.state).toBe('done')
        expect(current()?.activityHistory).toBeUndefined()
    })

    it('keeps the newest lines of a long turn and no more, as Harbor does', async () => {
        const invoke = vi.fn().mockResolvedValue({ invocations: [] })
        ;(window as unknown as { ipc: unknown }).ipc = { invoke }
        const { result } = renderHook(() => useSpaceInvocations('long-org', 'space'))
        const current = () => result.current.get('message')?.[0]
        const reports = 130
        for (let n = 0; n < reports; n += 1) {
            const id = String(n).padStart(4, '0')
            act(() => feed.listener?.({ orgId: 'long-org', frame: { kind: 'invocation_state', spaceId: 'space', invocation: invocation(`2026-11-01T10:00:0${n % 10}.000Z`, { activity: `Step ${id}` }), activityEntry: entry(id) } }))
        }
        const history = current()?.activityHistory ?? []
        expect(history).toHaveLength(100)
        expect(history.at(0)?.id).toBe(String(reports - 100).padStart(4, '0'))
        expect(history.at(-1)?.id).toBe(String(reports - 1).padStart(4, '0'))
    })
})
