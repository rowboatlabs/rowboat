import { useCallback, useEffect, useRef, useState } from 'react'
import { Code2, Plus } from 'lucide-react'
import type { CodeSession, CodeSessionStatus } from '@x/shared/src/code-sessions.js'
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
import { useCodeSessions, projectLabel } from './use-code-sessions'
import { SessionRail } from './session-rail'
import { AGENT_LABEL, fetchCodeAgentsStatus, isAgentReady, type CodeAgentsStatus } from './code-agent-status'

// Remember which session was open so leaving the Code section (which unmounts
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

// The Code section's middle pane: the session rail. The conversation is the
// main surface — the assistant chat bound to the selected session (a code
// session IS a chat session) fills the rest of the window, and changes /
// files / terminal open in a drawer beside it. App.tsx learns which session
// owns the chat via onSessionSelected and does the binding.
export function CodeView({
  onSessionSelected,
  focusSessionId,
  onFocusConsumed,
  onRailWidthChange,
}: {
  onSessionSelected?: (active: ActiveCodeSession | null) => void
  // Deep-link from elsewhere (a Home Deck strip): select this session on
  // mount/change instead of the remembered one.
  focusSessionId?: string | null
  onFocusConsumed?: () => void
  // The rail's drag-resizable width, reported up so App can size the middle
  // pane to the rail while a session's chat is the main surface.
  onRailWidthChange?: (width: number) => void
}) {
  const { projects, sessions, statusOf, refresh } = useCodeSessions()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(readStoredSelectedSessionId)

  useEffect(() => {
    if (!focusSessionId) return
    setSelectedSessionId(focusSessionId)
    onFocusConsumed?.()
  }, [focusSessionId, onFocusConsumed])
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

  // Tell App which session (and status) owns the chat.
  useEffect(() => {
    onSessionSelected?.(selectedSession ? { session: selectedSession, status: selectedStatus } : null)
  }, [selectedSession, selectedStatus, onSessionSelected])

  // Leaving the Code section unmounts this view — release the chat.
  useEffect(() => {
    return () => onSessionSelected?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const creatingRef = useRef(false)

  // Quick create — no form. An isolated worktree whenever the repo allows
  // one, the agent the user last worked with (whichever is ready), and
  // everything else at its default; all of it stays editable from the chat
  // header once the session is open. The chat is created untitled so the
  // runtime names it from the first message.
  const handleNewSession = useCallback(async (projectId: string, agentOverride?: CodingAgent) => {
    if (creatingRef.current) return
    const row = projects.find((p) => p.project.id === projectId)
    if (!row) return
    creatingRef.current = true
    try {
      const status = agentsStatus ?? (await fetchCodeAgentsStatus().catch(() => null))
      if (status && !agentsStatus) setAgentsStatus(status)
      const ready = (a: CodingAgent) => isAgentReady(status, a)
      const lastUsed = [...sessions]
        .sort((a, b) => (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt))[0]?.agent
      let agent: CodingAgent
      if (agentOverride) {
        if (status && !ready(agentOverride)) {
          toast.error(`${AGENT_LABEL[agentOverride]} isn't ready — sign in or enable it in Settings.`)
          return
        }
        agent = agentOverride
      } else if (!status) {
        // The probe failed: trust the last choice rather than block the click.
        agent = lastUsed ?? 'claude'
      } else if (lastUsed && ready(lastUsed)) {
        agent = lastUsed
      } else if (ready('claude') || ready('codex')) {
        agent = ready('claude') ? 'claude' : 'codex'
      } else {
        toast.error('No coding agent is ready — sign in to Claude Code or Codex in Settings.')
        return
      }
      const isolation = row.git.isGitRepo && row.git.hasCommits ? 'worktree' : 'in-repo'
      const res = await window.ipc.invoke('codeSession:create', { projectId, agent, isolation })
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
      // A fresh project goes straight into its first session.
      void handleNewSession(added.project.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add project')
    }
  }, [refresh, handleNewSession])

  const handleRemoveProject = useCallback(async (projectId: string) => {
    await window.ipc.invoke('codeProject:remove', { projectId })
    await refresh()
  }, [refresh])

  // Done is a flag: nothing on disk changes, and the session stays selected
  // if it was — the row just moves piles.
  const handleSetDone = useCallback(async (session: CodeSession, done: boolean) => {
    try {
      await window.ipc.invoke('codeSession:setDone', { sessionId: session.id, done })
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update session')
    }
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
        onSelectSession={(id) => {
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
          <Code2 className="size-10 text-muted-foreground/40" />
          <div className="text-sm font-medium">Code with agents</div>
          <p className="max-w-sm px-6 text-xs text-muted-foreground">
            Rowboat runs Claude Code or Codex on your projects. Each session is a conversation —
            changes, files and a terminal are one click away beside it.
          </p>
          {projects.length === 0 ? (
            <Button size="sm" onClick={() => void handleAddProject()}>Add a project to get started</Button>
          ) : projects.length === 1 ? (
            <Button size="sm" onClick={() => void handleNewSession(projects[0].project.id)}>
              <Plus className="size-3.5" />
              New session in {projectLabel(projects[0])}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Pick a session on the left, or start one from a project's + button.</p>
          )}
        </div>
      )}

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
