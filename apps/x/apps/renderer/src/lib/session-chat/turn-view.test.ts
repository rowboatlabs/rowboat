import { describe, expect, it } from 'vitest'
import { reduceTurn } from '@x/shared/src/turns.js'
import { isChatMessage, isErrorMessage, isToolCall } from '@/lib/chat-conversation'
import {
  applyOverlay,
  buildSessionChatState,
  buildTurnConversation,
  emptyOverlay,
} from './turn-view'
import {
  TS,
  assistantText,
  completed,
  completedTurnLog,
  created,
  invocation,
  requested,
  toolCallPart,
  toolResult,
  turnCompleted,
  user,
  type TEvent,
} from './test-fixtures'

const T1 = 'turn-1'
const S1 = 'sess-1'

function assistantCalls(...parts: Array<ReturnType<typeof toolCallPart>>) {
  return { role: 'assistant' as const, content: parts }
}

describe('applyOverlay', () => {
  it('accumulates text and reasoning deltas', () => {
    let overlay = emptyOverlay()
    overlay = applyOverlay(overlay, { type: 'text_delta', turnId: T1, modelCallIndex: 0, delta: 'he' })
    overlay = applyOverlay(overlay, { type: 'text_delta', turnId: T1, modelCallIndex: 0, delta: 'y' })
    overlay = applyOverlay(overlay, {
      type: 'reasoning_delta',
      turnId: T1,
      modelCallIndex: 0,
      delta: 'hmm',
    })
    expect(overlay.text).toBe('hey')
    expect(overlay.reasoning).toBe('hmm')
  })

  it('clears text/reasoning when the canonical model response arrives', () => {
    let overlay = { ...emptyOverlay(), text: 'streaming', reasoning: 'thinking' }
    overlay = applyOverlay(overlay, completed(T1, 0, assistantText('final')))
    expect(overlay.text).toBe('')
    expect(overlay.reasoning).toBe('')
  })

  it('accumulates tool-output progress chunks and drops them on the terminal result', () => {
    let overlay = emptyOverlay()
    const progress = (chunk: string): TEvent => ({
      type: 'tool_progress',
      turnId: T1,
      ts: TS,
      toolCallId: 'tc1',
      source: 'sync',
      progress: { kind: 'tool-output', chunk },
    })
    overlay = applyOverlay(overlay, progress('$ ls\n'))
    overlay = applyOverlay(overlay, progress('README.md\n'))
    expect(overlay.toolOutput.tc1).toBe('$ ls\nREADME.md\n')

    overlay = applyOverlay(overlay, toolResult(T1, 'tc1', 'executeCommand'))
    expect(overlay.toolOutput.tc1).toBeUndefined()
  })

  it('ignores non-output progress payloads', () => {
    const overlay = applyOverlay(emptyOverlay(), {
      type: 'tool_progress',
      turnId: T1,
      ts: TS,
      toolCallId: 'tc1',
      source: 'sync',
      progress: { pct: 50 },
    })
    expect(overlay.toolOutput).toEqual({})
  })
})

describe('voice output', () => {
  const delta = (d: string): Parameters<typeof applyOverlay>[1] =>
    ({ type: 'text_delta', turnId: T1, modelCallIndex: 0, delta: d })

  it('extracts completed <voice> blocks across split deltas', () => {
    let overlay = emptyOverlay()
    overlay = applyOverlay(overlay, delta('Sure! <voi'))
    expect(overlay.voiceSegments).toEqual([])
    overlay = applyOverlay(overlay, delta('ce>hello there</voice> and <voice>bye'))
    expect(overlay.voiceSegments).toEqual(['hello there'])
    overlay = applyOverlay(overlay, delta('</voice> done'))
    expect(overlay.voiceSegments).toEqual(['hello there', 'bye'])
  })

  it('keeps segments but resets the scan on model_call_completed', () => {
    let overlay = emptyOverlay()
    overlay = applyOverlay(overlay, delta('<voice>one</voice>'))
    overlay = applyOverlay(overlay, completed(T1, 0, assistantText('<voice>one</voice>')))
    expect(overlay.voiceSegments).toEqual(['one'])
    expect(overlay.text).toBe('')
    overlay = applyOverlay(overlay, delta('<voice>two</voice>'))
    expect(overlay.voiceSegments).toEqual(['one', 'two'])
  })

  it('strips voice tags from the streaming message and exposes segments on state', () => {
    const turn = reduceTurn([created(T1, S1), requested(T1, 0)])
    let overlay = emptyOverlay()
    overlay = applyOverlay(overlay, delta('Plan: <voice>speak this</voice> rest'))
    const state = buildSessionChatState([turn], overlay)
    expect(state.currentAssistantMessage).toBe('Plan: speak this rest')
    expect(state.voiceSegments).toEqual(['speak this'])
  })

  it('strips voice tags from persisted assistant messages', () => {
    const state = reduceTurn(
      completedTurnLog(T1, S1, 'q', 'Sure. <voice>Here you go.</voice> Done.'),
    )
    const items = buildTurnConversation(state)
    const assistant = items.find((i) => isChatMessage(i) && i.role === 'assistant')
    expect(isChatMessage(assistant!) && assistant.content).toBe('Sure. Here you go. Done.')
  })
})

describe('buildTurnConversation', () => {
  it('maps user input, assistant text, and settled tool calls', () => {
    const call = assistantCalls(toolCallPart('tc1', 'echo', { x: 1 }))
    const state = reduceTurn([
      created(T1, S1, user('run it')),
      requested(T1, 0),
      completed(T1, 0, call),
      invocation(T1, 'tc1', 'echo'),
      toolResult(T1, 'tc1', 'echo', { echoed: true }),
      requested(T1, 1, [
        'assistant:0',
        'toolResult:tc1',
      ]),
      completed(T1, 1, assistantText('all done')),
      turnCompleted(T1, 'all done'),
    ])
    const items = buildTurnConversation(state)
    expect(items.map((i) => (isToolCall(i) ? `tool:${i.name}:${i.status}` : isChatMessage(i) ? `${i.role}` : 'x'))).toEqual([
      'user',
      'tool:echo:completed',
      'assistant',
    ])
    const tool = items.find(isToolCall)
    expect(tool?.result).toEqual({ echoed: true })
    expect(tool?.input).toEqual({ x: 1 })
  })

  it('marks permission-pending tools pending and running tools running', () => {
    const state = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('p1', 'executeCommand'), toolCallPart('r1', 'echo'))),
      {
        type: 'tool_permission_required',
        turnId: T1,
        ts: TS,
        toolCallId: 'p1',
        toolName: 'executeCommand',
        request: { kind: 'command', commandNames: ['rm'] },
      },
      invocation(T1, 'r1', 'echo'),
    ])
    const items = buildTurnConversation(state).filter(isToolCall)
    expect(items.map((i) => i.status)).toEqual(['pending', 'running'])
  })

  it('renders user attachments and a failed turn as an error item', () => {
    const input = {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'see file' },
        { type: 'attachment' as const, path: '/tmp/a.png', filename: 'a.png', mimeType: 'image/png' },
      ],
    }
    const state = reduceTurn([
      created(T1, S1, input as never),
      requested(T1, 0),
      { type: 'model_call_failed', turnId: T1, ts: TS, modelCallIndex: 0, error: 'boom' },
      { type: 'turn_failed', turnId: T1, ts: TS, error: 'boom', usage: {} },
    ])
    const items = buildTurnConversation(state)
    expect(isChatMessage(items[0]) && items[0].attachments?.[0].filename).toBe('a.png')
    expect(isErrorMessage(items[1]) && items[1].message).toBe('boom')
  })
})

describe('buildSessionChatState', () => {
  it('composes the conversation across turns and derives processing flags', () => {
    const prior = reduceTurn(completedTurnLog('turn-1', S1, 'first?', 'first answer'))
    const latest = reduceTurn([
      created('turn-2', S1, user('second?')),
      requested('turn-2', 0),
    ])
    const state = buildSessionChatState([prior, latest], emptyOverlay())
    expect(
      state.conversation.filter(isChatMessage).map((m) => m.content),
    ).toEqual(['first?', 'first answer', 'second?'])
    expect(state.isProcessing).toBe(true) // latest turn idle = actively working
    expect(state.isThinking).toBe(true)
  })

  it('is settled (not processing) when the latest turn is terminal', () => {
    const turn = reduceTurn(completedTurnLog(T1, S1, 'q', 'a'))
    const state = buildSessionChatState([turn], emptyOverlay())
    expect(state.isProcessing).toBe(false)
    expect(state.isThinking).toBe(false)
  })

  it('exposes pending permissions as request events; waiting is not thinking', () => {
    const turn = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('p1', 'executeCommand', { command: 'rm -rf /' }))),
      {
        type: 'tool_permission_required',
        turnId: T1,
        ts: TS,
        toolCallId: 'p1',
        toolName: 'executeCommand',
        request: { kind: 'command', commandNames: ['rm'] },
      },
      {
        type: 'turn_suspended',
        turnId: T1,
        ts: TS,
        pendingPermissions: [
          { toolCallId: 'p1', toolName: 'executeCommand', request: { kind: 'command', commandNames: ['rm'] } },
        ],
        pendingAsyncTools: [],
        usage: {},
      },
    ])
    const state = buildSessionChatState([turn], emptyOverlay())
    const request = state.allPermissionRequests.get('p1')
    expect(request).toMatchObject({
      type: 'tool-permission-request',
      toolCall: { toolCallId: 'p1', toolName: 'executeCommand' },
      permission: { kind: 'command', commandNames: ['rm'] },
    })
    expect(state.isProcessing).toBe(true)
    expect(state.isThinking).toBe(false)
  })

  it('maps human decisions to responses and classifier decisions to auto-decisions', () => {
    const turn = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('h1', 'echo'), toolCallPart('c1', 'echo'))),
      { type: 'tool_permission_required', turnId: T1, ts: TS, toolCallId: 'h1', toolName: 'echo', request: { kind: 'command', commandNames: ['x'] } },
      { type: 'tool_permission_required', turnId: T1, ts: TS, toolCallId: 'c1', toolName: 'echo', request: { kind: 'command', commandNames: ['y'] } },
      { type: 'tool_permission_resolved', turnId: T1, ts: TS, toolCallId: 'h1', decision: 'allow', source: 'human' },
      { type: 'tool_permission_resolved', turnId: T1, ts: TS, toolCallId: 'c1', decision: 'deny', source: 'classifier', reason: 'risky' },
      { type: 'tool_result', turnId: T1, ts: TS, toolCallId: 'c1', toolName: 'echo', source: 'runtime', result: { output: 'denied', isError: true } },
      invocation(T1, 'h1', 'echo'),
      toolResult(T1, 'h1', 'echo'),
    ])
    const state = buildSessionChatState([turn], emptyOverlay())
    expect(state.permissionResponses.get('h1')).toBe('approve')
    expect(state.autoPermissionDecisions.get('c1')).toMatchObject({
      decision: 'deny',
      reason: 'risky',
    })
  })

  it('exposes pending ask-human calls with question and options', () => {
    const turn = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('ah1', 'ask-human', { question: 'Deploy?', options: ['Yes', 'No'] }))),
      {
        type: 'tool_invocation_requested',
        turnId: T1,
        ts: TS,
        toolCallId: 'ah1',
        toolId: 'builtin:ask-human',
        toolName: 'ask-human',
        execution: 'async',
        input: { question: 'Deploy?', options: ['Yes', 'No'] },
      },
    ])
    const state = buildSessionChatState([turn], emptyOverlay())
    expect(state.pendingAskHumanRequests.get('ah1')).toMatchObject({
      query: 'Deploy?',
      options: ['Yes', 'No'],
    })
    expect(state.isThinking).toBe(false) // waiting on the human, no shimmer
  })

  it('stitches live tool output onto the matching tool item', () => {
    const turn = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('tc1', 'executeCommand'))),
      invocation(T1, 'tc1', 'executeCommand'),
    ])
    const overlay = { ...emptyOverlay(), toolOutput: { tc1: 'partial output' } }
    const state = buildSessionChatState([turn], overlay)
    const tool = state.conversation.filter(isToolCall)[0]
    expect(tool.streamingOutput).toBe('partial output')
  })

  it('surfaces streaming text as currentAssistantMessage', () => {
    const turn = reduceTurn([created(T1, S1), requested(T1, 0)])
    const state = buildSessionChatState([turn], { ...emptyOverlay(), text: 'typing…' })
    expect(state.currentAssistantMessage).toBe('typing…')
  })
})
