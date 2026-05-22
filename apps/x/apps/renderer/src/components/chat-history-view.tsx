import { useCallback, useMemo, useState } from 'react'
import { ExternalLink, MessageSquare, SearchIcon, SquarePen, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
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
  agentId: string
}

type ChatHistoryViewProps = {
  runs: Run[]
  currentRunId?: string | null
  processingRunIds?: Set<string>
  onSelectRun: (runId: string) => void
  onOpenInNewTab?: (runId: string) => void
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
  onDeleteRun,
  onNewChat,
  onOpenSearch,
}: ChatHistoryViewProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const at = new Date(a.createdAt).getTime()
      const bt = new Date(b.createdAt).getTime()
      return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at)
    })
  }, [runs])

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    setPendingDeleteId(null)
    await onDeleteRun(id)
  }, [pendingDeleteId, onDeleteRun])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Chat history</h1>
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

      <div className="flex-1 overflow-y-auto">
        <div className="min-w-[480px]">
          <div className="sticky top-0 z-10 flex items-center border-b border-border bg-background px-6 py-2 text-xs font-medium text-muted-foreground">
            <div className="flex-1">Title</div>
            <div className="w-32 shrink-0">Created</div>
          </div>

          {sortedRuns.length === 0 ? (
            <div className="px-6 py-8 text-sm text-muted-foreground">No chats yet.</div>
          ) : (
            sortedRuns.map((run) => {
              const isActive = currentRunId === run.id
              const isProcessing = processingRunIds?.has(run.id)
              return (
                <ContextMenu key={run.id}>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        if (e.metaKey && onOpenInNewTab) {
                          onOpenInNewTab(run.id)
                        } else {
                          onSelectRun(run.id)
                        }
                      }}
                      className={[
                        'flex w-full items-center border-b border-border/60 px-6 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                        isActive ? 'bg-accent/60' : '',
                      ].join(' ')}
                    >
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate">{run.title || '(Untitled chat)'}</span>
                      </div>
                      <div className="w-32 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatRelativeTime(run.createdAt)}
                      </div>
                    </button>
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
            })
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
