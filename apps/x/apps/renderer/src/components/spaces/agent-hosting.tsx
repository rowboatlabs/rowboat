import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, FileText, Folder, Loader2, Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// Managing a managed agent's VM from its page (2026-10-27, Harbor spec §8
// Maritime, the management area). The owner has no login on the platform,
// so everything goes through Harbor on the deployment's key: the machine and
// its power, environment variables (a secret's value is never read back),
// one shell command at a time with its output, the platform's logs, the VM's
// files, and for Hermes the VM's skills and the platform's triggers. Each
// part is a fold the person opens; nothing loads until they do, except the
// machine line, which is the page's one read.

const COMMAND_POLL_MS = 1_000
/** Where each kind keeps its things on the volume: the files browser opens here. */
const HOME: Record<string, string> = { hermes: '/opt/data', codex: '/data', 'claude-code': '/data' }

function Fold({ title, note, open, onToggle, children }: { title: string; note?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-center gap-1 self-start text-xs font-semibold text-foreground">
                <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')} />
                {title}
            </button>
            {open && note && <p className="-mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p>}
            {open && children}
        </section>
    )
}

function fail(err: unknown, fallback: string) {
    toast(err instanceof Error ? err.message : fallback, 'error')
}

/** The machine as Maritime sees it, and its power: wake, sleep, restart, reload the environment. */
function MachineSection({ orgId, agentId, machine, onMachine }: { orgId: string; agentId: string; machine: spaces.HostingMachine | undefined; onMachine: (m: spaces.HostingMachine) => void }) {
    const [busy, setBusy] = useState<string | null>(null)
    const act = async (action: spaces.HostingPowerAction) => {
        setBusy(action)
        try {
            onMachine((await window.ipc.invoke('spaces:hostingPower', { orgId, agentId, action })).machine)
            toast(action === 'wake' ? 'Awake' : action === 'sleep' ? 'Asleep' : action === 'restart' ? 'Restarting' : 'Environment reloaded', 'success')
        } catch (err) {
            fail(err, `Could not ${action}`)
        } finally {
            setBusy(null)
        }
    }
    const asleep = machine?.status === 'sleeping' || machine?.status === 'stopped'
    const button = (action: spaces.HostingPowerAction, label: string) => (
        <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => void act(action)}>
            {busy === action ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {label}
        </Button>
    )
    return (
        <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted-foreground">
                {machine ? (
                    <>
                        Maritime says the machine is <span className="font-medium text-foreground">{machine.status}</span>
                        {machine.tier ? ` on the ${machine.tier.replace(/_/g, ' ')} tier` : ''}.
                    </>
                ) : (
                    'Maritime could not be asked about the machine just now.'
                )}
            </p>
            <div className="flex flex-wrap gap-1.5">
                {asleep ? button('wake', 'Wake') : button('sleep', 'Sleep')}
                {button('restart', 'Restart')}
                {button('reload', 'Reload environment')}
            </div>
        </div>
    )
}

/** Environment variables on the VM: a secret shows as set, never its value; a restart or reload applies changes. */
function EnvSection({ orgId, agentId, env, onEnv }: { orgId: string; agentId: string; env: spaces.HostingEnvVar[]; onEnv: (env: spaces.HostingEnvVar[]) => void }) {
    const [key, setKey] = useState('')
    const [value, setValue] = useState('')
    const [secret, setSecret] = useState(true)
    const [busy, setBusy] = useState(false)
    const [confirming, setConfirming] = useState<string | null>(null)
    const valid = /^[A-Z_][A-Z0-9_]{0,255}$/.test(key)
    const save = async () => {
        if (!valid || busy) return
        setBusy(true)
        try {
            onEnv((await window.ipc.invoke('spaces:setHostingEnv', { orgId, agentId, key, value, secret })).env)
            setKey('')
            setValue('')
            toast(`${key} saved. Restart or reload the environment to apply it.`, 'success')
        } catch (err) {
            fail(err, 'Could not save the variable')
        } finally {
            setBusy(false)
        }
    }
    const remove = async (k: string) => {
        setBusy(true)
        try {
            onEnv((await window.ipc.invoke('spaces:deleteHostingEnv', { orgId, agentId, key: k })).env)
        } catch (err) {
            fail(err, 'Could not delete the variable')
        } finally {
            setBusy(false)
            setConfirming(null)
        }
    }
    return (
        <div className="flex flex-col gap-2">
            {env.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No environment variables.</p>
            ) : (
                <ul aria-label="Environment variables" className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {env.map((v) => (
                        <li key={v.key} className="flex items-center gap-2 px-2.5 py-1.5 font-mono text-[11px]">
                            <span className="shrink-0 font-medium text-foreground">{v.key}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{v.secret ? '•••••••• (secret)' : v.value}</span>
                            {v.warning && <span className="shrink-0 text-amber-600" title={v.warning}>!</span>}
                            <button type="button" disabled={busy} onClick={() => (confirming === v.key ? void remove(v.key) : setConfirming(v.key))} className="shrink-0 rounded px-1.5 py-0.5 font-sans text-destructive hover:bg-destructive/10">
                                {confirming === v.key ? 'Confirm delete' : 'Delete'}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <form
                className="flex flex-wrap items-center gap-1.5"
                onSubmit={(e) => {
                    e.preventDefault()
                    void save()
                }}
            >
                <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="KEY" aria-label="Variable name" className="h-7 w-36 font-mono text-[11px]" />
                <Input type={secret ? 'password' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" aria-label="Variable value" className="h-7 min-w-0 flex-1 font-mono text-[11px]" autoComplete="off" />
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} aria-label="Secret" /> secret
                </label>
                <Button type="submit" size="sm" className="h-7" disabled={!valid || busy}>
                    {env.some((v) => v.key === key) ? 'Replace' : 'Add'}
                </Button>
            </form>
        </div>
    )
}

/** One shell command on the VM, read every second until it ends. Nothing persists between commands. */
function CommandSection({ orgId, agentId }: { orgId: string; agentId: string }) {
    const [command, setCommand] = useState('')
    const [execution, setExecution] = useState<spaces.HostingExecution | null>(null)
    const [busy, setBusy] = useState(false)
    const running = execution?.status === 'running'
    const timer = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        if (!running || !execution) return
        const id = execution.id
        timer.current = setInterval(async () => {
            try {
                const { execution: next } = await window.ipc.invoke('spaces:getHostingCommand', { orgId, agentId, executionId: id })
                setExecution(next)
            } catch (err) {
                fail(err, 'Lost the command')
                setExecution((e) => (e ? { ...e, status: 'failed' } : e))
            }
        }, COMMAND_POLL_MS)
        return () => {
            if (timer.current) clearInterval(timer.current)
        }
    }, [running, execution, orgId, agentId])

    const run = async () => {
        if (!command.trim() || busy || running) return
        setBusy(true)
        try {
            setExecution((await window.ipc.invoke('spaces:runHostingCommand', { orgId, agentId, command: command.trim() })).execution)
        } catch (err) {
            fail(err, 'Could not run the command')
        } finally {
            setBusy(false)
        }
    }
    const cancel = async () => {
        if (!execution) return
        try {
            setExecution((await window.ipc.invoke('spaces:cancelHostingCommand', { orgId, agentId, executionId: execution.id })).execution)
        } catch (err) {
            fail(err, 'Could not cancel the command')
        }
    }
    return (
        <div className="flex flex-col gap-2">
            <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                    e.preventDefault()
                    void run()
                }}
            >
                <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="ls -la /opt/data" aria-label="Command" className="h-7 min-w-0 flex-1 font-mono text-[11px]" spellCheck={false} disabled={running} />
                {running ? (
                    <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void cancel()}>
                        <Square className="size-3" /> Cancel
                    </Button>
                ) : (
                    <Button type="submit" size="sm" className="h-7" disabled={!command.trim() || busy}>
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3" />} Run
                    </Button>
                )}
            </form>
            {execution && (
                <div className="flex flex-col gap-1">
                    <p role="status" className="text-[11px] text-muted-foreground">
                        {running ? 'Running…' : execution.status === 'cancelled' ? 'Cancelled.' : `Exited ${execution.exitCode ?? '?'}.`}
                    </p>
                    {(execution.stdout || execution.stderr) && (
                        <pre aria-label="Command output" className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap">
                            {execution.stdout}
                            {execution.stderr && <span className="text-destructive">{execution.stderr}</span>}
                        </pre>
                    )}
                </div>
            )}
        </div>
    )
}

/** The platform's logs for the VM, newest first, older on request. */
function LogsSection({ orgId, agentId }: { orgId: string; agentId: string }) {
    const [logs, setLogs] = useState<spaces.HostingLogLine[] | null>(null)
    const [nextBefore, setNextBefore] = useState<string | undefined>(undefined)
    const [busy, setBusy] = useState(false)
    const load = useCallback(
        async (before?: string) => {
            setBusy(true)
            try {
                const page = await window.ipc.invoke('spaces:getHostingLogs', { orgId, agentId, limit: 100, ...(before ? { before } : {}) })
                setLogs((have) => (before && have ? [...have, ...page.logs] : page.logs))
                setNextBefore(page.nextBefore)
            } catch (err) {
                fail(err, 'Could not read the logs')
            } finally {
                setBusy(false)
            }
        },
        [orgId, agentId],
    )
    useEffect(() => {
        void load()
    }, [load])
    return (
        <div className="flex flex-col gap-2">
            {logs === null ? (
                <p className="text-[11px] text-muted-foreground">Loading…</p>
            ) : logs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No log lines.</p>
            ) : (
                <ol aria-label="Logs" className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">
                    {logs.map((l) => (
                        <li key={l.id} className={cn('whitespace-pre-wrap', /warn|error/i.test(l.level) && 'text-destructive')}>
                            <span className="text-muted-foreground">{l.timestamp.replace('T', ' ').slice(0, 19)}</span> {l.level} {l.message}
                        </li>
                    ))}
                </ol>
            )}
            <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void load()}>
                    <RefreshCw className={cn('size-3', busy && 'animate-spin')} /> Refresh
                </Button>
                {nextBefore && (
                    <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => void load(nextBefore)}>
                        Older
                    </Button>
                )}
            </div>
        </div>
    )
}

/** The VM's files: a directory at a time; a text file opens to edit; new folder, rename, delete. */
function FilesSection({ orgId, agentId, home }: { orgId: string; agentId: string; home: string }) {
    const [path, setPath] = useState(home)
    const [entries, setEntries] = useState<spaces.HostingFileEntry[] | null>(null)
    const [open, setOpen] = useState<{ path: string; content: string; truncated: boolean } | null>(null)
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)
    const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
    const [confirming, setConfirming] = useState<string | null>(null)

    const list = useCallback(
        async (dir: string) => {
            setBusy(true)
            try {
                const page = await window.ipc.invoke('spaces:listHostingFiles', { orgId, agentId, path: dir })
                setPath(page.path)
                setEntries([...page.entries].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)))
            } catch (err) {
                fail(err, 'Could not list the files')
            } finally {
                setBusy(false)
            }
        },
        [orgId, agentId],
    )
    useEffect(() => {
        void list(home)
    }, [list, home])

    const read = async (file: string) => {
        setBusy(true)
        try {
            const got = await window.ipc.invoke('spaces:readHostingFile', { orgId, agentId, path: file })
            setOpen(got)
            setDraft(got.content)
        } catch (err) {
            fail(err, 'Could not read the file')
        } finally {
            setBusy(false)
        }
    }
    const save = async () => {
        if (!open) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:writeHostingFile', { orgId, agentId, path: open.path, content: draft })
            setOpen({ ...open, content: draft, truncated: false })
            toast('Saved', 'success')
            await list(path)
        } catch (err) {
            fail(err, 'Could not save the file')
        } finally {
            setBusy(false)
        }
    }
    const act = async (what: () => Promise<unknown>, fallback: string) => {
        setBusy(true)
        try {
            await what()
            await list(path)
        } catch (err) {
            fail(err, fallback)
        } finally {
            setBusy(false)
            setConfirming(null)
            setRenaming(null)
        }
    }
    const parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
    return (
        <div className="flex flex-col gap-2">
            <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                    e.preventDefault()
                    void list(path)
                }}
            >
                <Input value={path} onChange={(e) => setPath(e.target.value)} aria-label="Directory" className="h-7 min-w-0 flex-1 font-mono text-[11px]" spellCheck={false} />
                <Button type="submit" size="sm" variant="outline" className="h-7" disabled={busy}>Open</Button>
                <Button type="button" size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => void act(() => window.ipc.invoke('spaces:makeHostingDir', { orgId, agentId, path: `${path.replace(/\/+$/, '')}/new-folder` }), 'Could not make the folder')}>
                    New folder
                </Button>
            </form>
            {entries === null ? (
                <p className="text-[11px] text-muted-foreground">Loading…</p>
            ) : (
                <ul aria-label="Files" className="max-h-64 overflow-auto rounded-md border border-border">
                    {path !== '/' && (
                        <li>
                            <button type="button" onClick={() => void list(parent)} className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left font-mono text-[11px] text-muted-foreground hover:bg-accent">
                                <Folder className="size-3" /> ..
                            </button>
                        </li>
                    )}
                    {entries.length === 0 && <li className="px-2.5 py-1 text-[11px] text-muted-foreground">Empty.</li>}
                    {entries.map((e) => (
                        <li key={e.path} className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] hover:bg-accent">
                            <button type="button" onClick={() => (e.kind === 'dir' ? void list(e.path) : void read(e.path))} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                {e.kind === 'dir' ? <Folder className="size-3 shrink-0 text-muted-foreground" /> : <FileText className="size-3 shrink-0 text-muted-foreground" />}
                                <span className="truncate">{e.name}</span>
                                {e.size !== undefined && <span className="ml-auto shrink-0 text-muted-foreground">{e.size} B</span>}
                            </button>
                            {renaming?.from === e.path ? (
                                <form
                                    className="flex items-center gap-1"
                                    onSubmit={(ev) => {
                                        ev.preventDefault()
                                        void act(() => window.ipc.invoke('spaces:moveHostingFile', { orgId, agentId, from: renaming.from, to: renaming.to }), 'Could not move it')
                                    }}
                                >
                                    <Input value={renaming.to} onChange={(ev) => setRenaming({ from: renaming.from, to: ev.target.value })} aria-label="New path" className="h-6 w-56 font-mono text-[11px]" autoFocus />
                                    <Button type="submit" size="sm" className="h-6" disabled={busy}>Move</Button>
                                </form>
                            ) : (
                                <>
                                    <button type="button" onClick={() => setRenaming({ from: e.path, to: e.path })} className="shrink-0 rounded px-1 font-sans text-muted-foreground hover:text-foreground">Rename</button>
                                    <button type="button" disabled={busy} onClick={() => (confirming === e.path ? void act(() => window.ipc.invoke('spaces:deleteHostingFile', { orgId, agentId, path: e.path }), 'Could not delete it') : setConfirming(e.path))} className="shrink-0 rounded px-1 font-sans text-destructive hover:bg-destructive/10">
                                        {confirming === e.path ? 'Confirm' : 'Delete'}
                                    </button>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {open && (
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{open.path}{open.truncated ? ' (cut at 1 MB)' : ''}</span>
                        <div className="flex gap-1">
                            <Button size="sm" className="h-6" disabled={busy || open.truncated || draft === open.content} onClick={() => void save()}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-6" onClick={() => setOpen(null)}>Close</Button>
                        </div>
                    </div>
                    <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="File content" className="min-h-32 font-mono text-[11px]" spellCheck={false} />
                </div>
            )}
        </div>
    )
}

/** Skills on a Hermes VM, and the platform catalog's matches to install. */
function SkillsSection({ orgId, agentId }: { orgId: string; agentId: string }) {
    const [installed, setInstalled] = useState<spaces.HostingSkill[] | null>(null)
    const [q, setQ] = useState('')
    const [found, setFound] = useState<spaces.HostingSkill[] | null>(null)
    const [busy, setBusy] = useState(false)
    const load = useCallback(async () => {
        try {
            setInstalled(await (await window.ipc.invoke('spaces:listHostingSkills', { orgId, agentId })).skills)
        } catch (err) {
            fail(err, 'Could not list the skills')
            setInstalled([])
        }
    }, [orgId, agentId])
    useEffect(() => {
        void load()
    }, [load])
    const search = async () => {
        if (!q.trim()) return
        setBusy(true)
        try {
            setFound((await window.ipc.invoke('spaces:listHostingSkills', { orgId, agentId, q: q.trim() })).skills)
        } catch (err) {
            fail(err, 'Could not search the catalog')
        } finally {
            setBusy(false)
        }
    }
    const install = async (name: string) => {
        setBusy(true)
        try {
            setInstalled((await window.ipc.invoke('spaces:installHostingSkill', { orgId, agentId, name })).skills)
            setFound((f) => f?.map((s) => (s.name === name ? { ...s, installed: true } : s)) ?? f)
            toast(`${name} installed`, 'success')
        } catch (err) {
            fail(err, 'Could not install the skill')
        } finally {
            setBusy(false)
        }
    }
    const remove = async (name: string) => {
        setBusy(true)
        try {
            setInstalled((await window.ipc.invoke('spaces:removeHostingSkill', { orgId, agentId, name })).skills)
        } catch (err) {
            fail(err, 'Could not remove the skill')
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="flex flex-col gap-2">
            {installed === null ? (
                <p className="text-[11px] text-muted-foreground">Loading…</p>
            ) : installed.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No skills on the VM.</p>
            ) : (
                <ul aria-label="Installed skills" className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {installed.map((s) => (
                        <li key={s.name} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                            <span className="font-medium text-foreground">{s.name}</span>
                            {s.version && <span className="text-muted-foreground">{s.version}</span>}
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.description}</span>
                            <button type="button" disabled={busy} onClick={() => void remove(s.name)} className="shrink-0 rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10">Remove</button>
                        </li>
                    ))}
                </ul>
            )}
            <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                    e.preventDefault()
                    void search()
                }}
            >
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog" aria-label="Skill search" className="h-7 min-w-0 flex-1 text-[11px]" />
                <Button type="submit" size="sm" variant="outline" className="h-7" disabled={!q.trim() || busy}>Search</Button>
            </form>
            {found && (
                <ul aria-label="Catalog skills" className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {found.length === 0 && <li className="px-2.5 py-1.5 text-[11px] text-muted-foreground">Nothing matched.</li>}
                    {found.map((s) => (
                        <li key={s.name} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                            <span className="font-medium text-foreground">{s.name}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.description}</span>
                            {s.installed ? <span className="text-muted-foreground">installed</span> : <Button size="sm" className="h-6" disabled={busy} onClick={() => void install(s.name)}>Install</Button>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

/** Triggers the platform fires on a Hermes agent: a cron schedule and the prompt it sends. */
function TriggersSection({ orgId, agentId }: { orgId: string; agentId: string }) {
    const [triggers, setTriggers] = useState<spaces.HostingTrigger[] | null>(null)
    const [schedule, setSchedule] = useState('')
    const [prompt, setPrompt] = useState('')
    const [busy, setBusy] = useState(false)
    const load = useCallback(async () => {
        try {
            setTriggers((await window.ipc.invoke('spaces:listHostingTriggers', { orgId, agentId })).triggers)
        } catch (err) {
            fail(err, 'Could not list the triggers')
            setTriggers([])
        }
    }, [orgId, agentId])
    useEffect(() => {
        void load()
    }, [load])
    const add = async () => {
        if (!schedule.trim() || !prompt.trim() || busy) return
        setBusy(true)
        try {
            setTriggers((await window.ipc.invoke('spaces:createHostingTrigger', { orgId, agentId, type: 'cron', config: { schedule: schedule.trim(), prompt: prompt.trim() } })).triggers)
            setSchedule('')
            setPrompt('')
        } catch (err) {
            fail(err, 'Could not add the trigger')
        } finally {
            setBusy(false)
        }
    }
    const toggle = async (t: spaces.HostingTrigger) => {
        setBusy(true)
        try {
            setTriggers((await window.ipc.invoke('spaces:updateHostingTrigger', { orgId, agentId, triggerId: t.id, enabled: !t.enabled })).triggers)
        } catch (err) {
            fail(err, 'Could not change the trigger')
        } finally {
            setBusy(false)
        }
    }
    const remove = async (t: spaces.HostingTrigger) => {
        setBusy(true)
        try {
            setTriggers((await window.ipc.invoke('spaces:deleteHostingTrigger', { orgId, agentId, triggerId: t.id })).triggers)
        } catch (err) {
            fail(err, 'Could not delete the trigger')
        } finally {
            setBusy(false)
        }
    }
    const text = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v))
    return (
        <div className="flex flex-col gap-2">
            {triggers === null ? (
                <p className="text-[11px] text-muted-foreground">Loading…</p>
            ) : triggers.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No triggers.</p>
            ) : (
                <ul aria-label="Triggers" className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {triggers.map((t) => (
                        <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                            <span className="shrink-0 font-mono font-medium text-foreground">{text(t.config.schedule) || t.type}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{text(t.config.prompt)}</span>
                            <button type="button" disabled={busy} onClick={() => void toggle(t)} className={cn('shrink-0 rounded px-1.5 py-0.5', t.enabled ? 'text-foreground' : 'text-muted-foreground')}>
                                {t.enabled ? 'On' : 'Off'}
                            </button>
                            <button type="button" disabled={busy} onClick={() => void remove(t)} className="shrink-0 rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10" aria-label={`Delete trigger ${t.id}`}>
                                <Trash2 className="size-3" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <form
                className="flex flex-col gap-1.5"
                onSubmit={(e) => {
                    e.preventDefault()
                    void add()
                }}
            >
                <div className="flex items-center gap-1.5">
                    <Input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * 1-5" aria-label="Schedule" className="h-7 w-40 font-mono text-[11px]" />
                    <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What to do, and where to post it" aria-label="Prompt" className="h-7 min-w-0 flex-1 text-[11px]" />
                    <Button type="submit" size="sm" className="h-7" disabled={!schedule.trim() || !prompt.trim() || busy}>Add</Button>
                </div>
                <span className="text-[11px] text-muted-foreground">A cron schedule, in the VM's clock (UTC). The agent's reply goes where the prompt says, through its Spaces tools; name the space.</span>
            </form>
        </div>
    )
}

/**
 * The management area on a managed agent's page, once the hosting is ready:
 * the machine line is read at once; each fold loads when opened.
 */
export function HostingManagement({ orgId, agent, hermes }: { orgId: string; agent: spaces.Member; hermes: boolean }) {
    const [machine, setMachine] = useState<spaces.HostingMachine | undefined>(undefined)
    const [env, setEnv] = useState<spaces.HostingEnvVar[] | null>(null)
    const [open, setOpen] = useState<Record<string, boolean>>({ machine: true })
    const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))
    useEffect(() => {
        let gone = false
        window.ipc
            .invoke('spaces:getHosting', { orgId, agentId: agent.id })
            .then((page) => {
                if (gone) return
                setMachine(page.machine)
                setEnv(page.env)
            })
            .catch((err: unknown) => {
                if (gone) return
                fail(err, 'Could not read the hosting')
                setEnv([])
            })
        return () => {
            gone = true
        }
    }, [orgId, agent.id])
    return (
        <div className="flex min-w-0 flex-col gap-4">
            <Fold title="Machine" open={open.machine === true} onToggle={() => toggle('machine')}>
                <MachineSection orgId={orgId} agentId={agent.id} machine={machine} onMachine={setMachine} />
            </Fold>
            <Fold title="Environment variables" note="On the VM. A secret is kept by Maritime and never shown again. Restart, or reload the environment, to apply a change." open={open.env === true} onToggle={() => toggle('env')}>
                {env === null ? <p className="text-[11px] text-muted-foreground">Loading…</p> : <EnvSection orgId={orgId} agentId={agent.id} env={env} onEnv={setEnv} />}
            </Fold>
            <Fold title="Run a command" note="One command at a time, as root on the VM. Not a shell: nothing persists between commands." open={open.command === true} onToggle={() => toggle('command')}>
                <CommandSection orgId={orgId} agentId={agent.id} />
            </Fold>
            <Fold title="Logs" note="Maritime's logs for the VM, newest first." open={open.logs === true} onToggle={() => toggle('logs')}>
                {open.logs && <LogsSection orgId={orgId} agentId={agent.id} />}
            </Fold>
            <Fold title="Files" note="The VM's volume. Text files open to edit." open={open.files === true} onToggle={() => toggle('files')}>
                {open.files && <FilesSection orgId={orgId} agentId={agent.id} home={HOME[agent.agentKind ?? ''] ?? '/'} />}
            </Fold>
            {hermes && (
                <Fold title="Skills" note="What Hermes can do on this VM, and Maritime's catalog to add from." open={open.skills === true} onToggle={() => toggle('skills')}>
                    {open.skills && <SkillsSection orgId={orgId} agentId={agent.id} />}
                </Fold>
            )}
            {hermes && (
                <Fold title="Automations" note="Maritime runs the prompt on the schedule, in the VM; the agent posts wherever the prompt says." open={open.triggers === true} onToggle={() => toggle('triggers')}>
                    {open.triggers && <TriggersSection orgId={orgId} agentId={agent.id} />}
                </Fold>
            )}
        </div>
    )
}
