import { useEffect, useState } from 'react'
import { ChevronDown, GitBranch, SlidersHorizontal } from 'lucide-react'
import type { CodeSession, CodeSessionStatus, CodeAgentModelOptions } from '@x/shared/src/code-sessions.js'
import type { ApprovalPolicy, CodingAgent } from '@x/shared/src/code-mode.js'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
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

type SessionPatch = { agent?: CodingAgent; policy?: ApprovalPolicy; agentModel?: string; agentEffort?: string }

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

// Header of the chat while it is bound to a coding session — the chat is the
// main surface, so this is where the session lives: its title and branch,
// the agent's model / effort / approvals in one menu, and the doors to the
// workspace drawer (changes, files, terminal).
export function CodeSessionHeader({ session, status, changedCount, panel, onTogglePanel }: CodeSessionHeaderProps) {
  const [modelOpts, setModelOpts] = useState<CodeAgentModelOptions>({ models: [], efforts: [] })
  useEffect(() => {
    let cancelled = false
    void fetchCodeAgentOptions(session.agent).then((opts) => { if (!cancelled) setModelOpts(opts) })
    return () => { cancelled = true }
  }, [session.agent])
  // Which agents can be switched to (cached probe; null until known).
  const [agentsStatus, setAgentsStatus] = useState<CodeAgentsStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchCodeAgentsStatus().then((s) => { if (!cancelled) setAgentsStatus(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const update = async (patch: SessionPatch) => {
    try {
      await window.ipc.invoke('codeSession:update', { sessionId: session.id, patch })
      await refreshCodeSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update session')
    }
  }

  const worktreeActive = session.worktree && !session.worktree.removedAt
  const models = withDefault(modelOpts.models)
  const efforts = withDefault(modelOpts.efforts)

  return (
    <div className="titlebar-no-drag flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-3 pr-1 @container">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={session.title}>{session.title}</span>
        <StatusPill status={status} />
        {worktreeActive && (
          <span
            className="hidden max-w-48 shrink items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground @[520px]:flex"
            title={session.worktree?.branch}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{session.worktree?.branch}</span>
          </span>
        )}
      </div>

      {/* Session settings: one menu, three choices. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground">
                <SlidersHorizontal className="size-3.5" />
                <span className="hidden @[400px]:inline">{AGENT_LABEL[session.agent] ?? session.agent}</span>
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Model, effort and approvals for this session</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span>{AGENT_LABEL[session.agent] ?? session.agent}</span>
            <span className="truncate font-mono text-[11px] font-normal text-muted-foreground" title={session.cwd}>
              {session.cwd}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
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
                  {(['claude', 'codex'] as CodingAgent[]).map((agent) => (
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="flex-1">Model</span>
              <span className="ml-3 truncate text-xs text-muted-foreground">{optionLabel(models, session.agentModel)}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                <DropdownMenuRadioGroup
                  value={session.agentModel ?? 'default'}
                  onValueChange={(v) => void update({ agentModel: v })}
                >
                  {models.map((m) => (
                    <DropdownMenuRadioItem key={m.value} value={m.value}>{m.label}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          {modelOpts.efforts.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">Effort</span>
                <span className="ml-3 truncate text-xs text-muted-foreground">{optionLabel(efforts, session.agentEffort)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={session.agentEffort ?? 'default'}
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
