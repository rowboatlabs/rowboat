import type { z } from 'zod'
import type { SessionIndexEntry, SessionState } from '@x/shared/src/sessions.js'
import type { ResolvedAgent, TurnEvent } from '@x/shared/src/turns.js'

// Compact turn-event builders for renderer tests. Sequences must satisfy the
// shared reducer's invariants (reduceTurn is what the store runs on them).

export type TEvent = z.infer<typeof TurnEvent>

export const TS = '2026-07-02T10:00:00Z'

export const FIXTURE_AGENT: z.infer<typeof ResolvedAgent> = {
  agentId: 'copilot',
  systemPrompt: 'SYS',
  model: { provider: 'openai', model: 'gpt-fixture' },
  tools: [],
}

export function user(text: string) {
  return { role: 'user' as const, content: text }
}

export function assistantText(text: string) {
  return { role: 'assistant' as const, content: text }
}

export function toolCallPart(id: string, name: string, args: unknown = {}) {
  return { type: 'tool-call' as const, toolCallId: id, toolName: name, arguments: args }
}

export function created(
  turnId: string,
  sessionId: string,
  input: ReturnType<typeof user> = user('hello'),
): TEvent {
  return {
    type: 'turn_created',
    schemaVersion: 1,
    turnId,
    ts: TS,
    sessionId,
    agent: { requested: { agentId: 'copilot' }, resolved: FIXTURE_AGENT },
    context: [],
    input,
    config: { autoPermission: false, humanAvailable: true, maxModelCalls: 20 },
  }
}

export function requested(
  turnId: string,
  index: number,
  refs: string[] = ['input'],
): TEvent {
  return {
    type: 'model_call_requested',
    turnId,
    ts: TS,
    modelCallIndex: index,
    request: {
      messages: refs,
      parameters: {},
    },
  }
}

export function completed(
  turnId: string,
  index: number,
  message: { role: 'assistant'; content: unknown },
): TEvent {
  return {
    type: 'model_call_completed',
    turnId,
    ts: TS,
    modelCallIndex: index,
    message: message as never,
    finishReason: 'stop',
    usage: {},
  }
}

export function invocation(turnId: string, toolCallId: string, name: string): TEvent {
  return {
    type: 'tool_invocation_requested',
    turnId,
    ts: TS,
    toolCallId,
    toolId: `builtin:${name}`,
    toolName: name,
    execution: 'sync',
    input: {},
  }
}

export function toolResult(
  turnId: string,
  toolCallId: string,
  name: string,
  output: unknown = 'ok',
): TEvent {
  return {
    type: 'tool_result',
    turnId,
    ts: TS,
    toolCallId,
    toolName: name,
    source: 'sync',
    result: { output: output as never, isError: false },
  }
}

export function turnCompleted(turnId: string, text = 'done'): TEvent {
  return {
    type: 'turn_completed',
    turnId,
    ts: TS,
    output: assistantText(text),
    finishReason: 'stop',
    usage: {},
  }
}

// A settled single-response turn.
export function completedTurnLog(
  turnId: string,
  sessionId: string,
  question: string,
  answer: string,
): TEvent[] {
  return [
    created(turnId, sessionId, user(question)),
    requested(turnId, 0),
    completed(turnId, 0, assistantText(answer)),
    turnCompleted(turnId, answer),
  ]
}

export function indexEntry(
  sessionId: string,
  overrides: Partial<SessionIndexEntry> = {},
): SessionIndexEntry {
  return {
    sessionId,
    title: `Session ${sessionId}`,
    createdAt: TS,
    updatedAt: TS,
    turnCount: 1,
    latestTurnStatus: 'completed',
    ...overrides,
  }
}

export function sessionState(
  sessionId: string,
  turnIds: string[],
): SessionState {
  return {
    definition: { type: 'session_created', schemaVersion: 1, sessionId, ts: TS },
    title: `Session ${sessionId}`,
    turns: turnIds.map((turnId, i) => ({
      turnId,
      sessionSeq: i + 1,
      agentId: 'copilot',
      model: FIXTURE_AGENT.model,
      ts: TS,
    })),
    latestTurnId: turnIds[turnIds.length - 1],
    createdAt: TS,
    updatedAt: TS,
  }
}
