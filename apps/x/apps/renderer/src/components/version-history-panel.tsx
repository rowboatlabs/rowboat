import { useEffect, useState, useCallback } from 'react'
import { X, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface CommitInfo {
  oid: string
  message: string
  timestamp: number
  author: string
}

interface VersionHistoryPanelProps {
  path: string // knowledge-relative file path (e.g. "knowledge/People/John.md")
  onClose: () => void
  onSelectVersion: (oid: string | null, content: string) => void // null = current
  onRestore: (oid: string) => void
}

function formatTimestamp(unixSeconds: number): { date: string; time: string } {
  const d = new Date(unixSeconds * 1000)
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return { date, time }
}

export function VersionHistoryPanel({
  path,
  onClose,
  onSelectVersion,
  onRestore,
}: VersionHistoryPanelProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOid, setSelectedOid] = useState<string | null>(null) // null = current/latest
  const [error, setError] = useState<string | null>(null)

  // Strip "knowledge/" prefix for IPC calls
  const relPath = path.startsWith('knowledge/') ? path.slice('knowledge/'.length) : path

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.ipc.invoke('knowledge:history', { path: relPath })
      setCommits(result.commits)
    } catch (err) {
      console.error('Failed to load version history:', err)
      setError('Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [relPath])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // Refresh when new commits land
  useEffect(() => {
    return window.ipc.on('knowledge:didCommit', () => {
      loadHistory()
    })
  }, [loadHistory])

  const handleSelectCommit = useCallback(async (oid: string, isLatest: boolean) => {
    if (isLatest) {
      setSelectedOid(null)
      // Read current file content
      try {
        const result = await window.ipc.invoke('workspace:readFile', { path })
        onSelectVersion(null, result.data)
      } catch (err) {
        console.error('Failed to read current file:', err)
      }
      return
    }

    setSelectedOid(oid)
    try {
      const result = await window.ipc.invoke('knowledge:fileAtCommit', { path: relPath, oid })
      onSelectVersion(oid, result.content)
    } catch (err) {
      console.error('Failed to load file at commit:', err)
    }
  }, [path, relPath, onSelectVersion])

  const handleRestore = useCallback(() => {
    if (selectedOid) {
      onRestore(selectedOid)
    }
  }, [selectedOid, onRestore])

  return (
    <div className="flex flex-col w-[280px] shrink-0 border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium text-foreground">Version history</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Close version history"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Commit list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {error}
          </div>
        ) : commits.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            No history available
          </div>
        ) : (
          <div className="py-1">
            {commits.map((commit, index) => {
              const isLatest = index === 0
              const isSelected = isLatest ? selectedOid === null : selectedOid === commit.oid
              const { date, time } = formatTimestamp(commit.timestamp)

              return (
                <button
                  key={commit.oid}
                  type="button"
                  onClick={() => handleSelectCommit(commit.oid, isLatest)}
                  className={cn(
                    'w-full text-left px-3 py-2 transition-colors',
                    isSelected
                      ? 'bg-accent'
                      : 'hover:bg-accent/50'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {!isLatest && (
                      <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm text-foreground">
                      {date} &middot; {time}
                    </span>
                  </div>
                  {isLatest && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Current version
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {selectedOid && (
        <div className="shrink-0 border-t border-border p-3">
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={handleRestore}
          >
            Restore this version
          </Button>
        </div>
      )}
    </div>
  )
}
