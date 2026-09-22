import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { codeWorkspaceKey, type CodeSession, type CodeSessionStatus } from '@x/shared/src/code-sessions.js'
import type { CodingAgent } from '@x/shared/src/code-mode.js'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { useCodeSessions, projectLabel, type ProjectRow } from './use-code-sessions'
import { SessionRail } from './session-rail'
import { useCodeSessionReader } from './session-read-state'
import { BranchDialog } from './branch-dialog'
import { fetchCodeAgentsStatus, isAgentReady, type CodeAgentsStatus } from './code-agent-status'

// Remember which session was open so leaving Projects (which unmounts
// this view) and coming back restores the selection — and with it the chat
// bound to it — instead of dropping back to the empty state.
const SELECTED_SESSION_STORAGE_KEY = 'x:code-selected-session'

function readStoredSelectedSessionId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(SELECTED_SESSION_STORAGE_KEY) || null
}

export interface ActiveCodeSession {
  session: CodeSession
  status: CodeSessionStatus
}

// Projects uses the existing session store (its Code names remain compatible
// with saved sessions and routes). The rail selects a thread, its conversation
// fills the main surface, and the terminal opens beside it.
export function CodeView({
  onSessionSelected,
  focusSessionId,
  onFocusConsumed,
  onRailWidthChange,
  focusProjectPath,
  onProjectFocusConsumed,
}: {
  onSessionSelected?: (active: ActiveCodeSession | null) => void
  // Deep-link from elsewhere (a Home Deck strip): select this session on
  // mount/change instead of the remembered one.
  focusSessionId?: string | null
  onFocusConsumed?: () => void
  // The rail's drag-resizable width, reported up so App can size the middle
  // pane to the rail while a session's chat is the main surface.
  onRailWidthChange?: (width: number) => void
  focusProjectPath?: string | null
  onProjectFocusConsumed?: () => void
}) {
  const { projects, sessions, statusOf, refresh } = useCodeSessions()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(readStoredSelectedSessionId)

  useEffect(() => {
    if (!focusSessionId) return
    setSelectedSessionId(focusSessionId)
    onFocusConsumed?.()
  }, [focusSessionId, onFocusConsumed])
  const [branchDialog, setBranchDialog] = useState<{ projectId: string; mode: 'switch' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CodeSession | null>(null)

  // Warm the agent probe so a quick-create doesn't pay for it on the click.
  const [agentsStatus, setAgentsStatus] = useState<CodeAgentsStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchCodeAgentsStatus().then((s) => { if (!cancelled) setAgentsStatus(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (selectedSessionId) window.localStorage.setItem(SELECTED_SESSION_STORAGE_KEY, selectedSessionId)
    else window.localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY)
  }, [selectedSessionId])

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null
  const selectedStatus = selectedSession ? statusOf(selectedSession.id) : 'idle'
  useCodeSessionReader(focusSessionId ? null : selectedSession?.id ?? null)

  useEffect(() => {
    if (selectedSession) window.localStorage.setItem(`x:code-workspace-session:${codeWorkspaceKey(selectedSession)}`, selectedSession.id)
  }, [selectedSession])

  // Tell App which session (and status) owns the chat.
  useEffect(() => {
    onSessionSelected?.(selectedSession ? { session: selectedSession, status: selectedStatus } : null)
  }, [selectedSession, selectedStatus, onSessionSelected])

  // Leaving Projects unmounts this view — release the chat.
  useEffect(() => {
    return () => onSessionSelected?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const creatingRef = useRef(false)

  // Create immediately from the live parent checkout. The base can be changed
  // from the worktree controls until its first session starts.
  const handleNewSession = useCallback(async (projectId: string, agentOverride?: CodingAgent, projectRow?: ProjectRow) => {
    if (creatingRef.current) return
    const row = projectRow ?? projects.find((p) => p.project.id === projectId)
    if (!row) return
    creatingRef.current = true
    try {
      const lastUsed = [...sessions]
        .sort((a, b) => (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt))[0]?.agent
      const agent: CodingAgent = agentOverride ?? lastUsed ?? (isAgentReady(agentsStatus, 'claude') ? 'claude' : 'codex')
      const isolation = row.git.isGitRepo ? 'worktree' : 'in-repo'
      const res = await window.ipc.invoke('codeSession:create', { projectId, agent, isolation, codeModeEnabled: row.git.isGitRepo || !!agentOverride })
      await refresh()
      setSelectedSessionId(res.session.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      creatingRef.current = false
    }
  }, [projects, sessions, agentsStatus, refresh])

  const handleAddProject = useCallback(async () => {
    const res = await window.ipc.invoke('dialog:openDirectory', { title: 'Choose a project folder' })
    const dir = res.path
    if (!dir) return
    try {
      const added = await window.ipc.invoke('codeProject:add', { path: dir })
      await refresh()
      // Use the returned row directly: the refreshed React snapshot may not
      // have rendered yet when a project is first added.
      await handleNewSession(added.project.id, undefined, added)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add project')
    }
  }, [refresh, handleNewSession])

  useEffect(() => {
    if (!focusProjectPath) return
    let cancelled = false
    void (async () => {
      try {
        const row = await window.ipc.invoke('codeProject:add', { path: focusProjectPath })
        await refresh()
        if (cancelled) return
        const existing = await window.ipc.invoke('codeSession:list', null)
        const session = existing.sessions.find((s) => s.projectId === row.project.id && !s.doneAt)
        if (session) setSelectedSessionId(session.id)
        else await handleNewSession(row.project.id, undefined, row)
        onProjectFocusConsumed?.()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to open project')
        onProjectFocusConsumed?.()
      }
    })()
    return () => { cancelled = true }
    // A directory request is consumed once, independently of store refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProjectPath])

  const handleRemoveProject = useCallback(async (projectId: string) => {
    await window.ipc.invoke('codeProject:remove', { projectId })
    await refresh()
  }, [refresh])

  // The rail acts on the whole workspace; the chat header can still mark
  // an individual session done. Files and conversations remain on disk.
  const handleSetDone = useCallback(async (session: CodeSession, done: boolean) => {
    try {
      for (const member of sessions.filter((s) => codeWorkspaceKey(s) === codeWorkspaceKey(session))) {
        await window.ipc.invoke('codeSession:setDone', { sessionId: member.id, done })
      }
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update session')
    }
  }, [refresh, sessions])

  const handleDeleteSession = useCallback(async (session: CodeSession, removeWorktree: boolean) => {
    try {
      await window.ipc.invoke('codeSession:delete', {
        sessionId: session.id,
        removeWorktree,
        deleteBranch: removeWorktree,
      })
      if (selectedSessionId === session.id) setSelectedSessionId(sessions.find((s) => s.id !== session.id && codeWorkspaceKey(s) === codeWorkspaceKey(session))?.id ?? null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete session')
    }
  }, [refresh, selectedSessionId, sessions])

  return (
    <div className="flex h-full min-h-0">
      {/* Session rail, on the shared SecondaryRail shell (it owns its width
          and drag-resize). With a session selected this IS the middle pane —
          App sizes the pane to the width the rail reports; without one the
          empty state fills the rest and the chat pane stays out of the way. */}
      <SessionRail
        projects={projects}
        sessions={sessions}
        statusOf={statusOf}
        agentsStatus={agentsStatus}
        selectedSessionId={selectedSessionId}
        onSelectSession={(clickedId) => {
          const clicked = sessions.find((s) => s.id === clickedId)
          const remembered = clicked && window.localStorage.getItem(`x:code-workspace-session:${codeWorkspaceKey(clicked)}`)
          const id = clicked && sessions.some((s) => s.id === remembered && codeWorkspaceKey(s) === codeWorkspaceKey(clicked)) ? remembered! : clickedId
          setSelectedSessionId(id)
          // Re-clicking the already-selected session is a no-op for React
          // state, but the user means "show me this session's chat" — the
          // chat may have been rebound to another conversation meanwhile.
          // Re-notify so App re-asserts the binding (it dedupes).
          if (id === selectedSessionId) {
            const session = sessions.find((s) => s.id === id)
            if (session) onSessionSelected?.({ session, status: statusOf(session.id) })
          }
        }}
        onSwitchBranch={(projectId) => setBranchDialog({ projectId, mode: 'switch' })}
        onAddProject={() => void handleAddProject()}
        onRemoveProject={(id) => void handleRemoveProject(id)}
        onNewSession={(projectId, agent) => void handleNewSession(projectId, agent)}
        onSetDone={(session, done) => void handleSetDone(session, done)}
        onDeleteSession={setDeleteTarget}
        onWidthChange={onRailWidthChange}
        // With a session selected the chat pane sits flush right and draws
        // the divider (its border-l) — the rail's own would double it.
        className={selectedSession ? 'border-r-0' : undefined}
      />

      {!selectedSession && (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <FolderOpen className="size-10 text-muted-foreground/40" />
          <div className="text-sm font-medium">Your projects</div>
          <p className="max-w-sm px-6 text-xs text-muted-foreground">
            Open a folder and start a conversation. Enable Harness to work with Claude Code or Codex.
          </p>
          {projects.length === 0 ? (
            <Button size="sm" onClick={() => void handleAddProject()}>Add a project to get started</Button>
          ) : projects.length === 1 ? (
            <Button size="sm" onClick={() => void handleNewSession(projects[0].project.id)}>
              <Plus className="size-3.5" />
              New thread in {projectLabel(projects[0])}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Pick a session on the left, or start one from a project's + button.</p>
          )}
        </div>
      )}

      {branchDialog && <BranchDialog key={`${branchDialog.projectId}:${branchDialog.mode}`} projectId={branchDialog.projectId} mode={branchDialog.mode}
        onClose={() => setBranchDialog(null)} onConfirm={async (branch) => {
          await window.ipc.invoke('codeProject:switchBranch', { projectId: branchDialog.projectId, branch })
          await refresh()
        }} />}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              The conversation history will be deleted.
              {deleteTarget?.worktree && !deleteTarget.worktree.removedAt && sessions.filter((s) => codeWorkspaceKey(s) === codeWorkspaceKey(deleteTarget)).length === 1
                ? ' Its worktree and branch will be removed too — merge back first if you want to keep the changes.'
                : ' Other sessions and their workspace will be kept.'}
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
