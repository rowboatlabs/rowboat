import { useCallback, useEffect, useState } from 'react'
import { Bot, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { stripKnowledgePrefix, wikiLabel } from '@/lib/wiki-links'
import { toast } from '@/lib/toast'

type BackgroundAgentNote = {
  path: string
  trackCount: number
  createdAt: string | null
  lastRunAt: string | null
  isActive: boolean
}

type BackgroundAgentsViewProps = {
  onOpenNote: (path: string) => void
  onAddNewBackgroundAgent: () => void
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

function formatDateTimeLabel(iso: string | null): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isKnowledgeMarkdownPath(path: string | undefined): boolean {
  return typeof path === 'string' && path.startsWith('knowledge/') && path.endsWith('.md')
}

export function BackgroundAgentsView({ onOpenNote, onAddNewBackgroundAgent }: BackgroundAgentsViewProps) {
  const [notes, setNotes] = useState<BackgroundAgentNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingPaths, setUpdatingPaths] = useState<Set<string>>(new Set())

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.ipc.invoke('track:listNotes', null)
      setNotes(result.notes)
      setError(null)
    } catch (err) {
      console.error('Failed to load background agent notes:', err)
      setError('Could not load background agents.')
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

    const cleanupTracks = window.ipc.on('tracks:events', () => {
      scheduleReload()
    })

    return () => {
      cleanupWorkspace()
      cleanupTracks()
      if (timeout) clearTimeout(timeout)
    }
  }, [loadNotes])

  const handleToggleState = useCallback(async (note: BackgroundAgentNote, active: boolean) => {
    setUpdatingPaths((prev) => new Set(prev).add(note.path))
    try {
      const result = await window.ipc.invoke('track:setNoteActive', {
        path: note.path,
        active,
      })

      if (!result.success || !result.note) {
        throw new Error(result.error ?? 'Failed to update background agent state')
      }

      const updatedNote = result.note
      setNotes((prev) => prev.map((entry) => (
        entry.path === note.path ? updatedNote : entry
      )))
    } catch (err) {
      console.error('Failed to update background agent note state:', err)
      toast(err instanceof Error ? err.message : 'Failed to update background agent state', 'error')
    } finally {
      setUpdatingPaths((prev) => {
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
            <Bot className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Background agents</h2>
          </div>
          <Button type="button" size="sm" onClick={onAddNewBackgroundAgent}>
            Add new background agent
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Notes that contain track blocks. Toggle a note inactive to pause every background agent in it.
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
              <Bot className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <Bot className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No notes with background agents yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-left">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Note</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Created date</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Last ran</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">State</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => {
                  const isUpdating = updatingPaths.has(note.path)
                  return (
                    <tr key={note.path} className="border-b border-border/50 last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-3 align-top">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onOpenNote(note.path)}
                              className="truncate text-left text-sm font-medium text-foreground hover:text-primary"
                              title={note.path}
                            >
                              {wikiLabel(note.path)}
                            </button>
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {note.trackCount} {note.trackCount === 1 ? 'agent' : 'agents'}
                            </span>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {stripKnowledgePrefix(note.path)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground/80">
                        {formatDateLabel(note.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground/80">
                        {formatDateTimeLabel(note.lastRunAt)}
                      </td>
                      <td className="px-4 py-3">
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
