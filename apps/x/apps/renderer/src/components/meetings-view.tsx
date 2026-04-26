import { memo, useCallback, useEffect, useState } from 'react'
import { Mic, MicOff, FileText, Loader2 } from 'lucide-react'
import type { MeetingTranscriptionState, TranscriptEntry } from '@/hooks/useMeetingTranscription'

interface RecentMeeting {
  path: string
  title: string
  date: string
}

interface MeetingsViewProps {
  meetingState: MeetingTranscriptionState
  liveTranscript: TranscriptEntry[]
  onToggleRecording: () => void
  onNavigateToNote: (path: string) => void
}

export const MeetingsView = memo(function MeetingsView({
  meetingState,
  liveTranscript,
  onToggleRecording,
  onNavigateToNote,
}: MeetingsViewProps) {
  const [recentMeetings, setRecentMeetings] = useState<RecentMeeting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const result = await window.ipc.invoke('workspace:readDir', {
          path: 'knowledge/Meetings',
          recursive: true,
        })
        if (cancelled) return
        const files: string[] = result?.files ?? []
        const meetings: RecentMeeting[] = files
          .filter((f: string) => f.endsWith('.md'))
          .map((f: string) => {
            const name = f.split('/').pop()?.replace(/\.md$/i, '') ?? f
            const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/)
            return {
              path: f,
              title: name.replace(/_/g, ' '),
              date: dateMatch?.[1] ?? '',
            }
          })
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 20)
        setRecentMeetings(meetings)
      } catch {
        setRecentMeetings([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [meetingState])

  const isRecording = meetingState === 'recording'
  const isConnecting = meetingState === 'connecting'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isRecording ? (
              <div className="flex items-center gap-2">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
                </span>
                <span className="text-sm font-medium text-red-600 dark:text-red-400">Recording</span>
              </div>
            ) : (
              <Mic className="size-5 text-primary" />
            )}
            <h2 className="text-base font-semibold text-foreground">Meetings</h2>
          </div>
          <button
            type="button"
            onClick={onToggleRecording}
            disabled={isConnecting || meetingState === 'stopping'}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              isRecording
                ? "bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400"
                : "bg-primary/10 text-primary hover:bg-primary/20"
            )}
          >
            {isConnecting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Connecting…
              </>
            ) : isRecording ? (
              <>
                <MicOff className="size-4" />
                Stop
              </>
            ) : (
              <>
                <Mic className="size-4" />
                Record
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live transcript area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {liveTranscript.length > 0 ? (
          <div className="px-6 py-4 space-y-3">
            {liveTranscript.map((entry, i) => (
              <div key={i} className="text-sm">
                <span className="font-semibold text-foreground">{entry.speaker}:</span>{' '}
                <span className="text-muted-foreground">{entry.text}</span>
              </div>
            ))}
          </div>
        ) : isRecording ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            Listening for speech…
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 px-8 py-12 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Mic className="size-8 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Start a meeting recording</p>
              <p className="text-xs text-muted-foreground mt-1">
                Record a live transcription with speaker diarization. Chat with the AI on the right while notes are captured.
              </p>
            </div>
          </div>
        )}

        {/* Recent meetings list */}
        {(recentMeetings.length > 0 || loading) && (
          <div className="border-t border-border px-6 py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Recent Notes</h3>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1">
                {recentMeetings.map((m) => (
                  <button
                    key={m.path}
                    type="button"
                    onClick={() => onNavigateToNote(m.path)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-left hover:bg-accent transition-colors"
                  >
                    <FileText className="size-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground font-medium">{m.title}</p>
                      {m.date && (
                        <p className="text-xs text-muted-foreground">{m.date}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}
