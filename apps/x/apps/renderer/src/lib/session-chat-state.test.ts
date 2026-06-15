import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentLoopTurn } from '@x/shared/src/agent-turn.js'
import { emptyOverlay } from './agent-turn-view.js'
import { turnToChatState } from './session-chat-state.js'
import { isChatMessage, isToolCall } from './chat-conversation.js'

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

describe('turnToChatState', () => {
  it('derives conversation + streaming text + not-processing for a completed turn', () => {
    const state = turnToChatState(
      turn({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
        completedAt: '2026-06-14T00:00:02Z',
      }),
      emptyOverlay(),
    )
    expect(state.conversation.filter(isChatMessage).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(state.currentAssistantMessage).toBe('')
    expect(state.isProcessing).toBe(false)
    expect(state.isThinking).toBe(false)
  })

  it('marks an in-flight (non-terminal) turn as processing and surfaces streaming text', () => {
    const state = turnToChatState(
      turn({ messages: [{ role: 'user', content: 'go' }] }),
      { text: 'streaming…', toolOutput: {} },
    )
    expect(state.isProcessing).toBe(true)
    expect(state.isThinking).toBe(true) // idle = actively working
    expect(state.currentAssistantMessage).toBe('streaming…')
  })

  it('overlays live tool output onto the matching tool call', () => {
    const state = turnToChatState(
      turn({
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'executeCommand', arguments: {} }] },
        ],
      }),
      { ...emptyOverlay(), toolOutput: { tc1: 'line1\nline2' } },
    )
    const tool = state.conversation.find(isToolCall)
    expect(tool?.streamingOutput).toBe('line1\nline2')
  })

  it('exposes a pending permission as a request event keyed by tool call id', () => {
    const state = turnToChatState(
      turn({
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'executeCommand', arguments: { command: 'rm -rf /' } }] },
        ],
        permissionRequests: [{ toolCallId: 'tc1', request: { kind: 'command', commandNames: ['rm'] }, requestedAt: '2026-06-14T00:00:00Z' }],
      }),
      emptyOverlay(),
    )
    const req = state.allPermissionRequests.get('tc1')
    expect(req?.type).toBe('tool-permission-request')
    expect(req?.toolCall.toolCallId).toBe('tc1')
    expect(state.isProcessing).toBe(true) // waiting on permission still blocks the composer
    expect(state.isThinking).toBe(false) // but it's not "thinking" — no shimmer under the card
  })

  it('records a user decision in permissionResponses and a classifier decision in autoPermissionDecisions', () => {
    const state = turnToChatState(
      turn({
        permissionMode: 'auto',
        messages: [
          { role: 'assistant', content: [
            { type: 'tool-call', toolCallId: 'tc1', toolName: 'executeCommand', arguments: {} },
            { type: 'tool-call', toolCallId: 'tc2', toolName: 'file-readText', arguments: {} },
          ] },
          { role: 'tool', content: 'denied', toolCallId: 'tc1', toolName: 'executeCommand' },
        ],
        permissionRequests: [
          { toolCallId: 'tc1', request: { kind: 'command', commandNames: ['rm'] }, requestedAt: '2026-06-14T00:00:00Z' },
          { toolCallId: 'tc2', request: { kind: 'file', operation: 'read', paths: ['/x'], pathPrefix: '/' }, requestedAt: '2026-06-14T00:00:00Z' },
        ],
        permissionDecisions: [
          { toolCallId: 'tc1', decidedBy: 'user', decision: 'denied', reason: null, decidedAt: '2026-06-14T00:00:01Z' },
          { toolCallId: 'tc2', decidedBy: 'classifier', decision: 'granted', reason: 'read-only', decidedAt: '2026-06-14T00:00:01Z' },
        ],
      }),
      emptyOverlay(),
    )
    expect(state.permissionResponses.get('tc1')).toBe('deny')
    const auto = state.autoPermissionDecisions.get('tc2')
    expect(auto?.decision).toBe('allow')
    expect(auto?.reason).toBe('read-only')
  })

  it('exposes an unresolved ask-human as a request event', () => {
    const state = turnToChatState(
      turn({
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'ask-human', arguments: { question: 'Proceed?', options: ['Yes', 'No'] } }] },
        ],
        startedTools: [{ toolCallId: 'tc1', startedAt: '2026-06-14T00:00:00Z' }],
        dispatchedTools: [{ toolCallId: 'tc1', dispatchedAt: '2026-06-14T00:00:01Z' }],
      }),
      emptyOverlay(),
    )
    const ask = state.pendingAskHumanRequests.get('tc1')
    expect(ask?.query).toBe('Proceed?')
    expect(ask?.options).toEqual(['Yes', 'No'])
  })
})
