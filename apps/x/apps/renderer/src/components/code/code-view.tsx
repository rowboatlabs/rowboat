import { useCallback, useEffect, useState } from 'react'
import { Bot, Code2, GitBranch } from 'lucide-react'
import type { CodeSession, CodeSessionStatus } from '@x/shared/src/code-sessions.js'
import type { ApprovalPolicy } from '@x/shared/src/code-mode.js'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useCodeSessions } from './use-code-sessions'
import { SessionRail } from './session-rail'
import { NewSessionDialog } from './new-session-dialog'
import { WorkspacePane } from './workspace-pane'

const AGENT_LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }
const POLICY_LABEL: Record<ApprovalPolicy, string> = {
  ask: 'Ask every time',
  'auto-approve-reads': 'Auto-approve reads',
  yolo: 'Auto-approve everything',
}

export interface ActiveCodeSession {
  session: CodeSession
  status: CodeSessionStatus
}

// The Code section's middle pane: session rail + workspace (diffs/files).
// The conversation lives in the RIGHT pane — the assistant chat bound to the
// session's run when Rowboat drives, or the direct-drive chat otherwise.
// App.tsx learns which via onSessionSelected and renders the right pane.
export function CodeView({
  onSessionSelected,
  openDiffPath,
  onDiffOpened,
}: {
  onSessionSelected?: (active: ActiveCodeSession | null) => void
  // A file path the chat asked to review (clicking a changed file in a tool call).
  openDiffPath?: string | null
  onDiffOpened?: () => void
}) {
  const { projects, sessions, statusOf, refresh } = useCodeSessions()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CodeSession | null>(null)

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null
  const selectedStatus = selectedSession ? statusOf(selectedSession.id) : 'idle'
  const newSessionProject = projects.find((p) => p.project.id === newSessionProjectId) ?? null

  // Tell App which session (and status) owns the right-hand chat pane.
  useEffect(() => {
    onSessionSelected?.(selectedSession ? { session: selectedSession, status: selectedStatus } : null)
  }, [selectedSession, selectedStatus, onSessionSelected])

  // Leaving the Code section unmounts this view — release the right pane.
  useEffect(() => {
    return () => onSessionSelected?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAddProject = useCallback(async () => {
    const res = await window.ipc.invoke('dialog:openDirectory', { title: 'Choose a project folder' })
    const dir = res.path
    if (!dir) return
    try {
      const added = await window.ipc.invoke('codeProject:add', { path: dir })
      await refresh()
      setNewSessionProjectId(added.project.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add project')
    }
  }, [refresh])

  const handleRemoveProject = useCallback(async (projectId: string) => {
    await window.ipc.invoke('codeProject:remove', { projectId })
    await refresh()
  }, [refresh])

  const handleSessionCreated = useCallback(async (session: CodeSession) => {
    await refresh()
    setSelectedSessionId(session.id)
  }, [refresh])

  const handleDeleteSession = useCallback(async (session: CodeSession, removeWorktree: boolean) => {
    try {
      await window.ipc.invoke('codeSession:delete', {
        sessionId: session.id,
        removeWorktree,
        deleteBranch: removeWorktree,
      })
      if (selectedSessionId === session.id) setSelectedSessionId(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete session')
    }
  }, [refresh, selectedSessionId])

  const handleUpdateSession = useCallback(async (patch: { mode?: 'direct' | 'rowboat'; policy?: ApprovalPolicy; agent?: 'claude' | 'codex' }) => {
    if (!selectedSessionId) return
    try {
      await window.ipc.invoke('codeSession:update', { sessionId: selectedSessionId, patch })
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update session')
    }
  }, [refresh, selectedSessionId])

  const busy = selectedStatus === 'working' || selectedStatus === 'needs-you'

  return (
    <div className="flex h-full min-h-0">
      {/* Session rail */}
      <div className="w-64 shrink-0 border-r">
        <SessionRail
          projects={projects}
          sessions={sessions}
          statusOf={statusOf}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
          onAddProject={() => void handleAddProject()}
          onRemoveProject={(id) => void handleRemoveProject(id)}
          onNewSession={setNewSessionProjectId}
          onDeleteSession={setDeleteTarget}
        />
      </div>

      {/* Workspace: session header + diffs/files. The chat is in the right pane. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedSession ? (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{selectedSession.title}</div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{AGENT_LABEL[selectedSession.agent]}</span>
                  <span>·</span>
                  <span className="truncate font-mono" title={selectedSession.cwd}>{selectedSession.cwd}</span>
                  {selectedSession.worktree && !selectedSession.worktree.removedAt && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
                      <GitBranch className="size-3" />
                      {selectedSession.worktree.branch}
                    </span>
                  )}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
                    {POLICY_LABEL[selectedSession.policy]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(POLICY_LABEL) as ApprovalPolicy[]).map((policy) => (
                    <DropdownMenuItem key={policy} onClick={() => void handleUpdateSession({ policy })}>
                      {POLICY_LABEL[policy]}
                      {selectedSession.policy === policy && <span className="ml-auto">✓</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Bot className="size-3.5" />
                Rowboat drives
                <Switch
                  checked={selectedSession.mode === 'rowboat'}
                  disabled={busy}
                  onCheckedChange={(checked) => void handleUpdateSession({ mode: checked ? 'rowboat' : 'direct' })}
                />
              </label>
            </div>
            <div className="min-h-0 flex-1">
              <WorkspacePane
                session={selectedSession}
                status={selectedStatus}
                openDiffPath={openDiffPath ?? null}
                onDiffOpened={() => onDiffOpened?.()}
                onSessionChanged={() => void refresh()}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Code2 className="size-10 text-muted-foreground/40" />
            <div className="text-sm font-medium">Code with agents</div>
            <p className="max-w-sm px-6 text-xs text-muted-foreground">
              Run Claude Code or Codex on your projects — let Rowboat drive them, or talk to them
              directly. The conversation happens in the chat pane on the right; changes and files
              show here.
            </p>
            {projects.length === 0 ? (
              <Button size="sm" onClick={() => void handleAddProject()}>Add a project to get started</Button>
            ) : (
              <p className="text-xs text-muted-foreground">Pick a session on the left, or create a new one.</p>
            )}
          </div>
        )}
      </div>

      <NewSessionDialog
        projectRow={newSessionProject}
        open={newSessionProjectId !== null}
        onOpenChange={(open) => { if (!open) setNewSessionProjectId(null) }}
        onCreated={(session) => void handleSessionCreated(session)}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              The conversation history will be deleted.
              {deleteTarget?.worktree && !deleteTarget.worktree.removedAt
                ? ' Its worktree and branch will be removed too — merge back first if you want to keep the changes.'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void handleDeleteSession(deleteTarget, true)
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
