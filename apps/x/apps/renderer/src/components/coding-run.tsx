import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDot,
  Eye,
  FileText,
  Loader,
  Pencil,
  Search,
  ShieldQuestion,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react'
import type { CodeRunEvent, PermissionAsk, PermissionDecision } from '@x/shared/src/code-mode.js'
import { cn } from '@/lib/utils'
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool'
import { getToolErrorText, toToolState, type ToolCall } from '@/lib/chat-conversation'
import { clearCodeRunBuffer, useCodeRunFeed } from '@/lib/code-run-feed'

// ── Timeline reduction ──────────────────────────────────────────────
// The raw ACP stream is a flat list of events; collapse it into ordered rows,
// folding tool_call + tool_call_update (by id) and the latest plan in place.

type TextRow = { kind: 'text'; id: string; text: string }
type ToolRow = { kind: 'tool'; id: string; title?: string; toolKind?: string; status?: string; diffs: string[] }
type PlanRow = { kind: 'plan'; id: string; entries: { content: string; status?: string }[] }
type PermRow = { kind: 'perm'; id: string; title: string; decision: string }
type Row = TextRow | ToolRow | PlanRow | PermRow

export function reduceEvents(events: CodeRunEvent[]): Row[] {
  const rows: Row[] = []
  const toolIdx = new Map<string, number>()
  let planIdx = -1

  events.forEach((e, i) => {
    switch (e.type) {
      case 'message': {
        if (e.role !== 'agent' || !e.text) return
        const last = rows[rows.length - 1]
        if (last && last.kind === 'text') last.text += e.text
        else rows.push({ kind: 'text', id: `t${i}`, text: e.text })
        break
      }
      case 'tool_call': {
        const id = e.id ?? `tc${i}`
        const at = toolIdx.get(id)
        if (at != null) {
          const r = rows[at] as ToolRow
          r.title = e.title ?? r.title
          r.toolKind = e.kind ?? r.toolKind
          r.status = e.status ?? r.status
        } else {
          toolIdx.set(id, rows.length)
          rows.push({ kind: 'tool', id, title: e.title, toolKind: e.kind, status: e.status, diffs: [] })
        }
        break
      }
      case 'tool_call_update': {
        const id = e.id ?? `tu${i}`
        let at = toolIdx.get(id)
        if (at == null) {
          at = rows.length
          toolIdx.set(id, at)
          rows.push({ kind: 'tool', id, diffs: [] })
        }
        const r = rows[at] as ToolRow
        if (e.status) r.status = e.status
        for (const d of e.diffs) if (!r.diffs.includes(d)) r.diffs.push(d)
        break
      }
      case 'plan': {
        if (planIdx >= 0) (rows[planIdx] as PlanRow).entries = e.entries
        else {
          planIdx = rows.length
          rows.push({ kind: 'plan', id: 'plan', entries: e.entries })
        }
        break
      }
      case 'permission':
        rows.push({ kind: 'perm', id: `p${i}`, title: e.ask.title, decision: e.decision })
        break
      default:
        break
    }
  })
  return rows
}

function toolKindIcon(kind?: string, title?: string) {
  if (title === 'Compacting context') return <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
  switch (kind) {
    case 'read': return <Eye className="size-3.5 shrink-0 text-muted-foreground" />
    case 'edit': return <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
    case 'delete': return <Trash2 className="size-3.5 shrink-0 text-muted-foreground" />
    case 'search': return <Search className="size-3.5 shrink-0 text-muted-foreground" />
    case 'execute': return <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
    case 'fetch': return <FileText className="size-3.5 shrink-0 text-muted-foreground" />
    default: return <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
  }
}

function planMarker(status?: string) {
  if (status === 'completed') return <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
  if (status === 'in_progress') return <CircleDot className="size-3.5 shrink-0 text-blue-500" />
  return <Circle className="size-3.5 shrink-0 text-muted-foreground" />
}

const basename = (p: string) => p.split(/[\\/]/).pop() || p

export function CodingRunTimeline({
  events,
  error,
  onOpenDiff,
}: {
  events: CodeRunEvent[]
  error?: string
  // When set, changed-file names become clickable (the Code section opens the diff).
  onOpenDiff?: (path: string) => void
}) {
  const rows = useMemo(() => reduceEvents(events), [events])
  if (rows.length === 0) {
    if (error) {
      return (
        <div className="px-4 py-3">
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 whitespace-pre-wrap break-words">{error}</span>
          </div>
        </div>
      )
    }
    return <div className="px-4 py-3 text-xs text-muted-foreground">Starting the agent…</div>
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {rows.map((row) => {
        if (row.kind === 'text') {
          return (
            <p key={row.id} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
              {row.text}
            </p>
          )
        }
        if (row.kind === 'tool') {
          const running = row.status !== 'completed' && row.status !== 'failed'
          const failed = row.status === 'failed'
          return (
            <div key={row.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm">
                {running ? (
                  <Loader className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : failed ? (
                  <AlertCircle className="size-3.5 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
                )}
                {toolKindIcon(row.toolKind, row.title)}
                <span className="truncate text-foreground/90">{row.title ?? row.toolKind ?? 'Tool call'}</span>
              </div>
              {row.diffs.length > 0 && (
                <div className="ml-7 flex flex-col gap-0.5">
                  {row.diffs.map((d) => (
                    onOpenDiff ? (
                      <button
                        key={d}
                        type="button"
                        onClick={() => onOpenDiff(d)}
                        className="truncate text-left font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                        title={d}
                      >
                        {basename(d)}
                      </button>
                    ) : (
                      <span key={d} className="truncate font-mono text-xs text-muted-foreground" title={d}>
                        {basename(d)}
                      </span>
                    )
                  ))}
                </div>
              )}
            </div>
          )
        }
        if (row.kind === 'plan') {
          return (
            <div key={row.id} className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-2">
              {row.entries.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-foreground/90">
                  {planMarker(entry.status)}
                  <span className={cn('truncate', entry.status === 'completed' && 'text-muted-foreground line-through')}>
                    {entry.content}
                  </span>
                </div>
              ))}
            </div>
          )
        }
        // resolved permission
        const denied = row.decision === 'reject' || row.decision === 'cancelled'
        return (
          <div key={row.id} className={cn('flex items-center gap-2 text-xs', denied ? 'text-red-600' : 'text-green-600')}>
            {denied ? '✕' : '✓'}
            <span className="truncate">{denied ? 'Denied' : 'Allowed'}: {row.title}</span>
          </div>
        )
      })}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-wrap break-words">{error}</span>
        </div>
      )}
    </div>
  )
}

// ── In-run permission card ──────────────────────────────────────────

export function CodeRunPermissionRequest({
  ask,
  onDecide,
}: {
  ask: PermissionAsk
  onDecide: (decision: PermissionDecision) => void
}) {
  const [busy, setBusy] = useState(false)
  const decide = (d: PermissionDecision) => {
    if (busy) return
    setBusy(true)
    onDecide(d)
  }
  const btn = 'rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'
  return (
    <div className="mb-4 rounded-[20px] border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ShieldQuestion className="size-4 shrink-0 text-amber-600" />
        Permission needed
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        The agent wants to: <span className="font-medium text-foreground">{ask.title}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => decide('allow_once')}
          className={cn(btn, 'bg-foreground text-background hover:bg-foreground/90')}>
          Allow
        </button>
        <button type="button" disabled={busy} onClick={() => decide('allow_always')}
          className={cn(btn, 'border hover:bg-muted')}>
          Always allow{ask.kind ? ` (${ask.kind})` : ''}
        </button>
        <button type="button" disabled={busy} onClick={() => decide('reject')}
          className={cn(btn, 'border border-red-500/40 text-red-600 hover:bg-red-500/10')}>
          Deny
        </button>
      </div>
    </div>
  )
}

// ── Block wrapper (rendered in the chat for a code_agent_run tool call) ──

const AGENT_LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }

export function CodingRunBlock({
  item,
  open,
  onOpenChange,
  onPermissionDecision,
}: {
  item: ToolCall
  open: boolean
  onOpenChange: (open: boolean) => void
  onPermissionDecision: (decision: PermissionDecision) => void
}) {
  // Prefer the agent the backend actually ran (the chip) once the run returns; fall
  // back to the requested input agent while it's still in flight. Never trust only the
  // model's input — it can pass a stale agent the backend overrode with the chip.
  const agent =
    (item.result as { agent?: string } | undefined)?.agent ??
    (item.input as { agent?: string } | undefined)?.agent
  const title = AGENT_LABEL[agent ?? ''] ?? 'Coding agent'
  const error = getToolErrorText(item)
  // Timeline source: the durable record (item.codeRunEvents — the settle-time
  // batch, or the legacy path's inline accumulation) wins; while it's absent
  // the live CodeRunFeed buffer streams the run in real time.
  const liveEvents = useCodeRunFeed(item.id)
  const durableEvents = item.codeRunEvents
  const events = durableEvents?.length ? durableEvents : liveEvents
  // Once the durable batch has landed the buffer is redundant — drop it.
  useEffect(() => {
    if (durableEvents?.length) clearCodeRunBuffer(item.id)
  }, [durableEvents?.length, item.id])
  return (
    <>
      <Tool open={open} onOpenChange={onOpenChange}>
        <ToolHeader title={title} type="tool-code_agent_run" state={toToolState(item.status)} />
        <ToolContent>
          <CodingRunTimeline events={events} error={error} />
        </ToolContent>
      </Tool>
      {item.pendingCodePermission && (
        <CodeRunPermissionRequest ask={item.pendingCodePermission.ask} onDecide={onPermissionDecision} />
      )}
    </>
  )
}
