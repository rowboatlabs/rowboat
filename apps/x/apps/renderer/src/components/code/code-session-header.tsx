import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, GitBranch, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { CodeSession, CodeSessionStatus, CodeAgentModelOptions } from '@x/shared/src/code-sessions.js'
import type { ApprovalPolicy, EnabledCodingAgent as CodingAgent } from '@x/shared/src/code-mode.js'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fetchCodeAgentOptions, withDefault, optionLabel } from './code-agent-options'
import { refreshCodeSessions } from './use-code-sessions'
import { CODE_PANELS, type CodePanel } from './code-panels'
import { AGENT_LABEL, fetchCodeAgentsStatus, isAgentReady, type CodeAgentsStatus } from './code-agent-status'
const POLICY_LABEL: Record<ApprovalPolicy, string> = {
  ask: 'Ask every time',
  'auto-approve-reads': 'Auto-approve reads',
  yolo: 'Auto-approve everything',
}

export interface CodeSessionHeaderProps {
  session: CodeSession
  status: CodeSessionStatus
  // Uncommitted files in the session's working tree; null while unknown.
  changedCount: number | null
  panel: CodePanel | null
  onTogglePanel: (panel: CodePanel) => void
}

type SessionPatch = { agent?: CodingAgent; policy?: ApprovalPolicy; agentModel?: string; agentEffort?: string; agentMode?: string }

function StatusPill({ status }: { status: CodeSessionStatus }) {
  if (status === 'idle') return null
  const working = status === 'working'
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        working
          ? 'bg-[color-mix(in_oklab,var(--rowboat-git)_12%,transparent)] text-[var(--rowboat-git)]'
          : 'bg-[color-mix(in_oklab,var(--rowboat-attention)_12%,transparent)] text-[var(--rowboat-attention)]',
      )}
    >
      <span className={cn('size-1.5 rounded-full bg-current', !working && 'animate-pulse')} />
      {working ? 'Working' : 'Needs you'}
    </span>
  )
}

// Branch chip for a session working in an isolated worktree. Hovering reveals
// a copy button so the worktree path can be pasted into a terminal or editor
// without hunting for it.
function WorktreeChip({ branch, path }: { branch: string; path: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      toast.success('Worktree path copied')
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error('Could not copy the path')
    }
  }
  return (
    <span
      className="group/wt hidden max-w-56 shrink items-center gap-1 rounded-full bg-muted py-0.5 pl-2 pr-1 text-[11px] text-muted-foreground @[520px]:flex"
    >
      <GitBranch className="size-3 shrink-0" />
      <span className="truncate" title={`${branch}\n${path}`}>{branch}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label="Copy worktree path"
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/wt:opacity-100',
              copied && 'opacity-100 text-[var(--rowboat-git)]',
            )}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{copied ? 'Copied' : 'Copy worktree path'}</TooltipContent>
      </Tooltip>
    </span>
  )
}

// Header of the chat while it is bound to a coding session — the chat is the
// main surface, so this is where the session lives: its title and branch,
// a visible model picker, additional session settings, and the doors to the
// workspace drawer (changes, files, terminal).
export function CodeSessionHeader({ session, status, changedCount, panel, onTogglePanel }: CodeSessionHeaderProps) {
  const [modelOpts, setModelOpts] = useState<CodeAgentModelOptions>({ models: [], efforts: [] })
  const [optionsError, setOptionsError] = useState<string>()
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [openCodeGroup, setOpenCodeGroup] = useState<'go' | 'zen'>()
  useEffect(() => { setOpenCodeGroup(undefined) }, [session.id])
  const [refreshOptions, setRefreshOptions] = useState(0)
  useEffect(() => {
    let cancelled = false
    setModelOpts({ models: [], efforts: [] }); setOptionsError(undefined); setOptionsLoading(true)
    void fetchCodeAgentOptions(session.agent, session.cwd, session.agentModel, session.agentMode)
      .then((opts) => { if (!cancelled) { setModelOpts(opts); setOptionsError(opts.selectionError) } })
      .catch((error: unknown) => { if (!cancelled) setOptionsError(error instanceof Error ? error.message : 'Could not discover model options') })
      .finally(() => { if (!cancelled) setOptionsLoading(false) })
    return () => { cancelled = true }
  }, [session.agent, session.cwd, session.agentModel, session.agentMode, refreshOptions])
  // Which agents can be switched to (cached probe; null until known).
  const [agentsStatus, setAgentsStatus] = useState<CodeAgentsStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    const refreshStatus = () => {
      setRefreshOptions(n => n + 1)
      void fetchCodeAgentsStatus().then((s) => { if (!cancelled) setAgentsStatus(s) }).catch(() => {})
    }
    void fetchCodeAgentsStatus().then((s) => { if (!cancelled) setAgentsStatus(s) }).catch(() => {})
    window.addEventListener('opencode-configuration-changed', refreshStatus)
    return () => { cancelled = true; window.removeEventListener('opencode-configuration-changed', refreshStatus) }
  }, [])

  const update = async (patch: SessionPatch) => {
    setUpdating(true)
    try {
      await window.ipc.invoke('codeSession:update', { sessionId: session.id, patch })
      await refreshCodeSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update session')
    } finally {
      setUpdating(false)
    }
  }

  const worktreeActive = session.worktree && !session.worktree.removedAt
  const setDone = async (done: boolean) => {
    try {
      await window.ipc.invoke('codeSession:setDone', { sessionId: session.id, done })
      await refreshCodeSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update session')
    }
  }
  const allModels = session.agent === 'opencode' ? modelOpts.models : withDefault(modelOpts.models)
  const providers = modelOpts.openCodeProviders ?? []
  const bothServices = session.agent === 'opencode' && providers.includes('go') && providers.includes('zen')
  const activeGroup = bothServices ? (openCodeGroup ?? (session.agentModel?.startsWith('opencode-go/') ? 'go' : 'zen')) : providers[0]
  const models = bothServices ? allModels.filter(model => model.value.startsWith(activeGroup === 'go' ? 'opencode-go/' : 'opencode/')) : allModels
  const efforts = session.agent === 'opencode' ? modelOpts.efforts : withDefault(modelOpts.efforts)
  const selectedModel = session.agentModel ?? modelOpts.currentModel
  const modelLabel = selectedModel ? optionLabel(allModels, selectedModel) : 'Choose model'
  const configurationLocked = updating || status !== 'idle'

  return (
    <div className="titlebar-no-drag flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-3 pr-1 @container">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={session.title}>{session.title}</span>
        <StatusPill status={status} />
        {worktreeActive && session.worktree && (
          <WorktreeChip branch={session.worktree.branch} path={session.worktree.path} />
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Choose coding model" title={modelLabel} className="h-7 min-w-0 max-w-52 shrink gap-1 px-2 text-xs">
            <span className="shrink-0">Model:</span>
            <span className="truncate">{updating ? 'Applying...' : optionsLoading ? 'Loading...' : modelLabel}</span>
            <ChevronDown className="size-3 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
          <DropdownMenuLabel>{AGENT_LABEL[session.agent]} models</DropdownMenuLabel>
          {bothServices && <div className="flex gap-1 px-2 pb-2" role="group" aria-label="OpenCode service">
            {(['zen', 'go'] as const).map(group => <Button key={group} size="sm" variant={activeGroup === group ? 'secondary' : 'ghost'} aria-pressed={activeGroup === group} onClick={() => setOpenCodeGroup(group)}>{group === 'go' ? 'Go' : 'Zen'}</Button>)}
          </div>}
          {!bothServices && activeGroup && <p className="px-2 pb-1 text-xs text-muted-foreground">{activeGroup === 'free' ? 'Free models — no OpenCode account connected' : activeGroup === 'go' ? 'Go subscription models' : 'Zen models'}</p>}
          {optionsLoading && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Loading models from the coding agent...</p>}
          {optionsError && <p role="alert" className="px-2 py-1 text-xs text-destructive">{optionsError}</p>}
          {!optionsLoading && !models.length && !optionsError && <p className="px-2 py-1 text-xs text-muted-foreground">No models are available. Refresh to try again.</p>}
          {configurationLocked && <p className="px-2 py-1 text-xs text-muted-foreground">{updating ? 'Applying your selection...' : 'Stop the current operation before changing models.'}</p>}
          <DropdownMenuRadioGroup value={selectedModel} onValueChange={value => void update({ agentModel: value })}>
            {!optionsLoading && models.map(model => <DropdownMenuRadioItem key={model.value} value={model.value} disabled={configurationLocked}>{model.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={optionsLoading || updating} onSelect={event => { event.preventDefault(); setRefreshOptions(n => n + 1) }}>Refresh models</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Additional session configuration. Models are directly accessible above. */}
      <DropdownMenu onOpenChange={(open) => { if (open && session.agent === 'opencode') setRefreshOptions(n => n + 1) }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Coding session settings" className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground">
                <SlidersHorizontal className="size-3.5" />
                <span className="hidden @[400px]:inline">{AGENT_LABEL[session.agent] ?? session.agent}</span>
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Agent, mode, effort and approvals for this session</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span>{AGENT_LABEL[session.agent] ?? session.agent}</span>
            <span className="truncate font-mono text-[11px] font-normal text-muted-foreground" title={session.cwd}>
              {session.cwd}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {optionsError && <p role="alert" className="px-2 py-1 text-xs text-destructive">{optionsError}</p>}
          {session.agent === 'opencode' && <p className="px-2 py-1 text-xs text-muted-foreground">Approvals apply once. Subagent tasks are unavailable.</p>}
          {/* A quick-created session lands on the last-used agent; switching
              here starts the other engine fresh on the next turn. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="flex-1">Agent</span>
              <span className="ml-3 truncate text-xs text-muted-foreground">{AGENT_LABEL[session.agent] ?? session.agent}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={session.agent}
                  onValueChange={(v) => void update({ agent: v as CodingAgent })}
                >
                  {(['claude', 'codex', 'opencode'] as CodingAgent[]).map((agent) => (
                    <DropdownMenuRadioItem
                      key={agent}
                      value={agent}
                      disabled={agentsStatus !== null && !isAgentReady(agentsStatus, agent)}
                    >
                      {AGENT_LABEL[agent]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          {!!modelOpts.modes?.length && <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="flex-1">Mode</span>
              <span className="ml-3 text-xs text-muted-foreground">{optionLabel(modelOpts.modes, session.agentMode ?? modelOpts.currentMode)}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal><DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={session.agentMode ?? modelOpts.currentMode} onValueChange={v => void update({ agentMode: v })}>
                {modelOpts.modes.map(mode => <DropdownMenuRadioItem key={mode.value} value={mode.value}>{mode.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent></DropdownMenuPortal>
          </DropdownMenuSub>}
          {modelOpts.efforts.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">Effort</span>
                <span className="ml-3 truncate text-xs text-muted-foreground">{optionLabel(efforts, session.agentEffort ?? modelOpts.currentEffort)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={session.agentEffort ?? modelOpts.currentEffort ?? 'default'}
                    onValueChange={(v) => void update({ agentEffort: v })}
                  >
                    {efforts.map((e) => (
                      <DropdownMenuRadioItem key={e.value} value={e.value}>{e.label}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="flex-1">Approvals</span>
              <span className="ml-3 truncate text-xs text-muted-foreground">
                {session.policy ? POLICY_LABEL[session.policy] : 'Auto'}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={session.policy ?? ''}
                  onValueChange={(v) => void update({ policy: v as ApprovalPolicy })}
                >
                  {(Object.keys(POLICY_LABEL) as ApprovalPolicy[]).map((policy) => (
                    <DropdownMenuRadioItem key={policy} value={policy}>{POLICY_LABEL[policy]}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {!session.policy && (
                  <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-muted-foreground">
                    Auto: follows the composer chip and the global setting until you pick one here.
                  </p>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          {/* Done files the session under the rail's Done pile; the chat,
              worktree and branch stay. Reopen brings it back. */}
          <DropdownMenuItem onClick={() => void setDone(!session.doneAt)}>
            {session.doneAt ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
            {session.doneAt ? 'Reopen' : 'Mark as done'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />

      {/* Doors to the workspace drawer. Clicking the open one closes it. */}
      {CODE_PANELS.map(({ id, label, icon: Icon }) => {
        const active = panel === id
        const badge = id === 'changes' && changedCount ? changedCount : null
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onTogglePanel(id)}
                aria-pressed={active}
                aria-label={label}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  active && 'bg-accent text-foreground',
                )}
              >
                <Icon className="size-4" />
                {badge !== null && <span className="text-[11px] tabular-nums">{badge}</span>}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{active ? `Hide ${label.toLowerCase()}` : label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
