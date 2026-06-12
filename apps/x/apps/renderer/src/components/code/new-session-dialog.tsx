import { useEffect, useState } from 'react'
import { Bot, GitBranch, Loader2, Terminal } from 'lucide-react'
import type { CodeSession, CodeSessionMode } from '@x/shared/src/code-sessions.js'
import type { ApprovalPolicy, CodingAgent } from '@x/shared/src/code-mode.js'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProjectRow } from './use-code-sessions'

type AgentStatus = { installed: boolean; signedIn: boolean }
type ModelOption = { provider: string; model: string }

const POLICY_LABEL: Record<ApprovalPolicy, string> = {
  ask: 'Ask every time',
  'auto-approve-reads': 'Auto-approve reads',
  yolo: 'Auto-approve everything (YOLO)',
}

// Models the user can pick for Rowboat-mode turns — mirrors the chat
// composer's loading: gateway list when signed in, models.json otherwise.
async function loadModelOptions(): Promise<ModelOption[]> {
  try {
    const oauth = await window.ipc.invoke('oauth:getState', null)
    const connected = oauth.config?.rowboat?.connected ?? false
    if (connected) {
      const listResult = await window.ipc.invoke('models:list', null)
      const rowboatProvider = (listResult.providers as Array<{ id: string; models?: Array<{ id: string }> }> | undefined)
        ?.find((p) => p.id === 'rowboat')
      return (rowboatProvider?.models ?? []).map((m) => ({ provider: 'rowboat', model: m.id }))
    }
    const result = await window.ipc.invoke('workspace:readFile', { path: 'config/models.json' })
    const parsed = JSON.parse(result.data)
    const models: ModelOption[] = []
    if (parsed?.providers) {
      for (const [flavor, entry] of Object.entries(parsed.providers)) {
        const e = entry as Record<string, unknown>
        const modelList: string[] = Array.isArray(e.models) ? e.models as string[] : []
        const singleModel = typeof e.model === 'string' ? e.model : ''
        const allModels = modelList.length > 0 ? modelList : singleModel ? [singleModel] : []
        for (const model of allModels) {
          if (model) models.push({ provider: flavor, model })
        }
      }
    }
    return models
  } catch {
    return []
  }
}

export function NewSessionDialog({
  projectRow,
  open,
  onOpenChange,
  onCreated,
}: {
  projectRow: ProjectRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (session: CodeSession) => void
}) {
  const [agentStatus, setAgentStatus] = useState<{ claude: AgentStatus; codex: AgentStatus } | null>(null)
  const [agent, setAgent] = useState<CodingAgent>('claude')
  // Rowboat drives by default — direct CLI access is the power-user opt-in.
  const [mode, setMode] = useState<CodeSessionMode>('rowboat')
  const [policy, setPolicy] = useState<ApprovalPolicy>('auto-approve-reads')
  const [isolation, setIsolation] = useState<'in-repo' | 'worktree'>('in-repo')
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  // 'default' = let the backend use the configured default model.
  const [modelKey, setModelKey] = useState('default')

  const git = projectRow?.git
  const worktreeAvailable = !!git?.isGitRepo && !!git?.hasCommits

  useEffect(() => {
    if (!open) return
    setTitle('')
    setCreating(false)
    setIsolation('in-repo')
    setMode('rowboat')
    setModelKey('default')
    void loadModelOptions().then(setModelOptions)
    void window.ipc.invoke('codeMode:checkAgentStatus', null).then((status) => {
      setAgentStatus(status)
      // Default to whichever agent is actually ready.
      const claudeReady = status.claude.installed && status.claude.signedIn
      const codexReady = status.codex.installed && status.codex.signedIn
      if (!claudeReady && codexReady) setAgent('codex')
      else setAgent('claude')
    })
  }, [open])

  const agentReady = (a: CodingAgent): boolean => {
    if (!agentStatus) return true
    const s = agentStatus[a]
    return s.installed && s.signedIn
  }

  const handleCreate = async () => {
    if (!projectRow) return
    setCreating(true)
    try {
      const picked = modelKey !== 'default'
        ? modelOptions.find((m) => `${m.provider}/${m.model}` === modelKey)
        : undefined
      const res = await window.ipc.invoke('codeSession:create', {
        projectId: projectRow.project.id,
        title: title.trim() || undefined,
        agent,
        mode,
        policy,
        isolation,
        ...(picked ? { model: picked.model, provider: picked.provider } : {}),
      })
      onOpenChange(false)
      onCreated(res.session)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New coding session</DialogTitle>
          <DialogDescription>
            {projectRow ? <span className="font-mono text-xs">{projectRow.project.path}</span> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Name (optional)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fix flaky auth tests"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Coding agent</label>
            <div className="grid grid-cols-2 gap-2">
              {(['claude', 'codex'] as const).map((a) => {
                const ready = agentReady(a)
                return (
                  <button
                    key={a}
                    type="button"
                    disabled={!ready}
                    onClick={() => setAgent(a)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      agent === a ? 'border-foreground bg-muted' : 'hover:bg-muted/60',
                      !ready && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <div className="font-medium">{a === 'claude' ? 'Claude Code' : 'Codex'}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {ready ? 'Ready' : agentStatus?.[a]?.installed ? 'Not signed in' : 'Not installed'}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Who drives</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('rowboat')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  mode === 'rowboat' ? 'border-foreground bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <Bot className="size-3.5" />
                  Rowboat
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Full assistant chat — Rowboat plans, runs the agent, and can use your knowledge.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode('direct')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  mode === 'direct' ? 'border-foreground bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <Terminal className="size-3.5" />
                  Direct
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Talk straight to the coding agent — no assistant in between.
                </div>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Where it works</label>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setIsolation('in-repo')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  isolation === 'in-repo' ? 'border-foreground bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <div className="font-medium">Directly in the project</div>
                <div className="text-[11px] text-muted-foreground">Changes land in your working tree.</div>
              </button>
              <button
                type="button"
                disabled={!worktreeAvailable}
                onClick={() => setIsolation('worktree')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  isolation === 'worktree' ? 'border-foreground bg-muted' : 'hover:bg-muted/60',
                  !worktreeAvailable && 'cursor-not-allowed opacity-50',
                )}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <GitBranch className="size-3.5" />
                  Isolated worktree
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {worktreeAvailable
                    ? 'Works on its own branch — safe to run sessions in parallel; merge back when done.'
                    : 'Needs a git repository with at least one commit.'}
                </div>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Approvals</label>
            <Select value={policy} onValueChange={(v) => setPolicy(v as ApprovalPolicy)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(POLICY_LABEL) as ApprovalPolicy[]).map((p) => (
                  <SelectItem key={p} value={p}>{POLICY_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              How the coding agent's file edits and commands get approved — applies in both modes.
            </p>
          </div>

          {/* The model only powers Rowboat's own turns; the coding agent uses its
              own configured model, so hide this entirely for direct sessions. */}
          {mode === 'rowboat' && modelOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Model</label>
              <Select value={modelKey} onValueChange={setModelKey}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default model</SelectItem>
                  {modelOptions.map((m) => {
                    const key = `${m.provider}/${m.model}`
                    return <SelectItem key={key} value={key}>{m.model}</SelectItem>
                  })}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Used when Rowboat drives. Fixed once the session is created, like any chat.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleCreate()} disabled={creating || !projectRow || !agentReady(agent)}>
            {creating && <Loader2 className="size-4 animate-spin" />}
            Create session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
