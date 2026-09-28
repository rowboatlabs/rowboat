import { useCallback, useEffect, useState } from 'react'
import type { ipc } from '@x/shared'
import { Cloud, Loader2, ExternalLink } from 'lucide-react'
import { toast } from '@/lib/toast'

type Config = ipc.IPCChannels['spaces:getReplicasConfig']['res']
type Task = ipc.IPCChannels['spaces:getReplicasTask']['res']['task']
type Operation = ipc.IPCChannels['spaces:actOnReplicasTask']['req']['operation']
export type SharedReplicasOptions = { environmentId?: string; planMode?: boolean }

export function ReplicasPanel({ orgId, spaceId, threadRootId, onMention, onOptions, onConnection }: {
    orgId: string; spaceId: string; threadRootId?: string
    onConnection: (connection: { memberId: string | null; direct: boolean }) => void
    onMention: (memberId: string) => void
    onOptions: (options: SharedReplicasOptions | undefined) => void
}) {
    const [config, setConfig] = useState<Config | null>(null)
    const [task, setTask] = useState<Task>(null)
    const [settings, setSettings] = useState(false)
    const [key, setKey] = useState('')
    const [environment, setEnvironment] = useState('')
    const [plan, setPlan] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [workspaceId, setWorkspaceId] = useState('')
    const [chatId, setChatId] = useState('')
    const [forkText, setForkText] = useState('')
    const [forking, setForking] = useState(false)
    const load = useCallback(async () => {
        const next = await window.ipc.invoke('spaces:getReplicasConfig', { orgId, spaceId })
        setConfig(next)
        onConnection({ memberId: next.enabled ? next.botMemberId : null, direct: next.enabled && next.direct })
        setEnvironment(current => current || next.environmentId || '')
    }, [orgId, spaceId, onConnection])
    useEffect(() => {
        let alive = true
        setConfig(null); setTask(null); setEnvironment(''); setPlan(false)
        setSettings(false); setKey(''); setError(null)
        onConnection({ memberId: null, direct: false }); onOptions(undefined)
        const refresh = () => { void window.ipc.invoke('spaces:getReplicasConfig', { orgId, spaceId }).then(next => {
            if (!alive) return
            setConfig(next); setEnvironment(current => current || next.environmentId || '')
            onConnection({ memberId: next.enabled ? next.botMemberId : null, direct: next.enabled && next.direct })
        }).catch(() => { /* Older Harbor versions do not expose this integration. */ }) }
        refresh()
        window.addEventListener('focus', refresh)
        const interval = setInterval(refresh, 30_000)
        return () => { alive = false; clearInterval(interval); window.removeEventListener('focus', refresh) }
    }, [orgId, spaceId, onConnection, onOptions])
    useEffect(() => {
        setTask(null)
        if (!threadRootId || !config?.enabled) return
        let alive = true
        const refresh = async () => {
            try {
                const result = await window.ipc.invoke('spaces:getReplicasTask', { orgId, spaceId, rootMessageId: threadRootId })
                if (alive) setTask(result.task)
            } catch { /* Keep the last known state during reconnect. */ }
        }
        void refresh()
        const interval = setInterval(() => { void refresh() }, 3000)
        return () => { alive = false; clearInterval(interval) }
    }, [orgId, spaceId, threadRootId, config?.enabled])
    const run = async (fn: () => Promise<void>) => {
        setBusy(true); setError(null)
        try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Replicas could not complete this request') }
        finally { setBusy(false) }
    }
    const act = (operation: Operation) => run(async () => {
        const result = await window.ipc.invoke('spaces:actOnReplicasTask', { orgId, spaceId, rootMessageId: threadRootId!, operation })
        if (operation.action === 'fork') { setForking(false); setForkText(''); toast('Started a new feature thread in this Space', 'success') }
        else setTask(result.task)
    })
    if (!config) return null
    const working = task && ['queued', 'sending', 'running'].includes(task.status)
    return <div className="px-3 py-2 text-xs border-b border-border/50" aria-label="Replicas shared agent">
        <div className="flex items-center gap-2 flex-wrap">
            {working ? <Loader2 className="size-3.5 animate-spin" /> : <Cloud className="size-3.5 text-muted-foreground" />}
            <span className="font-medium">Replicas</span>
            {config.enabled ? <>
                <button type="button" className="hover:underline" onClick={() => {
                    onOptions({ ...(environment ? { environmentId: environment } : {}), planMode: plan })
                    onMention(config.botMemberId!)
                }}>Ask Replicas</button>
                {!task?.workspaceId && <select aria-label="Replicas environment" className="bg-transparent max-w-40" value={environment} onChange={e => {
                    setEnvironment(e.target.value)
                    onOptions({ ...(e.target.value ? { environmentId: e.target.value } : {}), planMode: plan })
                }}>
                    <option value="">Choose environment…</option>
                    {config.environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>}
                <label className="flex gap-1 items-center"><input type="checkbox" checked={plan} onChange={e => {
                    setPlan(e.target.checked); onOptions({ ...(environment ? { environmentId: environment } : {}), planMode: e.target.checked })
                }} />Plan first</label>
                {task && <span role="status" className="text-muted-foreground">{task.status.replaceAll('_', ' ')}{task.pending > 1 ? ` · ${task.pending - 1} queued` : ''}</span>}
                {task?.url && <a href={task.url} target="_blank" rel="noreferrer" className="flex gap-1 items-center hover:underline">Workspace <ExternalLink className="size-3" /></a>}
                {task && <button type="button" onClick={() => setForking(v => !v)} className="hover:underline">Fork task</button>}
            </> : <span className="text-muted-foreground">{config.canConfigure ? 'Connect a shared coding agent' : 'An admin can connect this Space'}</span>}
            {config.canConfigure && <button type="button" className="ml-auto hover:underline" onClick={() => setSettings(v => !v)}>Settings</button>}
        </div>
        {task?.status === 'select_environment' && <button type="button" disabled={!environment || busy} className="mt-2 underline disabled:opacity-50" onClick={() => void act({ action: 'select_environment', environmentId: environment })}>Start in selected environment</button>}
        {task?.status === 'error' && <button type="button" disabled={busy} className="mt-2 underline" onClick={() => void act({ action: 'retry' })}>Retry request</button>}
        {task?.error && <p role="status" className="mt-2 text-amber-600">{task.error}</p>}
        {(task?.status === 'uncertain' || task?.status === 'error') && <div className="mt-2 flex gap-2 flex-wrap">
            <input aria-label="Existing workspace ID" placeholder="Existing workspace ID" className="rounded border bg-background px-2 py-1" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} />
            <input aria-label="Existing chat ID" placeholder="Existing chat ID" className="rounded border bg-background px-2 py-1" value={chatId} onChange={e => setChatId(e.target.value)} />
            <button type="button" disabled={busy || !workspaceId || !chatId} onClick={() => void act({ action: 'attach', workspaceId, chatId })}>Resume tracking</button>
        </div>}
        {forking && <div className="mt-2 flex gap-2">
            <input aria-label="New task instructions" placeholder="What should the separate task do?" className="flex-1 rounded border bg-background px-2 py-1" value={forkText} onChange={e => setForkText(e.target.value)} />
            <button type="button" disabled={busy || !forkText.trim()} onClick={() => void act({ action: 'fork', messageId: threadRootId!, body: forkText.trim() })}>Start separate task</button>
        </div>}
        {settings && <div className="mt-3 space-y-2 rounded border p-3">
            <p>Everyone in this Space can start and steer work using this Replicas account. Usage is billed to that account. Work continues when Rowboat is closed.</p>
            <input type="password" autoComplete="off" aria-label="Replicas API key" placeholder={config.configured ? 'New API key (optional)' : 'Replicas API key'} className="w-full rounded border bg-background px-2 py-1.5" value={key} onChange={e => setKey(e.target.value)} />
            <div className="flex gap-3">
                <button type="button" disabled={busy || (!key && !config.configured)} onClick={() => void run(async () => {
                    await window.ipc.invoke('spaces:configureReplicas', { orgId, spaceId, config: { enabled: true, ...(key ? { apiKey: key } : {}), environmentId: environment || null } })
                    setKey(''); await load(); setSettings(false)
                })}>{busy ? 'Saving…' : config.configured ? 'Save connection' : 'Connect for this Space'}</button>
                {config.enabled && <button type="button" disabled={busy} onClick={() => void run(async () => {
                    await window.ipc.invoke('spaces:configureReplicas', { orgId, spaceId, config: { enabled: false } }); await load()
                })}>Disconnect</button>}
            </div>
        </div>}
        {config.error && <p role="status" className="mt-2 text-amber-600">{config.error}</p>}
        {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
    </div>
}
