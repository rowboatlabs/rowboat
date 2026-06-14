import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentLoopTurn } from '@x/shared/src/agent-turn.js'
import {
  applyOverlay,
  buildConversation,
  emptyOverlay,
  pendingAskHuman,
  pendingPermissions,
} from './agent-turn-view.js'
import { isChatMessage, isToolCall } from './chat-conversation.js'

type Turn = z.infer<typeof AgentLoopTurn>

function turn(overrides: Partial<Turn> = {}): Turn {
  const now = '2026-06-14T00:00:00Z'
  return {
    id: 't1',
    agentId: 'copilot',
    provider: null,
    model: null,
    permissionMode: 'manual',
    useCase: null,
    subUseCase: null,
    sessionId: 's1',
    sessionSeq: 1,
    composeContext: null,
    messages: [],
    permissionRequests: [],
    permissionDecisions: [],
    startedTools: [],
    dispatchedTools: [],
    modelUsage: [],
    error: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('buildConversation', () => {
  it('maps user + assistant text into ordered chat messages', () => {
    const items = buildConversation(turn({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
    }))
    expect(items.map((i) => (isChatMessage(i) ? `${i.role}:${i.content}` : 'x'))).toEqual([
      'user:hello',
      'assistant:hi there',
    ])
  })

  it('builds a tool call with its result and completed status', () => {
    const items = buildConversation(turn({
      messages: [
        { role: 'user', content: 'read it' },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'file-readText', arguments: { path: '/a' } }],
        },
        { role: 'tool', content: '{"text":"hi"}', toolCallId: 'tc1', toolName: 'file-readText' },
      ],
    }))
    const tool = items.find(isToolCall)
    expect(tool).toMatchObject({ id: 'tc1', name: 'file-readText', status: 'completed', result: { text: 'hi' } })
  })

  it('surfaces attachment parts on a user message as chips', () => {
    const items = buildConversation(turn({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'attachment', path: '/a/photo.png', filename: 'photo.png', mimeType: 'image/png', size: 100 },
            { type: 'text', text: 'look at this' },
          ],
        },
      ],
    }))
    const msg = items.find(isChatMessage)
    expect(msg?.content).toBe('look at this')
    expect(msg?.attachments).toEqual([{ path: '/a/photo.png', filename: 'photo.png', mimeType: 'image/png', size: 100 }])
  })

  it('marks an unresolved cleared tool call as running', () => {
    const items = buildConversation(turn({
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'calc', arguments: {} }] },
      ],
    }))
    expect(items.find(isToolCall)?.status).toBe('running')
  })
})

describe('pendingPermissions', () => {
  it('returns tool calls awaiting a user decision with the tool call + request payload', () => {
    const result = pendingPermissions(turn({
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'executeCommand', arguments: { command: 'rm -rf /' } }] },
      ],
      permissionRequests: [{ toolCallId: 'tc1', request: { kind: 'command', commandNames: ['rm'] }, requestedAt: '2026-06-14T00:00:00Z' }],
    }))
    expect(result).toHaveLength(1)
    expect(result[0].toolCall.toolCallId).toBe('tc1')
    expect(result[0].toolCall.toolName).toBe('executeCommand')
    expect(result[0].request).toEqual({ kind: 'command', commandNames: ['rm'] })
  })

  it('excludes calls that already have a terminal decision', () => {
    const result = pendingPermissions(turn({
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'executeCommand', arguments: {} }] },
      ],
      permissionRequests: [{ toolCallId: 'tc1', request: {}, requestedAt: '2026-06-14T00:00:00Z' }],
      permissionDecisions: [{ toolCallId: 'tc1', decidedBy: 'user', decision: 'granted', reason: null, decidedAt: '2026-06-14T00:00:01Z' }],
    }))
    expect(result).toEqual([])
  })
})

describe('pendingAskHuman', () => {
  it('returns unresolved ask-human calls with question and options', () => {
    const result = pendingAskHuman(turn({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'ask-human', arguments: { question: 'Proceed?', options: ['Yes', 'No'] } }],
        },
      ],
      startedTools: [{ toolCallId: 'tc1', startedAt: '2026-06-14T00:00:00Z' }],
      dispatchedTools: [{ toolCallId: 'tc1', dispatchedAt: '2026-06-14T00:00:01Z' }],
    }))
    expect(result).toEqual([{ toolCallId: 'tc1', question: 'Proceed?', options: ['Yes', 'No'] }])
  })

  it('omits ask-human calls that already have an answer', () => {
    const result = pendingAskHuman(turn({
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'ask-human', arguments: { question: 'Proceed?' } }] },
        { role: 'tool', content: 'Yes', toolCallId: 'tc1', toolName: 'ask-human' },
      ],
      startedTools: [{ toolCallId: 'tc1', startedAt: '2026-06-14T00:00:00Z' }],
      dispatchedTools: [{ toolCallId: 'tc1', dispatchedAt: '2026-06-14T00:00:01Z' }],
    }))
    expect(result).toEqual([])
  })
})

describe('applyOverlay', () => {
  it('accumulates streaming text and per-tool output, ignores other events', () => {
    let overlay = emptyOverlay()
    overlay = applyOverlay(overlay, { type: 'text-delta', delta: 'Hel' })
    overlay = applyOverlay(overlay, { type: 'text-delta', delta: 'lo' })
    overlay = applyOverlay(overlay, { type: 'tool-output', toolCallId: 'tc1', chunk: 'line1\n' })
    overlay = applyOverlay(overlay, { type: 'tool-output', toolCallId: 'tc1', chunk: 'line2' })
    overlay = applyOverlay(overlay, { type: 'tool-result', toolCallId: 'tc1' })
    expect(overlay).toEqual({ text: 'Hello', toolOutput: { tc1: 'line1\nline2' } })
  })
})
