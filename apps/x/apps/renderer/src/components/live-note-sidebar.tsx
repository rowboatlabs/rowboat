import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import '@/styles/live-note-panel.css'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Play, Square, Loader2, Sparkles,
  AlertCircle, Plus, X, Check, Pencil, Radio, Repeat, Clock, Zap,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { LiveNoteSchema, type LiveNote, type Triggers } from '@x/shared/dist/live-note.js'
import { useLiveNoteAgentStatus } from '@/hooks/use-live-note-agent-status'
import { formatRelativeTime } from '@/lib/relative-time'
import { fetchAgentRunTranscript, type AgentRunTranscript } from '@/lib/agent-transcript'
import { CompactConversation } from '@/components/compact-conversation'

export type OpenLiveNotePanelDetail = {
  filePath: string
}

const CRON_PHRASES: Record<string, string> = {
  '* * * * *': 'Every minute',
  '*/5 * * * *': 'Every 5 minutes',
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Hourly, on the hour',
  '0 */2 * * *': 'Every 2 hours',
  '0 */6 * * *': 'Every 6 hours',
  '0 */12 * * *': 'Every 12 hours',
  '0 0 * * *': 'Daily at midnight',
  '0 8 * * *': 'Daily at 8 AM',
  '0 9 * * *': 'Daily at 9 AM',
  '0 12 * * *': 'Daily at noon',
  '0 18 * * *': 'Daily at 6 PM',
  '0 9 * * 1-5': 'Weekdays at 9 AM',
  '0 17 * * 1-5': 'Weekdays at 5 PM',
}

function describeCron(expr: string): string {
  return CRON_PHRASES[expr.trim()] ?? expr
}

function summarizeSchedule(triggers: Triggers | undefined): string {
  if (!triggers) return 'Manual only'
  const parts: string[] = []
  if (triggers.cronExpr) parts.push(describeCron(triggers.cronExpr))
  if (triggers.windows && triggers.windows.length > 0) {
    parts.push(triggers.windows.length === 1
      ? `${triggers.windows[0].startTime}–${triggers.windows[0].endTime}`
      : `${triggers.windows.length} windows`)
  }
  if (triggers.eventMatchCriteria) parts.push('events')
  return parts.length === 0 ? 'Manual only' : parts.join(' · ')
}

function stripKnowledgePrefix(p: string): string {
  return p.replace(/^knowledge\//, '')
}

function formatRunAt(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} · ${time}`
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

type Tab = 'objective' | 'last-run' | 'details'

export interface LiveNoteSidebarProps {
  /**
   * Note path the panel should bind to. Workspace-relative (`knowledge/Foo.md`)
   * or full — both forms are accepted; the prefix is stripped internally.
   * `null` (or empty) hides the panel entirely.
   */
  filePath: string | null
  /** Called when the user clicks the close button or hands off to Copilot. */
  onClose: () => void
}

export function LiveNoteSidebar({ filePath, onClose }: LiveNoteSidebarProps) {
  const [live, setLive] = useState<LiveNote | null>(null)
  const [draft, setDraft] = useState<LiveNote | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('objective')
  const [editingObjective, setEditingObjective] = useState(false)
  const [editingEvents, setEditingEvents] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const knowledgeRelPath = useMemo(() => stripKnowledgePrefix(filePath ?? ''), [filePath])
  const agentStatus = useLiveNoteAgentStatus()
  const runState = agentStatus.get(knowledgeRelPath) ?? { status: 'idle' as const }
  const isRunning = runState.status === 'running'

  const refresh = useCallback(async (relPath: string) => {
    if (!relPath) { setLive(null); setDraft(null); return }
    setLoading(true)
    setError(null)
    try {
      const res = await window.ipc.invoke('live-note:get', { filePath: relPath })
      if (!res.success) {
        setError(res.error ?? 'Failed to load')
        setLive(null)
        setDraft(null)
        return
      }
      setLive(res.live ?? null)
      setDraft(res.live ? structuredClone(res.live) as LiveNote : null)
      setConfirmingDelete(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLive(null)
      setDraft(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setTab('objective')
    setEditingObjective(false)
    setEditingEvents(false)
    setShowAdvanced(false)
    setConfirmingDelete(false)
    setError(null)
    if (knowledgeRelPath) {
      void refresh(knowledgeRelPath)
    } else {
      setLive(null)
      setDraft(null)
    }
  }, [knowledgeRelPath, refresh])

  useEffect(() => {
    if (!knowledgeRelPath) return
    const state = agentStatus.get(knowledgeRelPath)
    if (state && (state.status === 'done' || state.status === 'error')) {
      void refresh(knowledgeRelPath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentStatus, knowledgeRelPath])

  const isDirty = useMemo(() => {
    if (!live || !draft) return false
    return JSON.stringify(live) !== JSON.stringify(draft)
  }, [live, draft])

  const handleSave = useCallback(async () => {
    if (!knowledgeRelPath || !draft) return
    const parsed = LiveNoteSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues.map(i => i.message).join('; '))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await window.ipc.invoke('live-note:set', { filePath: knowledgeRelPath, live: parsed.data })
      if (!res.success) {
        setError(res.error ?? 'Save failed')
        return
      }
      setLive(res.live ?? null)
      setDraft(res.live ? structuredClone(res.live) as LiveNote : null)
      setEditingObjective(false)
      setEditingEvents(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [knowledgeRelPath, draft])

  const handleCancelObjective = useCallback(() => {
    if (live) setDraft(d => d ? { ...d, objective: live.objective } : d)
    setEditingObjective(false)
  }, [live])

  const handleToggleActive = useCallback(async () => {
    if (!knowledgeRelPath || !live) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.ipc.invoke('live-note:setActive', {
        filePath: knowledgeRelPath,
        active: live.active === false,
      })
      if (!res.success) {
        setError(res.error ?? 'Failed')
        return
      }
      setLive(res.live ?? null)
      setDraft(res.live ? structuredClone(res.live) as LiveNote : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [knowledgeRelPath, live])

  const handleRun = useCallback(async () => {
    if (!knowledgeRelPath) return
    setError(null)
    try {
      await window.ipc.invoke('live-note:run', { filePath: knowledgeRelPath })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [knowledgeRelPath])

  const handleStop = useCallback(async () => {
    if (!knowledgeRelPath) return
    setError(null)
    try {
      const res = await window.ipc.invoke('live-note:stop', { filePath: knowledgeRelPath })
      if (!res.success && res.error) setError(res.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [knowledgeRelPath])

  const handleDelete = useCallback(async () => {
    if (!knowledgeRelPath) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.ipc.invoke('live-note:delete', { filePath: knowledgeRelPath })
      if (!res.success) {
        setError(res.error ?? 'Delete failed')
        return
      }
      setLive(null)
      setDraft(null)
      setConfirmingDelete(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [knowledgeRelPath])

  const handleEditWithCopilot = useCallback(() => {
    if (!filePath) return
    window.dispatchEvent(new CustomEvent('rowboat:open-copilot-edit-live-note', {
      detail: { filePath },
    }))
    onClose()
  }, [filePath, onClose])

  if (!filePath) return null

  const noteTitle = filePath
    ? (filePath.split('/').pop() ?? filePath).replace(/\.md$/, '')
    : 'Live note'
  const paused = live?.active === false

  // Empty state — passive note.
  if (!loading && !live) {
    return (
      <aside className="flex w-[440px] max-w-[40vw] shrink-0 flex-col overflow-hidden border-l border-border bg-background">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Radio className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{noteTitle}</span>
          <span className="ml-auto" />
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        {error && (
          <div className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <Radio className="size-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground">This note is passive</div>
          <div className="text-xs text-muted-foreground max-w-[260px]">
            Make it live to have an agent keep its body up to date — describe what you want it to track and how often.
          </div>
          <Button size="sm" onClick={handleEditWithCopilot} className="mt-2">
            <Sparkles className="size-3" />
            Make this note live
          </Button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex w-[440px] max-w-[40vw] shrink-0 flex-col overflow-hidden border-l border-border bg-background">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <Radio
          className={`size-4 shrink-0 ${paused ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'}`}
        />
        <span className="truncate text-sm font-semibold">{noteTitle}</span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
          paused
            ? 'bg-muted text-muted-foreground'
            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        }`}>
          <span className={`size-1.5 rounded-full ${paused ? 'bg-muted-foreground/60' : 'bg-emerald-500'} ${isRunning ? 'animate-pulse' : ''}`} aria-hidden />
          {paused ? 'Paused' : 'Live note'}
        </span>
        <span className="ml-auto" />
        <Switch
          checked={!paused}
          onCheckedChange={handleToggleActive}
          disabled={saving || !live}
          aria-label="Active"
        />
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </div>
      )}

      {!loading && live && draft && (
        <div className={`flex flex-1 flex-col overflow-hidden ${paused ? 'opacity-90' : ''}`}>
          {/* Status strip — 2 columns: Last run · Triggers. */}
          <div className="shrink-0 border-b border-border px-4 py-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Last run</div>
                <div className="mt-0.5 truncate text-xs text-foreground">
                  {live.lastRunAt
                    ? <>
                        {formatRelativeTime(live.lastRunAt)} ago
                        {live.lastRunError && <span className="text-destructive"> · error</span>}
                      </>
                    : <span className="text-muted-foreground">Never</span>}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Triggers</div>
                <div className="mt-0.5 truncate text-xs text-foreground">{summarizeSchedule(live.triggers)}</div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex shrink-0 border-b border-border px-4">
            <TabButton active={tab === 'objective'} onClick={() => setTab('objective')}>Objective</TabButton>
            <TabButton
              active={tab === 'last-run'}
              onClick={() => setTab('last-run')}
              disabled={!live.lastRunId}
            >
              Last run
            </TabButton>
            <TabButton active={tab === 'details'} onClick={() => setTab('details')}>Details</TabButton>
          </div>

          {tab === 'objective' && (
            <ObjectiveTab
              draft={draft}
              setDraft={setDraft}
              editing={editingObjective}
              onCancel={handleCancelObjective}
            />
          )}

          {tab === 'last-run' && (
            <LastRunTab live={live} />
          )}

          {tab === 'details' && (
            <DetailsTab
              draft={draft}
              setDraft={setDraft}
              editingEvents={editingEvents}
              setEditingEvents={setEditingEvents}
              showAdvanced={showAdvanced}
              setShowAdvanced={setShowAdvanced}
              confirmingDelete={confirmingDelete}
              setConfirmingDelete={setConfirmingDelete}
              onDelete={handleDelete}
              saving={saving}
            />
          )}

          {/* Footer — context-dependent. */}
          {tab === 'objective' && editingObjective ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
              <Button variant="ghost" size="sm" onClick={handleCancelObjective} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                Save
              </Button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
              {isRunning ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Running
                  </span>
                  <span className="ml-auto" />
                  <Button variant="destructive" size="sm" onClick={handleStop} disabled={saving}>
                    <Square className="size-3" />
                    Stop
                  </Button>
                </>
              ) : (
                <>
                  {tab === 'objective' && (
                    <Button variant="ghost" size="sm" onClick={() => setEditingObjective(true)} disabled={saving}>
                      <Pencil className="size-3" />
                      Edit
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleEditWithCopilot} disabled={saving}>
                    <Sparkles className="size-3" />
                    Edit with Copilot
                  </Button>
                  {isDirty && tab === 'details' && (
                    <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                      Save
                    </Button>
                  )}
                  <span className="ml-auto" />
                  <Button size="sm" onClick={handleRun} disabled={saving}>
                    <Play className="size-3" />
                    Run now
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative px-3 py-2.5 text-xs font-medium transition-colors ${
        active
          ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground'
          : disabled
            ? 'text-muted-foreground/50 cursor-not-allowed'
            : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function ObjectiveTab({
  draft,
  setDraft,
  editing,
  onCancel,
}: {
  draft: LiveNote
  setDraft: (next: LiveNote) => void
  editing: boolean
  onCancel: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [editing])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  if (editing) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <Textarea
          ref={textareaRef}
          value={draft.objective}
          onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
          onKeyDown={onKeyDown}
          spellCheck
          placeholder="Keep this note updated with…"
          className="flex-1 resize-none rounded-none border-0 border-transparent bg-transparent px-4 py-4 font-mono text-[12.5px] leading-relaxed shadow-none focus-visible:ring-0"
        />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto px-5 py-5">
      {draft.objective.trim() ? (
        <Streamdown className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          {draft.objective}
        </Streamdown>
      ) : (
        <p className="text-sm italic text-muted-foreground">No objective yet. Click Edit to write one.</p>
      )}
    </div>
  )
}

function DetailsTab({
  draft,
  setDraft,
  editingEvents,
  setEditingEvents,
  showAdvanced,
  setShowAdvanced,
  confirmingDelete,
  setConfirmingDelete,
  onDelete,
  saving,
}: {
  draft: LiveNote
  setDraft: (next: LiveNote) => void
  editingEvents: boolean
  setEditingEvents: (v: boolean) => void
  showAdvanced: boolean
  setShowAdvanced: (v: boolean) => void
  confirmingDelete: boolean
  setConfirmingDelete: (v: boolean) => void
  onDelete: () => void
  saving: boolean
}) {
  return (
    <div className="flex-1 overflow-auto">
      <SectionRegion label="Triggers">
        <TriggersEditor
          draft={draft}
          setDraft={setDraft}
          editingEvents={editingEvents}
          setEditingEvents={setEditingEvents}
        />
      </SectionRegion>

      <div className="border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Advanced
        </button>
        {showAdvanced && (
          <div className="mt-3">
            <div className="grid grid-cols-[74px_1fr] gap-x-3 gap-y-2.5 text-xs">
              <span className="pt-1.5 text-muted-foreground">Model</span>
              <Input
                value={draft.model ?? ''}
                onChange={(e) => setDraft({ ...draft, model: e.target.value || undefined })}
                placeholder="(global default)"
                className="h-7 font-mono text-xs"
              />
              <span className="pt-1.5 text-muted-foreground">Provider</span>
              <Input
                value={draft.provider ?? ''}
                onChange={(e) => setDraft({ ...draft, provider: e.target.value || undefined })}
                placeholder="(global default)"
                className="h-7 font-mono text-xs"
              />
            </div>
            <div className="mt-4">
              {confirmingDelete ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                  <span className="text-destructive">Convert to static note?</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button variant="destructive" size="sm" onClick={onDelete} disabled={saving}>
                      {saving ? <Loader2 className="size-3 animate-spin" /> : null}
                      Convert
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="text-xs font-medium text-destructive hover:underline"
                >
                  Convert to static note →
                </button>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

function SectionRegion({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-4 py-4 last:border-b-0">
      {label && (
        <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

function LastRunTab({ live }: { live: LiveNote }) {
  const [transcript, setTranscript] = useState<AgentRunTranscript | null>(null)
  const [loadingRun, setLoadingRun] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const runId = live.lastRunId ?? null

  useEffect(() => {
    if (!runId) {
      setTranscript(null)
      setFetchError(null)
      setLoadingRun(false)
      return
    }
    let cancelled = false
    setLoadingRun(true)
    setFetchError(null)
    void (async () => {
      try {
        const t = await fetchAgentRunTranscript(runId)
        if (cancelled) return
        setTranscript(t)
      } catch (err) {
        if (cancelled) return
        setFetchError(err instanceof Error ? err.message : String(err))
        setTranscript(null)
      } finally {
        if (!cancelled) setLoadingRun(false)
      }
    })()
    return () => { cancelled = true }
  }, [runId])

  if (!runId) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
        <p className="text-xs text-muted-foreground max-w-[240px]">
          No run yet. Click <span className="font-medium text-foreground">Run now</span> below to see the agent's full transcript here.
        </p>
      </div>
    )
  }

  const isError = !!live.lastRunError
  const items = transcript?.items ?? []

  return (
    <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
      {/* Summary header — timestamp + summary markdown / error. */}
      <div>
        {live.lastRunAt && (
          <div className="mb-2 font-mono text-[10.5px] text-muted-foreground">
            {formatRunAt(live.lastRunAt)} · {formatRelativeTime(live.lastRunAt)} ago
          </div>
        )}
        {isError && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5 text-destructive" />
            <code className="break-all font-mono text-[11px] leading-relaxed text-destructive">
              {live.lastRunError}
            </code>
          </div>
        )}
        {live.lastRunSummary && (
          <Streamdown className="prose prose-sm dark:prose-invert max-w-none text-foreground/85 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2">
            {live.lastRunSummary}
          </Streamdown>
        )}
        {!isError && !live.lastRunSummary && (
          <p className="text-xs italic text-muted-foreground">No summary recorded.</p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Full transcript */}
      <div>
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Transcript
        </div>
        {loadingRun && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Loading…
          </div>
        )}
        {fetchError && !loadingRun && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Couldn't load transcript: {fetchError}
          </div>
        )}
        {transcript && !loadingRun && items.length === 0 && (
          <p className="text-xs italic text-muted-foreground">No messages or tool calls recorded.</p>
        )}
        {transcript && !loadingRun && items.length > 0 && (
          <CompactConversation items={items} />
        )}
      </div>
    </div>
  )
}


function TriggersEditor({
  draft,
  setDraft,
  editingEvents,
  setEditingEvents,
}: {
  draft: LiveNote
  setDraft: (next: LiveNote) => void
  editingEvents: boolean
  setEditingEvents: (v: boolean) => void
}) {
  const triggers: Triggers = draft.triggers ?? {}
  const hasCron = typeof triggers.cronExpr === 'string'
  const hasWindows = Array.isArray(triggers.windows) && triggers.windows.length > 0
  const hasEvent = typeof triggers.eventMatchCriteria === 'string'

  const updateTriggers = (next: Partial<Triggers>) => {
    const merged: Triggers = { ...triggers, ...next }
    ;(Object.keys(merged) as (keyof Triggers)[]).forEach(key => {
      if (merged[key] === undefined) delete merged[key]
    })
    if (Object.keys(merged).length === 0) {
      const { triggers: _omit, ...rest } = draft
      setDraft(rest as LiveNote)
    } else {
      setDraft({ ...draft, triggers: merged })
    }
  }

  return (
    <div className="grid grid-cols-[74px_1fr] items-start gap-x-3 gap-y-4">
      {/* Cron */}
      <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
        <Repeat className="size-3.5" /> Cron
      </div>
      <div>
        {hasCron ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Input
                value={triggers.cronExpr ?? ''}
                onChange={(e) => updateTriggers({ cronExpr: e.target.value })}
                placeholder="0 * * * *"
                className="h-7 max-w-[160px] font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => updateTriggers({ cronExpr: undefined })}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Remove cron"
              >
                <X className="size-3" />
              </button>
            </div>
            {triggers.cronExpr && (
              <div className="text-[11px] text-muted-foreground">{describeCron(triggers.cronExpr)}</div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => updateTriggers({ cronExpr: '0 * * * *' })}
            className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" /> Cron
          </button>
        )}
      </div>

      {/* Windows */}
      <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" /> Windows
      </div>
      <div>
        {hasWindows && triggers.windows ? (
          <div className="space-y-1.5">
            {triggers.windows.map((w, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <Input
                  value={w.startTime}
                  onChange={(e) => {
                    const next = [...(triggers.windows ?? [])]
                    next[idx] = { ...next[idx], startTime: e.target.value }
                    updateTriggers({ windows: next })
                  }}
                  placeholder="09:00"
                  className={`h-7 w-20 font-mono text-xs ${HH_MM.test(w.startTime) ? '' : 'border-destructive'}`}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  value={w.endTime}
                  onChange={(e) => {
                    const next = [...(triggers.windows ?? [])]
                    next[idx] = { ...next[idx], endTime: e.target.value }
                    updateTriggers({ windows: next })
                  }}
                  placeholder="12:00"
                  className={`h-7 w-20 font-mono text-xs ${HH_MM.test(w.endTime) ? '' : 'border-destructive'}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = (triggers.windows ?? []).filter((_, i) => i !== idx)
                    updateTriggers({ windows: next.length === 0 ? undefined : next })
                  }}
                  className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Remove window"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => updateTriggers({
                windows: [...(triggers.windows ?? []), { startTime: '13:00', endTime: '15:00' }],
              })}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3" /> Window
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => updateTriggers({ windows: [{ startTime: '09:00', endTime: '12:00' }] })}
            className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" /> Window
          </button>
        )}
      </div>

      {/* Events */}
      <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
        <Zap className="size-3.5" /> Events
      </div>
      <div>
        {hasEvent ? (
          editingEvents ? (
            <div className="space-y-1.5">
              <Textarea
                value={triggers.eventMatchCriteria ?? ''}
                onChange={(e) => updateTriggers({ eventMatchCriteria: e.target.value })}
                rows={5}
                autoFocus
                placeholder="Emails or calendar events about…"
                className="text-xs"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingEvents(false)}
                  className="text-[11px] font-medium text-foreground hover:underline"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateTriggers({ eventMatchCriteria: undefined })
                    setEditingEvents(false)
                  }}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs leading-relaxed text-foreground/85">
              {triggers.eventMatchCriteria || <span className="italic text-muted-foreground">No criteria yet.</span>}
              <button
                type="button"
                onClick={() => setEditingEvents(true)}
                className="ml-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                {triggers.eventMatchCriteria ? 'Edit rule →' : 'Add →'}
              </button>
            </div>
          )
        ) : (
          <button
            type="button"
            onClick={() => {
              updateTriggers({ eventMatchCriteria: '' })
              setEditingEvents(true)
            }}
            className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" /> Event rule
          </button>
        )}
      </div>
    </div>
  )
}
