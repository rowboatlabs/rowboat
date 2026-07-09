import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { completedTurnLog } from '@/lib/session-chat/test-fixtures'
import { useAgentRunTranscript } from './use-agent-run-transcript'

// Same preload stub as use-turn.test.tsx: the hook rides useTurn (real
// turn-feed singleton) plus a runs:fetch legacy fallback.
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  invoke: (channel: string, args: unknown) => {
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.resolve({ success: true })
  },
}

beforeEach(() => {
  handlers = {}
})

describe('useAgentRunTranscript', () => {
  it('renders a turn-backed transcript', async () => {
    handlers['sessions:getTurn'] = async () => ({
      turnId: 'run-1',
      events: completedTurnLog('run-1', 's1', 'do the task', 'task done'),
    })
    const { result } = renderHook(() => useAgentRunTranscript('run-1'))

    await waitFor(() => expect(result.current.transcript).not.toBeNull())
    expect(result.current.transcript?.id).toBe('run-1')
    expect(result.current.transcript?.summary).toBe('task done')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('falls back to legacy runs:fetch when the id is not a turn', async () => {
    handlers['sessions:getTurn'] = async () => {
      throw new Error('turn not found: legacy id')
    }
    handlers['runs:fetch'] = async (args) => ({
      id: (args as { runId: string }).runId,
      createdAt: '2026-07-01T00:00:00Z',
      subUseCase: 'cron',
      log: [],
    })
    const { result } = renderHook(() => useAgentRunTranscript('legacy-run'))

    await waitFor(() => expect(result.current.transcript).not.toBeNull())
    expect(result.current.transcript?.id).toBe('legacy-run')
    expect(result.current.transcript?.trigger).toBe('cron')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('surfaces an error when both the turn and legacy paths fail', async () => {
    handlers['sessions:getTurn'] = async () => {
      throw new Error('turn not found')
    }
    handlers['runs:fetch'] = async () => {
      throw new Error('run not found either')
    }
    const { result } = renderHook(() => useAgentRunTranscript('ghost-run'))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toMatch(/run not found either/)
    expect(result.current.transcript).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('is idle without a run id', () => {
    const { result } = renderHook(() => useAgentRunTranscript(null))
    expect(result.current.transcript).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
