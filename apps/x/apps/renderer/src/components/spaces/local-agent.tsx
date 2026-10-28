import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CheckCircle2, Download, Folder, Laptop, Loader2, TriangleAlert } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { LOCAL_RUNTIME } from '@/lib/feature-flags'
import { kindInfo } from '@/lib/agent-kinds'
import { enabledOptimistic, startProvisioning, useProvisioning } from '@/lib/code-mode-provisioning'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// Local agents (Harbor spec §4 Agent members, 2026-10-28): the owner's own
// Claude Code or Codex, run by this computer as a Spaces agent. Main holds
// the key and runs it (core/spaces/local-agents.ts); this is where its owner
// picks the folder it works in and how it approves its own tool calls, on
// Add and later on its page. Both stay on this computer.

type Policy = spaces.SpacesLocalAgent['policy']

/** How it answers its own tool calls. Approving everything is the default (the user's call, 2026-10-28). */
export const POLICIES: ReadonlyArray<{ value: Policy; label: string; note: string }> = [
    { value: 'yolo', label: 'Approve everything', note: 'It edits files and runs commands without asking.' },
    { value: 'auto-approve-reads', label: 'Ask before changes', note: 'It reads freely; edits and commands wait for you in the thread.' },
    { value: 'ask', label: 'Ask for everything', note: 'Every tool call waits for you in the thread.' },
]

/** The engine code mode runs for each kind. */
const ENGINE: Record<spaces.SpacesLocalAgent['kind'], 'claude' | 'codex'> = { 'claude-code': 'claude', codex: 'codex' }

// --- what this computer runs: one store, kept fresh by main's pushes ---

let state: { agents: spaces.SpacesLocalAgent[]; defaultCwd: string } | null = null
const listeners = new Set<() => void>()
let started = false

function emit(next: typeof state) {
    state = next
    for (const fn of listeners) fn()
}

function ensureStarted() {
    if (started || !LOCAL_RUNTIME) return
    started = true
    window.ipc.on('spaces:localAgentsChanged', ({ agents }) => emit({ agents, defaultCwd: state?.defaultCwd ?? '' }))
    void window.ipc.invoke('spaces:localAgents', {}).then(emit).catch(() => emit({ agents: [], defaultCwd: '' }))
}

export function useLocalAgents(enabled = true): { agents: spaces.SpacesLocalAgent[]; defaultCwd: string } | null {
    useEffect(() => {
        if (enabled) ensureStarted()
    }, [enabled])
    return useSyncExternalStore(
        (fn) => {
            listeners.add(fn)
            return () => listeners.delete(fn)
        },
        () => state,
    )
}

/**
 * The kind's engine on this computer (code mode's, 2026-10-28): whether it is
 * installed and signed in, and installing it right from setup. The download
 * runs in main and keeps going if this unmounts (lib/code-mode-provisioning),
 * so Settings → Code Mode shows the same progress.
 */
export interface LocalEngine {
    label: string
    /** What signs it in, in a terminal. */
    signInCommand: string
    /** Unknown until checked. */
    status: { installed: boolean; signedIn: boolean; account?: { email?: string } } | null
    installing: boolean
    pct: number | null
    error?: string
    /** Download it, if it isn't here yet; resolves once it is. */
    install: () => Promise<void>
    recheck: () => void
}

export function useLocalEngine(kind: spaces.SpacesLocalAgent['kind'], enabled = true): LocalEngine {
    const engine = ENGINE[kind]
    const [status, setStatus] = useState<LocalEngine['status']>(null)
    const [tick, setTick] = useState(0)
    const prov = useProvisioning(engine)
    useEffect(() => {
        if (!enabled || !LOCAL_RUNTIME) return
        let live = true
        window.ipc.invoke('codeMode:checkAgentStatus', null)
            .then((all) => live && setStatus(all[engine]))
            .catch(() => live && setStatus(null))
        return () => {
            live = false
        }
    }, [engine, enabled, tick])
    const installed = (status?.installed ?? false) || enabledOptimistic.has(engine)
    return {
        label: kindInfo(kind).label,
        signInCommand: engine === 'claude' ? 'claude' : 'codex login',
        status: status && { ...status, installed },
        installing: prov !== undefined && prov.error === undefined,
        pct: prov?.pct ?? null,
        ...(prov?.error ? { error: prov.error } : {}),
        install: () =>
            installed
                ? Promise.resolve()
                : new Promise<void>((resolve, reject) =>
                      startProvisioning(
                          engine,
                          () => {
                              setTick((n) => n + 1)
                              resolve()
                          },
                          (message) => reject(new Error(`Couldn’t enable ${kindInfo(kind).label}: ${message}`)),
                      ),
                  ),
        recheck: () => setTick((n) => n + 1),
    }
}

/**
 * The engine, as a card on setup and on the agent's page: Claude Code or
 * Codex must be enabled on this computer to run at all, so the card says so
 * and offers Enable now; Add enables it anyway when it isn't (2026-10-28).
 * Signing in happens in a terminal, as in Settings → Code Mode.
 */
export function EngineCard({ engine }: { engine: LocalEngine }) {
    const { status, label } = engine
    const enable = () => void engine.install().catch(() => {})
    let tone: 'ok' | 'todo' | 'error' = 'todo'
    let title: string
    let note: ReactNode = null
    let action: ReactNode = null
    if (engine.installing) {
        title = `Enabling ${label}…`
        note = 'Downloading it to this computer. You can keep filling this in.'
    } else if (engine.error) {
        tone = 'error'
        title = `Couldn’t enable ${label}`
        note = engine.error
        action = <Button type="button" size="sm" variant="outline" onClick={enable}>Try again</Button>
    } else if (!status) {
        title = `Checking ${label} on this computer…`
    } else if (!status.installed) {
        title = `Enable ${label} for Rowboat`
        note = `This installs the ${label} engine and uses your own ${label} login on this computer. Adding the agent enables it too.`
        action = <Button type="button" size="sm" onClick={enable}>Enable now</Button>
    } else if (!status.signedIn) {
        title = `Sign in to ${label}`
        note = (
            <>
                Run <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{engine.signInCommand}</code> in a terminal and sign in, so it runs as you.
            </>
        )
        action = <Button type="button" size="sm" variant="outline" onClick={engine.recheck}>Check again</Button>
    } else {
        tone = 'ok'
        title = `${label} is ready on this computer`
        note = status.account?.email ? `Signed in as ${status.account.email}` : 'Enabled and signed in.'
    }
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            aria-label={`${label} on this computer`}
            className={cn(
                'flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5',
                tone === 'error' ? 'border-destructive/40 bg-destructive/5' : tone === 'ok' ? 'border-border' : 'border-border bg-muted/40',
            )}
        >
            <span className={cn('flex size-5 shrink-0 items-center justify-center', tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                {engine.installing || !status ? <Loader2 className="size-4 animate-spin" /> : tone === 'ok' ? <CheckCircle2 className="size-4" /> : tone === 'error' ? <TriangleAlert className="size-4" /> : <Download className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">{title}</div>
                {note && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{note}</div>}
                {engine.installing && (
                    <div role="progressbar" aria-label={`Enabling ${label}`} aria-valuenow={engine.pct ?? undefined} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 h-1 w-full overflow-hidden rounded bg-muted">
                        <div className={cn('h-full bg-foreground/60 transition-[width]', engine.pct === null && 'w-1/3 animate-pulse')} style={engine.pct !== null ? { width: `${engine.pct}%` } : undefined} />
                    </div>
                )}
            </div>
            {action}
        </div>
    )
}

async function pickFolder(current: string): Promise<string | null> {
    const { path } = await window.ipc.invoke('dialog:openDirectory', { title: 'Choose where the agent works', ...(current ? { defaultPath: current } : {}) })
    return path
}

function FolderField({ value, onChange, disabled }: { value: string; onChange: (path: string) => void; disabled?: boolean }) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 text-xs">
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-mono" title={value}>{value || 'No folder chosen'}</span>
            </div>
            <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => void pickFolder(value).then((path) => path && onChange(path))}
            >
                Change…
            </Button>
        </div>
    )
}

function PolicyField({ value, onChange, disabled }: { value: Policy; onChange: (policy: Policy) => void; disabled?: boolean }) {
    const note = POLICIES.find((p) => p.value === value)?.note
    return (
        <div className="flex flex-col gap-1.5">
            <div role="radiogroup" aria-label="Approvals" className="flex flex-wrap gap-1.5">
                {POLICIES.map((p) => (
                    <button
                        key={p.value}
                        type="button"
                        role="radio"
                        aria-checked={p.value === value}
                        disabled={disabled}
                        onClick={() => onChange(p.value)}
                        className={cn(
                            'rounded-lg border px-2.5 py-1.5 text-xs',
                            p.value === value ? 'border-foreground/50 bg-accent font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        )}
                    >
                        {p.label}
                    </button>
                ))}
            </div>
            {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
        </div>
    )
}

/** On Add: where it works and how it approves. */
export function LocalAgentFields({ cwd, onCwd, policy, onPolicy }: {
    cwd: string
    onCwd: (path: string) => void
    policy: Policy
    onPolicy: (policy: Policy) => void
}) {
    return (
        <>
            <div className="mt-4 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Works in</span>
                <FolderField value={cwd} onChange={onCwd} />
                <span className="text-[11px] text-muted-foreground">The folder it opens on this computer. You can change it later from its page.</span>
            </div>
            <div className="mt-4 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Approvals</span>
                <PolicyField value={policy} onChange={onPolicy} />
            </div>
        </>
    )
}

function statusLine(local: spaces.SpacesLocalAgent | undefined, whose: string): string {
    if (!local) return `Runs on ${whose} computer.`
    switch (local.status) {
        case 'online':
            return 'Running on this computer. It answers while Rowboat is open.'
        case 'connecting':
            return 'Connecting from this computer…'
        case 'offline':
            return 'Set up on this computer, but not connected. It reconnects on its own.'
        case 'error':
            return local.error ?? 'Not running.'
    }
}

/** On its page: where it runs, and for its owner, the folder and approvals, or running it here. */
export function LocalAgentSection({ orgId, agent, mine, ownerName }: { orgId: string; agent: spaces.Member; mine: boolean; ownerName: string }) {
    const local = useLocalAgents()
    const here = local?.agents.find((a) => a.orgId === orgId && a.agentId === agent.id)
    const [busy, setBusy] = useState(false)
    const [cwd, setCwd] = useState('')
    const [policy, setPolicy] = useState<Policy>('yolo')
    const kind = agent.agentKind === 'codex' ? 'codex' : 'claude-code'
    const engine = useLocalEngine(kind, mine)

    useEffect(() => {
        if (!here && local?.defaultCwd && !cwd) setCwd(local.defaultCwd)
    }, [here, local?.defaultCwd, cwd])

    const run = async (fn: () => Promise<unknown>, done?: string) => {
        if (busy) return
        setBusy(true)
        try {
            await fn()
            if (done) toast(done, 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Something went wrong', 'error')
        } finally {
            setBusy(false)
        }
    }

    const update = (change: { cwd?: string; policy?: Policy }) =>
        void run(() => window.ipc.invoke('spaces:updateLocalAgent', { orgId, agentId: agent.id, ...change }))

    return (
        <section aria-label="This computer" className="flex min-w-0 flex-col gap-3">
            <div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Laptop className="size-4" /> On {mine ? 'your' : `${ownerName}’s`} computer</h3>
                <p role="status" className={cn('mt-0.5 text-xs leading-snug', here?.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                    {mine && !here && LOCAL_RUNTIME ? 'Not running on this computer. Run it here to have it answer from this one.' : statusLine(here, mine ? 'your' : `${ownerName}’s`)}
                </p>
            </div>
            {mine && LOCAL_RUNTIME && here && (
                <>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-foreground">Works in</span>
                        <FolderField value={here.cwd} disabled={busy} onChange={(path) => update({ cwd: path })} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-foreground">Approvals</span>
                        <PolicyField value={here.policy} disabled={busy} onChange={(next) => update({ policy: next })} />
                    </div>
                    {here.status === 'error' && (
                        <div>
                            <Button size="sm" disabled={busy} onClick={() => void run(() => window.ipc.invoke('spaces:connectLocalAgent', { orgId, agentId: agent.id, cwd: here.cwd, policy: here.policy }), `${agent.displayName} runs on this computer again`)}>
                                {busy && <Loader2 className="size-3.5 animate-spin" />} Reconnect
                            </Button>
                        </div>
                    )}
                    <EngineCard engine={engine} />
                </>
            )}
            {mine && LOCAL_RUNTIME && !here && local && (
                <>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-foreground">Works in</span>
                        <FolderField value={cwd} disabled={busy} onChange={setCwd} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-foreground">Approvals</span>
                        <PolicyField value={policy} disabled={busy} onChange={setPolicy} />
                    </div>
                    <EngineCard engine={engine} />
                    <div>
                        <Button
                            size="sm"
                            disabled={busy || engine.installing || !cwd}
                            onClick={() =>
                                void run(async () => {
                                    // Installs its engine first when it isn't on this computer yet.
                                    await engine.install()
                                    await window.ipc.invoke('spaces:connectLocalAgent', { orgId, agentId: agent.id, cwd, policy })
                                }, `${agent.displayName} runs on this computer now`)
                            }
                        >
                            {(busy || engine.installing) && <Loader2 className="size-3.5 animate-spin" />}
                            {engine.status && !engine.status.installed ? `Enable ${engine.label} and run it here` : 'Run on this computer'}
                        </Button>
                        <p className="mt-1 text-[11px] text-muted-foreground">Any other computer running it stops: one computer answers for it.</p>
                    </div>
                </>
            )}
        </section>
    )
}
