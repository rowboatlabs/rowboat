import type { z } from 'zod'
import type { UseCase } from '@x/shared/src/analytics.js'
import type { UserMessage } from '@x/shared/src/message.js'
import type {
  QueuedSessionMessage,
  SessionIndexEntry,
  SessionState,
} from '@x/shared/src/sessions.js'
import type { JsonValue, RequestedAgent, TurnEvent } from '@x/shared/src/turns.js'

// Narrow, injectable surface over the sessions IPC channels so stores are
// testable with a plain fake instead of a window.ipc stub.
export interface SendMessageConfig {
  agent: z.infer<typeof RequestedAgent>
  useCase?: UseCase
  subUseCase?: string
  autoPermission?: boolean
  maxModelCalls?: number
}

export interface SessionsClient {
  create(input: { title?: string }): Promise<{ sessionId: string }>
  list(): Promise<{ sessions: SessionIndexEntry[] }>
  get(sessionId: string): Promise<SessionState>
  getTurn(turnId: string): Promise<{ turnId: string; events: Array<z.infer<typeof TurnEvent>> }>
  sendMessage(
    sessionId: string,
    input: z.infer<typeof UserMessage>,
    config: SendMessageConfig,
  ): Promise<{ turnId: string }>
  // Deliver-ASAP: starts a turn when settled, queues (main-process memory)
  // when the latest turn is still running — queued messages steer the live
  // turn at its next boundary or promote to a new turn at settle.
  sendOrQueueMessage(
    sessionId: string,
    input: z.infer<typeof UserMessage>,
    config: SendMessageConfig,
  ): Promise<{ queued: false; turnId: string } | { queued: true; queueId: string }>
  listQueued(sessionId: string): Promise<{ queue: QueuedSessionMessage[] }>
  editQueued(
    sessionId: string,
    queueId: string,
    message: z.infer<typeof UserMessage>,
  ): Promise<void>
  removeQueued(
    sessionId: string,
    queueId: string,
  ): Promise<{ removed: QueuedSessionMessage | null }>
  respondToPermission(
    turnId: string,
    toolCallId: string,
    decision: 'allow' | 'deny',
    metadata?: JsonValue,
  ): Promise<void>
  respondToAskHuman(turnId: string, toolCallId: string, answer: string): Promise<void>
  // Also drains the pending queue (stop must not auto-start queued work);
  // the drained messages come back for composer restore.
  stopTurn(
    turnId: string,
    reason?: string,
  ): Promise<{ dequeued: QueuedSessionMessage[] }>
  resumeTurn(sessionId: string): Promise<void>
  setTitle(sessionId: string, title: string): Promise<void>
  delete(sessionId: string): Promise<void>
}

export const ipcSessionsClient: SessionsClient = {
  create: (input) => window.ipc.invoke('sessions:create', input),
  list: () => window.ipc.invoke('sessions:list', {}),
  get: (sessionId) => window.ipc.invoke('sessions:get', { sessionId }),
  getTurn: (turnId) => window.ipc.invoke('sessions:getTurn', { turnId }),
  sendMessage: (sessionId, input, config) =>
    window.ipc.invoke('sessions:sendMessage', { sessionId, input, config }),
  sendOrQueueMessage: (sessionId, input, config) =>
    window.ipc.invoke('sessions:sendOrQueueMessage', { sessionId, input, config }),
  listQueued: (sessionId) => window.ipc.invoke('sessions:listQueued', { sessionId }),
  editQueued: async (sessionId, queueId, message) => {
    await window.ipc.invoke('sessions:editQueued', { sessionId, queueId, message })
  },
  removeQueued: (sessionId, queueId) =>
    window.ipc.invoke('sessions:removeQueued', { sessionId, queueId }),
  respondToPermission: async (turnId, toolCallId, decision, metadata) => {
    await window.ipc.invoke('sessions:respondToPermission', {
      turnId,
      toolCallId,
      decision,
      ...(metadata === undefined ? {} : { metadata }),
    })
  },
  respondToAskHuman: async (turnId, toolCallId, answer) => {
    await window.ipc.invoke('sessions:respondToAskHuman', { turnId, toolCallId, answer })
  },
  stopTurn: async (turnId, reason) => {
    const { dequeued } = await window.ipc.invoke('sessions:stopTurn', {
      turnId,
      ...(reason === undefined ? {} : { reason }),
    })
    return { dequeued }
  },
  resumeTurn: async (sessionId) => {
    await window.ipc.invoke('sessions:resumeTurn', { sessionId })
  },
  setTitle: async (sessionId, title) => {
    await window.ipc.invoke('sessions:setTitle', { sessionId, title })
  },
  delete: async (sessionId) => {
    await window.ipc.invoke('sessions:delete', { sessionId })
  },
}
