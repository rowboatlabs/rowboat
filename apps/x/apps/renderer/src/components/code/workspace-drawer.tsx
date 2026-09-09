import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FilePlus2,
  FileX2,
  FileEdit,
  GitBranch,
  GitMerge,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type { CodeSession, GitStatusFile } from '@x/shared/src/code-sessions.js'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CodeFileTree } from './file-tree'
import { CodeFileViewer } from './file-viewer'
import { DiffViewer } from './diff-viewer'
import { TerminalPane } from './terminal-pane'
import type { CodeGitStatus } from './use-code-git-status'
import { CODE_PANELS, type CodePanel } from './code-panels'

const WIDTH_STORAGE_KEY = 'x:code-drawer-width'
const DEFAULT_WIDTH = 560
const MIN_WIDTH = 380
const MAX_WIDTH = 1200
// The chat is the main surface — the drawer never squeezes it below this.
const MIN_CHAT_WIDTH = 440

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const raw = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw))
}

const STATE_ICON: Record<GitStatusFile['state'], typeof FileEdit> = {
  modified: FileEdit,
  added: FilePlus2,
  untracked: FilePlus2,
  deleted: FileX2,
  renamed: FileEdit,
}

const basename = (p: string) => p.split(/[\\/]/).pop() || p

// The workspace drawer beside a coding session's chat: a diff reviewer
// (Changes), a read-only code browser (Files) and a real shell in the
// session's directory (Terminal). Opened from the chat header; the chat stays
// the main surface and this sits at its edge, resizable.
export function CodeWorkspaceDrawer({
  session,
  panel,
  onPanelChange,
  onClose,
  gitStatus,
  onRefreshGit,
  openDiffPath,
  onDiffOpened,
  onSessionChanged,
  placement = 'right',
  className,
}: {
  session: CodeSession
  panel: CodePanel
  onPanelChange: (panel: CodePanel) => void
  onClose: () => void
  gitStatus: CodeGitStatus | null
  onRefreshGit: () => void
  // A file path requested from the chat (clicking a changed file in a run).
  openDiffPath: string | null
  onDiffOpened: () => void
  onSessionChanged: () => void
  // Where the chat sits relative to the drawer — decides which seam gets the
  // hairline. The resize handle is always on the chat-facing (left) edge.
  placement?: 'middle' | 'right'
  className?: string
}) {
  const [width, setWidth] = useState(readStoredWidth)
  const [isResizing, setIsResizing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  useEffect(() => {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
  }, [width])

  // A different session: start from its lists, not the previous file.
  useEffect(() => {
    setDiffPath(null)
    setFilePath(null)
  }, [session.id])

  // Chat asked to show a specific file's diff.
  useEffect(() => {
    if (!openDiffPath) return
    // Tool events may carry absolute paths — make them cwd-relative.
    const rel = openDiffPath.startsWith(session.cwd + '/')
      ? openDiffPath.slice(session.cwd.length + 1)
      : openDiffPath
    setDiffPath(rel)
    onDiffOpened()
  }, [openDiffPath, session.cwd, onDiffOpened])

  const maxAllowedWidth = useCallback(() => {
    const root = rootRef.current
    const chat = root?.parentElement?.querySelector<HTMLElement>('[data-chat-sidebar-root]')
    const chatWidth = chat?.getBoundingClientRect().width ?? 0
    const split = chatWidth + (root?.getBoundingClientRect().width ?? 0)
    if (split <= 0) return MAX_WIDTH
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, split - MIN_CHAT_WIDTH))
  }, [])

  // The chat is the main surface: whenever it gets squeezed (window resized,
  // app sidebar expanded) give width back from the drawer, never from the
  // chat. Shrink-only, so it can't fight the user's own resize.
  useEffect(() => {
    const root = rootRef.current
    const chat = root?.parentElement?.querySelector<HTMLElement>('[data-chat-sidebar-root]')
    if (!chat) return
    const clamp = () => setWidth((w) => Math.min(w, maxAllowedWidth()))
    clamp()
    const observer = new ResizeObserver(clamp)
    observer.observe(chat)
    return () => observer.disconnect()
  }, [maxAllowedWidth])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    setIsResizing(true)
    const onMove = (event: MouseEvent) => {
      // The handle is on the left edge: dragging left grows the drawer.
      const next = startWidth + (startX - event.clientX)
      setWidth(Math.min(maxAllowedWidth(), Math.max(MIN_WIDTH, next)))
    }
    const onUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, maxAllowedWidth])

  const handleMergeBack = async () => {
    setMerging(true)
    try {
      const res = await window.ipc.invoke('codeSession:mergeBack', { sessionId: session.id })
      if (res.ok) {
        toast.success(res.message)
        onSessionChanged()
        onRefreshGit()
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
      onRefreshGit()
    } else {
      toast.error(res.error ?? 'Failed to remove worktree')
    }
  }

  const dirtyCount = gitStatus?.files.length ?? 0
  const worktreeActive = Boolean(session.worktree && !session.worktree.removedAt)

  return (
    <div
      ref={rootRef}
      data-code-drawer
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden bg-background',
        placement === 'middle' ? 'border-r border-border' : 'border-l border-border',
        className,
      )}
      style={{ width, flex: '0 0 auto' }}
    >
      <div
        onMouseDown={handleResizeStart}
        className={cn(
          'absolute inset-y-0 left-0 z-20 w-4 -translate-x-1/2 cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:transition-colors',
          'hover:after:bg-sidebar-border',
          isResizing && 'after:bg-primary',
        )}
      />

      {/* Header: segmented panel switch + panel actions. Part of the
          titlebar drag region like the chat header beside it. */}
      <div className="titlebar-drag-region flex h-10 shrink-0 items-center gap-1 border-b border-border bg-sidebar pl-2 pr-1">
        <div className="titlebar-no-drag flex items-center gap-0.5">
          {CODE_PANELS.map(({ id, label, icon: Icon }) => {
            const active = panel === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => onPanelChange(id)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-xs transition-colors',
                  active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {label}
                {id === 'changes' && dirtyCount > 0 && (
                  <span className="tabular-nums text-muted-foreground">{dirtyCount}</span>
                )}
              </button>
            )
          })}
        </div>
        <span className="flex-1" />
        {panel === 'changes' && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="titlebar-no-drag h-7 w-7 p-0 text-muted-foreground"
                  onClick={onRefreshGit}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>
            {worktreeActive && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="titlebar-no-drag h-7 gap-1.5 px-2 text-xs text-muted-foreground">
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
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="titlebar-no-drag h-7 w-7 p-0 text-muted-foreground"
              onClick={onClose}
              aria-label="Close panel"
            >
              <X className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close</TooltipContent>
        </Tooltip>
      </div>

      {/* Context strip: where this panel is looking. */}
      {panel === 'changes' && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-3 text-xs text-muted-foreground">
          {gitStatus?.isRepo ? (
            <>
              <GitBranch className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate font-mono">{gitStatus.branch ?? '(no branch)'}</span>
              <span className="flex-1" />
              <span className="shrink-0 tabular-nums">
                {dirtyCount === 0 ? 'Clean' : `${dirtyCount} changed`}
              </span>
            </>
          ) : gitStatus ? (
            <span>Not a git repository</span>
          ) : (
            <span>Reading status…</span>
          )}
        </div>
      )}
      {panel === 'terminal' && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate font-mono" title={session.cwd}>{basename(session.cwd)}</span>
          {worktreeActive && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">worktree</span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1">
        {panel === 'changes' && (
          diffPath ? (
            <DiffViewer sessionId={session.id} path={diffPath} onClose={() => setDiffPath(null)} />
          ) : (
            <div className="h-full overflow-auto p-2">
              {gitStatus && !gitStatus.isRepo && (
                <p className="p-3 text-sm text-muted-foreground">
                  This folder isn't a git repository, so there's nothing to diff. Files still works.
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
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent/60"
                    title={file.path}
                  >
                    <Icon className={cn(
                      'size-3.5 shrink-0',
                      file.state === 'deleted'
                        ? 'text-[var(--rowboat-attention)]'
                        : file.state === 'modified' || file.state === 'renamed'
                          ? 'text-muted-foreground'
                          : 'text-[var(--rowboat-success)]',
                    )} />
                    <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                    <span className="flex shrink-0 gap-1.5 tabular-nums">
                      {file.insertions !== null && <span className="text-[var(--rowboat-success)]">+{file.insertions}</span>}
                      {file.deletions !== null && <span className="text-[var(--rowboat-attention)]">−{file.deletions}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        )}
        {panel === 'files' && (
          filePath ? (
            <CodeFileViewer sessionId={session.id} path={filePath} onClose={() => setFilePath(null)} />
          ) : (
            <div className="h-full overflow-auto">
              <CodeFileTree sessionId={session.id} selectedPath={filePath} onSelectFile={setFilePath} />
            </div>
          )
        )}
        {panel === 'terminal' && (
          // A real shell in the session's directory (worktree included). The
          // PTY lives in the main process and survives closing this panel.
          <div className="h-full min-h-0 bg-background pb-2 dark:bg-black">
            <TerminalPane key={session.id} terminalId={session.id} cwd={session.cwd} />
          </div>
        )}
      </div>
    </div>
  )
}
