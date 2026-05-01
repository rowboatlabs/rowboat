import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import '@/styles/track-modal.css'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Radio, Clock, Play, Loader2, Sparkles, Code2, CalendarClock, Zap,
  Trash2, ChevronDown, ChevronUp,
} from 'lucide-react'
import { parse as parseYaml } from 'yaml'
import { Streamdown } from 'streamdown'
import { TrackBlockSchema, type TrackSchedule } from '@x/shared/dist/track-block.js'
import { useTrackStatus } from '@/hooks/use-track-status'
import type { OpenTrackModalDetail } from '@/extensions/track-block'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

const CRON_PHRASES: Record<string, string> = {
  '* * * * *': 'Every minute',
  '*/5 * * * *': 'Every 5 minutes',
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Hourly',
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
  '0 0 * * 0': 'Sundays at midnight',
  '0 0 * * 1': 'Mondays at midnight',
  '0 0 1 * *': 'First of each month',
}

function describeCron(expr: string): string {
  return CRON_PHRASES[expr.trim()] ?? expr
}

type ScheduleIconKind = 'timer' | 'calendar' | 'target' | 'bolt'
type ScheduleSummary = { icon: ScheduleIconKind; text: string }

function summarizeSchedule(schedule?: TrackSchedule): ScheduleSummary {
  if (!schedule) return { icon: 'bolt', text: 'Manual only' }
  if (schedule.type === 'once') {
    return { icon: 'target', text: `Once at ${formatDateTime(schedule.runAt)}` }
  }
  if (schedule.type === 'cron') {
    return { icon: 'timer', text: describeCron(schedule.expression) }
  }
  if (schedule.type === 'window') {
    return { icon: 'calendar', text: `${describeCron(schedule.cron)} · ${schedule.startTime}–${schedule.endTime}` }
  }
  return { icon: 'calendar', text: 'Scheduled' }
}

function ScheduleIcon({ icon, size = 14 }: { icon: ScheduleIconKind; size?: number }) {
  if (icon === 'timer') return <Clock size={size} />
  if (icon === 'calendar' || icon === 'target') return <CalendarClock size={size} />
  return <Zap size={size} />
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

type Tab = 'what' | 'when' | 'event' | 'details'

export function TrackModal() {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<OpenTrackModalDetail | null>(null)
  const [yaml, setYaml] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('what')
  const [editingRaw, setEditingRaw] = useState(false)
  const [rawDraft, setRawDraft] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Listen for the open event and seed modal state.
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<OpenTrackModalDetail>
      const d = ev.detail
      if (!d?.trackId || !d?.filePath) return
      setDetail(d)
      setYaml(d.initialYaml ?? '')
      setActiveTab('what')
      setEditingRaw(false)
      setRawDraft('')
      setShowAdvanced(false)
      setConfirmingDelete(false)
      setError(null)
      setOpen(true)
      void fetchFresh(d)
    }
    window.addEventListener('rowboat:open-track-modal', handler as EventListener)
    return () => window.removeEventListener('rowboat:open-track-modal', handler as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchFresh = useCallback(async (d: OpenTrackModalDetail) => {
    try {
      setLoading(true)
      const res = await window.ipc.invoke('track:get', { trackId: d.trackId, filePath: stripKnowledgePrefix(d.filePath) })
      if (res?.success && res.yaml) {
        setYaml(res.yaml)
      } else if (res?.error) {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const track = useMemo<z.infer<typeof TrackBlockSchema> | null>(() => {
    if (!yaml) return null
    try { return TrackBlockSchema.parse(parseYaml(yaml)) } catch { return null }
  }, [yaml])

  const trackId = track?.trackId ?? detail?.trackId ?? ''
  const instruction = track?.instruction ?? ''
  const active = track?.active ?? true
  const schedule = track?.schedule
  const eventMatchCriteria = track?.eventMatchCriteria ?? ''
  const lastRunAt = track?.lastRunAt ?? ''
  const lastRunId = track?.lastRunId ?? ''
  const lastRunSummary = track?.lastRunSummary ?? ''
  const model = track?.model ?? ''
  const provider = track?.provider ?? ''
  const scheduleSummary = useMemo(() => summarizeSchedule(schedule), [schedule])
  const triggerType: 'scheduled' | 'event' | 'manual' =
    schedule ? 'scheduled' : eventMatchCriteria ? 'event' : 'manual'

  const knowledgeRelPath = detail ? stripKnowledgePrefix(detail.filePath) : ''

  const allTrackStatus = useTrackStatus()
  const runState = allTrackStatus.get(`${trackId}:${knowledgeRelPath}`) ?? { status: 'idle' as const }
  const isRunning = runState.status === 'running'

  useEffect(() => {
    if (editingRaw && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      )
    }
  }, [editingRaw])

  const visibleTabs: { key: Tab; label: string; visible: boolean }[] = [
    { key: 'what', label: 'What to track', visible: true },
    { key: 'when', label: 'When to run', visible: !!schedule },
    { key: 'event', label: 'Event matching', visible: !!eventMatchCriteria },
    { key: 'details', label: 'Details', visible: true },
  ]
  const shown = visibleTabs.filter(t => t.visible)

  useEffect(() => {
    if (!shown.some(t => t.key === activeTab)) setActiveTab('what')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, eventMatchCriteria])

  // -------------------------------------------------------------------------
  // IPC-backed mutations
  // -------------------------------------------------------------------------

  const runUpdate = useCallback(async (updates: Record<string, unknown>) => {
    if (!detail) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.ipc.invoke('track:update', {
        trackId: detail.trackId,
        filePath: stripKnowledgePrefix(detail.filePath),
        updates,
      })
      if (res?.success && res.yaml) {
        setYaml(res.yaml)
      } else if (res?.error) {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [detail])

  const handleToggleActive = useCallback(() => {
    void runUpdate({ active: !active })
  }, [active, runUpdate])

  const handleRun = useCallback(async () => {
    if (!detail || isRunning) return
    try {
      await window.ipc.invoke('track:run', {
        trackId: detail.trackId,
        filePath: stripKnowledgePrefix(detail.filePath),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [detail, isRunning])

  const handleSaveRaw = useCallback(async () => {
    if (!detail) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.ipc.invoke('track:replaceYaml', {
        trackId: detail.trackId,
        filePath: stripKnowledgePrefix(detail.filePath),
        yaml: rawDraft,
      })
      if (res?.success && res.yaml) {
        setYaml(res.yaml)
        setEditingRaw(false)
      } else if (res?.error) {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [detail, rawDraft])

  const handleDelete = useCallback(async () => {
    if (!detail) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.ipc.invoke('track:delete', {
        trackId: detail.trackId,
        filePath: stripKnowledgePrefix(detail.filePath),
      })
      if (res?.success) {
        // Tell the editor to remove the node so Tiptap's next save doesn't
        // re-create the track block on disk.
        try { detail.onDeleted() } catch { /* editor may have unmounted */ }
        setOpen(false)
      } else if (res?.error) {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [detail])

  const handleEditWithCopilot = useCallback(() => {
    if (!detail) return
    window.dispatchEvent(new CustomEvent('rowboat:open-copilot-edit-track', {
      detail: {
        trackId: detail.trackId,
        filePath: detail.filePath,
      },
    }))
    setOpen(false)
  }, [detail])

  if (!detail) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="track-modal-content w-[min(44rem,calc(100%-2rem))] max-w-2xl p-0 gap-0 overflow-hidden rounded-xl"
        data-trigger={triggerType}
        data-active={active ? 'true' : 'false'}
      >
        <div className="track-modal-header">
          <div className="track-modal-header-left">
            <div className="track-modal-icon-wrap">
              <Radio size={16} />
            </div>
            <div className="track-modal-title-col">
              <DialogHeader className="space-y-0">
                <DialogTitle className="track-modal-title">
                  {trackId || 'Track'}
                </DialogTitle>
                <DialogDescription className="track-modal-subtitle">
                  <ScheduleIcon icon={scheduleSummary.icon} size={11} />
                  {scheduleSummary.text}
                  {eventMatchCriteria && triggerType === 'scheduled' && (
                    <span className="track-modal-subtitle-sep">· also event-driven</span>
                  )}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
          <div className="track-modal-header-actions">
            <label className="track-modal-toggle">
              <Switch checked={active} onCheckedChange={handleToggleActive} disabled={saving} />
              <span className="track-modal-toggle-label">{active ? 'Active' : 'Paused'}</span>
            </label>
          </div>
        </div>

        {/* Tabs */}
        <div className="track-modal-tabs">
          {shown.map(tab => (
            <button
              key={tab.key}
              className={`track-modal-tab ${activeTab === tab.key ? 'track-modal-tab-active' : ''}`}
              onClick={() => { setActiveTab(tab.key); setEditingRaw(false) }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="track-modal-body">
          {loading && <div className="track-modal-loading"><Loader2 size={14} className="animate-spin" /> Loading latest…</div>}

          {activeTab === 'what' && (
            <div className="track-modal-prose">
              {instruction
                ? <Streamdown className="track-modal-markdown">{instruction}</Streamdown>
                : <span className="track-modal-empty">No instruction set.</span>}
            </div>
          )}

          {activeTab === 'when' && schedule && (
            <div className="track-modal-when">
              <div className="track-modal-when-headline">
                <ScheduleIcon icon={scheduleSummary.icon} size={18} />
                <span>{scheduleSummary.text}</span>
              </div>
              <dl className="track-modal-dl">
                <dt>Type</dt><dd><code>{schedule.type}</code></dd>
                {schedule.type === 'cron' && (
                  <>
                    <dt>Expression</dt><dd><code>{schedule.expression}</code></dd>
                  </>
                )}
                {schedule.type === 'window' && (
                  <>
                    <dt>Expression</dt><dd><code>{schedule.cron}</code></dd>
                    <dt>Window</dt><dd>{schedule.startTime} – {schedule.endTime}</dd>
                  </>
                )}
                {schedule.type === 'once' && (
                  <>
                    <dt>Runs at</dt><dd>{formatDateTime(schedule.runAt)}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {activeTab === 'event' && (
            <div className="track-modal-prose">
              {eventMatchCriteria
                ? <Streamdown className="track-modal-markdown">{eventMatchCriteria}</Streamdown>
                : <span className="track-modal-empty">No event matching set.</span>}
            </div>
          )}

          {activeTab === 'details' && (
            <div className="track-modal-details">
              <dl className="track-modal-dl">
                <dt>Track ID</dt><dd><code>{trackId}</code></dd>
                <dt>File</dt><dd><code>{detail.filePath}</code></dd>
                <dt>Status</dt><dd>{active ? 'Active' : 'Paused'}</dd>
                {model && (<>
                  <dt>Model</dt><dd><code>{model}</code></dd>
                </>)}
                {provider && (<>
                  <dt>Provider</dt><dd><code>{provider}</code></dd>
                </>)}
                {lastRunAt && (<>
                  <dt>Last run</dt><dd>{formatDateTime(lastRunAt)}</dd>
                </>)}
                {lastRunId && (<>
                  <dt>Run ID</dt><dd><code>{lastRunId}</code></dd>
                </>)}
                {lastRunSummary && (<>
                  <dt>Summary</dt><dd>{lastRunSummary}</dd>
                </>)}
              </dl>
            </div>
          )}

          {/* Advanced (raw YAML) — all tabs */}
          <div className="track-modal-advanced">
            <button
              className="track-modal-advanced-toggle"
              onClick={() => {
                const next = !showAdvanced
                setShowAdvanced(next)
                if (next) {
                  setRawDraft(yaml)
                  setEditingRaw(true)
                } else {
                  setEditingRaw(false)
                }
              }}
            >
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              <Code2 size={12} />
              Advanced (raw YAML)
            </button>
            {showAdvanced && (
              <div className="track-modal-raw-editor">
                <Textarea
                  ref={textareaRef}
                  value={rawDraft}
                  onChange={(e) => setRawDraft(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  className="track-modal-textarea"
                />
                <div className="track-modal-raw-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setRawDraft(yaml); setShowAdvanced(false); setEditingRaw(false) }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveRaw}
                    disabled={saving || rawDraft.trim() === yaml.trim()}
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Danger zone — on Details tab only */}
          {activeTab === 'details' && (
            <div className="track-modal-danger-zone">
              {confirmingDelete ? (
                <div className="track-modal-confirm">
                  <span>Delete this track and its generated content?</span>
                  <div className="track-modal-confirm-actions">
                    <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button variant="destructive" size="sm" onClick={handleDelete} disabled={saving}>
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Yes, delete
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="track-modal-delete-btn"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 size={12} />
                  Delete track block
                </Button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="track-modal-error">{error}</div>
        )}

        <DialogFooter className="track-modal-footer">
          <Button
            variant="outline"
            size="sm"
            onClick={handleEditWithCopilot}
            disabled={saving}
          >
            <Sparkles size={12} />
            Edit with Copilot
          </Button>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={isRunning || saving}
            className="track-modal-run-btn"
          >
            {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {isRunning ? 'Running…' : 'Run now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function stripKnowledgePrefix(p: string): string {
  return p.replace(/^knowledge\//, '')
}
