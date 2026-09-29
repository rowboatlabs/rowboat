import { useEffect, useState, type ReactNode } from 'react'
import type { ipc } from '@x/shared'
import { Check, FolderGit2, KeyRound, Loader2, RotateCcw, ExternalLink, GitPullRequest, MessagesSquare, Users, ListChecks, GitFork, X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ReplicasLogo } from './replicas-logo'
import { REPLICAS_CONFIG_CHANGED, REPLICAS_REQUEST_SENT, useReplicasConfig, type ReplicasConfig as Config } from './use-replicas-config'

type Task = ipc.IPCChannels['spaces:getReplicasTask']['res']['task']
type Operation = ipc.IPCChannels['spaces:actOnReplicasTask']['req']['operation']
export type SharedReplicasOptions = { environmentId?: string; planMode?: boolean }

const REPLICAS_URL = 'https://app.replicas.dev'

// ---------------------------------------------------------------------------
// Space header: what Replicas is, and (for admins) connecting it.

export function ReplicasHeaderButton({ orgId, spaceId }: { orgId: string; spaceId: string }) {
    const { config, reload } = useReplicasConfig(orgId, spaceId)
    const [open, setOpen] = useState(false)
    if (!config || (!config.enabled && !config.canConfigure)) return null
    return <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
            <button
                type="button"
                title={config.enabled ? 'Replicas — cloud coding agent for this Space' : 'Set up Replicas, a cloud coding agent for this Space'}
                className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=open]:bg-accent/60 data-[state=open]:text-foreground"
            >
                <span className="relative">
                    <ReplicasLogo />
                    {config.enabled && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-[var(--rowboat-success)] ring-2 ring-background" />}
                    {config.error && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-amber-500 ring-2 ring-background" />}
                </span>
                <span className="hidden lg:inline">Replicas</span>
            </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[28rem] p-0">
            <ReplicasSettings orgId={orgId} spaceId={spaceId} config={config} onSaved={async () => {
                await reload(); window.dispatchEvent(new Event(REPLICAS_CONFIG_CHANGED))
            }} />
        </PopoverContent>
    </Popover>
}

export function ReplicasSettings({ orgId, spaceId, config, onSaved }: {
    orgId: string; spaceId: string; config: Config
    onSaved: () => Promise<void>
}) {
    const [key, setKey] = useState('')
    const [replacing, setReplacing] = useState(!!config.error)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const save = async (input: ipc.IPCChannels['spaces:configureReplicas']['req']['config'], done: string) => {
        setBusy(true); setError(null)
        try {
            await window.ipc.invoke('spaces:configureReplicas', { orgId, spaceId, config: input })
            setKey(''); setReplacing(false); await onSaved()
            toast(done, 'success')
        } catch (e) { setError(e instanceof Error ? e.message : 'Replicas could not be saved') }
        finally { setBusy(false) }
    }
    const state = config.error ? 'error' : config.enabled ? 'on' : config.configured ? 'paused' : 'new'
    const keyField = (label: string) => <div className="space-y-1.5">
        <label htmlFor="replicas-api-key" className="text-xs font-medium text-muted-foreground">{label}</label>
        <Input id="replicas-api-key" type="password" autoComplete="off" autoFocus={state !== 'new'} aria-label="Replicas API key"
            placeholder="Paste your org API key" value={key} onChange={e => setKey(e.target.value)} />
        <a href={REPLICAS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--rowboat-link)] hover:underline">Get an org key on Replicas <ExternalLink className="size-3" /></a>
    </div>

    return <div className="text-sm">
        <div className="flex items-start gap-3 p-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--rowboat-wash)]"><ReplicasLogo className="size-4" /></div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="font-medium">Replicas</p>
                    {state === 'on' && <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"><Check className="size-3" />Connected</span>}
                    {state === 'paused' && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Paused</span>}
                    {state === 'error' && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">Can’t reach Replicas</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                    {state === 'on' ? <>Ready in this Space. Mention <span className="font-medium text-foreground">@replicas</span> in any thread to hand off a coding task.</>
                        : state === 'paused' ? 'Disconnected from this Space. Reconnect to take coding requests again — task history is kept.'
                        : state === 'error' ? 'The saved key isn’t working. Replace it to get going again.'
                        : 'A shared cloud coding agent that turns a thread into a pull request.'}
                </p>
            </div>
        </div>

        {state === 'new' && <ul className="space-y-2.5 px-4 pb-4">
            <Step icon={<MessagesSquare className="size-3.5" />} title="Ask in any thread">@mention Replicas with a bug or feature, like you would a teammate.</Step>
            <Step icon={<GitPullRequest className="size-3.5" />} title="It ships a PR">It works on your repo in the cloud and opens a pull request — even with every laptop closed.</Step>
            <Step icon={<Users className="size-3.5" />} title="Steer it together">Anyone here can follow up in the thread. Requests queue instead of colliding.</Step>
        </ul>}

        {state !== 'new' && <dl className="mx-4 mb-4 divide-y divide-border/60 rounded-lg border border-border/60 text-xs">
            <Row label="Environments">
                {config.environments.length === 0
                    ? <a href={REPLICAS_URL} target="_blank" rel="noreferrer" className="text-[var(--rowboat-link)] hover:underline">None yet — add a repo</a>
                    : config.environments.map(e => e.name).join(', ')}
            </Row>
            <Row label="Default">
                {config.canConfigure && config.environments.length > 1
                    ? <select aria-label="Default environment" title="Used when a request doesn't pick an environment"
                        className="-my-1 h-6 max-w-full rounded-md bg-[var(--rowboat-wash)] px-1.5 outline-none disabled:opacity-60" disabled={busy}
                        value={config.environmentId ?? ''}
                        onChange={e => void save({ enabled: config.enabled, environmentId: e.target.value || null }, 'Default environment updated')}>
                        <option value="">Ask each time</option>
                        {config.environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                    : config.environments.find(e => e.id === config.environmentId)?.name ?? (config.environments.length === 1 ? config.environments[0].name : 'Ask each time')}
            </Row>
            <Row label="Coding agent"><span className="capitalize">{config.codingAgent}</span></Row>
            <Row label="Billing">Your team’s Replicas account</Row>
        </dl>}

        {config.error && <p role="status" className="mx-4 mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{config.error}</p>}

        {config.canConfigure ? <div className="space-y-3 border-t border-border/60 p-4">
            {state === 'new' && <>
                <p className="rounded-lg bg-[var(--rowboat-wash)] px-3 py-2 text-xs text-muted-foreground">
                    Everyone in this Space can start and steer work using this Replicas account, and usage is billed to it. Use an <span className="font-medium text-foreground">org API key</span>, not a personal one — otherwise teammates' PRs look like yours.
                </p>
                {keyField('Replicas org API key')}
                <Button size="sm" disabled={busy || !key} onClick={() => void save({ enabled: true, apiKey: key, environmentId: config.environmentId }, 'Replicas connected to this Space')}>
                    {busy ? 'Connecting…' : 'Connect Replicas'}
                </Button>
            </>}
            {state !== 'new' && replacing && <>
                {keyField('New org API key')}
                <p className="text-xs text-muted-foreground">Replacing the key updates every Space connected to Replicas.</p>
                <div className="flex items-center gap-2">
                    <Button size="sm" disabled={busy || !key} onClick={() => void save({ enabled: true, apiKey: key, environmentId: config.environmentId }, 'Replicas API key replaced')}>
                        {busy ? 'Saving…' : 'Save new key'}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setReplacing(false); setKey('') }}>Cancel</Button>
                </div>
            </>}
            {state !== 'new' && !replacing && <div className="flex items-center gap-2">
                {state === 'paused' && <Button size="sm" disabled={busy} onClick={() => void save({ enabled: true, environmentId: config.environmentId }, 'Replicas reconnected')}>{busy ? 'Reconnecting…' : 'Reconnect'}</Button>}
                <Button variant="outline" size="sm" className="rounded-md" disabled={busy} onClick={() => setReplacing(true)}><KeyRound />Replace API key</Button>
                {state === 'on' && <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" disabled={busy}
                    title="Stops new requests in this Space. Running work and other Spaces are unaffected."
                    onClick={() => void save({ enabled: false }, 'Replicas disconnected from this Space')}>Disconnect</Button>}
            </div>}
        </div> : <p className="border-t border-border/60 p-4 text-xs text-muted-foreground">An admin connected this Space to the team's Replicas account; usage is billed to it.</p>}
        {error && <p role="alert" className="px-4 pb-4 text-xs text-destructive">{error}</p>}
    </div>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return <div className="flex gap-3 px-3 py-2">
        <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
        <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
}

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return <li className="flex gap-2.5">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div><p className="font-medium">{title}</p><p className="text-xs text-muted-foreground">{children}</p></div>
    </li>
}

// ---------------------------------------------------------------------------
// Composer toolbar: the options for a message addressed to Replicas.

export function ReplicasComposerOptions({ config, options, onChange }: {
    config: Config
    options: SharedReplicasOptions
    onChange: (options: SharedReplicasOptions) => void
}) {
    const environment = options.environmentId ?? ''
    return <>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <span className="text-[11px] text-muted-foreground">runs on Replicas · opens a PR</span>
        {config.environments.length > 0
            ? <select aria-label="Replicas environment" title="Which repo environment the agent works in"
                className="h-7 max-w-44 shrink-0 rounded-full bg-transparent px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
                value={environment} onChange={e => onChange({ ...options, environmentId: e.target.value || undefined })}>
                <option value="">{config.environments.length === 1 ? config.environments[0].name : 'Choose environment…'}</option>
                {config.environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            : <a href={REPLICAS_URL} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:underline">No environments — add a repo on Replicas</a>}
        <button type="button" aria-label="Plan first" aria-pressed={!!options.planMode}
            title={options.planMode ? 'Plan first — Replicas proposes a plan and waits for “proceed”. Click to let it code straight away' : 'Ask for a plan before any code is written'}
            onClick={() => onChange({ ...options, planMode: !options.planMode })}
            className={cn('flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors',
                options.planMode ? 'bg-secondary text-foreground hover:bg-secondary/70' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            <ListChecks className="size-3.5 shrink-0" /><span>Plan first</span>
        </button>
    </>
}

// ---------------------------------------------------------------------------
// Thread: the shared task's state, where agent progress already shows.

type Status = NonNullable<Task>['status']
const STATUS: Record<Status, { title: string; hint: string; tone: 'busy' | 'ok' | 'warn' | 'bad' }> = {
    queued: { title: 'Queued', hint: 'up next', tone: 'busy' },
    sending: { title: 'Starting', hint: 'setting up the workspace', tone: 'busy' },
    running: { title: 'Working', hint: '', tone: 'busy' },
    idle: { title: 'Done', hint: 'reply to continue', tone: 'ok' },
    select_environment: { title: 'Needs an environment', hint: '', tone: 'warn' },
    uncertain: { title: 'Unconfirmed', hint: 'the connection dropped mid-send', tone: 'warn' },
    error: { title: 'Failed', hint: '', tone: 'bad' },
}
const TAG = {
    busy: 'bg-muted text-foreground',
    ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    bad: 'bg-destructive/10 text-destructive',
}
const rowAction = 'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-60'
/** Past these, there is a workspace in Replicas to open or fork from. */
const STARTED = new Set<string>(['running', 'idle', 'error', 'uncertain'])
/** How long a just-sent request shows as queued before the server's word wins. */
const SENT_GRACE_MS = 15_000

export function ReplicasThreadStatus({ orgId, spaceId, threadRootId, onAgent }: {
    orgId: string; spaceId: string; threadRootId: string
    /** The Replicas member while this thread has a task and the Space's connection is on, else null. */
    onAgent?: (memberId: string | null) => void
}) {
    const { config } = useReplicasConfig(orgId, spaceId)
    const [task, setTask] = useState<Task>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [environment, setEnvironment] = useState('')
    const [workspaceId, setWorkspaceId] = useState('')
    const [chatId, setChatId] = useState('')
    const [forkText, setForkText] = useState('')
    const [forking, setForking] = useState(false)
    const [attaching, setAttaching] = useState(false)
    const [justSent, setJustSent] = useState(false)
    useEffect(() => {
        setTask(null); setJustSent(false)
        if (!config?.configured) return
        let alive = true
        let grace: ReturnType<typeof setTimeout> | undefined
        const refresh = async () => {
            try {
                const result = await window.ipc.invoke('spaces:getReplicasTask', { orgId, spaceId, rootMessageId: threadRootId })
                if (!alive) return
                setTask(result.task)
                if (result.task && !['idle', 'error'].includes(result.task.status)) setJustSent(false)
            } catch { /* Keep the last known state during reconnect. */ }
        }
        const onSent = (event: Event) => {
            if ((event as CustomEvent<{ threadRootId: string }>).detail?.threadRootId !== threadRootId) return
            setJustSent(true)
            clearTimeout(grace)
            grace = setTimeout(() => { if (alive) setJustSent(false) }, SENT_GRACE_MS)
            void refresh()
        }
        void refresh()
        const interval = setInterval(() => { void refresh() }, 3000)
        window.addEventListener(REPLICAS_REQUEST_SENT, onSent)
        return () => { alive = false; clearInterval(interval); clearTimeout(grace); window.removeEventListener(REPLICAS_REQUEST_SENT, onSent) }
    }, [orgId, spaceId, threadRootId, config?.configured])
    const agentId = (task || justSent) && config?.enabled ? config.botMemberId : null
    useEffect(() => { onAgent?.(agentId) }, [agentId, onAgent])
    useEffect(() => () => onAgent?.(null), [onAgent])
    const act = async (operation: Operation) => {
        setBusy(true); setError(null)
        try {
            const result = await window.ipc.invoke('spaces:actOnReplicasTask', { orgId, spaceId, rootMessageId: threadRootId, operation })
            if (operation.action === 'fork') { setForking(false); setForkText(''); toast('Started a new feature thread in this Space', 'success') }
            else setTask(result.task)
        } catch (e) { setError(e instanceof Error ? e.message : 'Replicas could not complete this request') }
        finally { setBusy(false) }
    }
    if (!config || (!task && !justSent)) return null
    // Between sending and the worker's next pass, the task still reads as it was.
    const shown: Status = justSent && (!task || task.status === 'idle' || task.status === 'error') ? 'queued' : task!.status
    const status = STATUS[shown]
    const working = ['queued', 'sending', 'running'].includes(shown)
    const started = STARTED.has(shown) || !!task?.workspaceId
    const cancel = (task?.cancellableMessageIds ?? []).map((messageId, index, all) => <button key={messageId} type="button" disabled={busy} className={rowAction}
        onClick={() => void act({ action: 'cancel', messageId })}>
        <X className="size-3" />{all.length === 1 ? 'Cancel queued request' : `Cancel queued request ${index + 1}`}
    </button>)

    if (task && shown === 'select_environment') {
        const envs = config.environments
        return <div className="pl-10 pt-1 text-xs" aria-label="Replicas task">
            <div className="max-w-lg space-y-2.5 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                    <ReplicasLogo className="mt-0.5 size-3.5" />
                    <div className="flex-1">
                        <p className="text-sm font-medium">Where should Replicas work?</p>
                        <p className="text-muted-foreground">It uses this environment for the whole thread.</p>
                    </div>
                </div>
                {envs.length === 0
                    ? <a href={REPLICAS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--rowboat-link)] hover:underline">No environments yet — add a repo on Replicas <ExternalLink className="size-3" /></a>
                    : envs.length <= 6
                        ? <div className="flex flex-wrap gap-1.5">
                            {envs.map(e => <Button key={e.id} variant="outline" size="xs" className="h-7 rounded-md" disabled={busy}
                                onClick={() => void act({ action: 'select_environment', environmentId: e.id })}>
                                <FolderGit2 className="size-3.5" />{e.name}
                            </Button>)}
                        </div>
                        : <div className="flex gap-2">
                            <select aria-label="Replicas environment" className="h-7 flex-1 rounded-md bg-[var(--rowboat-wash)] px-2 outline-none" value={environment} onChange={e => setEnvironment(e.target.value)}>
                                <option value="">Choose environment…</option>
                                {envs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                            <Button size="xs" className="h-7" disabled={!environment || busy} onClick={() => void act({ action: 'select_environment', environmentId: environment })}>Start</Button>
                        </div>}
                {cancel.length > 0 && <div className="flex gap-1.5 border-t border-border/60 pt-2.5">{cancel}</div>}
                {error && <p role="alert" className="text-destructive">{error}</p>}
            </div>
        </div>
    }

    return <div className="space-y-2 pl-10 pt-1 text-xs" aria-label="Replicas task">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 leading-none">
            <span className="inline-flex h-6 items-center" title="Replicas">
                {working ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : <ReplicasLogo className="size-3.5" />}
            </span>
            <span role="status" className={cn('inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium', TAG[status.tone])}>
                {status.title}{task && task.pending > 1 ? ` · ${task.pending - 1} more queued` : ''}
            </span>
            {status.hint && <span className="text-muted-foreground">{status.hint}</span>}
            {(shown === 'error' || cancel.length > 0 || started) && <span className="mx-1 h-3.5 w-px bg-border" />}
            {shown === 'error' && <button type="button" className={rowAction} disabled={busy} onClick={() => void act({ action: 'retry' })}><RotateCcw className="size-3" />Retry request</button>}
            {cancel}
            {started && <button type="button" className={rowAction} title="Start a separate task in a new thread, with this one as context" onClick={() => setForking(v => !v)}>
                <GitFork className="size-3" />Fork task
            </button>}
            {started && <a href={task?.url ?? REPLICAS_URL} target="_blank" rel="noreferrer" className={rowAction}>Open in Replicas <ExternalLink className="size-3" /></a>}
        </div>
        {task?.error && <p role="status" className="text-amber-700 dark:text-amber-400">{task.error}</p>}
        {(shown === 'uncertain' || shown === 'error') && (shown === 'uncertain' || attaching
            ? <div className="max-w-lg space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Already running in Replicas?</p>
                <p className="text-muted-foreground">The connection dropped mid-send, so Replicas may have this request. If you find it there, paste its IDs to keep tracking it here without sending it twice.</p>
                <div className="flex flex-wrap gap-2">
                    <Input aria-label="Existing workspace ID" placeholder="Workspace ID" className="h-7 w-40 text-xs md:text-xs" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} />
                    <Input aria-label="Existing chat ID" placeholder="Chat ID" className="h-7 w-40 text-xs md:text-xs" value={chatId} onChange={e => setChatId(e.target.value)} />
                    <Button variant="outline" size="xs" className="h-7 rounded-md" disabled={busy || !workspaceId || !chatId} onClick={() => void act({ action: 'attach', workspaceId, chatId })}>Resume tracking</Button>
                </div>
            </div>
            : <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => setAttaching(true)}>Already running in Replicas? Resume tracking it</button>)}
        {forking && <div className="flex max-w-lg gap-2">
            <Input autoFocus aria-label="New task instructions" placeholder="What should the separate task do?" className="h-7 flex-1 text-xs md:text-xs" value={forkText} onChange={e => setForkText(e.target.value)} />
            <Button size="xs" className="h-7" disabled={busy || !forkText.trim()} onClick={() => void act({ action: 'fork', messageId: threadRootId, body: forkText.trim() })}>Start separate task</Button>
            <Button variant="ghost" size="xs" className="h-7" onClick={() => { setForking(false); setForkText('') }}>Cancel</Button>
        </div>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
}
