import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Folder, Loader2, Play, RefreshCw, Square } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { HOME, fail, type HostingState } from '@/components/spaces/agent-hosting-state'
import { ConfirmButton, DangerRow, Empty, FormCard, Row, RowAction, Rows, ScreenHeader, Subhead, Tag } from '@/components/spaces/agent-tabs'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// Managing a managed agent's VM from its page (2026-10-27, Harbor spec §8
// Maritime, the management area). The owner has no login on the platform,
// so everything goes through Harbor on the deployment's key: the machine and
// its power, environment variables (a secret's value is never read back),
// one shell command at a time with its output, the platform's logs, the VM's
// files, and for Hermes the VM's skills and the platform's triggers. Each is
// a tab on the agent page; what cannot be undone (deleting a variable, a
// path, a skill, an automation, the agent itself) is on the Danger zone tab
// and asks once more. The page (agent-page.tsx) composes the tabs; the state
// they share is in agent-hosting-state.ts.

const COMMAND_POLL_MS = 1_000
const SELECT = 'h-8 max-w-[14rem] min-w-0 rounded-md border border-border bg-background px-2 font-mono text-xs disabled:opacity-60'

/** The machine as Maritime sees it, with a lamp, and its power: wake or sleep, restart, reload the environment. */
export function MachineBlock({ orgId, agentId, state }: { orgId: string; agentId: string; state: HostingState }) {
    const { machine, setMachine } = state
    const [busy, setBusy] = useState<string | null>(null)
    const act = async (action: spaces.HostingPowerAction) => {
        setBusy(action)
        try {
            setMachine((await window.ipc.invoke('spaces:hostingPower', { orgId, agentId, action })).machine)
            toast(action === 'wake' ? 'Awake' : action === 'sleep' ? 'Asleep' : action === 'restart' ? 'Restarting' : 'Environment reloaded', 'success')
        } catch (err) {
            fail(err, `Could not ${action}`)
        } finally {
            setBusy(null)
        }
    }
    const asleep = machine?.status === 'sleeping' || machine?.status === 'stopped'
    const awake = machine?.status === 'active' || machine?.status === 'running'
    const button = (action: spaces.HostingPowerAction, label: string) => (
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(action)}>
            {busy === action ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {label}
        </Button>
    )
    return (
        <div role="group" aria-label="Machine" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border p-3">
            <div className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
                <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-full ring-4', awake ? 'bg-emerald-500 ring-emerald-500/15' : asleep ? 'bg-muted-foreground/50 ring-muted-foreground/10' : 'bg-amber-500 ring-amber-500/15')} />
                <div className="min-w-0">
                    <p className="text-sm leading-tight font-semibold text-foreground capitalize">{machine ? machine.status.replace(/_/g, ' ') : 'Unknown'}</p>
                    <p className="text-[11px] text-muted-foreground">{machine ? `${machine.tier ? `${machine.tier.replace(/_/g, ' ')} tier · ` : ''}as Maritime sees it` : 'Maritime could not be asked about the machine just now.'}</p>
                </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {asleep ? button('wake', 'Wake') : button('sleep', 'Sleep')}
                {button('restart', 'Restart')}
                {button('reload', 'Reload environment')}
            </div>
        </div>
    )
}

/** Environment variables on the VM: a secret shows as set, never its value; a reload or restart applies changes. */
export function EnvScreen({ orgId, agentId, state }: { orgId: string; agentId: string; state: HostingState }) {
    const { env, setEnv, setMachine } = state
    const [key, setKey] = useState('')
    const [value, setValue] = useState('')
    const [secret, setSecret] = useState(true)
    const [busy, setBusy] = useState(false)
    const [reloading, setReloading] = useState(false)
    const valueField = useRef<HTMLInputElement>(null)
    const valid = /^[A-Z_][A-Z0-9_]{0,255}$/.test(key)
    const replacing = env?.some((v) => v.key === key) === true
    const save = async () => {
        if (!valid || busy) return
        setBusy(true)
        try {
            setEnv((await window.ipc.invoke('spaces:setHostingEnv', { orgId, agentId, key, value, secret })).env)
            setKey('')
            setValue('')
            toast(`${key} saved. Reload the environment to apply it.`, 'success')
        } catch (err) {
            fail(err, 'Could not save the variable')
        } finally {
            setBusy(false)
        }
    }
    const reload = async () => {
        setReloading(true)
        try {
            setMachine((await window.ipc.invoke('spaces:hostingPower', { orgId, agentId, action: 'reload' })).machine)
            toast('Environment reloaded', 'success')
        } catch (err) {
            fail(err, 'Could not reload the environment')
        } finally {
            setReloading(false)
        }
    }
    return (
        <>
            <ScreenHeader
                title="Environment"
                note="Variables on the VM. A secret is kept by Maritime and never shown again. A change applies after Reload environment, or a restart."
                action={
                    <Button size="sm" variant="outline" disabled={reloading} onClick={() => void reload()}>
                        {reloading && <Loader2 className="size-3.5 animate-spin" />}
                        Reload environment
                    </Button>
                }
            />
            <FormCard title={replacing ? `Replace ${key}` : 'Add a variable'} onSubmit={() => void save()}>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="KEY" aria-label="Variable name" className="h-8 w-40 font-mono text-xs" />
                    <Input ref={valueField} type={secret ? 'password' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" aria-label="Variable value" className="h-8 min-w-0 flex-1 basis-40 font-mono text-xs" autoComplete="off" />
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} aria-label="Secret" /> secret
                    </label>
                    <Button type="submit" size="sm" disabled={!valid || busy}>
                        {busy && <Loader2 className="size-3.5 animate-spin" />}
                        {replacing ? 'Replace variable' : 'Add variable'}
                    </Button>
                </div>
            </FormCard>
            {env === null ? (
                <Empty>Loading…</Empty>
            ) : env.length === 0 ? (
                <Empty>No environment variables.</Empty>
            ) : (
                <Rows label="Environment variables">
                    {env.map((v) => (
                        <Row key={v.key} className="font-mono">
                            <span className="shrink-0 font-medium text-foreground">{v.key}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{v.secret ? '••••••••' : v.value}</span>
                            {v.secret && <Tag tone="warn">secret</Tag>}
                            {v.warning && <Tag tone="warn" title={v.warning}>!</Tag>}
                            <RowAction
                                disabled={busy}
                                onClick={() => {
                                    setKey(v.key)
                                    setSecret(v.secret)
                                    setValue('')
                                    valueField.current?.focus()
                                }}
                            >
                                Replace
                            </RowAction>
                        </Row>
                    ))}
                </Rows>
            )}
        </>
    )
}

/** One shell command on the VM, read every second until it ends. Nothing persists between commands. */
export function CommandsScreen({ orgId, agentId }: { orgId: string; agentId: string }) {
    const [command, setCommand] = useState('')
    const [execution, setExecution] = useState<spaces.HostingExecution | null>(null)
    const [busy, setBusy] = useState(false)
    const running = execution?.status === 'running'

    useEffect(() => {
        if (!running || !execution) return
        const id = execution.id
        const timer = setInterval(async () => {
            try {
                const { execution: next } = await window.ipc.invoke('spaces:getHostingCommand', { orgId, agentId, executionId: id })
                setExecution(next)
            } catch (err) {
                fail(err, 'Lost the command')
                setExecution((e) => (e ? { ...e, status: 'failed' } : e))
            }
        }, COMMAND_POLL_MS)
        return () => clearInterval(timer)
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
    const stop = async () => {
        if (!execution) return
        try {
            setExecution((await window.ipc.invoke('spaces:cancelHostingCommand', { orgId, agentId, executionId: execution.id })).execution)
        } catch (err) {
            fail(err, 'Could not stop the command')
        }
    }
    const outcome = !execution ? '' : running ? 'Running…' : execution.status === 'cancelled' ? 'Stopped.' : `Exited ${execution.exitCode ?? '?'}.`
    return (
        <>
            <ScreenHeader title="Commands" note="One command at a time, as root on the VM. Not a shell: nothing persists between commands. Ten minutes at most." />
            <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                    e.preventDefault()
                    void run()
                }}
            >
                <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="ls -la /opt/data" aria-label="Command" className="h-9 min-w-0 flex-1 font-mono text-xs" spellCheck={false} disabled={running} />
                {running ? (
                    <Button type="button" variant="outline" onClick={() => void stop()}>
                        <Square className="size-3" /> Stop
                    </Button>
                ) : (
                    <Button type="submit" disabled={!command.trim() || busy}>
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3" />} Run
                    </Button>
                )}
            </form>
            {execution && (
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <Tag tone={running ? 'accent' : execution.exitCode === 0 ? 'muted' : 'warn'}>{running ? 'running' : execution.status === 'cancelled' ? 'stopped' : `exit ${execution.exitCode ?? '?'}`}</Tag>
                        <p role="status" className="text-[11px] text-muted-foreground">{outcome}</p>
                        {!running && (
                            <RowAction className="ml-auto" onClick={() => setExecution(null)}>
                                Clear
                            </RowAction>
                        )}
                    </div>
                    {(execution.stdout || execution.stderr) && (
                        <pre aria-label="Command output" className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap">
                            {execution.stdout}
                            {execution.stderr && <span className="text-destructive">{execution.stderr}</span>}
                        </pre>
                    )}
                </div>
            )}
        </>
    )
}

const LEVELS: Array<{ label: string; level: string | undefined }> = [
    { label: 'All', level: undefined },
    { label: 'Info', level: 'info' },
    { label: 'Warnings', level: 'warning' },
    { label: 'Errors', level: 'error' },
]

/** The platform's logs for the VM, newest first, by level, older on request. */
export function LogsScreen({ orgId, agentId }: { orgId: string; agentId: string }) {
    const [logs, setLogs] = useState<spaces.HostingLogLine[] | null>(null)
    const [nextBefore, setNextBefore] = useState<string | undefined>(undefined)
    const [level, setLevel] = useState<string | undefined>(undefined)
    const [busy, setBusy] = useState(false)
    const load = useCallback(
        async (lvl: string | undefined, before?: string) => {
            setBusy(true)
            try {
                const page = await window.ipc.invoke('spaces:getHostingLogs', { orgId, agentId, limit: 100, ...(before ? { before } : {}), ...(lvl ? { level: lvl } : {}) })
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
        void load(level)
    }, [load, level])
    return (
        <>
            <ScreenHeader
                title="Logs"
                note="Maritime's logs for the VM, newest first."
                action={
                    <Button size="sm" disabled={busy} onClick={() => void load(level)}>
                        <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} /> Refresh
                    </Button>
                }
            />
            <div role="group" aria-label="Level" className="inline-flex self-start overflow-hidden rounded-md border border-border">
                {LEVELS.map((l) => (
                    <button
                        key={l.label}
                        type="button"
                        aria-pressed={l.level === level}
                        disabled={busy}
                        onClick={() => setLevel(l.level)}
                        className={cn('h-7 border-l border-border px-2.5 text-xs font-medium first:border-l-0', l.level === level ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    >
                        {l.label}
                    </button>
                ))}
            </div>
            {logs === null ? (
                <Empty>Loading…</Empty>
            ) : logs.length === 0 ? (
                <Empty>No log lines.</Empty>
            ) : (
                <ol aria-label="Logs" className="max-h-80 overflow-auto rounded-lg border border-border bg-muted/40 py-1.5 font-mono text-xs">
                    {logs.map((l) => {
                        const bad = /warn|error/i.test(l.level)
                        return (
                            <li key={l.id} className="grid grid-cols-[8.5ch_5ch_minmax(0,1fr)] gap-x-2.5 px-2.5 leading-relaxed">
                                <span className="text-muted-foreground/70 tabular-nums">{l.timestamp.replace('T', ' ').slice(11, 19)}</span>
                                <span className={bad ? 'text-destructive' : 'text-muted-foreground'}>{l.level.toLowerCase().replace(/^warning$/, 'warn').slice(0, 5)}</span>
                                <span className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', bad && 'text-destructive')}>{l.message}</span>
                            </li>
                        )
                    })}
                </ol>
            )}
            {nextBefore && (
                <Button size="sm" variant="outline" className="self-start" disabled={busy} onClick={() => void load(level, nextBefore)}>
                    Older
                </Button>
            )}
        </>
    )
}

/** The VM's files: a directory at a time; a text file opens to edit; new folder, rename. Delete is on the Danger zone. */
export function FilesScreen({ orgId, agentId, home }: { orgId: string; agentId: string; home: string }) {
    const [path, setPath] = useState(home)
    const [entries, setEntries] = useState<spaces.HostingFileEntry[] | null>(null)
    const [open, setOpen] = useState<{ path: string; content: string; truncated: boolean } | null>(null)
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)
    const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
    const [folder, setFolder] = useState<string | null>(null)

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
            setRenaming(null)
            setFolder(null)
        }
    }
    const dir = path.replace(/\/+$/, '')
    const parent = dir.split('/').slice(0, -1).join('/') || '/'
    return (
        <>
            <ScreenHeader
                title="Files"
                note="The VM's volume. Text files open to edit."
                action={
                    <Button size="sm" variant="outline" disabled={busy || folder !== null} onClick={() => setFolder('')}>
                        New folder
                    </Button>
                }
            />
            <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                    e.preventDefault()
                    void list(path)
                }}
            >
                <Input value={path} onChange={(e) => setPath(e.target.value)} aria-label="Directory" className="h-8 min-w-0 flex-1 font-mono text-xs" spellCheck={false} />
                <Button type="submit" size="sm" variant="outline" disabled={busy}>Go</Button>
                {path !== '/' && (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void list(parent)}>
                        Up
                    </Button>
                )}
            </form>
            {folder !== null && (
                <FormCard title={`New folder in ${dir || '/'}`} onSubmit={() => folder.trim() && void act(() => window.ipc.invoke('spaces:makeHostingDir', { orgId, agentId, path: `${dir}/${folder.trim()}` }), 'Could not make the folder')}>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="name" aria-label="Folder name" className="h-8 w-56 font-mono text-xs" autoFocus />
                        <Button type="submit" size="sm" disabled={!folder.trim() || busy}>Create folder</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setFolder(null)}>Cancel</Button>
                    </div>
                </FormCard>
            )}
            {entries === null ? (
                <Empty>Loading…</Empty>
            ) : (
                <Rows label="Files" className="max-h-72 overflow-auto">
                    {entries.length === 0 && <Row className="text-muted-foreground">Empty.</Row>}
                    {entries.map((e) => (
                        <Row key={e.path} className="font-mono">
                            <button type="button" disabled={busy} onClick={() => (e.kind === 'dir' ? void list(e.path) : void read(e.path))} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground">
                                {e.kind === 'dir' ? <Folder className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
                                <span className="truncate">{e.name}{e.kind === 'dir' ? '/' : ''}</span>
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
                                    <Input value={renaming.to} onChange={(ev) => setRenaming({ from: renaming.from, to: ev.target.value })} aria-label="New path" className="h-7 w-56 font-mono text-xs" autoFocus />
                                    <Button type="submit" size="xs" disabled={busy}>Move</Button>
                                    <Button type="button" size="xs" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                                </form>
                            ) : (
                                <RowAction disabled={busy} onClick={() => setRenaming({ from: e.path, to: e.path })}>Rename</RowAction>
                            )}
                        </Row>
                    ))}
                </Rows>
            )}
            {open && (
                <div className="overflow-hidden rounded-lg border border-border">
                    <div className="flex items-center gap-2 border-b border-border bg-muted/40 py-1.5 pr-1.5 pl-3">
                        <span className="min-w-0 truncate font-mono text-xs font-medium text-foreground">{open.path}</span>
                        {open.truncated && <Tag tone="warn">cut at 1 MB</Tag>}
                        {draft !== open.content && <Tag tone="accent">edited</Tag>}
                        <div className="ml-auto flex gap-1">
                            <Button size="xs" disabled={busy || open.truncated || draft === open.content} onClick={() => void save()}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={() => setOpen(null)}>Close</Button>
                        </div>
                    </div>
                    <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="File content" className="min-h-40 rounded-none border-0 font-mono text-xs focus-visible:ring-0" spellCheck={false} />
                </div>
            )}
        </>
    )
}

/** Skills on a Hermes VM, and the platform catalog's matches to install. Removing one is on the Danger zone. */
export function SkillsScreen({ orgId, agentId, state }: { orgId: string; agentId: string; state: HostingState }) {
    const { skills, setSkills, loadSkills } = state
    const [q, setQ] = useState('')
    const [found, setFound] = useState<spaces.HostingSkill[] | null>(null)
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        if (skills === null) void loadSkills()
    }, [skills, loadSkills])
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
            setSkills((await window.ipc.invoke('spaces:installHostingSkill', { orgId, agentId, name })).skills)
            setFound((f) => f?.map((s) => (s.name === name ? { ...s, installed: true } : s)) ?? f)
            toast(`${name} installed`, 'success')
        } catch (err) {
            fail(err, 'Could not install the skill')
        } finally {
            setBusy(false)
        }
    }
    return (
        <>
            <ScreenHeader title="Skills" note="What Hermes can do on this VM. Rowboat installs rowboat-spaces itself; the rest comes from Maritime's catalog." />
            <div className="flex flex-col gap-2">
                <Subhead>Installed</Subhead>
                {skills === null ? (
                    <Empty>Loading…</Empty>
                ) : skills.length === 0 ? (
                    <Empty>No skills on the VM.</Empty>
                ) : (
                    <Rows label="Installed skills">
                        {skills.map((s) => (
                            <Row key={s.name}>
                                <span className="shrink-0 font-medium text-foreground">{s.name}</span>
                                {s.version && <Tag>{s.version}</Tag>}
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.description}</span>
                            </Row>
                        ))}
                    </Rows>
                )}
            </div>
            <FormCard title="Add from the catalog" onSubmit={() => void search()}>
                <div className="flex items-center gap-1.5">
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog" aria-label="Skill search" className="h-8 min-w-0 flex-1 text-xs" />
                    <Button type="submit" size="sm" variant="outline" disabled={!q.trim() || busy}>Search</Button>
                </div>
                {found && (
                    <Rows label="Catalog skills">
                        {found.length === 0 && <Row className="text-muted-foreground">Nothing matched.</Row>}
                        {found.map((s) => (
                            <Row key={s.name}>
                                <span className="shrink-0 font-medium text-foreground">{s.name}</span>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.description}</span>
                                {s.installed ? <Tag>installed</Tag> : <Button size="xs" disabled={busy} onClick={() => void install(s.name)}>Install</Button>}
                            </Row>
                        ))}
                    </Rows>
                )}
            </FormCard>
        </>
    )
}

/** Triggers the platform fires on a Hermes agent: a cron schedule and the prompt it sends. Deleting one is on the Danger zone. */
export function TriggersScreen({ orgId, agentId, state }: { orgId: string; agentId: string; state: HostingState }) {
    const { triggers, setTriggers, loadTriggers } = state
    const [schedule, setSchedule] = useState('')
    const [prompt, setPrompt] = useState('')
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        if (triggers === null) void loadTriggers()
    }, [triggers, loadTriggers])
    const add = async () => {
        if (!schedule.trim() || !prompt.trim() || busy) return
        setBusy(true)
        try {
            setTriggers((await window.ipc.invoke('spaces:createHostingTrigger', { orgId, agentId, type: 'cron', config: { schedule: schedule.trim(), prompt: prompt.trim() } })).triggers)
            setSchedule('')
            setPrompt('')
        } catch (err) {
            fail(err, 'Could not add the automation')
        } finally {
            setBusy(false)
        }
    }
    const toggle = async (t: spaces.HostingTrigger) => {
        setBusy(true)
        try {
            setTriggers((await window.ipc.invoke('spaces:updateHostingTrigger', { orgId, agentId, triggerId: t.id, enabled: !t.enabled })).triggers)
        } catch (err) {
            fail(err, 'Could not change the automation')
        } finally {
            setBusy(false)
        }
    }
    return (
        <>
            <ScreenHeader title="Automations" note="Maritime runs the prompt on the schedule, inside the VM. The agent's reply goes where the prompt says, through its Spaces tools; name the space. Times are UTC." />
            <FormCard title="New automation" onSubmit={() => void add()}>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * 1-5" aria-label="Schedule" className="h-8 w-36 font-mono text-xs" />
                    <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What to do, and where to post it" aria-label="Prompt" className="h-8 min-w-0 flex-1 basis-48 text-xs" />
                    <Button type="submit" size="sm" disabled={!schedule.trim() || !prompt.trim() || busy}>Add automation</Button>
                </div>
            </FormCard>
            {triggers === null ? (
                <Empty>Loading…</Empty>
            ) : triggers.length === 0 ? (
                <Empty>No automations yet.</Empty>
            ) : (
                <Rows label="Automations">
                    {triggers.map((t) => (
                        <Row key={t.id}>
                            <span className="shrink-0 font-mono font-medium text-foreground">{triggerText(t.config.schedule) || t.type}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{triggerText(t.config.prompt)}</span>
                            <RowAction disabled={busy} pressed={t.enabled} onClick={() => void toggle(t)}>
                                {t.enabled ? 'On' : 'Off'}
                            </RowAction>
                        </Row>
                    ))}
                </Rows>
            )}
        </>
    )
}

function triggerText(v: unknown): string {
    return typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v)
}

/** The Danger zone's rows for the VM: delete a variable, a path, and for Hermes a skill or an automation. */
export function HostingDangerRows({ orgId, agent, hermes, state }: { orgId: string; agent: spaces.Member; hermes: boolean; state: HostingState }) {
    const agentId = agent.id
    const { env, setEnv, skills, setSkills, loadSkills, triggers, setTriggers, loadTriggers, bumpFiles } = state
    const [variable, setVariable] = useState('')
    const [path, setPath] = useState('')
    const [skill, setSkill] = useState('')
    const [trigger, setTrigger] = useState('')
    const [busy, setBusy] = useState<string | null>(null)
    useEffect(() => {
        if (hermes && skills === null) void loadSkills()
        if (hermes && triggers === null) void loadTriggers()
    }, [hermes, skills, loadSkills, triggers, loadTriggers])

    const chosenVariable = variable || env?.[0]?.key || ''
    const chosenSkill = skill || skills?.[0]?.name || ''
    const chosenTrigger = trigger || triggers?.[0]?.id || ''
    const home = HOME[agent.agentKind ?? ''] ?? '/'

    const run = async (what: string, go: () => Promise<void>, fallback: string) => {
        setBusy(what)
        try {
            await go()
        } catch (err) {
            fail(err, fallback)
        } finally {
            setBusy(null)
        }
    }
    return (
        <>
            <DangerRow title="Delete an environment variable" note="The agent keeps the old value until the environment is reloaded. A secret cannot be recovered.">
                <select aria-label="Variable" value={chosenVariable} disabled={!env?.length || busy !== null} onChange={(e) => setVariable(e.target.value)} className={SELECT}>
                    {(env ?? []).map((v) => (
                        <option key={v.key} value={v.key}>{v.key}</option>
                    ))}
                </select>
                <ConfirmButton
                    label="Delete variable"
                    confirmLabel={`Confirm delete ${chosenVariable}`}
                    disabled={!chosenVariable}
                    busy={busy === 'env'}
                    onConfirm={() =>
                        void run(
                            'env',
                            async () => {
                                setEnv((await window.ipc.invoke('spaces:deleteHostingEnv', { orgId, agentId, key: chosenVariable })).env)
                                setVariable('')
                                toast(`${chosenVariable} deleted`, 'success')
                            },
                            'Could not delete the variable',
                        )
                    }
                />
            </DangerRow>
            <DangerRow title="Delete a file or folder" note="From the VM's volume. A folder goes with everything in it.">
                <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder={`${home}/…`} aria-label="Path" className="h-8 w-60 max-w-full font-mono text-xs" spellCheck={false} />
                <ConfirmButton
                    label="Delete path"
                    confirmLabel="Confirm delete"
                    disabled={!path.trim()}
                    busy={busy === 'path'}
                    onConfirm={() =>
                        void run(
                            'path',
                            async () => {
                                await window.ipc.invoke('spaces:deleteHostingFile', { orgId, agentId, path: path.trim() })
                                toast(`${path.trim()} deleted`, 'success')
                                setPath('')
                                bumpFiles()
                            },
                            'Could not delete it',
                        )
                    }
                />
            </DangerRow>
            {hermes && (
                <DangerRow title="Remove a skill" note="Hermes loses it on its next turn. Installing it again from the catalog brings it back.">
                    <select aria-label="Skill" value={chosenSkill} disabled={!skills?.length || busy !== null} onChange={(e) => setSkill(e.target.value)} className={SELECT}>
                        {(skills ?? []).map((s) => (
                            <option key={s.name} value={s.name}>{s.name}</option>
                        ))}
                    </select>
                    <ConfirmButton
                        label="Remove skill"
                        confirmLabel={`Confirm remove ${chosenSkill}`}
                        disabled={!chosenSkill}
                        busy={busy === 'skill'}
                        onConfirm={() =>
                            void run(
                                'skill',
                                async () => {
                                    setSkills((await window.ipc.invoke('spaces:removeHostingSkill', { orgId, agentId, name: chosenSkill })).skills)
                                    setSkill('')
                                    toast(`${chosenSkill} removed`, 'success')
                                },
                                'Could not remove the skill',
                            )
                        }
                    />
                </DangerRow>
            )}
            {hermes && (
                <DangerRow title="Delete an automation" note="Turning one off on the Automations tab keeps it. Deleting drops the schedule and its prompt.">
                    <select aria-label="Automation" value={chosenTrigger} disabled={!triggers?.length || busy !== null} onChange={(e) => setTrigger(e.target.value)} className={SELECT}>
                        {(triggers ?? []).map((t) => (
                            <option key={t.id} value={t.id}>{`${triggerText(t.config.schedule) || t.type} · ${triggerText(t.config.prompt).slice(0, 40)}`}</option>
                        ))}
                    </select>
                    <ConfirmButton
                        label="Delete automation"
                        confirmLabel="Confirm delete"
                        disabled={!chosenTrigger}
                        busy={busy === 'trigger'}
                        onConfirm={() =>
                            void run(
                                'trigger',
                                async () => {
                                    setTriggers((await window.ipc.invoke('spaces:deleteHostingTrigger', { orgId, agentId, triggerId: chosenTrigger })).triggers)
                                    setTrigger('')
                                    toast('Automation deleted', 'success')
                                },
                                'Could not delete the automation',
                            )
                        }
                    />
                </DangerRow>
            )}
        </>
    )
}
