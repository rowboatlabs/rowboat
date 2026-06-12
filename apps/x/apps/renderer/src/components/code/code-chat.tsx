import { useEffect, useRef, useState } from 'react'
import { ArrowUp, FileText, Loader2, LoaderIcon, Plus, Square, Terminal, X } from 'lucide-react'
import type { CodeSession, CodeSessionStatus } from '@x/shared/src/code-sessions.js'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { MessageResponse } from '@/components/ai-elements/message'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool'
import { toToolState, getToolDisplayName, getWebSearchCardData, type ToolCall } from '@/lib/chat-conversation'
import { CodeRunPermissionRequest, CodingRunTimeline } from '@/components/coding-run'
import { PermissionRequest } from '@/components/ai-elements/permission-request'
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request'
import { WebSearchResult } from '@/components/ai-elements/web-search-result'
import { useCodeChat, isDirectTurn, isChatToolCall, isChatErrorMessage, type CodeChatItem } from './use-code-chat'

const AGENT_LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }

function RowboatToolCall({ item, onOpenDiff }: { item: ToolCall; onOpenDiff: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const webSearch = getWebSearchCardData(item)
  if (webSearch) {
    return (
      <WebSearchResult
        query={webSearch.query}
        results={webSearch.results}
        status={item.status}
        title={webSearch.title}
      />
    )
  }
  if (item.name === 'code_agent_run') {
    const agent = (item.result as { agent?: string } | undefined)?.agent
      ?? (item.input as { agent?: string } | undefined)?.agent
    return (
      <Tool open={open || item.status === 'running'} onOpenChange={setOpen}>
        <ToolHeader title={AGENT_LABEL[agent ?? ''] ?? 'Coding agent'} type="tool-code_agent_run" state={toToolState(item.status)} />
        <ToolContent>
          <CodingRunTimeline events={item.codeRunEvents ?? []} onOpenDiff={onOpenDiff} />
        </ToolContent>
      </Tool>
    )
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {item.status === 'running' || item.status === 'pending'
        ? <Loader2 className="size-3 animate-spin" />
        : <span className="text-green-600">✓</span>}
      <span className="truncate">{getToolDisplayName(item)}</span>
    </div>
  )
}

function ChatItem({ item, onOpenDiff }: { item: CodeChatItem; onOpenDiff: (path: string) => void }) {
  if (isDirectTurn(item)) {
    if (item.events.length === 0) return null
    return (
      <div className="rounded-[16px] border bg-muted/20">
        <CodingRunTimeline events={item.events} onOpenDiff={onOpenDiff} />
      </div>
    )
  }
  if (isChatErrorMessage(item)) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {item.message.split('\n')[0]}
      </div>
    )
  }
  if (isChatToolCall(item)) {
    return <RowboatToolCall item={item} onOpenDiff={onOpenDiff} />
  }
  if (item.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary/10 px-4 py-2.5 text-sm">
          {item.content}
        </div>
      </div>
    )
  }
  return (
    <div className="max-w-none text-sm">
      <MessageResponse>{item.content}</MessageResponse>
    </div>
  )
}

// Direct-drive chat for one coding session, rendered in the right-side pane in
// place of the assistant chat. Messages go straight to the ACP agent — when the
// session is in Rowboat mode this component isn't used (the real assistant
// chat pane is, bound to the session's run).
export function CodeChat({
  session,
  status,
  onOpenDiff,
}: {
  session: CodeSession
  status: CodeSessionStatus
  onOpenDiff: (path: string) => void
}) {
  const {
    items, liveText, isProcessing, pendingPermission, pendingToolPermissions, pendingAskHumans,
    loading, send, stop, resolvePermission, respondToToolPermission, respondToAskHuman,
  } = useCodeChat(session)
  const [draft, setDraft] = useState('')
  const [stopping, setStopping] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const busy = isProcessing || status === 'working' || status === 'needs-you'
  // Attached file PATHS — like dragging a file into the Claude Code CLI, the
  // agent receives paths and reads the files itself with its own tools.
  const [attachments, setAttachments] = useState<string[]>([])

  useEffect(() => {
    setDraft('')
    setAttachments([])
    setStopping(false)
    textareaRef.current?.focus()
  }, [session.id])

  useEffect(() => {
    if (!busy) setStopping(false)
  }, [busy])

  const addAttachments = (paths: string[]) => {
    const cleaned = paths.filter(Boolean)
    if (cleaned.length === 0) return
    setAttachments((prev) => [...prev, ...cleaned.filter((p) => !prev.includes(p))])
  }

  const handlePickFiles = async () => {
    const res = await window.ipc.invoke('dialog:openFiles', {
      title: 'Attach files',
      defaultPath: session.cwd,
    })
    addAttachments(res.paths)
    textareaRef.current?.focus()
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer?.files?.length) return
    e.preventDefault()
    const paths = Array.from(e.dataTransfer.files)
      .map((file) => window.electronUtils?.getPathForFile(file))
      .filter(Boolean) as string[]
    addAttachments(paths)
  }

  const canSend = (Boolean(draft.trim()) || attachments.length > 0) && !busy

  const handleSend = async () => {
    if (!canSend) return
    const text = draft.trim()
    const files = attachments
    // The agent gets paths, CLI-style; it reads them from disk on its own.
    const message = files.length > 0
      ? `${text || 'Look at the attached files.'}\n\nAttached files (read them from disk):\n${files.map((p) => `- ${p}`).join('\n')}`
      : text
    setDraft('')
    setAttachments([])
    const result = await send(message)
    if (!result.ok && result.error) {
      toast.error(result.error)
      setDraft(text)
      setAttachments(files)
    }
  }

  const handleStop = async () => {
    setStopping(true)
    await stop()
  }

  const basename = (p: string) => p.split(/[\\/]/).pop() || p

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }}
      onDrop={handleDrop}
    >
      {/* Slim header — session controls live in the Code view's middle header */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{session.title}</div>
          <div className="text-[11px] text-muted-foreground">{AGENT_LABEL[session.agent]} — direct</div>
        </div>
      </div>

      {/* Conversation */}
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
          {loading && <div className="text-sm text-muted-foreground">Loading conversation…</div>}
          {!loading && items.length === 0 && !busy && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <div className="text-sm font-medium">
                Talk directly to {AGENT_LABEL[session.agent]}
              </div>
              <p className="max-w-sm text-xs text-muted-foreground">
                Your messages go straight to the coding agent in this project. Tool calls, plans, and diffs stream in here.
              </p>
            </div>
          )}
          {items.map((item) => (
            <ChatItem key={item.id} item={item} onOpenDiff={onOpenDiff} />
          ))}
          {liveText && (
            <div className="max-w-none text-sm">
              <MessageResponse>{liveText.replace(/<\/?voice>/g, '')}</MessageResponse>
            </div>
          )}
          {pendingPermission && (
            <CodeRunPermissionRequest ask={pendingPermission.ask} onDecide={(d) => void resolvePermission(d)} />
          )}
          {Array.from(pendingToolPermissions.values()).map((request) => (
            <PermissionRequest
              key={request.toolCall.toolCallId}
              toolCall={request.toolCall}
              permission={request.permission}
              onApprove={() => void respondToToolPermission(request.toolCall.toolCallId, request.subflow, 'approve')}
              onApproveSession={() => void respondToToolPermission(request.toolCall.toolCallId, request.subflow, 'approve', 'session')}
              onApproveAlways={() => void respondToToolPermission(request.toolCall.toolCallId, request.subflow, 'approve', 'always')}
              onDeny={() => void respondToToolPermission(request.toolCall.toolCallId, request.subflow, 'deny')}
              isProcessing={busy}
            />
          ))}
          {Array.from(pendingAskHumans.values()).map((request) => (
            <AskHumanRequest
              key={request.toolCallId}
              query={request.query}
              options={request.options}
              onResponse={(response) => void respondToAskHuman(request.toolCallId, request.subflow, response)}
              isProcessing={busy}
            />
          ))}
          {busy && !pendingPermission && pendingToolPermissions.size === 0 && pendingAskHumans.size === 0 && (
            <Shimmer className="text-sm">
              {stopping ? 'Stopping…' : `${AGENT_LABEL[session.agent]} is working…`}
            </Shimmer>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Composer — mirrors the assistant chat input's look (rounded card,
          borderless textarea, round primary send / destructive stop). */}
      <div className="p-3">
        <div className="rowboat-chat-input mx-auto w-full max-w-3xl rounded-lg border border-border bg-background shadow-none">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-1 pt-3">
              {attachments.map((p) => (
                <span
                  key={p}
                  title={p}
                  className="group inline-flex max-w-[260px] items-center gap-1.5 rounded-xl border border-border/50 bg-muted/80 px-2.5 py-1.5 text-xs"
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{basename(p)}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x !== p))}
                    aria-label="Remove attachment"
                    className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="px-4 pb-2 pt-4">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="Type your message..."
              className="max-h-40 min-h-[24px] w-full resize-none border-0 bg-transparent p-0 text-sm shadow-none outline-none focus-visible:ring-0"
              rows={2}
            />
          </div>
          <div className="flex items-center gap-2 px-3 pb-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void handlePickFiles()}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Attach files"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Attach files — the agent reads them from disk (or drag & drop)</TooltipContent>
            </Tooltip>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Terminal className="size-3.5 shrink-0" />
              <span className="truncate">Direct — straight to {AGENT_LABEL[session.agent]}</span>
            </span>
            <div className="flex-1" />
            {busy ? (
              <Button
                size="icon"
                onClick={() => void handleStop()}
                title={stopping ? 'Stopping…' : 'Stop the agent'}
                className={cn(
                  'h-7 w-7 shrink-0 rounded-full transition-all',
                  stopping
                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                {stopping ? (
                  <LoaderIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-3 w-3 fill-current" />
                )}
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={() => void handleSend()}
                disabled={!canSend}
                title="Send"
                className={cn(
                  'h-7 w-7 shrink-0 rounded-full transition-all',
                  canSend
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
