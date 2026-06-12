import { useCallback, useEffect, useState } from 'react'
import {
  FileDiff,
  FilePlus2,
  FileX2,
  FileEdit,
  GitBranch,
  GitMerge,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { CodeSession, CodeSessionStatus, GitStatusFile } from '@x/shared/src/code-sessions.js'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CodeFileTree } from './file-tree'
import { CodeFileViewer } from './file-viewer'
import { DiffViewer } from './diff-viewer'

type GitStatus = {
  isRepo: boolean
  branch: string | null
  hasCommits: boolean
  files: GitStatusFile[]
}

const STATE_ICON: Record<GitStatusFile['state'], typeof FileEdit> = {
  modified: FileEdit,
  added: FilePlus2,
  untracked: FilePlus2,
  deleted: FileX2,
  renamed: FileEdit,
}

// Right pane of a coding session: a diff reviewer first (Changes), a code
// browser second (Files). Read-only in v1 by design.
export function WorkspacePane({
  session,
  status,
  openDiffPath,
  onDiffOpened,
  onSessionChanged,
}: {
  session: CodeSession
  status: CodeSessionStatus
  // A file path requested from the chat (clicking a changed file in a tool call).
  openDiffPath: string | null
  onDiffOpened: () => void
  onSessionChanged: () => void
}) {
  const [tab, setTab] = useState<'changes' | 'files'>('changes')
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const res = await window.ipc.invoke('codeSession:gitStatus', { sessionId: session.id })
      setGitStatus(res)
    } catch {
      setGitStatus(null)
    }
  }, [session.id])

  useEffect(() => {
    setTab('changes')
    setDiffPath(null)
    setFilePath(null)
    void refreshStatus()
  }, [refreshStatus])

  // Refresh on turn end, and poll lightly while the agent is working — the
  // session cwd lives outside the workspace watcher, so there are no change
  // events to react to.
  useEffect(() => {
    if (status === 'idle') {
      void refreshStatus()
      return
    }
    const interval = setInterval(() => void refreshStatus(), 5000)
    return () => clearInterval(interval)
  }, [status, refreshStatus])

  // Chat asked to show a specific file's diff.
  useEffect(() => {
    if (!openDiffPath) return
    // Tool events may carry absolute paths — make them cwd-relative.
    const rel = openDiffPath.startsWith(session.cwd + '/')
      ? openDiffPath.slice(session.cwd.length + 1)
      : openDiffPath
    setTab('changes')
    setDiffPath(rel)
    onDiffOpened()
  }, [openDiffPath, session.cwd, onDiffOpened])

  const handleMergeBack = async () => {
    setMerging(true)
    try {
      const res = await window.ipc.invoke('codeSession:mergeBack', { sessionId: session.id })
      if (res.ok) {
        toast.success(res.message)
        onSessionChanged()
      } else {
        toast.error(res.message, { duration: 10000 })
      }
    } finally {
      setMerging(false)
    }
  }

  const handleCleanup = async (deleteBranch: boolean) => {
    const res = await window.ipc.invoke('codeSession:cleanupWorktree', { sessionId: session.id, deleteBranch })
    if (res.success) {
      toast.success('Worktree removed. The session now works directly in the repo.')
      onSessionChanged()
    } else {
      toast.error(res.error ?? 'Failed to remove worktree')
    }
  }

  const dirtyCount = gitStatus?.files.length ?? 0
  const worktreeActive = session.worktree && !session.worktree.removedAt

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: branch + worktree controls */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          {gitStatus?.isRepo ? (
            <>
              <GitBranch className="size-3.5 shrink-0" />
              <span className="truncate font-mono">{gitStatus.branch ?? '(no branch)'}</span>
              {dirtyCount > 0 && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                  {dirtyCount} changed
                </span>
              )}
            </>
          ) : (
            <span>Not a git repository</span>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void refreshStatus()} title="Refresh">
          <RefreshCw className="size-3.5" />
        </Button>
        {worktreeActive && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
                <GitMerge className="size-3.5" />
                Worktree
                <MoreHorizontal className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={merging} onClick={() => void handleMergeBack()}>
                <GitMerge className="size-4" />
                Merge back into repo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCleanup(false)}>
                <Trash2 className="size-4" />
                Remove worktree (keep branch)
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => void handleCleanup(true)}>
                <Trash2 className="size-4" />
                Remove worktree and branch
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        {(['changes', 'files'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors',
              tab === t ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t === 'changes' ? `Changes${dirtyCount > 0 ? ` (${dirtyCount})` : ''}` : 'Files'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        {tab === 'changes' && (
          diffPath ? (
            <DiffViewer sessionId={session.id} path={diffPath} onClose={() => setDiffPath(null)} />
          ) : (
            <div className="h-full overflow-auto p-2">
              {!gitStatus?.isRepo && (
                <p className="p-3 text-sm text-muted-foreground">
                  This folder isn't a git repository, so there's nothing to diff. The Files tab still works.
                </p>
              )}
              {gitStatus?.isRepo && gitStatus.files.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No uncommitted changes.</p>
              )}
              {gitStatus?.files.map((file) => {
                const Icon = STATE_ICON[file.state]
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setDiffPath(file.path)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
                    title={file.path}
                  >
                    <Icon className={cn(
                      'size-3.5 shrink-0',
                      file.state === 'deleted' ? 'text-red-500' : file.state === 'modified' || file.state === 'renamed' ? 'text-amber-500' : 'text-green-600',
                    )} />
                    <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                    {file.insertions !== null && <span className="shrink-0 text-green-600">+{file.insertions}</span>}
                    {file.deletions !== null && <span className="shrink-0 text-red-500">−{file.deletions}</span>}
                  </button>
                )
              })}
            </div>
          )
        )}
        {tab === 'files' && (
          filePath ? (
            <CodeFileViewer sessionId={session.id} path={filePath} onClose={() => setFilePath(null)} />
          ) : (
            <div className="h-full overflow-auto">
              <CodeFileTree sessionId={session.id} selectedPath={filePath} onSelectFile={setFilePath} />
            </div>
          )
        )}
      </div>
      {tab === 'changes' && !diffPath && dirtyCount > 0 && (
        <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <FileDiff className="mr-1 inline size-3" />
          Click a file to review its diff.
        </div>
      )}
    </div>
  )
}
