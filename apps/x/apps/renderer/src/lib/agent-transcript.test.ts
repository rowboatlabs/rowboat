import { describe, expect, it } from 'vitest'
import { turnToTranscript } from './agent-transcript'
import { completedTurnLog, created, requested, user } from './session-chat/test-fixtures'

describe('turnToTranscript', () => {
  it('maps a completed turn to id/createdAt/summary/items', () => {
    const events = completedTurnLog('turn-1', 'sess-1', 'do the thing', 'all done')
    const t = turnToTranscript('turn-1', events)
    expect(t.id).toBe('turn-1')
    expect(t.createdAt).toBeDefined()
    expect(t.summary).toBe('all done')
    expect(t.error).toBeUndefined()
    expect(t.trigger).toBeUndefined()
    expect(t.items.length).toBeGreaterThan(0)
  })

  it('surfaces turn_failed as error with no summary', () => {
    const events = [
      created('turn-2', 'sess-1', user('go')),
      requested('turn-2', 0),
      { type: 'model_call_failed' as const, turnId: 'turn-2', ts: '2026-07-02T10:00:00Z', modelCallIndex: 0, error: 'boom' },
      { type: 'turn_failed' as const, turnId: 'turn-2', ts: '2026-07-02T10:00:00Z', error: 'boom', usage: {} },
    ]
    const t = turnToTranscript('turn-2', events)
    expect(t.error).toBe('boom')
    expect(t.summary).toBeUndefined()
  })
})
