import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AgentLoopTurn } from '@x/shared/src/agent-turn.js'
import type { SessionBusEvent } from '@x/shared/src/sessions.js'
import { subscribeSessionFeed } from '../lib/session-feed.js'
import { useSessionChat } from './useSessionChat.js'

vi.mock('../lib/session-feed.js', () => ({ subscribeSessionFeed: vi.fn() }))

type Turn = z.infer<typeof AgentLoopTurn>

function turn(overrides: Partial<Turn> = {}): Turn {
  const now = '2026-06-14T00:00:00Z'
  return {
    id: 't1', agentId: 'copilot', provider: null, model: null, permissionMode: 'manual',
    useCase: null, subUseCase: null,
    sessionId: 's1', sessionSeq: 1, composeContext: null, messages: [],
    permissionRequests: [], permissionDecisions: [], startedTools: [], dispatchedTools: [],
    modelUsage: [], error: null, completedAt: null, createdAt: now, updatedAt: now,
    ...overrides,
  }
}

let emit: (e: SessionBusEvent) => void = () => undefined
const invoke = vi.fn()

beforeEach(() => {
  vi.mocked(subscribeSessionFeed).mockImplementation((listener) => {
    emit = listener
    return () => undefined
  })
  invoke.mockReset()
  invoke.mockResolvedValue({ turns: [] })
  ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: vi.fn(), send: vi.fn() }
})

afterEach(() => {
  delete (window as unknown as { ipc?: unknown }).ipc
})

describe('useSessionChat', () => {
  it('seeds from sessions:listTurns and derives chat state', async () => {
    invoke.mockResolvedValueOnce({ turns: [turn({ messages: [{ role: 'user', content: 'hi' }], completedAt: '2026-06-14T00:00:02Z' })] })
    const { result } = renderHook(() => useSessionChat('s1'))
    await waitFor(() => expect(result.current.chatState).not.toBeNull())
    expect(invoke).toHaveBeenCalledWith('sessions:listTurns', { sessionId: 's1' })
    expect(result.current.chatState?.conversation).toHaveLength(1)
    expect(result.current.chatState?.isProcessing).toBe(false)
  })

  it('updates from a state snapshot and accumulates streaming text from live events', async () => {
    const { result } = renderHook(() => useSessionChat('s1'))
    act(() => emit({ kind: 'state', turnId: 't1', sessionId: 's1', turn: turn({ messages: [{ role: 'user', content: 'go' }] }) }))
    expect(result.current.chatState?.isProcessing).toBe(true)
    act(() => emit({ kind: 'event', turnId: 't1', sessionId: 's1', event: { type: 'text-delta', delta: 'streaming…' } }))
    expect(result.current.chatState?.currentAssistantMessage).toBe('streaming…')
  })

  it('ignores feed events for other sessions', async () => {
    const { result } = renderHook(() => useSessionChat('s1'))
    act(() => emit({ kind: 'state', turnId: 'x', sessionId: 'OTHER', turn: turn({ id: 'x', sessionId: 'OTHER' }) }))
    expect(result.current.chatState).toBeNull()
  })

  it('routes actions to the right IPC channels against the latest turn', async () => {
    const { result } = renderHook(() => useSessionChat('s1'))
    act(() => emit({ kind: 'state', turnId: 't1', sessionId: 's1', turn: turn() }))
    invoke.mockResolvedValue({ turnId: 't1' })

    await act(async () => { await result.current.sendMessage([{ role: 'user', content: 'hi' }], { model: 'gpt-x' }) })
    expect(invoke).toHaveBeenCalledWith('sessions:sendMessage', { sessionId: 's1', messages: [{ role: 'user', content: 'hi' }], options: { model: 'gpt-x' } })

    await act(async () => { await result.current.respondToPermission('tc1', 'granted') })
    expect(invoke).toHaveBeenCalledWith('sessions:respondToPermission', { turnId: 't1', toolCallId: 'tc1', decision: 'granted' })

    await act(async () => { await result.current.answerAskHuman('tc2', 'Yes') })
    expect(invoke).toHaveBeenCalledWith('sessions:setToolResult', { turnId: 't1', toolCallId: 'tc2', result: 'Yes' })

    await act(async () => { await result.current.stop() })
    expect(invoke).toHaveBeenCalledWith('sessions:stopTurn', { turnId: 't1' })
  })
})
