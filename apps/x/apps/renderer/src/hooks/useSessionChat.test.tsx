import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TurnBusEvent } from '@x/shared/src/turns.js'
import type { SessionsClient } from '@/lib/session-chat/client'
import {
  assistantText,
  completed,
  completedTurnLog,
  created,
  requested,
  sessionState,
  turnCompleted,
  user,
} from '@/lib/session-chat/test-fixtures'
import { isChatMessage } from '@/lib/chat-conversation'
import { useSessionChat } from './useSessionChat'

const S1 = 'sess-1'

function makeDeps() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  let emit: (event: TurnBusEvent) => void = () => undefined
  let unsubscribed = 0
  const deltaSubs: string[] = []
  const sessions = new Map([[S1, sessionState(S1, ['turn-1'])]])
  const turns = new Map([['turn-1', completedTurnLog('turn-1', S1, 'q1', 'a1')]])
  const client: SessionsClient = {
    create: async () => ({ sessionId: 'x' }),
    list: async () => ({ sessions: [] }),
    get: async (sessionId) => {
      const state = sessions.get(sessionId)
      if (!state) throw new Error('session not found')
      return state
    },
    getTurn: async (turnId) => ({ turnId, events: turns.get(turnId) ?? [] }),
    sendMessage: async (...args) => {
      calls.push({ method: 'sendMessage', args })
      return { turnId: 'turn-2' }
    },
    respondToPermission: async (...args) => {
      calls.push({ method: 'respondToPermission', args })
    },
    respondToAskHuman: async (...args) => {
      calls.push({ method: 'respondToAskHuman', args })
    },
    stopTurn: async (...args) => {
      calls.push({ method: 'stopTurn', args })
    },
    resumeTurn: async () => undefined,
    setTitle: async () => undefined,
    delete: async () => undefined,
  }
  return {
    deps: {
      client,
      subscribeTurnFeed: (listener: (event: TurnBusEvent) => void) => {
        emit = listener
        return () => {
          unsubscribed += 1
        }
      },
      subscribeDeltas: (turnId: string) => {
        deltaSubs.push(turnId)
        return () => {
          const i = deltaSubs.indexOf(turnId)
          if (i >= 0) deltaSubs.splice(i, 1)
        }
      },
    },
    calls,
    emit: (event: TurnBusEvent) => emit(event),
    deltaSubs,
    getUnsubscribed: () => unsubscribed,
  }
}

function durable(
  turnId: string,
  event: TurnBusEvent['event'],
  offset: number,
): TurnBusEvent {
  return { turnId, sessionId: S1, event, offset }
}

function delta(turnId: string, text: string): TurnBusEvent {
  return {
    turnId,
    sessionId: S1,
    event: { type: 'text_delta', turnId, modelCallIndex: 0, delta: text },
  }
}

describe('useSessionChat', () => {
  it('seeds from the session, follows live events, and routes actions', async () => {
    const { deps, calls, emit, deltaSubs } = makeDeps()
    const { result } = renderHook(() => useSessionChat(S1, deps), { wrapper: StrictMode })

    await waitFor(() => {
      expect(result.current.latestTurnId).toBe('turn-1')
    })
    expect(
      result.current.chatState?.conversation.filter(isChatMessage).map((m) => m.content),
    ).toEqual(['q1', 'a1'])
    // The window subscribed to the latest turn's deltas.
    expect(deltaSubs).toEqual(['turn-1'])

    // A new turn streams in over the turns:events spine.
    act(() => {
      emit(durable('turn-2', created('turn-2', S1, user('q2')), 1))
      emit(durable('turn-2', requested('turn-2', 0), 2))
      emit(delta('turn-2', 'a2…'))
    })
    expect(result.current.latestTurnId).toBe('turn-2')
    expect(result.current.chatState?.currentAssistantMessage).toBe('a2…')
    expect(result.current.chatState?.isProcessing).toBe(true)
    expect(deltaSubs).toEqual(['turn-2'])

    act(() => {
      emit(durable('turn-2', completed('turn-2', 0, assistantText('a2')), 3))
      emit(durable('turn-2', turnCompleted('turn-2', 'a2'), 4))
    })
    expect(result.current.chatState?.isProcessing).toBe(false)

    await act(async () => {
      await result.current.respondToPermission('tc1', 'deny')
      await result.current.stop()
    })
    expect(calls).toEqual([
      { method: 'respondToPermission', args: ['turn-2', 'tc1', 'deny', undefined] },
      { method: 'stopTurn', args: ['turn-2'] },
    ])
  })

  it('unsubscribes from the feed on unmount (StrictMode double-mounts included)', async () => {
    const { deps, getUnsubscribed, deltaSubs } = makeDeps()
    const { unmount } = renderHook(() => useSessionChat(S1, deps), {
      wrapper: StrictMode,
    })
    unmount()
    // StrictMode's simulated cleanup plus the real unmount: every subscribe
    // was matched by an unsubscribe, and no delta subscription leaks.
    expect(getUnsubscribed()).toBe(2)
    expect(deltaSubs).toEqual([])
  })
})
