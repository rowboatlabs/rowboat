import { useMemo } from 'react'
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool'
import { TurnConversation } from '@/components/turn-conversation'
import { turnStateToTranscript, type AgentRunTranscript } from '@/lib/agent-transcript'
import { toToolState, type ToolCall } from '@/lib/chat-conversation'
import { useTurn } from '@/hooks/use-turn'

// Rendered for a spawn-agent tool call: a collapsed status card that expands
// into the child turn's live transcript. The child is a standalone turn
// (sessionId null); its durable events arrive on the turns:events spine, so
// useTurn keeps the transcript live without polling.

function useChildTranscript(
  childTurnId: string | undefined,
  open: boolean,
): AgentRunTranscript | null {
  const { state } = useTurn(childTurnId, { enabled: open })
  return useMemo(
    () => (childTurnId && state ? turnStateToTranscript(childTurnId, state) : null),
    [childTurnId, state],
  )
}

// "london-weather" / "meeting_prep" → "London weather" / "Meeting prep".
function humanizeName(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ''
}

export function SubAgentBlock({
  item,
  open,
  onOpenChange,
}: {
  item: ToolCall
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const input = item.input as
    | { name?: string; agent_id?: string; task?: string }
    | undefined
  const rawName = item.subAgent?.agentName || input?.agent_id || input?.name || ''
  const name = rawName === 'subagent' ? '' : humanizeName(rawName)
  const task = (item.subAgent?.task || input?.task || '').trim()
  const running = item.status === 'pending' || item.status === 'running'
  const transcript = useChildTranscript(item.subAgent?.childTurnId, open)

  return (
    <Tool open={open} onOpenChange={onOpenChange}>
      <ToolHeader
        summary={{ verb: name || 'Agent', detail: task || undefined }}
        type="tool-spawn-agent"
        state={toToolState(item.status)}
      />
      <ToolContent>
        <div className="flex flex-col py-1">
          {transcript ? (
            // The transcript opens with the child's user message — the task —
            // so no separate task chip is rendered here. Same shared renderer
            // as the chat transcript, so tool rows, usage footer, and copy
            // behave identically inside the nested turn.
            <TurnConversation items={transcript.items} />
          ) : (
            <div className="px-1 text-sm text-muted-foreground">
              {item.subAgent
                ? 'Loading sub-agent transcript…'
                : running
                  ? 'Starting sub-agent…'
                  : 'No sub-agent transcript was recorded.'}
            </div>
          )}
        </div>
      </ToolContent>
    </Tool>
  )
}
