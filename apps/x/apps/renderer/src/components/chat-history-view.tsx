import { useCallback, useMemo, useState } from 'react'
import { ExternalLink, MoreVertical, Pencil, SearchIcon, SquarePen, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatRelativeTime } from '@/lib/relative-time'

type Run = {
  id: string
  title?: string
  createdAt: string
  modifiedAt: string
  agentId: string
}

type ChatHistoryViewProps = {
  runs: Run[]
  currentRunId?: string | null
  processingRunIds?: Set<string>
  onSelectRun: (runId: string) => void
  onOpenInNewTab?: (runId: string) => void
  onRenameRun?: (runId: string, title: string) => void
  onDeleteRun: (runId: string) => Promise<void> | void
  onNewChat?: () => void
  onOpenSearch?: () => void
}

export function ChatHistoryView({
  runs,
  currentRunId,
  processingRunIds,
  onSelectRun,
  onOpenInNewTab,
  onRenameRun,
  onDeleteRun,
  onNewChat,
  onOpenSearch,
}: ChatHistoryViewProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const at = new Date(a.modifiedAt).getTime()
      const bt = new Date(b.modifiedAt).getTime()
      return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at)
    })
  }, [runs])

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    setPendingDeleteId(null)
    await onDeleteRun(id)
  }, [pendingDeleteId, onDeleteRun])

  const startRename = useCallback((run: Run) => {
    setRenameDraft(run.title || '')
    setRenamingId(run.id)
  }, [])

  const commitRename = useCallback((runId: string) => {
    const title = renameDraft.trim()
    const current = runs.find((r) => r.id === runId)
    setRenamingId(null)
    if (!title || title === (current?.title ?? '')) return
    onRenameRun?.(runId, title)
  }, [renameDraft, runs, onRenameRun])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f8f8f9] dark:bg-[#0b0b0d]">
      <div className="mx-auto w-full max-w-[1120px] shrink-0 px-[30px] pt-[34px] pb-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-[24px] font-[650] tracking-[-0.02em] text-[#0d0e11] dark:text-[#f4f5f7]">Chat history</h1>
          <div className="flex items-center gap-2">
            {onOpenSearch && (
              <button
                type="button"
                onClick={onOpenSearch}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <SearchIcon className="size-4" />
                <span>Search</span>
              </button>
            )}
            {onNewChat && (
              <Button size="sm" onClick={onNewChat}>
                <SquarePen className="size-4" />
                New chat
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-[14px] text-black/50 dark:text-white/[0.52]">
          {sortedRuns.length === 0
            ? 'Every conversation you have shows up here.'
            : `${sortedRuns.length} ${sortedRuns.length === 1 ? 'conversation' : 'conversations'}, newest first.`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1120px] px-[30px] pb-12">
          {sortedRuns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              No chats yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
              <div className="flex items-center border-b border-border/60 bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <div className="min-w-0 flex-1">Title</div>
                <div className="w-28 shrink-0 text-right">Last modified</div>
                <div className="w-7 shrink-0" />
              </div>

              {sortedRuns.map((run) => {
                const isActive = currentRunId === run.id
                const isProcessing = processingRunIds?.has(run.id)
                return (
                  <ContextMenu key={run.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          'group relative border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/20',
                          isActive && 'bg-muted/30',
                        )}
                      >
                        {renamingId === run.id ? (
                          <div className="flex items-center px-4 py-1.5">
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  commitRename(run.id)
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  setRenamingId(null)
                                }
                              }}
                              onBlur={() => commitRename(run.id)}
                              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                if (e.metaKey && onOpenInNewTab) {
                                  onOpenInNewTab(run.id)
                                } else {
                                  onSelectRun(run.id)
                                }
                              }}
                              className="flex w-full items-center px-4 py-2.5 text-left text-sm"
                            >
                              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                {run.title || '(Untitled chat)'}
                              </span>
                              <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                                {formatRelativeTime(run.modifiedAt)}
                              </span>
                              <span className="w-7 shrink-0" />
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Chat options"
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
                                >
                                  <MoreVertical className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                {onOpenInNewTab && (
                                  <>
                                    <DropdownMenuItem onClick={() => onOpenInNewTab(run.id)}>
                                      <ExternalLink className="mr-2 size-4" />
                                      Open in new tab
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                  </>
                                )}
                                {onRenameRun && (
                                  <DropdownMenuItem onClick={() => startRename(run)}>
                                    <Pencil className="mr-2 size-4" />
                                    Rename
                                  </DropdownMenuItem>
                                )}
                                {!isProcessing && (
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setPendingDeleteId(run.id)}
                                  >
                                    <Trash2 className="mr-2 size-4" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      {onOpenInNewTab && (
                        <>
                          <ContextMenuItem onClick={() => onOpenInNewTab(run.id)}>
                            <ExternalLink className="mr-2 size-4" />
                            Open in new tab
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                        </>
                      )}
                      {onRenameRun && (
                        <ContextMenuItem onClick={() => startRename(run)}>
                          <Pencil className="mr-2 size-4" />
                          Rename
                        </ContextMenuItem>
                      )}
                      {!isProcessing && (
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => setPendingDeleteId(run.id)}
                        >
                          <Trash2 className="mr-2 size-4" />
                          Delete
                        </ContextMenuItem>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this chat?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
