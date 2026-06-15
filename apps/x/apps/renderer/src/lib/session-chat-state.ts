import { z } from 'zod'
import type { AgentLoopTurn } from '@x/shared/src/agent-turn.js'
import { deriveTurnStatus, toolCallParts } from '@x/shared/src/agent-turn.js'
import {
  AskHumanRequestEvent,
  ToolPermissionAutoDecisionEvent,
  ToolPermissionRequestEvent,
} from '@x/shared/src/runs.js'
import {
  buildConversation,
  pendingAskHuman,
  pendingPermissions,
  type LiveOverlay,
} from './agent-turn-view.js'
import { isToolCall, type ConversationItem, type PermissionResponse } from './chat-conversation.js'

// Maps a session's latest turn (+ its live overlay) onto the exact ChatTabViewState
// fields the existing chat renderer consumes. Because the sessions layer
// copy-forwards the transcript, the latest turn alone reproduces the whole
// conversation, so this is all the renderer needs. Pure + unit-tested; the App
// feed effect is a thin wrapper that calls this and sets state.

type Turn = z.infer<typeof AgentLoopTurn>
type PermMeta = z.infer<typeof ToolPermissionRequestEvent>['permission']

export type SessionChatState = {
  conversation: ConversationItem[]
  currentAssistantMessage: string
  allPermissionRequests: Map<string, z.infer<typeof ToolPermissionRequestEvent>>
  permissionResponses: Map<string, PermissionResponse>
  autoPermissionDecisions: Map<string, z.infer<typeof ToolPermissionAutoDecisionEvent>>
  pendingAskHumanRequests: Map<string, z.infer<typeof AskHumanRequestEvent>>
  // The turn is "processing" (compose box blocked, Stop shown) until it reaches
  // a terminal rest state — completed or errored. Waiting on a permission /
  // ask-human still counts as processing; the user answers via the inline card.
  isProcessing: boolean
  // Actively working (model / tools running) — drives the "Thinking…" shimmer.
  // False while waiting on the user, so the shimmer doesn't show under a
  // permission / ask-human card.
  isThinking: boolean
}

export function turnToChatState(turn: Turn, overlay: LiveOverlay): SessionChatState {
  const runId = turn.id
  const status = deriveTurnStatus(turn)
  const parts = toolCallParts(turn)

  const conversation = buildConversation(turn).map((item) => {
    if (!isToolCall(item)) return item
    const codeRunEvents = overlay.codeRunEvents[item.id]
    const codePermission = overlay.codePermission[item.id]
    if (!overlay.toolOutput[item.id] && !codeRunEvents && codePermission === undefined) return item
    return {
      ...item,
      ...(overlay.toolOutput[item.id] ? { streamingOutput: overlay.toolOutput[item.id] } : {}),
      ...(codeRunEvents ? { codeRunEvents } : {}),
      ...(codePermission !== undefined ? { pendingCodePermission: codePermission } : {}),
    }
  })

  const allPermissionRequests = new Map<string, z.infer<typeof ToolPermissionRequestEvent>>()
  for (const { toolCall, request } of pendingPermissions(turn)) {
    allPermissionRequests.set(toolCall.toolCallId, {
      runId,
      type: 'tool-permission-request',
      subflow: [],
      toolCall,
      permission: request as PermMeta,
    })
  }

  const permissionResponses = new Map<string, PermissionResponse>()
  const autoPermissionDecisions = new Map<string, z.infer<typeof ToolPermissionAutoDecisionEvent>>()
  for (const d of turn.permissionDecisions) {
    if (d.decidedBy === 'user' && (d.decision === 'granted' || d.decision === 'denied')) {
      permissionResponses.set(d.toolCallId, d.decision === 'granted' ? 'approve' : 'deny')
    } else if (d.decidedBy === 'classifier' && (d.decision === 'granted' || d.decision === 'denied')) {
      const toolCall = parts.find((p) => p.toolCallId === d.toolCallId)
      if (!toolCall) continue
      const request = turn.permissionRequests.find((r) => r.toolCallId === d.toolCallId)?.request
      autoPermissionDecisions.set(d.toolCallId, {
        runId,
        type: 'tool-permission-auto-decision',
        subflow: [],
        toolCallId: d.toolCallId,
        toolCall,
        permission: request as PermMeta,
        decision: d.decision === 'granted' ? 'allow' : 'deny',
        reason: d.reason,
      })
    }
  }

  const pendingAskHumanRequests = new Map<string, z.infer<typeof AskHumanRequestEvent>>()
  for (const q of pendingAskHuman(turn)) {
    pendingAskHumanRequests.set(q.toolCallId, {
      runId,
      type: 'ask-human-request',
      subflow: [],
      toolCallId: q.toolCallId,
      query: q.question,
      ...(q.options ? { options: q.options } : {}),
    })
  }

  return {
    conversation,
    currentAssistantMessage: overlay.text,
    allPermissionRequests,
    permissionResponses,
    autoPermissionDecisions,
    pendingAskHumanRequests,
    isProcessing: status !== 'completed' && status !== 'error',
    isThinking: status === 'idle',
  }
}
