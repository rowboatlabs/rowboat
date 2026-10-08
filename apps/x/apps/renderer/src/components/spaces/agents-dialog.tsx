import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Bot, Check, ChevronRight, Hash, Loader2, MessageSquare, Plus } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { AgentPage } from '@/components/spaces/agent-page'
import { AgentLogo, ConnectAgent } from '@/components/spaces/agent-setup'
import { MemberAvatar } from '@/components/spaces/atoms'
import { refreshMembers, refreshOrgRoster, useOrgRoster } from '@/hooks/use-space-members'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { AGENT_SETUPS, agentLabel, agentSetup, kindInfo, setupFor, type AgentSetup } from '@/lib/agent-kinds'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// Agents (Harbor spec §4 Agent members, 2026-09-29): add an agent you own,
// connect whatever runs it, rotate and revoke keys. A key's secret is shown
// once, right after it is made, and never again — the org keeps only its
// hash. You see the agents you own; an admin sees every one and can revoke,
// never mint.
//
// Four screens, one job each (2026-09-30; the agent's page, 2026-10-01): the
// list, a roster to click into; adding one, which starts with how it connects
// (lib/agent-kinds.ts: Hermes, Replicas with its coding agent and key, Conductor, or
// Custom); connecting it with its new key, by the steps its setup gives; and
// its page (agent-page.tsx): its option defaults, its setup steps any time
// after, its keys, and a platform agent's key (Replicas) with Replace.

type Screen =
    | { name: 'list' }
    | { name: 'add' }
    | { name: 'connect'; agentId: string; agentName: string; secret: string; setupId: string; kind: string }
    | { name: 'agent'; agentId: string }

function Header({ title, description, icon, onBack }: { title: string; description: string; icon?: ReactNode; onBack?: () => void }) {
    return (
        <DialogHeader className="gap-1 border-b border-border px-5 pt-5 pb-4 text-left">
            <div className="flex min-w-0 items-center gap-2 pr-8">
                {onBack && (
                    <button
                        type="button"
                        aria-label="Back"
                        onClick={onBack}
                        className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        <ArrowLeft className="size-4" />
                    </button>
                )}
                {icon}
                <DialogTitle className="truncate text-sm">{title}</DialogTitle>
            </div>
            <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>
    )
}

function Body({ children }: { children: ReactNode }) {
    return <div className="max-h-[calc(100vh-13rem)] min-w-0 overflow-y-auto px-5 py-4">{children}</div>
}

function Footer({ children }: { children: ReactNode }) {
    return <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{children}</div>
}

function SetupTile({ setup, selected, onSelect }: { setup: AgentSetup; selected: boolean; onSelect: () => void }) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={setup.label}
            onClick={onSelect}
            className={cn(
                'flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                selected ? 'border-foreground/50 bg-accent ring-1 ring-foreground/20' : 'border-border hover:bg-accent/50',
            )}
        >
            <AgentLogo logo={setup.logo} className="size-9" />
            <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground">{setup.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{setup.description}</span>
            </span>
        </button>
    )
}

/**
 * Where the new agent goes: your DM with it, and which of your spaces it joins,
 * all by default, each one a tick. `direct` null hides the DM row (a setup that
 * opens the DM itself).
 */
function SpacePicker({ spaces: list, skipped, onChange, direct, onDirectChange }: {
    spaces: spaces.Space[]
    skipped: ReadonlySet<string>
    onChange: (skipped: ReadonlySet<string>) => void
    direct: boolean | null
    onDirectChange: (on: boolean) => void
}) {
    if (list.length === 0 && direct === null) return null
    const allIn = skipped.size === 0
    const toggle = (id: string) => {
        const next = new Set(skipped)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        onChange(next)
    }
    return (
        <div className="mt-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Add it to</span>
                {list.length > 1 && <button
                    type="button"
                    onClick={() => onChange(allIn ? new Set(list.map((space) => space.id)) : new Set())}
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                    {allIn ? 'None' : 'All spaces'}
                </button>}
            </div>
            <ul aria-label="Add it to" className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-border">
                {direct !== null && (
                    <li className="border-b border-border last:border-b-0">
                        <PickRow on={direct} label="Direct message" icon={<MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />} onClick={() => onDirectChange(!direct)} />
                    </li>
                )}
                {list.map((space) => {
                    const on = !skipped.has(space.id)
                    return (
                        <li key={space.id} className="border-b border-border last:border-b-0">
                            <PickRow on={on} label={`#${space.name}`} text={space.name} icon={<Hash className="size-3.5 shrink-0 text-muted-foreground" />} onClick={() => toggle(space.id)} />
                        </li>
                    )
                })}
            </ul>
            <span className="text-[11px] text-muted-foreground">Anyone in these spaces can mention it, or DM it. You can add it to more later from its page.</span>
        </div>
    )
}

function PickRow({ on, label, text, icon, onClick }: { on: boolean; label: string; text?: string; icon: ReactNode; onClick: () => void }) {
    return (
        <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={onClick} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent">
            <span className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                {on && <Check className="size-2.5" />}
            </span>
            {icon}
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{text ?? label}</span>
        </button>
    )
}

/** The coding agent a Replicas agent runs: its kind. */
function KindChoice({ kinds, selected, onSelect }: { kinds: readonly string[]; selected: string; onSelect: (kind: string) => void }) {
    return (
        <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Coding agent</span>
            <div role="radiogroup" aria-label="Coding agent" className="flex flex-wrap gap-1.5">
                {kinds.map((k) => (
                    <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={k === selected}
                        aria-label={kindInfo(k).label}
                        onClick={() => onSelect(k)}
                        className={cn(
                            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs',
                            k === selected ? 'border-foreground/50 bg-accent font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        )}
                    >
                        <AgentLogo logo={kindInfo(k).logo} className="size-4" />
                        {kindInfo(k).label}
                    </button>
                ))}
            </div>
        </div>
    )
}

/** A platform agent's key: its end, whether the platform rejected it, and Replace for the owner. */
export function AgentsDialog({ org, open, onOpenChange }: {
    org: OrgWithSpaces
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const roster = useOrgRoster(org.id, spaceIds)
    const names = useMemo(() => new Map(roster.map((m) => [m.id, m.displayName])), [roster])
    const isAdmin = roster.find((m) => m.id === org.memberId)?.role === 'admin'
    const [agents, setAgents] = useState<spaces.AgentListing[] | null>(null)
    const [screen, setScreen] = useState<Screen>({ name: 'list' })
    const [busy, setBusy] = useState(false)
    const [chosen, setChosen] = useState<string | null>(null)
    const [chosenKind, setChosenKind] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [nameEdited, setNameEdited] = useState(false)
    const [credential, setCredential] = useState('')
    const [addError, setAddError] = useState<string | null>(null)
    // The spaces a new agent joins on Add: every one of yours unless unticked (2026-10-08).
    const [skippedSpaces, setSkippedSpaces] = useState<ReadonlySet<string>>(new Set())
    const [withDirect, setWithDirect] = useState(true)
    // Until the person picks, the first way to connect, and its first kind.
    const setup = AGENT_SETUPS.find((k) => k.id === chosen) ?? AGENT_SETUPS[0]!
    const kind = chosenKind && setup.kinds.includes(chosenKind) ? chosenKind : setup.kinds[0]!
    // The name suggests the setup's own, or the kind's, until the person types one.
    const shownName = nameEdited ? name : setup.defaultName || kindInfo(kind).label
    const ready = shownName.trim() !== '' && (!setup.credential || credential.trim() !== '')

    const load = useCallback(async () => {
        try {
            setAgents((await window.ipc.invoke('spaces:listAgents', { orgId: org.id })).agents)
        } catch (err) {
            setAgents([])
            toast(err instanceof Error ? err.message : 'Could not load agents', 'error')
        }
    }, [org.id])

    useEffect(() => {
        if (!open) return
        setScreen({ name: 'list' })
        setAgents(null)
        void load()
    }, [open, load])

    const startAdding = () => {
        setChosen(null)
        setChosenKind(null)
        setName('')
        setNameEdited(false)
        setCredential('')
        setAddError(null)
        setSkippedSpaces(new Set())
        setWithDirect(true)
        setScreen({ name: 'add' })
    }

    // A refused platform key shows under its field, not as a toast: nothing was created.
    const add = async () => {
        if (busy) return
        setBusy(true)
        setAddError(null)
        try {
            const { agent, key } = await window.ipc.invoke('spaces:addAgent', {
                orgId: org.id,
                displayName: shownName.trim(),
                kind,
                connection: setup.connection,
                ...(setup.credential ? { credential: credential.trim() } : {}),
            })
            setCredential('')
            // Into the spaces picked on this form; one that refuses doesn't undo the agent.
            const into = org.spaces.filter((space) => !skippedSpaces.has(space.id))
            const joined = await Promise.allSettled(
                into.map((space) => window.ipc.invoke('spaces:addMembers', { orgId: org.id, spaceId: space.id, memberIds: [agent.id] })),
            )
            joined.forEach((result, i) => result.status === 'fulfilled' && refreshMembers(org.id, into[i]!.id, { force: true }))
            const missed = into.filter((_, i) => joined[i]!.status === 'rejected').map((space) => `#${space.name}`)
            // Your DM with it, in the sidebar like any DM (Hermes's setup opens it as its home channel anyway).
            if (withDirect && !setup.wantsHomeChannel) {
                await window.ipc.invoke('spaces:openDirect', { orgId: org.id, memberId: agent.id }).catch(() => missed.push('your direct messages'))
            }
            if (missed.length > 0) toast(`Couldn't add ${agent.displayName} to ${missed.join(', ')}`, 'error')
            // Your new agent is on your roster (and so in Add people) right away.
            refreshOrgRoster(org.id)
            await load()
            setScreen({ name: 'connect', agentId: agent.id, agentName: agent.displayName, secret: key.secret, setupId: setup.id, kind })
        } catch (err) {
            setAddError(err instanceof Error ? err.message : 'Could not add the agent')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* One column that may shrink: long setup lines wrap inside it instead of widening the dialog. */}
            <DialogContent className={cn('grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden p-0', screen.name === 'connect' || screen.name === 'agent' ? 'sm:max-w-2xl' : 'sm:max-w-xl')}>
                {screen.name === 'list' && (
                    <>
                        <Header title={`Agents in ${org.name}`} description="Agents are members with their own key. Add one, connect what runs it, then add it to spaces." />
                        <Body>
                            {agents === null ? (
                                <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading agents…</div>
                            ) : agents.length === 0 ? (
                                <div className="flex flex-col items-center gap-2 py-8 text-center">
                                    <Bot className="size-6 text-muted-foreground" />
                                    <div className="text-sm font-medium">{isAdmin ? 'No agents in this server yet' : 'You have no agents yet'}</div>
                                    <div className="max-w-xs text-xs text-muted-foreground">Add one to connect Hermes, a coding agent in Replicas or Conductor, or anything that speaks the agent contract.</div>
                                </div>
                            ) : (
                                <ul className="-mx-2 flex flex-col">
                                    {agents.map(({ agent, keys, credential }) => {
                                        const mine = agent.ownerId === org.memberId
                                        const live = keys.filter((k) => !k.revokedAt)
                                        return (
                                            <li key={agent.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => setScreen({ name: 'agent', agentId: agent.id })}
                                                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-accent"
                                                >
                                                    <MemberAvatar id={agent.id} name={agent.displayName} size="md" agent agentKind={agent.agentKind} />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-medium">{agent.displayName}</div>
                                                        <div className="truncate text-[11px] text-muted-foreground">
                                                            {agentLabel(agent.agentKind, agent.agentConnection)}
                                                            {' · '}
                                                            {agent.ownerId ? (mine ? 'Yours' : `Owned by ${names.get(agent.ownerId) ?? 'another member'}`) : 'Managed by admins'}
                                                            {' · '}
                                                            {live.length === 0 ? 'no active keys' : live.length === 1 ? '1 key' : `${live.length} keys`}
                                                            {credential?.rejectedAt && <span className="text-destructive">{' · '}Key rejected</span>}
                                                        </div>
                                                    </div>
                                                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                                </button>
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                        </Body>
                        <Footer>
                            <Button size="sm" onClick={startAdding}>
                                <Plus className="size-3.5" /> Add agent
                            </Button>
                        </Footer>
                    </>
                )}

                {screen.name === 'add' && (
                    <form
                        className="contents"
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (ready) void add()
                        }}
                    >
                        <Header title="Add an agent" description="Choose what runs it. The steps to connect it come next." onBack={() => setScreen({ name: 'list' })} />
                        <Body>
                            <div role="radiogroup" aria-label="How it connects" className="grid grid-cols-2 gap-2">
                                {AGENT_SETUPS.map((k) => (
                                    <SetupTile
                                        key={k.id}
                                        setup={k}
                                        selected={k.id === setup.id}
                                        onSelect={() => {
                                            setChosen(k.id)
                                            setAddError(null)
                                        }}
                                    />
                                ))}
                            </div>
                            {setup.kinds.length > 1 && <KindChoice kinds={setup.kinds} selected={kind} onSelect={setChosenKind} />}
                            <label className="mt-4 flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-foreground">Name</span>
                                <Input
                                    value={shownName}
                                    onChange={(e) => {
                                        setNameEdited(true)
                                        setName(e.target.value)
                                    }}
                                    placeholder="e.g. Scout"
                                    aria-label="Agent name"
                                    className="h-9 text-sm"
                                    maxLength={128}
                                    autoFocus
                                />
                                <span className="text-[11px] text-muted-foreground">How it appears in Spaces, and what people type to mention it.</span>
                            </label>
                            {setup.credential && (
                                <label className="mt-4 flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-foreground">{setup.credential.label}</span>
                                    <Input
                                        type="password"
                                        value={credential}
                                        onChange={(e) => {
                                            setCredential(e.target.value)
                                            setAddError(null)
                                        }}
                                        placeholder={setup.credential.placeholder}
                                        aria-label={setup.credential.label}
                                        className="h-9 text-sm"
                                        autoComplete="off"
                                    />
                                    <span className="text-[11px] text-muted-foreground">{setup.credential.note}</span>
                                </label>
                            )}
                            <SpacePicker
                                spaces={org.spaces}
                                skipped={skippedSpaces}
                                onChange={setSkippedSpaces}
                                direct={setup.wantsHomeChannel ? null : withDirect}
                                onDirectChange={setWithDirect}
                            />
                            {addError && <div role="alert" className="mt-3 text-xs text-destructive">{addError}</div>}
                        </Body>
                        <Footer>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setScreen({ name: 'list' })}>Cancel</Button>
                            <Button type="submit" size="sm" disabled={!ready || busy}>
                                {busy && <Loader2 className="size-3.5 animate-spin" />}
                                Add agent
                            </Button>
                        </Footer>
                    </form>
                )}

                {screen.name === 'connect' && (
                    <>
                        <Header
                            title={`Connect ${screen.agentName}`}
                            description="This is the only time its key is shown. Finish these steps before you close this."
                            icon={<AgentLogo logo={kindInfo(screen.kind).logo ?? agentSetup(screen.setupId).logo} className="size-5" />}
                        />
                        <Body>
                            <ConnectAgent
                                org={org}
                                setup={agentSetup(screen.setupId)}
                                agentId={screen.agentId}
                                agentName={screen.agentName}
                                agentKey={screen.secret}
                            />
                        </Body>
                        <Footer>
                            <Button size="sm" onClick={() => setScreen({ name: 'list' })}>Done</Button>
                        </Footer>
                    </>
                )}

                {screen.name === 'agent' && (() => {
                    const listing = agents?.find((a) => a.agent.id === screen.agentId)
                    if (!listing) return null
                    const { agent } = listing
                    const owner = agent.ownerId === org.memberId ? 'Yours' : agent.ownerId ? `Owned by ${names.get(agent.ownerId) ?? 'another member'}` : 'Managed by admins'
                    return (
                        <>
                            <Header
                                title={agent.displayName}
                                description={`${agentLabel(agent.agentKind, agent.agentConnection)} · ${owner}`}
                                icon={<AgentLogo logo={kindInfo(agent.agentKind ?? 'custom').logo ?? setupFor(agent).logo} className="size-5" />}
                                onBack={() => setScreen({ name: 'list' })}
                            />
                            <Body>
                                <AgentPage org={org} listing={listing} isAdmin={isAdmin} onChanged={load} />
                            </Body>
                            <Footer>
                                <Button size="sm" onClick={() => setScreen({ name: 'list' })}>Done</Button>
                            </Footer>
                        </>
                    )
                })()}
            </DialogContent>
        </Dialog>
    )
}
