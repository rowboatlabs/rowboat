import type { z } from 'zod'
import type { Run } from '@x/shared/src/runs.js'
import { reduceTurn, type TurnEvent, type TurnState } from '@x/shared/src/turns.js'
import type { ConversationItem } from '@/lib/chat-conversation'
import { runLogToConversation } from '@/lib/run-to-conversation'
import { buildTurnConversation } from '@/lib/session-chat/turn-view'

// Unified read model for a headless agent run's transcript, whether the id
// is a turn (new runtime) or a legacy run (pre-turn-runtime files under
// $WorkDir/runs/). Used by the background-tasks and live-note history views.

export interface AgentRunTranscript {
  id: string
  createdAt?: string
  // Legacy runs only (subUseCase); turns carry the trigger inside the
  // message text instead.
  trigger?: string
  summary?: string
  error?: string
  items: ConversationItem[]
}

export function turnToTranscript(
  turnId: string,
  events: Array<z.infer<typeof TurnEvent>>,
): AgentRunTranscript {
  return turnStateToTranscript(turnId, reduceTurn(events))
}

// Reduced-state variant for consumers that already hold a live TurnState
// (useTurn) and should not re-reduce the event log.
export function turnStateToTranscript(
  turnId: string,
  state: TurnState,
): AgentRunTranscript {
  const out: AgentRunTranscript = {
    id: turnId,
    createdAt: state.definition.ts,
    items: buildTurnConversation(state),
  }
  if (state.terminal?.type === 'turn_failed') {
    out.error = state.terminal.error
  }
  for (let i = state.modelCalls.length - 1; i >= 0; i--) {
    const response = state.modelCalls[i].response
    if (!response) continue
    const content = response.content
    const text =
      typeof content === 'string'
        ? content
        : content.map((p) => (p.type === 'text' ? p.text : '')).join('')
    if (text) {
      out.summary = text
      break
    }
  }
  return out
}

export function runToTranscript(run: z.infer<typeof Run>): AgentRunTranscript {
  const out: AgentRunTranscript = {
    id: run.id,
    createdAt: run.createdAt,
    trigger: run.subUseCase,
    items: runLogToConversation(run.log),
  }
  for (const event of run.log) {
    if (event.type === 'error' && typeof event.error === 'string') {
      out.error = event.error
    } else if (event.type === 'message' && event.message?.role === 'assistant') {
      const content = event.message.content
      if (typeof content === 'string') {
        out.summary = content
      } else if (Array.isArray(content)) {
        const text = content
          .filter((p) => p.type === 'text')
          .map((p) => ('text' in p ? p.text : ''))
          .join('')
        if (text) out.summary = text
      }
    }
  }
  return out
}

// Turn-first with a legacy-run fallback so histories recorded before the
// turn-runtime migration stay readable. The fallback goes away with the
// runs runtime (stage 7).
export async function fetchAgentRunTranscript(id: string): Promise<AgentRunTranscript> {
  try {
    const turn = await window.ipc.invoke('sessions:getTurn', { turnId: id })
    return turnToTranscript(id, turn.events)
  } catch {
    const run = await window.ipc.invoke('runs:fetch', { runId: id })
    return runToTranscript(run)
  }
}
