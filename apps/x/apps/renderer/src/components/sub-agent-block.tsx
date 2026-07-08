import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool'
import { CompactConversation } from '@/components/compact-conversation'
import { fetchAgentRunTranscript, type AgentRunTranscript } from '@/lib/agent-transcript'
import { toToolState, type ToolCall } from '@/lib/chat-conversation'

// Rendered for a spawn-agent tool call: a collapsed status card that expands
// into the child turn's live transcript. The child is a standalone turn
// (sessionId null) whose events never reach the session bus, so while it
// runs we poll sessions:getTurn via fetchAgentRunTranscript — the file is
// local and append-only, making this cheap — and do one final fetch when the
// parent tool call settles.

const POLL_MS = 1000

function useChildTranscript(
  childTurnId: string | undefined,
  running: boolean,
  open: boolean,
): AgentRunTranscript | null {
  const [transcript, setTranscript] = useState<AgentRunTranscript | null>(null)
  useEffect(() => {
    if (!childTurnId || !open) return
    let alive = true
    const fetchOnce = async () => {
      try {
        const next = await fetchAgentRunTranscript(childTurnId)
        if (alive) setTranscript(next)
      } catch {
        // Child file may not be readable yet; the next tick retries.
      }
    }
    void fetchOnce()
    if (!running) return () => { alive = false }
    const timer = setInterval(() => void fetchOnce(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [childTurnId, running, open])
  return transcript
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
  const agentName = item.subAgent?.agentName ?? input?.agent_id ?? input?.name ?? 'subagent'
  const task = item.subAgent?.task ?? input?.task ?? ''
  const running = item.status === 'pending' || item.status === 'running'
  const transcript = useChildTranscript(item.subAgent?.childTurnId, running, open)

  return (
    <Tool open={open} onOpenChange={onOpenChange}>
      <ToolHeader
        title={`Sub-agent: ${agentName}`}
        type="tool-spawn-agent"
        state={toToolState(item.status)}
      />
      <ToolContent>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {task && (
            <div className="flex items-start gap-2 rounded-2xl bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
              <Bot className="mt-0.5 size-4 shrink-0" />
              <span className="whitespace-pre-wrap">{task}</span>
            </div>
          )}
          {transcript ? (
            <CompactConversation items={transcript.items} />
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
