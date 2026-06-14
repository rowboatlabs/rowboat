import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import type { AgentLoopTurn } from '@x/shared/src/agent-turn.js'
import type { MessageList } from '@x/shared/src/message.js'
import type { SendMessageOptions } from '@x/shared/src/sessions.js'
import { applyOverlay, emptyOverlay, type LiveOverlay } from '../lib/agent-turn-view.js'
import { subscribeSessionFeed } from '../lib/session-feed.js'
import { turnToChatState, type SessionChatState } from '../lib/session-chat-state.js'

type Turn = z.infer<typeof AgentLoopTurn>

export type SessionChat = {
  // The rendered chat state for this session, or null until its first turn
  // loads. Shape matches the fields the existing chat renderer consumes.
  chatState: SessionChatState | null
  // The turn currently in flight / latest (target for permission, ask-human,
  // and stop actions). null when the session has no turns yet.
  latestTurnId: string | null
  sendMessage: (
    messages: z.infer<typeof MessageList>,
    options?: z.infer<typeof SendMessageOptions>,
  ) => Promise<{ turnId: string }>
  respondToPermission: (toolCallId: string, decision: 'granted' | 'denied') => Promise<void>
  answerAskHuman: (toolCallId: string, answer: string) => Promise<void>
  stop: () => Promise<void>
}

// Owns the session→chat data flow for one session: seeds the latest turn,
// tracks the global feed (state snapshots replace the turn + clear the live
// overlay; live events accumulate streaming text / tool output), and derives the
// renderer-facing chat state via the pure turnToChatState mapper. All state
// writes happen in async callbacks; stale state across a sessionId change is
// filtered in render. App.tsx consumes this rather than inlining the logic.
export function useSessionChat(sessionId: string | null): SessionChat {
  const [live, setLive] = useState<{ turn: Turn; overlay: LiveOverlay } | null>(null)

  useEffect(() => {
    if (!sessionId) return
    let active = true
    void window.ipc
      .invoke('sessions:listTurns', { sessionId })
      .then(({ turns }) => {
        const latest = turns[turns.length - 1]
        if (active && latest) setLive({ turn: latest, overlay: emptyOverlay() })
      })
      .catch(() => {
        // New/unreadable session; feed state events will populate it.
      })

    const unsubscribe = subscribeSessionFeed((event) => {
      if (event.sessionId !== sessionId) return
      if (event.kind === 'state') {
        setLive({ turn: event.turn, overlay: emptyOverlay() })
      } else {
        setLive((prev) => (prev ? { turn: prev.turn, overlay: applyOverlay(prev.overlay, event.event) } : prev))
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [sessionId])

  // Ignore state left over from a previous sessionId until the new one loads.
  const current = live && live.turn.sessionId === sessionId ? live : null
  const latestTurnId = current ? current.turn.id : null

  const sendMessage = useCallback<SessionChat['sendMessage']>(
    (messages, options) => {
      if (!sessionId) return Promise.reject(new Error('No active session'))
      return window.ipc.invoke('sessions:sendMessage', {
        sessionId,
        messages,
        ...(options ? { options } : {}),
      })
    },
    [sessionId],
  )

  const respondToPermission = useCallback<SessionChat['respondToPermission']>(
    async (toolCallId, decision) => {
      if (!latestTurnId) return
      await window.ipc.invoke('sessions:respondToPermission', { turnId: latestTurnId, toolCallId, decision })
    },
    [latestTurnId],
  )

  const answerAskHuman = useCallback<SessionChat['answerAskHuman']>(
    async (toolCallId, answer) => {
      if (!latestTurnId) return
      await window.ipc.invoke('sessions:setToolResult', { turnId: latestTurnId, toolCallId, result: answer })
    },
    [latestTurnId],
  )

  const stop = useCallback<SessionChat['stop']>(async () => {
    if (!latestTurnId) return
    await window.ipc.invoke('sessions:stopTurn', { turnId: latestTurnId })
  }, [latestTurnId])

  return useMemo(
    () => ({
      chatState: current ? turnToChatState(current.turn, current.overlay) : null,
      latestTurnId,
      sendMessage,
      respondToPermission,
      answerAskHuman,
      stop,
    }),
    [current, latestTurnId, sendMessage, respondToPermission, answerAskHuman, stop],
  )
}
