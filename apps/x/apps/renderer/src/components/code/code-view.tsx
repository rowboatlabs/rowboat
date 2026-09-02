import { useCallback, useEffect, useState } from 'react'
import { Code2 } from 'lucide-react'
import type { CodeSession, CodeSessionStatus } from '@x/shared/src/code-sessions.js'
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
import { useCodeSessions } from './use-code-sessions'
import { SessionRail, CODE_RAIL_WIDTH } from './session-rail'
import { NewSessionDialog } from './new-session-dialog'

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
}: {
  onSessionSelected?: (active: ActiveCodeSession | null) => void
  // Deep-link from elsewhere (a Home Deck strip): select this session on
  // mount/change instead of the remembered one.
  focusSessionId?: string | null
  onFocusConsumed?: () => void
}) {
  const { projects, sessions, statusOf, refresh } = useCodeSessions()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(readStoredSelectedSessionId)

  useEffect(() => {
    if (!focusSessionId) return
    setSelectedSessionId(focusSessionId)
    onFocusConsumed?.()
  }, [focusSessionId, onFocusConsumed])
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CodeSession | null>(null)

  useEffect(() => {
    if (selectedSessionId) window.localStorage.setItem(SELECTED_SESSION_STORAGE_KEY, selectedSessionId)
    else window.localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY)
  }, [selectedSessionId])

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null
  const selectedStatus = selectedSession ? statusOf(selectedSession.id) : 'idle'
  const newSessionProject = projects.find((p) => p.project.id === newSessionProjectId) ?? null

  // Tell App which session (and status) owns the chat.
  useEffect(() => {
    onSessionSelected?.(selectedSession ? { session: selectedSession, status: selectedStatus } : null)
  }, [selectedSession, selectedStatus, onSessionSelected])

  // Leaving the Code section unmounts this view — release the chat.
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

  return (
    <div className="flex h-full min-h-0">
      {/* Session rail. With a session selected this IS the middle pane (App
          sizes the pane to the rail); without one the empty state fills the
          rest and the chat pane stays out of the way. */}
      <div
        className={selectedSession ? 'min-w-0 flex-1' : 'shrink-0 border-r border-border'}
        style={selectedSession ? undefined : { width: CODE_RAIL_WIDTH }}
      >
        <SessionRail
          projects={projects}
          sessions={sessions}
          statusOf={statusOf}
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
          onNewSession={setNewSessionProjectId}
          onDeleteSession={setDeleteTarget}
        />
      </div>

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
          ) : (
            <p className="text-xs text-muted-foreground">Pick a session on the left, or create a new one.</p>
          )}
        </div>
      )}

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
