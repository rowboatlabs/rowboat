import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mic, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/relative-time'
import type { MeetingTranscriptionState } from '@/hooks/useMeetingTranscription'

const MEETINGS_ROOT = 'knowledge/Meetings'

type MeetingNoteRow = {
  path: string
  name: string
  dateLabel: string
  mtimeMs: number
}

type MeetingsViewProps = {
  onOpenNote: (path: string) => void
  onTakeMeetingNotes: () => void
  meetingState: MeetingTranscriptionState
  meetingSummarizing?: boolean
}

function isMeetingPath(path: string | undefined): boolean {
  return typeof path === 'string' && (path === MEETINGS_ROOT || path.startsWith(`${MEETINGS_ROOT}/`))
}

function formatMeetingName(name: string): string {
  return name.replace(/\.md$/i, '').replace(/_/g, ' ')
}

function formatDateLabel(label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label || '—'
  const date = new Date(`${label}T00:00:00`)
  if (Number.isNaN(date.getTime())) return label
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getMeetingButtonLabel(state: MeetingTranscriptionState): string {
  switch (state) {
    case 'connecting':
      return 'Starting...'
    case 'recording':
      return 'Stop recording'
    case 'stopping':
      return 'Stopping...'
    case 'idle':
    default:
      return 'Take meeting notes'
  }
}

export function MeetingsView({ onOpenNote, onTakeMeetingNotes, meetingState, meetingSummarizing = false }: MeetingsViewProps) {
  const [notes, setNotes] = useState<MeetingNoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const exists = await window.ipc.invoke('workspace:exists', { path: MEETINGS_ROOT })
      if (!exists.exists) {
        setNotes([])
        setError(null)
        return
      }

      const entries = await window.ipc.invoke('workspace:readdir', {
        path: MEETINGS_ROOT,
        opts: {
          recursive: true,
          includeHidden: false,
          includeStats: true,
        },
      })

      const rows = entries
	        .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md'))
	        .map((entry) => {
	          const relative = entry.path.slice(`${MEETINGS_ROOT}/`.length)
	          const parts = relative.split('/')
	          const dateFolder = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) ?? ''
	          return {
	            path: entry.path,
	            name: formatMeetingName(entry.name),
	            dateLabel: formatDateLabel(dateFolder),
	            mtimeMs: entry.stat?.mtimeMs ?? 0,
	          } satisfies MeetingNoteRow
        })
        .sort((a, b) => {
          if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
          return b.path.localeCompare(a.path)
        })

      setNotes(rows)
      setError(null)
    } catch (err) {
      console.error('Failed to load meetings:', err)
      setError('Could not load meeting notes.')
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

    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      switch (event.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (isMeetingPath(event.path)) scheduleReload()
          break
        case 'moved':
          if (isMeetingPath(event.from) || isMeetingPath(event.to)) {
            scheduleReload()
          }
          break
        case 'bulkChanged':
          if (!event.paths || event.paths.some(isMeetingPath)) {
            scheduleReload()
          }
          break
      }
    })

    return () => {
      cleanup()
      if (timeout) clearTimeout(timeout)
    }
  }, [loadNotes])

  const isBusy = meetingState === 'connecting' || meetingState === 'stopping' || meetingSummarizing
  const isRecording = meetingState === 'recording'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Mic className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Meetings</h2>
          </div>
          <Button
            type="button"
            size="sm"
            variant={isRecording ? 'destructive' : 'default'}
            disabled={isBusy}
            onClick={onTakeMeetingNotes}
          >
            {meetingSummarizing || meetingState === 'connecting' || meetingState === 'stopping' ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : isRecording ? (
              <Square className="mr-2 size-3.5" />
            ) : (
              <Mic className="mr-2 size-4" />
            )}
            {meetingSummarizing ? 'Generating notes...' : getMeetingButtonLabel(meetingState)}
          </Button>
	        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          All your meeting notes.
        </p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <Mic className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No meeting notes yet. Use <strong>Take meeting notes</strong> to start one.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[56%]" />
                <col className="w-[20%]" />
                <col className="w-[24%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-left">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Note</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Updated</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr key={note.path} className="border-b border-border/50 last:border-b-0 hover:bg-muted/20">
                    <td className="px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => onOpenNote(note.path)}
                        className="min-w-0 text-left text-sm font-medium text-foreground hover:underline"
                      >
                        <span className="block truncate">{note.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-muted-foreground">{note.dateLabel}</td>
                    <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                      {note.mtimeMs > 0 ? (formatRelativeTime(new Date(note.mtimeMs).toISOString()) || '—') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
