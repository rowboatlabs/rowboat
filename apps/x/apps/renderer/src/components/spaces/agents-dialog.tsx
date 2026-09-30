import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Bot, KeyRound, Loader2, Plus } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { AgentKindLogo, ConnectAgent } from '@/components/spaces/agent-setup'
import { MemberAvatar } from '@/components/spaces/atoms'
import { refreshOrgRoster, useOrgRoster } from '@/hooks/use-space-members'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { AGENT_KINDS, agentKind, CUSTOM_KIND, type AgentKind } from '@/lib/agent-kinds'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// Agents (Harbor spec §4 Agent members, 2026-09-29): add an agent you own,
// connect whatever runs it, rotate and revoke keys. A key's secret is shown
// once, right after it is made, and never again — the org keeps only its
// hash. You see the agents you own; an admin sees every one and can revoke,
// never mint.
//
// Three screens, one job each (2026-09-30): the list; adding one, which
// starts with its kind (lib/agent-kinds.ts); and connecting it with its new
// key, by the steps its kind gives. A new key for an existing agent goes
// straight to connecting, and asks how the agent runs, since the kind isn't
// stored.

type Screen =
    | { name: 'list' }
    | { name: 'add' }
    | { name: 'connect'; agentId: string; agentName: string; secret: string; kindId: string; askKind: boolean }

function when(iso: string | undefined): string {
    return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'never'
}

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

function KindTile({ kind, selected, onSelect }: { kind: AgentKind; selected: boolean; onSelect: () => void }) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={kind.label}
            onClick={onSelect}
            className={cn(
                'flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                selected ? 'border-foreground/50 bg-accent ring-1 ring-foreground/20' : 'border-border hover:bg-accent/50',
            )}
        >
            <AgentKindLogo kind={kind} className="size-9" />
            <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground">{kind.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{kind.description}</span>
            </span>
        </button>
    )
}

function KindSwitch({ kinds, selected, onSelect }: { kinds: AgentKind[]; selected: string; onSelect: (id: string) => void }) {
    return (
        <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">How does it run?</span>
            <div role="radiogroup" aria-label="How does it run?" className="flex gap-1 rounded-lg bg-muted p-0.5">
                {kinds.map((k) => (
                    <button
                        key={k.id}
                        type="button"
                        role="radio"
                        aria-checked={k.id === selected}
                        aria-label={k.label}
                        onClick={() => onSelect(k.id)}
                        className={cn(
                            'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
                            k.id === selected ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        <AgentKindLogo kind={k} className="size-4" />
                        {k.label}
                    </button>
                ))}
            </div>
        </div>
    )
}

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
    const [confirming, setConfirming] = useState<string | null>(null)
    const [chosen, setChosen] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [nameEdited, setNameEdited] = useState(false)
    const kinds = AGENT_KINDS as AgentKind[]
    // Until the person picks, the first kind this server can set up.
    const kind = kinds.find((k) => k.id === chosen) ?? kinds[0] ?? CUSTOM_KIND
    // The name suggests the kind's own until the person types one.
    const shownName = nameEdited ? name : kind.defaultName

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
        setConfirming(null)
        setAgents(null)
        void load()
    }, [open, load])

    const run = async (work: () => Promise<void>, failure: string) => {
        if (busy) return
        setBusy(true)
        try {
            await work()
            await load()
        } catch (err) {
            toast(err instanceof Error ? err.message : failure, 'error')
        } finally {
            setBusy(false)
        }
    }

    const startAdding = () => {
        setChosen(null)
        setName('')
        setNameEdited(false)
        setScreen({ name: 'add' })
    }

    const add = () => run(async () => {
        const { agent, key } = await window.ipc.invoke('spaces:addAgent', { orgId: org.id, displayName: shownName.trim() })
        // Your new agent is on your roster (and so in Add people) right away.
        refreshOrgRoster(org.id)
        setScreen({ name: 'connect', agentId: agent.id, agentName: agent.displayName, secret: key.secret, kindId: kind.id, askKind: false })
    }, 'Could not add the agent')

    const newKey = (agent: spaces.Member) => run(async () => {
        const { key } = await window.ipc.invoke('spaces:createAgentKey', { orgId: org.id, agentId: agent.id })
        // The kind isn't stored: start from the manual setup, and the person picks the agent's own.
        setScreen({ name: 'connect', agentId: agent.id, agentName: agent.displayName, secret: key.secret, kindId: CUSTOM_KIND.id, askKind: true })
    }, 'Could not create a key')

    const revoke = (agent: spaces.Member, keyId: string) => run(async () => {
        await window.ipc.invoke('spaces:revokeAgentKey', { orgId: org.id, agentId: agent.id, keyId })
        setConfirming(null)
        toast('Key revoked', 'success')
    }, 'Could not revoke the key')

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* One column that may shrink: long setup lines wrap inside it instead of widening the dialog. */}
            <DialogContent className={cn('grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden p-0', screen.name === 'connect' ? 'sm:max-w-2xl' : 'sm:max-w-xl')}>
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
                                    <div className="max-w-xs text-xs text-muted-foreground">Add one to connect Hermes, or anything that speaks the agent contract.</div>
                                </div>
                            ) : (
                                <ul className="-mx-2 flex flex-col">
                                    {agents.map(({ agent, keys }) => {
                                        const mine = agent.ownerId === org.memberId
                                        const live = keys.filter((k) => !k.revokedAt)
                                        return (
                                            <li key={agent.id} className="flex items-start gap-3 rounded-lg px-2 py-2.5">
                                                <MemberAvatar id={agent.id} name={agent.displayName} size="md" agent />
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-sm font-medium">{agent.displayName}</div>
                                                    <div className="truncate text-[11px] text-muted-foreground">
                                                        {agent.ownerId ? (mine ? 'Yours' : `Owned by ${names.get(agent.ownerId) ?? 'another member'}`) : 'Managed by admins'}
                                                        {' · '}
                                                        {live.length === 0 ? 'no active keys' : live.length === 1 ? '1 key' : `${live.length} keys`}
                                                    </div>
                                                    {live.length > 0 && (
                                                        <ul className="mt-1.5 flex flex-col gap-1">
                                                            {live.map((k) => (
                                                                <li key={k.id} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                                                    <span className="min-w-0 truncate">Key made {when(k.createdAt)} · last used {when(k.lastUsedAt)}</span>
                                                                    {(mine || isAdmin) && (
                                                                        <button
                                                                            type="button"
                                                                            disabled={busy}
                                                                            onClick={() => (confirming === k.id ? void revoke(agent, k.id) : setConfirming(k.id))}
                                                                            className="shrink-0 rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
                                                                        >
                                                                            {confirming === k.id ? 'Confirm revoke' : 'Revoke'}
                                                                        </button>
                                                                    )}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                                {mine && (
                                                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void newKey(agent)}>
                                                        <KeyRound className="size-3.5" /> New key
                                                    </Button>
                                                )}
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
                            if (shownName.trim()) void add()
                        }}
                    >
                        <Header title="Add an agent" description="Choose what runs it. The steps to connect it come next." onBack={() => setScreen({ name: 'list' })} />
                        <Body>
                            <div role="radiogroup" aria-label="Kind of agent" className="grid grid-cols-2 gap-2">
                                {kinds.map((k) => (
                                    <KindTile key={k.id} kind={k} selected={k.id === kind.id} onSelect={() => setChosen(k.id)} />
                                ))}
                            </div>
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
                        </Body>
                        <Footer>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setScreen({ name: 'list' })}>Cancel</Button>
                            <Button type="submit" size="sm" disabled={!shownName.trim() || busy}>
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
                            icon={<AgentKindLogo kind={agentKind(screen.kindId)} className="size-5" />}
                        />
                        <Body>
                            {screen.askKind && kinds.length > 1 && (
                                <KindSwitch kinds={kinds} selected={screen.kindId} onSelect={(kindId) => setScreen({ ...screen, kindId })} />
                            )}
                            <ConnectAgent
                                org={org}
                                kind={agentKind(screen.kindId)}
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
            </DialogContent>
        </Dialog>
    )
}
