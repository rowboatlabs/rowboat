import { useCallback, useEffect, useState } from 'react'
import { Radio, Loader2, Square, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { stripKnowledgePrefix, wikiLabel } from '@/lib/wiki-links'
import { toast } from '@/lib/toast'
import { formatRelativeTime } from '@/lib/relative-time'
import * as analytics from '@/lib/analytics'
import { useLiveNoteAgentStatus } from '@/hooks/use-live-note-agent-status'

type LiveNoteRow = {
  path: string
  createdAt: string | null
  lastRunAt: string | null
  isActive: boolean
  objective: string
  lastRunError?: string | null
  lastAttemptAt?: string | null
}

type LiveNotesViewProps = {
  onOpenNote: (path: string) => void
  onAddNewLiveNote: () => void
}

function formatDateLabel(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatLastRanLabel(iso: string | null): string {
  if (!iso) return 'Never'
  return formatRelativeTime(iso) || 'Never'
}

function isKnowledgeMarkdownPath(path: string | undefined): boolean {
  return typeof path === 'string' && path.startsWith('knowledge/') && path.endsWith('.md')
}

export function LiveNotesView({ onOpenNote, onAddNewLiveNote }: LiveNotesViewProps) {
  const [notes, setNotes] = useState<LiveNoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingPaths, setUpdatingPaths] = useState<Set<string>>(new Set())
  const [stoppingPaths, setStoppingPaths] = useState<Set<string>>(new Set())

  const agentStatus = useLiveNoteAgentStatus()

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.ipc.invoke('live-note:listNotes', null)
      // listNotes returns the summary fields; we also want lastRunError +
      // lastAttemptAt so the rows can render the error/running state. The
      // current IPC summary doesn't include them — fetch those per-note in
      // parallel so the rows can render fully.
      const enriched = await Promise.all(result.notes.map(async (n) => {
        const knowledgeRel = n.path.replace(/^knowledge\//, '')
        try {
          const detail = await window.ipc.invoke('live-note:get', { filePath: knowledgeRel })
          if (detail.success && detail.live) {
            return {
              ...n,
              lastRunError: detail.live.lastRunError ?? null,
              lastAttemptAt: detail.live.lastAttemptAt ?? null,
            } satisfies LiveNoteRow
          }
        } catch {
          // fall through
        }
        return n satisfies LiveNoteRow
      }))
      setNotes(enriched)
      setError(null)
    } catch (err) {
      console.error('Failed to load live notes:', err)
      setError('Could not load live notes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null

    const scheduleReload = () => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        timeout = null
        void loadNotes()
      }, 200)
    }

    const cleanupWorkspace = window.ipc.on('workspace:didChange', (event) => {
      switch (event.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (isKnowledgeMarkdownPath(event.path)) scheduleReload()
          break
        case 'moved':
          if (isKnowledgeMarkdownPath(event.from) || isKnowledgeMarkdownPath(event.to)) {
            scheduleReload()
          }
          break
        case 'bulkChanged':
          if (!event.paths || event.paths.some(isKnowledgeMarkdownPath)) {
            scheduleReload()
          }
          break
      }
    })

    const cleanupAgentEvents = window.ipc.on('live-note-agent:events', () => {
      scheduleReload()
    })

    return () => {
      cleanupWorkspace()
      cleanupAgentEvents()
      if (timeout) clearTimeout(timeout)
    }
  }, [loadNotes])

  const handleToggleState = useCallback(async (note: LiveNoteRow, active: boolean) => {
    setUpdatingPaths((prev) => new Set(prev).add(note.path))
    try {
      const knowledgeRelative = note.path.replace(/^knowledge\//, '')
      const result = await window.ipc.invoke('live-note:setActive', {
        filePath: knowledgeRelative,
        active,
      })

      if (!result.success || !result.live) {
        throw new Error(result.error ?? 'Failed to update live-note state')
      }

      analytics.liveNoteToggled(active)
      setNotes((prev) => prev.map((entry) => (
        entry.path === note.path
          ? {
              ...entry,
              isActive: result.live!.active !== false,
              lastRunAt: result.live!.lastRunAt ?? entry.lastRunAt,
              lastRunError: result.live!.lastRunError ?? null,
              lastAttemptAt: result.live!.lastAttemptAt ?? entry.lastAttemptAt,
            }
          : entry
      )))
    } catch (err) {
      console.error('Failed to update live-note state:', err)
      toast(err instanceof Error ? err.message : 'Failed to update live-note state', 'error')
    } finally {
      setUpdatingPaths((prev) => {
        const next = new Set(prev)
        next.delete(note.path)
        return next
      })
    }
  }, [])

  const handleStop = useCallback(async (note: LiveNoteRow) => {
    setStoppingPaths((prev) => new Set(prev).add(note.path))
    try {
      const knowledgeRelative = note.path.replace(/^knowledge\//, '')
      const result = await window.ipc.invoke('live-note:stop', { filePath: knowledgeRelative })
      if (result.success) analytics.liveNoteStopped()
      if (!result.success && result.error) {
        toast(result.error, 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to stop run', 'error')
    } finally {
      setStoppingPaths((prev) => {
        const next = new Set(prev)
        next.delete(note.path)
        return next
      })
    }
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Radio className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Live notes</h2>
          </div>
          <Button type="button" size="sm" onClick={onAddNewLiveNote}>
            New live note
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Notes whose body is kept current by an agent. Toggle a note inactive to pause its agent.
        </p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <Radio className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <Radio className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No live notes yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[50%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-left">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Note</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Created</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Last ran</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">State</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => {
                  const isUpdating = updatingPaths.has(note.path)
                  const isStopping = stoppingPaths.has(note.path)
                  const knowledgeRel = note.path.replace(/^knowledge\//, '')
                  const runState = agentStatus.get(knowledgeRel)
                  const isRunning = runState?.status === 'running'
                  const objectivePreview = note.objective.split('\n')[0].trim()
                  const hasError = !isRunning && !!note.lastRunError
                  return (
                    <tr
                      key={note.path}
                      className={`border-b border-border/50 last:border-b-0 transition-colors ${isRunning ? 'bg-primary/5' : 'hover:bg-muted/20'}`}
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            {hasError && (
                              <AlertCircle
                                className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                                aria-label="Last run failed"
                              >
                                <title>Last run failed: {note.lastRunError}</title>
                              </AlertCircle>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenNote(note.path)}
                              className="truncate text-left text-sm font-medium text-foreground hover:text-primary"
                              title={note.path}
                            >
                              {wikiLabel(note.path)}
                            </button>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {stripKnowledgePrefix(note.path)}
                          </div>
                          {objectivePreview && (
                            <div className="truncate text-xs text-muted-foreground/80" title={note.objective}>
                              {objectivePreview}
                            </div>
                          )}
                          {hasError && note.lastRunError && (
                            <div className="truncate text-xs text-amber-600 dark:text-amber-400" title={note.lastRunError}>
                              {note.lastRunError}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground/80">
                        {formatDateLabel(note.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground/80">
                        {formatLastRanLabel(note.lastRunAt)}
                      </td>
                      <td className="px-4 py-3">
                        {isRunning ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground animate-pulse">
                              <Loader2 className="size-3 animate-spin" />
                              Updating…
                            </span>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleStop(note)}
                              disabled={isStopping}
                            >
                              {isStopping ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
                              Stop
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            {isUpdating ? (
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            ) : (
                              <span className="size-4 shrink-0" aria-hidden="true" />
                            )}
                            <Switch
                              checked={note.isActive}
                              onCheckedChange={(checked) => { void handleToggleState(note, checked) }}
                              disabled={isUpdating}
                            />
                            <span className="min-w-16 text-xs font-medium text-foreground/80">
                              {note.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
