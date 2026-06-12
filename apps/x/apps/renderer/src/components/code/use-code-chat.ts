import { useCallback, useEffect, useRef, useState } from 'react'
import type z from 'zod'
import type { RunEvent, ToolPermissionRequestEvent, AskHumanRequestEvent } from '@x/shared/src/runs.js'
import type { CodeRunEvent, PermissionAsk, PermissionDecision } from '@x/shared/src/code-mode.js'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import {
  type ChatMessage,
  type ErrorMessage,
  type ToolCall,
  normalizeToolInput,
} from '@/lib/chat-conversation'

// A direct-drive coding turn: the structural ACP events (tool calls, plan,
// resolved permissions) grouped under one turn id. The agent's prose is NOT
// part of the turn — it streams via liveText and lands as an assistant
// ChatMessage, so live rendering and JSONL replay converge on the same shape.
export interface DirectTurn {
  kind: 'direct-turn'
  id: string
  events: CodeRunEvent[]
  timestamp: number
}

export type CodeChatItem = ChatMessage | ToolCall | ErrorMessage | DirectTurn

export const isDirectTurn = (item: CodeChatItem): item is DirectTurn =>
  'kind' in item && (item as DirectTurn).kind === 'direct-turn'

// Narrowing guards over the widened item union (the chat-conversation guards
// only accept ConversationItem).
export const isChatToolCall = (item: CodeChatItem): item is ToolCall => 'name' in item
export const isChatErrorMessage = (item: CodeChatItem): item is ErrorMessage =>
  'kind' in item && (item as ErrorMessage).kind === 'error'
export const isChatMessageItem = (item: CodeChatItem): item is ChatMessage => 'role' in item

export interface PendingCodePermission {
  requestId: string
  ask: PermissionAsk
  toolCallId: string
}

const DIRECT_PREFIX = 'direct-'
const STRUCTURAL_EVENTS = new Set(['tool_call', 'tool_call_update', 'plan', 'permission'])

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('')
  }
  return ''
}

// Conversation state for one coding session, fed by the run JSONL (history)
// and the live runs:events stream. Handles both modes: direct turns arrive as
// code-run-events with a `direct-` toolCallId; Rowboat turns arrive as the
// usual LLM message/tool events (incl. code_agent_run blocks).
export function useCodeChat(session: CodeSession | null) {
  const sessionId = session?.id ?? null
  const [items, setItems] = useState<CodeChatItem[]>([])
  const [liveText, setLiveText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingPermission, setPendingPermission] = useState<PendingCodePermission | null>(null)
  // Rowboat-mode copilot gates, same as the main chat: pre-tool-call permission
  // requests and ask-human questions. Keyed by toolCallId.
  const [pendingToolPermissions, setPendingToolPermissions] = useState<Map<string, z.infer<typeof ToolPermissionRequestEvent>>>(new Map())
  const [pendingAskHumans, setPendingAskHumans] = useState<Map<string, z.infer<typeof AskHumanRequestEvent>>>(new Map())
  const [loading, setLoading] = useState(false)
  const seenMessageIdsRef = useRef<Set<string>>(new Set())

  const applyCodeRunEvent = useCallback((toolCallId: string, event: CodeRunEvent) => {
    if (toolCallId.startsWith(DIRECT_PREFIX)) {
      if (!STRUCTURAL_EVENTS.has(event.type)) return
      setItems((prev) => {
        const at = prev.findIndex((item) => isDirectTurn(item) && item.id === toolCallId)
        if (at >= 0) {
          const turn = prev[at] as DirectTurn
          const next = [...prev]
          next[at] = { ...turn, events: [...turn.events, event] }
          return next
        }
        return [...prev, { kind: 'direct-turn', id: toolCallId, events: [event], timestamp: Date.now() }]
      })
      return
    }
    // Rowboat mode: attach to the code_agent_run tool call block.
    setItems((prev) => prev.map((item) => {
      if (isChatToolCall(item) && item.id === toolCallId) {
        return { ...item, codeRunEvents: [...(item.codeRunEvents ?? []), event] }
      }
      return item
    }))
  }, [])

  // Load history from the run log whenever the session changes.
  useEffect(() => {
    if (!sessionId) {
      setItems([])
      setLiveText('')
      setPendingPermission(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setItems([])
    setLiveText('')
    setPendingPermission(null)
    setPendingToolPermissions(new Map())
    setPendingAskHumans(new Map())
    seenMessageIdsRef.current = new Set()

    void window.ipc.invoke('runs:fetch', { runId: sessionId }).then((run) => {
      if (cancelled) return
      const loaded: CodeChatItem[] = []
      const toolCallMap = new Map<string, ToolCall>()
      const turnMap = new Map<string, DirectTurn>()
      // Rebuild copilot gates still waiting on the user (request without a
      // matching response in the log) so reopening a blocked session shows them.
      const toolPerms = new Map<string, z.infer<typeof ToolPermissionRequestEvent>>()
      const askHumans = new Map<string, z.infer<typeof AskHumanRequestEvent>>()

      for (const event of run.log as z.infer<typeof RunEvent>[]) {
        const ts = event.ts ? new Date(event.ts).getTime() : Date.now()
        switch (event.type) {
          case 'message': {
            const msg = event.message
            if (msg.role === 'user' || msg.role === 'assistant') {
              const text = messageText(msg.content)
              if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                for (const part of msg.content as Array<{ type: string; toolCallId?: string; toolName?: string; arguments?: unknown }>) {
                  if (part.type === 'tool-call' && part.toolCallId && part.toolName) {
                    const toolCall: ToolCall = {
                      id: part.toolCallId,
                      name: part.toolName,
                      input: normalizeToolInput(part.arguments as ToolCall['input']),
                      status: 'pending',
                      timestamp: ts,
                    }
                    toolCallMap.set(toolCall.id, toolCall)
                    loaded.push(toolCall)
                  }
                }
              }
              if (text.trim()) {
                seenMessageIdsRef.current.add(event.messageId)
                loaded.push({ id: event.messageId, role: msg.role, content: text, timestamp: ts })
              }
            }
            break
          }
          case 'tool-invocation': {
            const existing = event.toolCallId ? toolCallMap.get(event.toolCallId) : null
            if (existing) {
              existing.input = normalizeToolInput(event.input)
              existing.status = 'running'
            }
            break
          }
          case 'tool-result': {
            const existing = event.toolCallId ? toolCallMap.get(event.toolCallId) : null
            if (existing) {
              existing.result = event.result as ToolCall['result']
              existing.status = 'completed'
            }
            break
          }
          case 'code-run-event': {
            if (event.toolCallId.startsWith(DIRECT_PREFIX)) {
              if (!STRUCTURAL_EVENTS.has(event.event.type)) break
              let turn = turnMap.get(event.toolCallId)
              if (!turn) {
                turn = { kind: 'direct-turn', id: event.toolCallId, events: [], timestamp: ts }
                turnMap.set(event.toolCallId, turn)
                loaded.push(turn)
              }
              turn.events.push(event.event)
            } else {
              const existing = toolCallMap.get(event.toolCallId)
              if (existing) existing.codeRunEvents = [...(existing.codeRunEvents ?? []), event.event]
            }
            break
          }
          case 'tool-permission-request':
            toolPerms.set(event.toolCall.toolCallId, event)
            break
          case 'tool-permission-response':
            toolPerms.delete(event.toolCallId)
            break
          case 'ask-human-request':
            askHumans.set(event.toolCallId, event)
            break
          case 'ask-human-response':
            askHumans.delete(event.toolCallId)
            break
          case 'run-stopped':
            toolPerms.clear()
            askHumans.clear()
            break
          case 'error':
            loaded.push({ id: `error-${loaded.length}`, kind: 'error', message: event.error, timestamp: ts })
            break
          default:
            break
        }
      }
      setItems(loaded)
      setPendingToolPermissions(toolPerms)
      setPendingAskHumans(askHumans)
    }).catch(() => {
      // Run log unreadable — show an empty conversation rather than crashing.
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [sessionId])

  // Live event stream.
  useEffect(() => {
    if (!sessionId) return
    // runs:events is schema-less on the wire (req: z.null()) — cast like App.tsx does.
    return window.ipc.on('runs:events', ((raw: unknown) => {
      const event = raw as z.infer<typeof RunEvent>
      if (event.runId !== sessionId) return
      switch (event.type) {
        case 'run-processing-start':
          setIsProcessing(true)
          break
        case 'run-processing-end':
          setIsProcessing(false)
          setPendingPermission(null)
          // Anything still streaming that never landed as a message (e.g. the
          // turn errored) is flushed so the text isn't lost.
          setLiveText((text) => {
            if (text.trim()) {
              setItems((prev) => [...prev, {
                id: `assistant-flush-${Date.now()}`,
                role: 'assistant',
                content: text,
                timestamp: Date.now(),
              }])
            }
            return ''
          })
          break
        case 'run-stopped':
          setIsProcessing(false)
          setPendingPermission(null)
          setPendingToolPermissions(new Map())
          setPendingAskHumans(new Map())
          break
        case 'tool-permission-request':
          setPendingToolPermissions((prev) => new Map(prev).set(event.toolCall.toolCallId, event))
          break
        case 'tool-permission-response':
          setPendingToolPermissions((prev) => {
            const next = new Map(prev)
            next.delete(event.toolCallId)
            return next
          })
          break
        case 'ask-human-request':
          setPendingAskHumans((prev) => new Map(prev).set(event.toolCallId, event))
          break
        case 'ask-human-response':
          setPendingAskHumans((prev) => {
            const next = new Map(prev)
            next.delete(event.toolCallId)
            return next
          })
          break
        case 'message': {
          const msg = event.message
          if (msg.role !== 'user' && msg.role !== 'assistant') break
          if (seenMessageIdsRef.current.has(event.messageId)) break
          const text = messageText(msg.content)
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            for (const part of msg.content as Array<{ type: string; toolCallId?: string; toolName?: string; arguments?: unknown }>) {
              if (part.type === 'tool-call' && part.toolCallId && part.toolName) {
                const toolCall: ToolCall = {
                  id: part.toolCallId,
                  name: part.toolName,
                  input: normalizeToolInput(part.arguments as ToolCall['input']),
                  status: 'running',
                  timestamp: Date.now(),
                }
                setItems((prev) => (prev.some((i) => isChatToolCall(i) && i.id === toolCall.id) ? prev : [...prev, toolCall]))
              }
            }
          }
          if (!text.trim()) break
          seenMessageIdsRef.current.add(event.messageId)
          const chatMessage: ChatMessage = {
            id: event.messageId,
            role: msg.role,
            content: text.replace(/<\/?voice>/g, ''),
            timestamp: Date.now(),
          }
          if (msg.role === 'assistant') setLiveText('')
          setItems((prev) => {
            // Replace the optimistic local echo of this user message if present.
            if (msg.role === 'user') {
              const at = prev.findIndex((item) =>
                'role' in item && item.role === 'user' && item.id.startsWith('local-') && item.content === text)
              if (at >= 0) {
                const next = [...prev]
                next[at] = chatMessage
                return next
              }
            }
            return [...prev, chatMessage]
          })
          break
        }
        case 'llm-stream-event': {
          // Rowboat mode streaming text.
          const llmEvent = event.event as { type: string; delta?: string; toolCallId?: string; toolName?: string; input?: unknown }
          setIsProcessing(true)
          if (llmEvent.type === 'text-delta' && llmEvent.delta) {
            setLiveText((prev) => prev + llmEvent.delta)
          } else if (llmEvent.type === 'tool-call' && llmEvent.toolCallId) {
            const toolCall: ToolCall = {
              id: llmEvent.toolCallId,
              name: llmEvent.toolName || 'tool',
              input: normalizeToolInput(llmEvent.input as ToolCall['input']),
              status: 'running',
              timestamp: Date.now(),
            }
            setItems((prev) => (prev.some((i) => isChatToolCall(i) && i.id === toolCall.id) ? prev : [...prev, toolCall]))
          }
          break
        }
        case 'tool-invocation':
          setItems((prev) => prev.map((item) => (
            isChatToolCall(item) && item.id === event.toolCallId
              ? { ...item, input: normalizeToolInput(event.input), status: 'running' as const }
              : item
          )))
          break
        case 'tool-result':
          setItems((prev) => prev.map((item) => (
            isChatToolCall(item) && item.id === event.toolCallId
              ? { ...item, result: event.result as ToolCall['result'], status: 'completed' as const, pendingCodePermission: null }
              : item
          )))
          break
        case 'code-run-event': {
          setIsProcessing(true)
          if (event.event.type === 'message' && event.event.role === 'agent' && event.toolCallId.startsWith(DIRECT_PREFIX)) {
            const text = event.event.text
            setLiveText((prev) => prev + text)
          }
          if (event.event.type === 'permission') {
            setPendingPermission(null)
          }
          applyCodeRunEvent(event.toolCallId, event.event)
          break
        }
        case 'code-run-permission-request':
          setPendingPermission({ requestId: event.requestId, ask: event.ask, toolCallId: event.toolCallId })
          break
        case 'error':
          setItems((prev) => [...prev, {
            id: `error-${Date.now()}`,
            kind: 'error',
            message: event.error,
            timestamp: Date.now(),
          }])
          break
        default:
          break
      }
    }) as unknown as (event: null) => void)
  }, [sessionId, applyCodeRunEvent])

  const send = useCallback(async (text: string): Promise<{ ok: boolean; error?: string }> => {
    if (!session) return { ok: false, error: 'No session selected' }
    const trimmed = text.trim()
    if (!trimmed) return { ok: false }
    // Optimistic echo, replaced by the persisted event when it arrives.
    setItems((prev) => [...prev, {
      id: `local-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }])
    setIsProcessing(true)
    try {
      if (session.mode === 'direct') {
        const res = await window.ipc.invoke('codeSession:sendMessage', { sessionId: session.id, text: trimmed })
        if (!res.accepted) {
          setIsProcessing(false)
          return { ok: false, error: res.error ?? 'The session is busy.' }
        }
      } else {
        await window.ipc.invoke('runs:createMessage', {
          runId: session.id,
          message: trimmed,
          codeMode: session.agent,
          codeCwd: session.cwd,
          codePolicy: session.policy,
        })
      }
      return { ok: true }
    } catch (err) {
      setIsProcessing(false)
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to send message' }
    }
  }, [session])

  const stop = useCallback(async () => {
    if (!sessionId) return
    await window.ipc.invoke('codeSession:stop', { sessionId })
  }, [sessionId])

  const resolvePermission = useCallback(async (decision: PermissionDecision) => {
    if (!pendingPermission) return
    setPendingPermission(null)
    await window.ipc.invoke('codeRun:resolvePermission', {
      requestId: pendingPermission.requestId,
      decision,
    })
  }, [pendingPermission])

  // Rowboat-mode copilot gates — same IPC the main chat uses.
  const respondToToolPermission = useCallback(async (
    toolCallId: string,
    subflow: string[],
    response: 'approve' | 'deny',
    scope?: 'once' | 'session' | 'always',
  ) => {
    if (!sessionId) return
    setPendingToolPermissions((prev) => {
      const next = new Map(prev)
      next.delete(toolCallId)
      return next
    })
    await window.ipc.invoke('runs:authorizePermission', {
      runId: sessionId,
      authorization: { subflow, toolCallId, response, scope },
    })
  }, [sessionId])

  const respondToAskHuman = useCallback(async (toolCallId: string, subflow: string[], response: string) => {
    if (!sessionId) return
    setPendingAskHumans((prev) => {
      const next = new Map(prev)
      next.delete(toolCallId)
      return next
    })
    await window.ipc.invoke('runs:provideHumanInput', {
      runId: sessionId,
      reply: { subflow, toolCallId, response },
    })
  }, [sessionId])

  return {
    items,
    liveText,
    isProcessing,
    pendingPermission,
    pendingToolPermissions,
    pendingAskHumans,
    loading,
    send,
    stop,
    resolvePermission,
    respondToToolPermission,
    respondToAskHuman,
  }
}
