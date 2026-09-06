import { useEffect, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  FolderPlus,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import type { CodeSession, CodeSessionStatus } from '@x/shared/src/code-sessions.js'
import type { CodingAgent } from '@x/shared/src/code-mode.js'
import { cn, compactPath, parentPath } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { SecondaryRail } from '@/components/secondary-rail'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { projectLabel, type ProjectRow } from './use-code-sessions'
import { AGENT_LABEL, isAgentReady, type CodeAgentsStatus } from './code-agent-status'

// The Done pile shows this many before asking for "Show all" — a display
// cap, never a deletion policy.
const DONE_VISIBLE_LIMIT = 25
const DONE_OPEN_STORAGE_KEY = 'x:code-done-open'

function readDoneOpen(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(DONE_OPEN_STORAGE_KEY) === '1'
}

// The dot in each card's gutter carries the session's state: quiet grey at
// rest, the git accent rippling softly while an agent works (see
// `.code-working-dot` in App.css), the attention color pulsing when the
// session waits on the user. Color and motion do the talking — no words,
// and nothing lights the card itself.
function StatusDot({ status }: { status: CodeSessionStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-1.5 size-2 shrink-0 rounded-full',
        status === 'working' && 'code-working-dot bg-[var(--rowboat-git)]',
        status === 'needs-you' && 'animate-pulse bg-[var(--rowboat-attention)]',
        status === 'idle' && 'bg-muted-foreground/40',
      )}
    />
  )
}

// One session card: two lines — the title, then the agent running it —
// behind a status dot. The worktree branch stays off the card (it's in
// the tooltip and the session header's chip). Active cards show the time
// and, on hover, a check (mark done) beside the menu; done cards show
// when they were finished and a reopen arrow instead. Cards keep their
// looks in either pile — only the heading above them changes.
function SessionRow({
  session,
  status,
  selected,
  done,
  prefix,
  indent,
  onSelect,
  onSetDone,
  onDelete,
}: {
  session: CodeSession
  status: CodeSessionStatus
  selected: boolean
  done: boolean
  // A project label, for the flat Done pile where rows mix projects.
  prefix?: string
  indent: boolean
  onSelect: () => void
  onSetDone: (done: boolean) => void
  onDelete: () => void
}) {
  const worktree = session.worktree && !session.worktree.removedAt ? session.worktree : undefined
  const when = formatRelativeTime((done && session.doneAt) || session.lastActivityAt || session.createdAt)
  // The second line: the agent — short and constant, so every card keeps
  // its two-line shape without the branch noise.
  const detail = AGENT_LABEL[session.agent] ?? session.agent
  const ToggleIcon = done ? RotateCcw : Check
  const toggleLabel = done ? 'Reopen' : 'Mark as done'
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${session.title}\n${AGENT_LABEL[session.agent] ?? session.agent}${worktree ? ` · ${worktree.branch}` : ''}`}
      className={cn(
        'group relative mt-0.5 flex cursor-pointer items-start gap-2.5 rounded-lg py-1.5 pl-2.5 pr-1.5',
        indent && 'ml-3',
        selected ? 'bg-accent text-foreground' : 'hover:bg-accent/60',
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <StatusDot status={done ? 'idle' : status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[13px] leading-5', selected ? 'font-medium' : 'text-foreground/90')}>
            {prefix && <span className="text-muted-foreground">{prefix} · </span>}
            {session.title}
          </span>
          {/* The time's slot is exactly as wide as the hover actions, so the
              actions replace the time — never the title beside it. */}
          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70 transition-opacity group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0">
            {when}
          </span>
        </div>
        <div className="truncate text-[11px] leading-4 text-muted-foreground/70">{detail}</div>
      </div>
      {/* Hover actions sit in the time's reserved slot so the card never
          reflows and nothing overlaps the text. */}
      <div className="absolute right-1.5 top-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onSetDone(!done) }}
              aria-label={toggleLabel}
            >
              <ToggleIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{toggleLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 shrink-0 p-0 text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
              aria-label="Session actions"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onSetDone(!done)}>
              <ToggleIcon className="size-4" />
              {toggleLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete}>
              <Trash2 className="size-4" />
              Delete session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// Left rail of the Code section: registered projects with their active
// sessions as two-line cards (title, then agent), attention-first, and a
// Done pile pinned to the bottom. Status lives in each card's gutter dot —
// the working session's ripples (see `.code-working-dot` in App.css) so it
// can be found at a glance even when it is not the selected one. The rail
// chrome (docked width + drag-resize, persisted) is the shared
// SecondaryRail shell that Spaces and Email use; this file owns only
// what's IN the rail.
export function SessionRail({
  projects,
  sessions,
  statusOf,
  agentsStatus,
  selectedSessionId,
  onSelectSession,
  onAddProject,
  onRemoveProject,
  onNewSession,
  onSetDone,
  onDeleteSession,
  onWidthChange,
  className,
}: {
  projects: ProjectRow[]
  sessions: CodeSession[]
  statusOf: (sessionId: string) => CodeSessionStatus
  // Null while the probe is still running — entries stay enabled until known.
  agentsStatus: CodeAgentsStatus | null
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
  // No agent = the default (last used, whichever is ready).
  onNewSession: (projectId: string, agent?: CodingAgent) => void
  onSetDone: (session: CodeSession, done: boolean) => void
  onDeleteSession: (session: CodeSession) => void
  /** The shell reports the rail's (drag-resizable, persisted) width here so
   *  App can size the code middle pane to it. */
  onWidthChange?: (width: number) => void
  /** Extra classes for the shell's aside — CodeView drops the right border
   *  while the chat pane beside it draws the divider. */
  className?: string
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleCollapsed = (projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }
  const [doneOpen, setDoneOpen] = useState(readDoneOpen)
  const [showAllDone, setShowAllDone] = useState(false)
  useEffect(() => {
    window.localStorage.setItem(DONE_OPEN_STORAGE_KEY, doneOpen ? '1' : '0')
  }, [doneOpen])

  const active = sessions.filter((s) => !s.doneAt)
  // Newest finished first. The store's order is attention-first for the
  // active list; finished work is a timeline.
  const done = sessions
    .filter((s) => s.doneAt)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
  const visibleDone = showAllDone ? done : done.slice(0, DONE_VISIBLE_LIMIT)
  const labelByProject = new Map(projects.map((row) => [row.project.id, projectLabel(row)]))

  // The rail's content — the shell renders it at the docked width.
  const body = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border pl-3 pr-1.5">
        <span className="text-[13px] text-muted-foreground">Projects</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground" onClick={onAddProject}>
              <FolderPlus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add a project folder</TooltipContent>
        </Tooltip>
      </div>

      {/* Active work: projects with their sessions. Scrolls on its own. */}
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {projects.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
            <FolderGit2 className="size-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Add a project folder to start running coding agents on it.
            </p>
            <Button size="sm" variant="outline" onClick={onAddProject}>
              <FolderPlus className="size-3.5" />
              Add project
            </Button>
          </div>
        )}
        {projects.map((row) => {
          const { project } = row
          const label = labelByProject.get(project.id) ?? project.name
          // Repo-relative labels are distinctive on their own; only a bare
          // folder name needs its parent to stay tellable-apart.
          const parentHint = row.git.root ? '' : parentPath(project.path)
          const projectSessions = active.filter((s) => s.projectId === project.id)
          const isCollapsed = collapsed.has(project.id)
          // A collapsed group still surfaces its live sessions — attention
          // must not hide behind a chevron.
          const visibleSessions = isCollapsed
            ? projectSessions.filter((s) => statusOf(s.id) !== 'idle' || s.id === selectedSessionId)
            : projectSessions
          return (
            <div key={project.id} className="mb-2">
              <div className="group flex h-8 items-center gap-1 rounded-lg pl-1 pr-1 hover:bg-accent/60">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(project.id)}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground"
                  aria-label={isCollapsed ? 'Expand project' : 'Collapse project'}
                >
                  {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
                {/* Deliberate hover delay — the full path is reference info,
                    not something that should pop up on a passing cursor. */}
                <Tooltip delayDuration={1000}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(project.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" dir="rtl">
                        {/* Right-to-left truncation: when the label doesn't fit,
                            the leaf folder — the part that tells packages apart —
                            survives and the ellipsis eats the root end. */}
                        <span dir="ltr">
                          {label}
                          {parentHint && (
                            <span className="ml-1.5 font-normal text-muted-foreground/60">
                              {compactPath(parentHint, 22)}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[420px] break-all font-mono text-xs">
                    {project.path}
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => onNewSession(project.id)}
                  title="New session"
                >
                  <Plus className="size-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => onNewSession(project.id)}>
                      <Plus className="size-4" />
                      New session
                    </DropdownMenuItem>
                    {/* The explicit picks — the plain entry (and the + button)
                        take the agent you last worked with. */}
                    {(['claude', 'codex'] as CodingAgent[]).map((agent) => (
                      <DropdownMenuItem
                        key={agent}
                        disabled={agentsStatus !== null && !isAgentReady(agentsStatus, agent)}
                        onClick={() => onNewSession(project.id, agent)}
                      >
                        <span className="size-4" />
                        New {AGENT_LABEL[agent]} session
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onRemoveProject(project.id)}>
                      <Trash2 className="size-4" />
                      Remove project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {!isCollapsed && projectSessions.length === 0 && (
                <button
                  type="button"
                  onClick={() => onNewSession(project.id)}
                  className="ml-6 flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <Plus className="size-3" />
                  New session
                </button>
              )}
              {visibleSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  status={statusOf(session.id)}
                  selected={selectedSessionId === session.id}
                  done={false}
                  indent
                  onSelect={() => onSelectSession(session.id)}
                  onSetDone={(value) => onSetDone(session, value)}
                  onDelete={() => onDeleteSession(session)}
                />
              ))}
            </div>
          )
        })}
      </div>

      {/* Done: pinned to the bottom edge. Collapsed it is one row; expanded
          it takes at most a third of the rail with its own scroll, so
          opening it never pushes active sessions out of view. */}
      {done.length > 0 && (
        <div
          className={cn(
            'shrink-0 border-t border-border',
            doneOpen && 'flex max-h-[36%] min-h-0 flex-col',
          )}
        >
          <button
            type="button"
            onClick={() => setDoneOpen((v) => !v)}
            className="flex h-9 w-full shrink-0 items-center gap-1.5 px-2 text-[13px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            aria-expanded={doneOpen}
          >
            {doneOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            <span>Done</span>
            <span className="tabular-nums text-muted-foreground/70">{done.length}</span>
          </button>
          {doneOpen && (
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
              {visibleDone.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  status={statusOf(session.id)}
                  selected={selectedSessionId === session.id}
                  done
                  prefix={labelByProject.get(session.projectId)}
                  indent={false}
                  onSelect={() => onSelectSession(session.id)}
                  onSetDone={(value) => onSetDone(session, value)}
                  onDelete={() => onDeleteSession(session)}
                />
              ))}
              {done.length > DONE_VISIBLE_LIMIT && !showAllDone && (
                <button
                  type="button"
                  onClick={() => setShowAllDone(true)}
                  className="mt-1 flex h-7 w-full items-center rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  Show all {done.length}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    // Always docked: the middle pane above this rail (header + chat binding)
    // sizes itself to the rail, so the collapsed-sliver/peek mode the shell
    // offers Spaces and Email has nowhere to go here yet.
    <SecondaryRail open onTogglePin={() => {}} widthStorageKey="code:railWidth" onWidthChange={onWidthChange} className={className}>
      {() => body}
    </SecondaryRail>
  )
}
