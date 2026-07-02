import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SessionBusEvent } from '@x/shared/src/sessions.js'
import type { SessionsClient } from '@/lib/session-chat/client'
import type { SessionFeedListener } from '@/lib/session-chat/feed'
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
  let emit: SessionFeedListener = () => undefined
  let unsubscribed = 0
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
      subscribeFeed: (listener: SessionFeedListener) => {
        emit = listener
        return () => {
          unsubscribed += 1
        }
      },
    },
    calls,
    emit: (event: SessionBusEvent) => emit(event),
    getUnsubscribed: () => unsubscribed,
  }
}

describe('useSessionChat', () => {
  it('seeds from the session, follows live events, and routes actions', async () => {
    const { deps, calls, emit } = makeDeps()
    const { result } = renderHook(() => useSessionChat(S1, deps))

    await waitFor(() => {
      expect(result.current.latestTurnId).toBe('turn-1')
    })
    expect(
      result.current.chatState?.conversation.filter(isChatMessage).map((m) => m.content),
    ).toEqual(['q1', 'a1'])

    // A new turn streams in over the feed.
    act(() => {
      emit({ kind: 'turn-event', sessionId: S1, turnId: 'turn-2', event: created('turn-2', S1, user('q2')) })
      emit({ kind: 'turn-event', sessionId: S1, turnId: 'turn-2', event: requested('turn-2', 0, [user('q2')]) })
      emit({
        kind: 'turn-event',
        sessionId: S1,
        turnId: 'turn-2',
        event: { type: 'text_delta', turnId: 'turn-2', modelCallIndex: 0, delta: 'a2…' },
      })
    })
    expect(result.current.latestTurnId).toBe('turn-2')
    expect(result.current.chatState?.currentAssistantMessage).toBe('a2…')
    expect(result.current.chatState?.isProcessing).toBe(true)

    act(() => {
      emit({ kind: 'turn-event', sessionId: S1, turnId: 'turn-2', event: completed('turn-2', 0, assistantText('a2')) })
      emit({ kind: 'turn-event', sessionId: S1, turnId: 'turn-2', event: turnCompleted('turn-2', 'a2') })
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

  it('unsubscribes from the feed on unmount', async () => {
    const { deps, getUnsubscribed } = makeDeps()
    const { unmount } = renderHook(() => useSessionChat(S1, deps))
    unmount()
    expect(getUnsubscribed()).toBe(1)
  })
})
