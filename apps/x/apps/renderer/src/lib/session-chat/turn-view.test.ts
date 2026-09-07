import { describe, expect, it } from 'vitest'
import { reduceTurn } from '@x/shared/src/turns.js'
import { isChatMessage, isErrorMessage, isReasoningMessage, isToolCall, isTurnUsageMessage } from '@/lib/chat-conversation'
import {
  applyOverlay,
  assistantMessageId,
  buildSessionChatState,
  buildTurnConversation,
  emptyOverlay,
  reasoningMessageId,
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

function modelStep(
  turnId: string,
  modelCallIndex: number,
  event: Extract<TEvent, { type: 'model_step_event' }>['event'],
): Extract<TEvent, { type: 'model_step_event' }> {
  return { type: 'model_step_event', turnId, ts: TS, modelCallIndex, event }
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

  it('emits an early clause from a long open block, then the remainder on close', () => {
    let overlay = emptyOverlay()
    const longClause = 'Okay so the first thing I would look at here is the error message,'
    overlay = applyOverlay(overlay, delta(`<voice>${longClause} because`))
    // Open block crossed the early-speech threshold at a clause boundary.
    expect(overlay.voiceSegments).toEqual([longClause])
    overlay = applyOverlay(overlay, delta(' it tells you the root cause.</voice>'))
    // Remainder only — the early clause is not repeated.
    expect(overlay.voiceSegments).toEqual([longClause, 'because it tells you the root cause.'])
  })

  it('does not emit early clauses from short open blocks', () => {
    let overlay = emptyOverlay()
    overlay = applyOverlay(overlay, delta('<voice>Sure, one sec'))
    expect(overlay.voiceSegments).toEqual([])
    overlay = applyOverlay(overlay, delta('.</voice>'))
    expect(overlay.voiceSegments).toEqual(['Sure, one sec.'])
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

  it('adds one turn usage row from accumulated model-call usage', () => {
    const state = reduceTurn([
      created(T1, S1, user('run it')),
      requested(T1, 0),
      completed(T1, 0, assistantText('checking'), {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      }),
      requested(T1, 1, ['assistant:0']),
      completed(T1, 1, assistantText('done'), {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
        cachedInputTokens: 4,
      }),
      turnCompleted(T1, 'done'),
    ])
    const usage = buildTurnConversation(state).find(isTurnUsageMessage)
    expect(usage?.usage).toEqual({
      inputTokens: 22,
      outputTokens: 8,
      totalTokens: 30,
      cachedInputTokens: 4,
    })
    expect(usage?.modelCallCount).toBe(2)
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

  it('uses the tool result envelope to determine error status', () => {
    const state = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(
        T1,
        0,
        assistantCalls(
          toolCallPart('flagged', 'echo'),
          toolCallPart('normal', 'echo'),
        ),
      ),
      invocation(T1, 'flagged', 'echo'),
      {
        type: 'tool_result',
        turnId: T1,
        ts: TS,
        toolCallId: 'flagged',
        toolName: 'echo',
        source: 'sync',
        result: { output: 'boom', isError: true },
      },
      invocation(T1, 'normal', 'echo'),
      toolResult(T1, 'normal', 'echo', { success: false, message: 'payload data' }),
    ])
    const items = buildTurnConversation(state).filter(isToolCall)
    expect(items.map((i) => i.status)).toEqual(['error', 'completed'])
  })

  it('derives the code-run timeline from the settle-time batch and asks from request events', () => {
    const codeProgress = (progress: unknown): TEvent => ({
      type: 'tool_progress',
      turnId: T1,
      ts: TS,
      toolCallId: 'cr1',
      source: 'sync',
      progress: progress as never,
    })
    const state = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('cr1', 'code_agent_run', { agent: 'codex' }))),
      invocation(T1, 'cr1', 'code_agent_run'),
      codeProgress({
        kind: 'code-run-permission-request',
        requestId: 'cpr-1',
        ask: { toolCallId: 'x', title: 'write file', options: [] },
      }),
      codeProgress({
        kind: 'code-run-events',
        events: [
          { type: 'message', role: 'agent', text: 'hi' },
          { type: 'tool_call', id: 'x', title: 'write file' },
        ],
      }),
    ])
    const tool = buildTurnConversation(state).filter(isToolCall)[0]
    expect(tool.status).toBe('running')
    expect(tool.codeRunEvents?.map((e) => e.type)).toEqual(['message', 'tool_call'])
    expect(tool.pendingCodePermission?.requestId).toBe('cpr-1')
  })

  it('clears the pending code permission on the resolved marker and on tool result', () => {
    const codeProgress = (toolCallId: string, progress: unknown): TEvent => ({
      type: 'tool_progress',
      turnId: T1,
      ts: TS,
      toolCallId,
      source: 'sync',
      progress: progress as never,
    })
    const ask = { toolCallId: 'x', title: 'write file', options: [] }
    // resolved: the durable marker pairs off the request mid-run
    const resolvedState = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('cr1', 'code_agent_run'))),
      invocation(T1, 'cr1', 'code_agent_run'),
      codeProgress('cr1', { kind: 'code-run-permission-request', requestId: 'cpr-1', ask }),
      codeProgress('cr1', { kind: 'code-run-permission-resolved' }),
    ])
    const resolved = buildTurnConversation(resolvedState).filter(isToolCall)[0]
    expect(resolved.pendingCodePermission).toBeUndefined()

    // a second ask after the first resolution is pending again
    const secondAskState = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('cr1', 'code_agent_run'))),
      invocation(T1, 'cr1', 'code_agent_run'),
      codeProgress('cr1', { kind: 'code-run-permission-request', requestId: 'cpr-1', ask }),
      codeProgress('cr1', { kind: 'code-run-permission-resolved' }),
      codeProgress('cr1', { kind: 'code-run-permission-request', requestId: 'cpr-2', ask }),
    ])
    const secondAsk = buildTurnConversation(secondAskState).filter(isToolCall)[0]
    expect(secondAsk.pendingCodePermission?.requestId).toBe('cpr-2')

    // settled: an unanswered ask must not survive the tool's terminal result
    const settledState = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('cr2', 'code_agent_run'))),
      invocation(T1, 'cr2', 'code_agent_run'),
      codeProgress('cr2', { kind: 'code-run-permission-request', requestId: 'cpr-2', ask }),
      toolResult(T1, 'cr2', 'code_agent_run', { success: false, stopReason: 'cancelled' }),
    ])
    const settled = buildTurnConversation(settledState).filter(isToolCall)[0]
    expect(settled.pendingCodePermission).toBeUndefined()
    expect(settled.status).toBe('completed')
  })

  it('derives the sub-agent child link from spawn-agent progress', () => {
    const state = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(
        T1,
        0,
        assistantCalls(
          toolCallPart('sa1', 'spawn-agent', { task: 'research X', instructions: 'You research.' }),
        ),
      ),
      invocation(T1, 'sa1', 'spawn-agent'),
      {
        type: 'tool_progress',
        turnId: T1,
        ts: TS,
        toolCallId: 'sa1',
        source: 'sync',
        progress: {
          kind: 'subagent',
          childTurnId: 'child-turn-1',
          agentName: 'researcher',
          task: 'research X',
        } as never,
      },
    ])
    const tool = buildTurnConversation(state).filter(isToolCall)[0]
    expect(tool.subAgent).toEqual({
      childTurnId: 'child-turn-1',
      agentName: 'researcher',
      task: 'research X',
    })

    // Without the progress entry the link is simply absent.
    const bare = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('sa2', 'spawn-agent', { task: 't' }))),
      invocation(T1, 'sa2', 'spawn-agent'),
    ])
    expect(buildTurnConversation(bare).filter(isToolCall)[0].subAgent).toBeUndefined()
  })

  it('emits each model call\'s reasoning as an item before its text and tools', () => {
    const state = reduceTurn([
      created(T1, S1, user('q')),
      requested(T1, 0),
      completed(T1, 0, {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'planning the tool call' },
          toolCallPart('tc1', 'echo'),
        ],
      }),
      invocation(T1, 'tc1', 'echo'),
      toolResult(T1, 'tc1', 'echo'),
      requested(T1, 1, ['assistant:0', 'toolResult:tc1']),
      completed(T1, 1, {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'shaping the answer' },
          { type: 'text', text: 'answer' },
        ],
      }),
      turnCompleted(T1, 'answer'),
    ])
    const items = buildTurnConversation(state)
    expect(
      items.map((i) =>
        isReasoningMessage(i)
          ? `reasoning:${i.content}`
          : isToolCall(i)
            ? `tool:${i.name}`
            : isChatMessage(i)
              ? i.role
              : 'x',
      ),
    ).toEqual([
      'user',
      'reasoning:planning the tool call',
      'tool:echo',
      'reasoning:shaping the answer',
      'assistant',
    ])
  })

  it('joins multiple reasoning parts and drops encrypted-only (empty) ones', () => {
    const state = reduceTurn([
      created(T1, S1, user('q')),
      requested(T1, 0),
      completed(T1, 0, {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'part one' },
          { type: 'reasoning', text: '' },
          { type: 'reasoning', text: 'part two' },
          { type: 'text', text: 'answer' },
        ],
      }),
      turnCompleted(T1, 'answer'),
    ])
    const reasoning = buildTurnConversation(state).filter(isReasoningMessage)
    expect(reasoning).toHaveLength(1)
    expect(reasoning[0].content).toBe('part one\n\npart two')

    // A call whose reasoning is entirely encrypted (no text) yields no item.
    const encryptedOnly = reduceTurn([
      created(T1, S1, user('q')),
      requested(T1, 0),
      completed(T1, 0, {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '' },
          { type: 'text', text: 'answer' },
        ],
      }),
      turnCompleted(T1, 'answer'),
    ])
    expect(buildTurnConversation(encryptedOnly).filter(isReasoningMessage)).toHaveLength(0)
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
    expect(state.isReasoning).toBe(false)
    expect(state.isWaitingOnHuman).toBe(false)
  })

  it('aggregates usage across session turns', () => {
    const first = reduceTurn([
      created('turn-1', S1, user('first?')),
      requested('turn-1', 0),
      completed('turn-1', 0, assistantText('first answer'), {
        inputTokens: 20,
        outputTokens: 5,
        totalTokens: 25,
      }),
      turnCompleted('turn-1', 'first answer'),
    ])
    const second = reduceTurn([
      created('turn-2', S1, user('second?')),
      requested('turn-2', 0),
      completed('turn-2', 0, assistantText('second answer'), {
        inputTokens: 30,
        outputTokens: 7,
        totalTokens: 37,
        reasoningTokens: 2,
      }),
      turnCompleted('turn-2', 'second answer'),
    ])
    const state = buildSessionChatState([first, second], emptyOverlay())
    expect(state.sessionUsage).toEqual({
      inputTokens: 50,
      outputTokens: 12,
      totalTokens: 62,
      reasoningTokens: 2,
    })
  })

  it('is settled (not processing) when the latest turn is terminal', () => {
    const turn = reduceTurn(completedTurnLog(T1, S1, 'q', 'a'))
    const state = buildSessionChatState([turn], emptyOverlay())
    expect(state.isProcessing).toBe(false)
    expect(state.isReasoning).toBe(false)
    expect(state.isWaitingOnHuman).toBe(false)
  })

  it('exposes pending permissions as request events and marks the turn as waiting', () => {
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
    expect(state.isReasoning).toBe(false)
    expect(state.isWaitingOnHuman).toBe(true)
  })

  it('does not mark automatic permission classification as waiting on a human', () => {
    const turnCreated = created(T1, S1)
    const turn = reduceTurn([
      {
        ...turnCreated,
        config: { ...turnCreated.config, autoPermission: true },
      },
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('p1', 'executeCommand'))),
      {
        type: 'tool_permission_required',
        turnId: T1,
        ts: TS,
        toolCallId: 'p1',
        toolName: 'executeCommand',
        request: { kind: 'command', commandNames: ['echo'] },
      },
    ])
    const state = buildSessionChatState([turn], emptyOverlay())
    expect(state.allPermissionRequests.has('p1')).toBe(false)
    expect(state.isProcessing).toBe(true)
    expect(state.isReasoning).toBe(false)
    expect(state.isWaitingOnHuman).toBe(false)
  })

  it('marks the turn as waiting when automatic permission classification defers', () => {
    const turnCreated = created(T1, S1)
    const turn = reduceTurn([
      {
        ...turnCreated,
        config: { ...turnCreated.config, autoPermission: true },
      },
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('p1', 'executeCommand'))),
      {
        type: 'tool_permission_required',
        turnId: T1,
        ts: TS,
        toolCallId: 'p1',
        toolName: 'executeCommand',
        request: { kind: 'command', commandNames: ['rm'] },
      },
      {
        type: 'tool_permission_classified',
        turnId: T1,
        ts: TS,
        toolCallId: 'p1',
        decision: 'defer',
        reason: 'needs human review',
      },
    ])
    const state = buildSessionChatState([turn], emptyOverlay())
    expect(state.allPermissionRequests.has('p1')).toBe(true)
    expect(state.isProcessing).toBe(true)
    expect(state.isReasoning).toBe(false)
    expect(state.isWaitingOnHuman).toBe(true)
  })

  it('marks the turn as waiting when automatic permission classification denies with a human available', () => {
    const turnCreated = created(T1, S1)
    const turn = reduceTurn([
      {
        ...turnCreated,
        config: { ...turnCreated.config, autoPermission: true },
      },
      requested(T1, 0),
      completed(T1, 0, assistantCalls(toolCallPart('p1', 'executeCommand'))),
      {
        type: 'tool_permission_required',
        turnId: T1,
        ts: TS,
        toolCallId: 'p1',
        toolName: 'executeCommand',
        request: { kind: 'command', commandNames: ['rm'] },
      },
      {
        type: 'tool_permission_classified',
        turnId: T1,
        ts: TS,
        toolCallId: 'p1',
        decision: 'deny',
        reason: 'destructive command',
      },
    ])
    const state = buildSessionChatState([turn], emptyOverlay())
    expect(state.allPermissionRequests.has('p1')).toBe(true)
    expect(state.isProcessing).toBe(true)
    expect(state.isWaitingOnHuman).toBe(true)
  })

  it('tracks reasoning only between reasoning_start and reasoning_end', () => {
    const events: TEvent[] = [
      created(T1, S1),
      requested(T1, 0),
      modelStep(T1, 0, { type: 'reasoning_start' }),
    ]
    expect(buildSessionChatState([reduceTurn(events)], emptyOverlay()).isReasoning).toBe(true)

    events.push(modelStep(T1, 0, { type: 'reasoning_end', text: 'considering' }))
    expect(buildSessionChatState([reduceTurn(events)], emptyOverlay()).isReasoning).toBe(false)
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
    expect(state.isReasoning).toBe(false)
    expect(state.isWaitingOnHuman).toBe(true)
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
    expect(state.isReasoning).toBe(false)
  })

  it('renders the live text as a synthetic trailing item under the durable id', () => {
    const turn = reduceTurn([created(T1, S1), requested(T1, 0)])
    const state = buildSessionChatState([turn], { ...emptyOverlay(), text: 'typing…' })
    const last = state.conversation[state.conversation.length - 1]
    expect(last).toMatchObject({
      id: assistantMessageId(T1, 0),
      role: 'assistant',
      content: 'typing…',
      streaming: true,
    })

    // Completion must yield a durable item under the SAME id — any drift
    // between the two derivations reintroduces the unmount/remount flash.
    const done = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantText('typed all of it')),
    ])
    const settled = buildSessionChatState([done], emptyOverlay())
    const durable = settled.conversation
      .filter(isChatMessage)
      .find((m) => m.role === 'assistant')
    expect(durable?.id).toBe(assistantMessageId(T1, 0))
    expect(durable?.streaming).toBeUndefined()
    expect(
      settled.conversation.filter(
        (item) => 'id' in item && item.id === assistantMessageId(T1, 0),
      ),
    ).toHaveLength(1)
  })

  it('renders live reasoning as a synthetic item under the durable id, shimmering', () => {
    const turn = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      modelStep(T1, 0, { type: 'reasoning_start' }),
    ])
    const state = buildSessionChatState([turn], { ...emptyOverlay(), reasoning: 'hmm…' })
    const last = state.conversation[state.conversation.length - 1]
    expect(last).toMatchObject({
      id: reasoningMessageId(T1, 0),
      kind: 'reasoning',
      content: 'hmm…',
      streaming: true,
    })
  })

  it('live reasoning stops shimmering and precedes the answer once text streams', () => {
    const turn = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      modelStep(T1, 0, { type: 'reasoning_start' }),
      modelStep(T1, 0, { type: 'reasoning_end', text: 'done reasoning' }),
    ])
    const state = buildSessionChatState([turn], {
      ...emptyOverlay(),
      reasoning: 'done reasoning',
      text: 'answer…',
    })
    const ids = state.conversation.map((item) => item.id)
    expect(ids.indexOf(reasoningMessageId(T1, 0))).toBeLessThan(
      ids.indexOf(assistantMessageId(T1, 0)),
    )
    const reasoningItem = state.conversation.find(isReasoningMessage)
    expect(reasoningItem?.streaming).toBe(false)
  })

  it('a later model call streams under its own index; earlier segments stay durable', () => {
    const turn = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      completed(T1, 0, assistantText('first segment')),
      requested(T1, 1, ['assistant:0']),
    ])
    const state = buildSessionChatState([turn], { ...emptyOverlay(), text: 'second…' })
    const last = state.conversation[state.conversation.length - 1]
    expect(last).toMatchObject({ id: assistantMessageId(T1, 1), streaming: true })
    const first = state.conversation
      .filter(isChatMessage)
      .find((m) => m.id === assistantMessageId(T1, 0))
    expect(first?.content).toBe('first segment')
    expect(first?.streaming).toBeUndefined()
  })

  it('emits no synthetic items once the turn settles, and none without live text', () => {
    const settled = buildSessionChatState(
      [
        reduceTurn([
          created(T1, S1),
          requested(T1, 0),
          completed(T1, 0, assistantText('done')),
          turnCompleted(T1, 'done'),
        ]),
      ],
      emptyOverlay(),
    )
    expect(
      settled.conversation.some((item) => (item as { streaming?: boolean }).streaming),
    ).toBe(false)

    const quiet = buildSessionChatState(
      [reduceTurn([created(T1, S1), requested(T1, 0)])],
      emptyOverlay(),
    )
    expect(
      quiet.conversation.some((item) => (item as { streaming?: boolean }).streaming),
    ).toBe(false)
  })

  it('surfaces streaming reasoning as currentReasoning', () => {
    const turn = reduceTurn([
      created(T1, S1),
      requested(T1, 0),
      modelStep(T1, 0, { type: 'reasoning_start' }),
    ])
    const state = buildSessionChatState([turn], { ...emptyOverlay(), reasoning: 'hmm…' })
    expect(state.currentReasoning).toBe('hmm…')
    expect(state.isReasoning).toBe(true)
  })
})

describe('lastSelection', () => {
  it('surfaces the LATEST turn\'s resolved model and reasoning effort', () => {
    const first = reduceTurn([created(T1, S1)])
    const laterCreated = created('turn-2', S1)
    laterCreated.config = { ...laterCreated.config, reasoningEffort: 'high' }
    laterCreated.agent = {
      ...laterCreated.agent,
      resolved: {
        ...laterCreated.agent.resolved,
        model: { provider: 'anthropic', model: 'claude-fixture' },
      },
    }
    const second = reduceTurn([laterCreated])
    const state = buildSessionChatState([first, second], emptyOverlay())
    expect(state.lastSelection).toEqual({
      provider: 'anthropic',
      model: 'claude-fixture',
      effort: 'high',
    })
  })

  it('omits effort when the turn ran on auto', () => {
    const state = buildSessionChatState([reduceTurn([created(T1, S1)])], emptyOverlay())
    expect(state.lastSelection).toEqual({ provider: 'openai', model: 'gpt-fixture' })
  })

  it('is null for a session with no turns', () => {
    expect(buildSessionChatState([], emptyOverlay()).lastSelection).toBeNull()
  })
})
