import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronUp, Code2, GitBranch, Terminal as TerminalIcon } from 'lucide-react'
import type { CodeSession, CodeSessionStatus, CodeAgentModelOptions } from '@x/shared/src/code-sessions.js'
import { fetchCodeAgentOptions, withDefault, optionLabel } from './code-agent-options'
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
import { TerminalPane } from './terminal-pane'

const TERMINAL_HEIGHT_STORAGE_KEY = 'x:code-terminal-height'
const TERMINAL_MIN_HEIGHT = 120
const TERMINAL_MAX_HEIGHT = 600

// Remember which session was open so leaving the Code section (which unmounts
// this view) and coming back restores the selection — and with it the chat
// output in the right pane — instead of dropping back to the empty state.
const SELECTED_SESSION_STORAGE_KEY = 'x:code-selected-session'

function readStoredSelectedSessionId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(SELECTED_SESSION_STORAGE_KEY) || null
}

function readStoredTerminalHeight(): number {
  if (typeof window === 'undefined') return 240
  const raw = Number(window.localStorage.getItem(TERMINAL_HEIGHT_STORAGE_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return 240
  return Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, raw))
}

const AGENT_LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }
const POLICY_LABEL: Record<ApprovalPolicy, string> = {
  ask: 'Ask every time',
  'auto-approve-reads': 'Auto-approve reads',
  yolo: 'Auto-approve everything',
}
const POLICY_HEADER_LABEL: Record<ApprovalPolicy, string> = {
  ask: 'Ask',
  'auto-approve-reads': 'Auto reads',
  yolo: 'Auto all',
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(readStoredSelectedSessionId)
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CodeSession | null>(null)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(readStoredTerminalHeight)
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null)

  useEffect(() => {
    window.localStorage.setItem(TERMINAL_HEIGHT_STORAGE_KEY, String(terminalHeight))
  }, [terminalHeight])

  useEffect(() => {
    if (selectedSessionId) window.localStorage.setItem(SELECTED_SESSION_STORAGE_KEY, selectedSessionId)
    else window.localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY)
  }, [selectedSessionId])

  const handleTerminalDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStateRef.current = { startY: e.clientY, startHeight: terminalHeight }
    const onMove = (event: MouseEvent) => {
      const drag = dragStateRef.current
      if (!drag) return
      // Terminal sits at the bottom: dragging up grows it.
      const next = drag.startHeight + (drag.startY - event.clientY)
      setTerminalHeight(Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, next)))
    }
    const onUp = () => {
      dragStateRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [terminalHeight])

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null
  const selectedStatus = selectedSession ? statusOf(selectedSession.id) : 'idle'
  const newSessionProject = projects.find((p) => p.project.id === newSessionProjectId) ?? null

  // Live model/effort choices for the selected session's agent, for the header
  // pickers. Discovered from the engine and cached, so this is cheap to re-run.
  const [modelOpts, setModelOpts] = useState<CodeAgentModelOptions>({ models: [], efforts: [] })
  const selectedAgent = selectedSession?.agent
  useEffect(() => {
    if (!selectedAgent) { setModelOpts({ models: [], efforts: [] }); return }
    let cancelled = false
    void fetchCodeAgentOptions(selectedAgent).then((opts) => { if (!cancelled) setModelOpts(opts) })
    return () => { cancelled = true }
  }, [selectedAgent])

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

  const handleUpdateSession = useCallback(async (patch: { mode?: 'direct' | 'rowboat'; policy?: ApprovalPolicy; agent?: 'claude' | 'codex'; agentModel?: string; agentEffort?: string }) => {
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
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b px-4 py-2.5">
              <div className="min-w-64 flex-[1_1_360px]">
                <div className="truncate text-sm font-medium">{selectedSession.title}</div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="shrink-0 whitespace-nowrap">{AGENT_LABEL[selectedSession.agent]}</span>
                  <span className="shrink-0 text-muted-foreground/50">·</span>
                  <span className="min-w-0 max-w-full flex-1 truncate font-mono" title={selectedSession.cwd}>{selectedSession.cwd}</span>
                  {selectedSession.worktree && !selectedSession.worktree.removedAt && (
                    <span className="flex min-w-0 max-w-72 shrink items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
                      <GitBranch className="size-3" />
                      <span className="truncate">{selectedSession.worktree.branch}</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                      title="Coding agent model"
                    >
                      <span className="whitespace-nowrap">{optionLabel(modelOpts.models, selectedSession.agentModel)}</span>
                      <ChevronDown className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                    {withDefault(modelOpts.models).map((m) => (
                      <DropdownMenuItem key={m.value} onClick={() => void handleUpdateSession({ agentModel: m.value })}>
                        {m.label}
                        {(selectedSession.agentModel ?? 'default') === m.value && <span className="ml-auto">✓</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {modelOpts.efforts.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                        title="Reasoning effort"
                      >
                        <span className="whitespace-nowrap">{optionLabel(modelOpts.efforts, selectedSession.agentEffort)}</span>
                        <ChevronDown className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {withDefault(modelOpts.efforts).map((e) => (
                        <DropdownMenuItem key={e.value} onClick={() => void handleUpdateSession({ agentEffort: e.value })}>
                          {e.label}
                          {(selectedSession.agentEffort ?? 'default') === e.value && <span className="ml-auto">✓</span>}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                      title={POLICY_LABEL[selectedSession.policy]}
                    >
                      <span className="whitespace-nowrap">{POLICY_HEADER_LABEL[selectedSession.policy]}</span>
                      <ChevronDown className="size-3" />
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
                  <span className="whitespace-nowrap">Rowboat drives</span>
                  <Switch
                    checked={selectedSession.mode === 'rowboat'}
                    disabled={busy}
                    onCheckedChange={(checked) => void handleUpdateSession({ mode: checked ? 'rowboat' : 'direct' })}
                  />
                </label>
              </div>
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

            {/* Embedded terminal — a real shell in the session's directory
                (worktree included). The PTY lives in the main process and
                survives collapsing this panel. */}
            <div className="shrink-0 border-t">
              {terminalOpen && (
                <div
                  onMouseDown={handleTerminalDragStart}
                  className="h-1 cursor-row-resize bg-transparent transition-colors hover:bg-sidebar-border"
                />
              )}
              <button
                type="button"
                onClick={() => setTerminalOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <TerminalIcon className="size-3.5" />
                <span className="font-medium">Terminal</span>
                {selectedSession.worktree && !selectedSession.worktree.removedAt && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">worktree</span>
                )}
                <span className="flex-1" />
                {terminalOpen ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
              </button>
              {terminalOpen && (
                <div style={{ height: terminalHeight }}>
                  <TerminalPane
                    key={selectedSession.id}
                    terminalId={selectedSession.id}
                    cwd={selectedSession.cwd}
                  />
                </div>
              )}
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
