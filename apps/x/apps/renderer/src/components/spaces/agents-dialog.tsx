import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Bot, Check, ChevronDown, ChevronRight, Hash, Loader2, MessageSquare, Plus, Sparkles } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AgentPage } from '@/components/spaces/agent-page'
import { InstancePicker, type InstanceChoice } from '@/components/spaces/agent-instance-picker'
import { MaritimeAgentPicker } from '@/components/spaces/agent-maritime-picker'
import { AgentLogo, ConnectAgent } from '@/components/spaces/agent-setup'
import { MemberAvatar } from '@/components/spaces/atoms'
import { refreshMembers, refreshOrgRoster, useOrgRoster } from '@/hooks/use-space-members'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { isGroupChat } from '@/lib/spaces-navigation'
import { AGENT_SETUPS, MANAGED_KINDS, agentLabel, agentSetup, instanceLabel, isBot, kindInfo, setupFor, type AgentSetup } from '@/lib/agent-kinds'
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
//
// Bots (2026-10-03, Arjun): PostHog and Cal.com run a service's commands, as
// Slack bots do, so the list shows them apart and Add bot offers them; Add
// agent offers the rest. To Harbor both are agent members.
//
// Create agent (2026-10-26): when the org's Harbor has Rowboat's own Maritime
// key, the list's primary action creates an agent Rowboat runs: a kind, a
// name, the spaces it joins, and for Claude Code the person's Anthropic key,
// which goes to the agent's VM and nowhere else. There is nothing to connect:
// the new agent's page shows it deploying, then ready, and lets its owner
// delete it from Maritime. Add agent stays for an agent the person runs.

type Screen =
    | { name: 'list' }
    | { name: 'add'; bot: boolean }
    | { name: 'create' }
    | { name: 'connect'; agentId: string; agentName: string; secret: string; setupId: string; kind: string; instance?: string }
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

/** One of the kinds Rowboat creates, on the Create screen. */
function KindTile({ kind, description, selected, onSelect }: { kind: string; description: string; selected: boolean; onSelect: () => void }) {
    const info = kindInfo(kind)
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={info.label}
            onClick={onSelect}
            className={cn(
                'flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                selected ? 'border-foreground/50 bg-accent ring-1 ring-foreground/20' : 'border-border hover:bg-accent/50',
            )}
        >
            <AgentLogo logo={info.logo} className="size-9" />
            <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground">{info.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{description}</span>
            </span>
        </button>
    )
}

const ENV_KEY = /^[A-Z_][A-Z0-9_]{0,63}$/

/** "KEY=value" lines for a managed agent's environment: the variables, or the first line that is not one. */
function parseEnv(text: string): { env: Array<{ key: string; value: string }> } | { bad: string } {
    const env: Array<{ key: string; value: string }> = []
    for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const at = line.indexOf('=')
        const key = at < 0 ? line : line.slice(0, at).trim()
        if (at < 0 || !ENV_KEY.test(key)) return { bad: line }
        env.push({ key, value: line.slice(at + 1).trim() })
    }
    return { env }
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

/** The agent a platform runs (Replicas's coding agent, Agent37's Hermes or OpenClaw): its kind. */
function KindChoice({ label, kinds, selected, onSelect }: { label: string; kinds: readonly string[]; selected: string; onSelect: (kind: string) => void }) {
    return (
        <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">{label}</span>
            <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
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
/**
 * Where the dialog opens. The Agents page (2026-10-21) lists every agent
 * itself and opens this straight at adding one or at one agent's page; then
 * Back, Cancel and Done close the dialog instead of showing the list.
 */
export type AgentsDialogStart = { name: 'add'; bot: boolean } | { name: 'create' } | { name: 'agent'; agentId: string }

export function AgentsDialog({ org, open, onOpenChange, start }: {
    org: OrgWithSpaces
    open: boolean
    onOpenChange: (open: boolean) => void
    start?: AgentsDialogStart
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
    const [instance, setInstance] = useState<InstanceChoice | null>(null)
    const [addError, setAddError] = useState<string | null>(null)
    // The spaces a new agent joins on Add: every one of yours unless unticked (2026-10-08).
    const [skippedSpaces, setSkippedSpaces] = useState<ReadonlySet<string>>(new Set())
    const [withDirect, setWithDirect] = useState(true)
    const [progress, setProgress] = useState<string | null>(null)
    // Create agent: the kinds this org's Harbor creates (none until loaded, or on a Harbor with no Maritime key), and the form.
    const [managedKinds, setManagedKinds] = useState<string[]>([])
    const [createKind, setCreateKind] = useState<string | null>(null)
    const [anthropicKey, setAnthropicKey] = useState('')
    const [envText, setEnvText] = useState('')
    const [envOpen, setEnvOpen] = useState(false)
    // Add bot offers the bots, Add agent the rest; until the person picks, the first, and its first kind.
    const addingBot = screen.name === 'add' && screen.bot
    const offered = AGENT_SETUPS.filter((k) => (k.bot === true) === addingBot)
    const setup = offered.find((k) => k.id === chosen) ?? offered[0]!
    // An agent that is one platform instance (Agent37) runs whatever its instance runs.
    const kind = setup.bindsInstance ? instance?.kind ?? setup.kinds[0]! : chosenKind && setup.kinds.includes(chosenKind) ? chosenKind : setup.kinds[0]!
    // The name suggests the setup's own, or the kind's, until the person types one.
    const shownName = nameEdited ? name : setup.defaultName || kindInfo(kind).label
    const ready =
        shownName.trim() !== '' &&
        (!setup.credential || credential.trim() !== '') &&
        (!setup.bindsInstance || (instance !== null && (instance.type === 'existing' || Number.isFinite(instance.monthlyBudgetUsd))))

    const load = useCallback(async () => {
        try {
            setAgents((await window.ipc.invoke('spaces:listAgents', { orgId: org.id })).agents)
        } catch (err) {
            setAgents([])
            toast(err instanceof Error ? err.message : 'Could not load agents', 'error')
        }
    }, [org.id])

    const startAdding = useCallback((bot: boolean) => {
        setChosen(null)
        setChosenKind(null)
        setName('')
        setNameEdited(false)
        setCredential('')
        setInstance(null)
        setAddError(null)
        setSkippedSpaces(new Set())
        setWithDirect(true)
        setScreen({ name: 'add', bot })
    }, [])

    const startCreating = useCallback(() => {
        setCreateKind(null)
        setName('')
        setNameEdited(false)
        setAnthropicKey('')
        setEnvText('')
        setEnvOpen(false)
        setAddError(null)
        setSkippedSpaces(new Set())
        setWithDirect(true)
        setScreen({ name: 'create' })
    }, [])

    const startName = start?.name
    const startBot = start?.name === 'add' && start.bot
    const startAgentId = start?.name === 'agent' ? start.agentId : undefined
    useEffect(() => {
        if (!open) return
        if (startName === 'add') startAdding(startBot)
        else if (startName === 'create') startCreating()
        else setScreen(startAgentId ? { name: 'agent', agentId: startAgentId } : { name: 'list' })
        setAgents(null)
        void load()
        // An org whose Harbor creates no agents (no Maritime key, or older) just has no Create button.
        window.ipc.invoke('spaces:managedAgentKinds', { orgId: org.id }).then(({ kinds }) => setManagedKinds(kinds.filter((k) => MANAGED_KINDS.some((m) => m.kind === k)))).catch(() => setManagedKinds([]))
    }, [open, load, startAdding, startCreating, startName, startBot, startAgentId, org.id])

    // Back to the list, or out of the dialog when it was opened past the list.
    const back = () => (start ? onOpenChange(false) : setScreen({ name: 'list' }))

    const offeredKinds = MANAGED_KINDS.filter((m) => managedKinds.includes(m.kind))
    const chosenManaged = createKind && managedKinds.includes(createKind) ? createKind : offeredKinds[0]?.kind ?? 'hermes'
    const createName = nameEdited ? name : kindInfo(chosenManaged).label
    const parsedEnv = parseEnv(envText)
    const createReady = createName.trim() !== '' && (chosenManaged !== 'claude-code' || anthropicKey.trim() !== '') && !('bad' in parsedEnv)

    // The new agent into the spaces picked on the form, and your DM with it; one that refuses doesn't undo the agent.
    const settle = async (agent: spaces.Member, homeChannel: boolean) => {
        const into = org.spaces.filter((space) => !skippedSpaces.has(space.id))
        const joined = await Promise.allSettled(
            into.map((space) => window.ipc.invoke('spaces:addMembers', { orgId: org.id, spaceId: space.id, memberIds: [agent.id] })),
        )
        joined.forEach((result, i) => result.status === 'fulfilled' && refreshMembers(org.id, into[i]!.id, { force: true }))
        const missed = into.filter((_, i) => joined[i]!.status === 'rejected').map((space) => `#${space.name}`)
        // Your DM with it, in the sidebar like any DM (Hermes's setup opens it as its home channel anyway).
        // DMs are off while the server is one group chat (2026-10-07): no DM to open then.
        if (withDirect && !homeChannel && !isGroupChat(org)) {
            await window.ipc.invoke('spaces:openDirect', { orgId: org.id, memberId: agent.id }).catch(() => missed.push('your direct messages'))
        }
        if (missed.length > 0) toast(`Couldn't add ${agent.displayName} to ${missed.join(', ')}`, 'error')
        // Your new agent is on your roster (and so in Add people) right away.
        refreshOrgRoster(org.id)
        await load()
    }

    // Maritime's refusal (a plan limit, say) shows under the form: nothing was created.
    const create = async () => {
        if (busy || 'bad' in parsedEnv) return
        setBusy(true)
        setAddError(null)
        try {
            setProgress(`Creating ${createName.trim()} on Maritime…`)
            const { agent } = await window.ipc.invoke('spaces:createManagedAgent', {
                orgId: org.id,
                displayName: createName.trim(),
                kind: chosenManaged,
                ...(chosenManaged === 'claude-code' ? { anthropicApiKey: anthropicKey.trim() } : {}),
                ...(parsedEnv.env.length > 0 ? { env: parsedEnv.env } : {}),
            })
            setAnthropicKey('')
            setEnvText('')
            await settle(agent, false)
            setScreen({ name: 'agent', agentId: agent.id })
        } catch (err) {
            setAddError(err instanceof Error ? err.message : 'Could not create the agent')
        } finally {
            setBusy(false)
            setProgress(null)
        }
    }

    // A refused platform key shows under its field, not as a toast: nothing was created.
    const add = async () => {
        if (busy) return
        setBusy(true)
        setAddError(null)
        try {
            // A new instance is created first, with the key being pasted; Harbor then checks it like any other.
            let instanceId: string | undefined
            if (setup.id === 'agent37' && instance?.type === 'new') {
                setProgress('Creating the Agent37 instance… this can take a few minutes.')
                const { instance: created } = await window.ipc.invoke('spaces:agent37CreateInstance', {
                    key: credential.trim(),
                    kind: instance.kind,
                    name: `rowboat-${shownName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent'}`,
                    monthlyBudgetUsd: instance.monthlyBudgetUsd,
                    autoSleep: instance.autoSleep,
                })
                // If adding fails after this, the instance exists: keep it picked so a retry doesn't create another.
                setInstance({ type: 'existing', id: created.id, kind: created.kind ?? instance.kind, name: created.name })
                instanceId = created.id
                setProgress(`Created ${instanceLabel(created)}. Adding the agent…`)
            } else if (setup.bindsInstance && instance?.type === 'existing') {
                instanceId = instance.id
            }
            const { agent, key } = await window.ipc.invoke('spaces:addAgent', {
                orgId: org.id,
                displayName: shownName.trim(),
                kind,
                connection: setup.connection,
                ...(setup.credential ? { credential: credential.trim() } : {}),
                ...(instanceId ? { instance: instanceId } : {}),
            })
            setCredential('')
            setInstance(null)
            await settle(agent, setup.wantsHomeChannel === true)
            setScreen({ name: 'connect', agentId: agent.id, agentName: agent.displayName, secret: key.secret, setupId: setup.id, kind, ...(agent.agentInstance ? { instance: agent.agentInstance } : {}) })
        } catch (err) {
            setAddError(err instanceof Error ? err.message : `Could not add the ${addingBot ? 'bot' : 'agent'}`)
        } finally {
            setBusy(false)
            setProgress(null)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* One column that may shrink: long setup lines wrap inside it instead of widening the dialog. */}
            <DialogContent className={cn('grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden p-0', screen.name === 'connect' || screen.name === 'agent' ? 'sm:max-w-2xl' : 'sm:max-w-xl')}>
                {screen.name === 'list' && (
                    <>
                        <Header
                            title={`Agents and bots in ${org.name}`}
                            description="Agents work things out for themselves; bots run a service's commands. Each is a member with its own key: add one, connect it, then add it to spaces."
                        />
                        <Body>
                            {agents === null ? (
                                <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading agents…</div>
                            ) : agents.length === 0 ? (
                                <div className="flex flex-col items-center gap-2 py-8 text-center">
                                    <Bot className="size-6 text-muted-foreground" />
                                    <div className="text-sm font-medium">{isAdmin ? 'No agents or bots in this server yet' : 'You have no agents or bots yet'}</div>
                                    <div className="max-w-xs text-xs text-muted-foreground">
                                        {offeredKinds.length > 0 ? 'Create an agent and Rowboat runs it for you, or add one you run: ' : 'Add an agent to connect '}
                                        Hermes, a coding agent in Replicas or Conductor, or anything that speaks the agent contract, or a bot for PostHog or Cal.com.
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {([['Agents', agents.filter((a) => !isBot(a.agent.agentKind))], ['Bots', agents.filter((a) => isBot(a.agent.agentKind))]] as const).map(([heading, group]) =>
                                        group.length === 0 ? null : (
                                            <section key={heading} aria-label={heading}>
                                                <h3 className="mb-1 text-[11px] font-medium text-muted-foreground">{heading}</h3>
                                                <ul className="-mx-2 flex flex-col">
                                                    {group.map(({ agent, keys, credential }) => {
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
                                            </section>
                                        ),
                                    )}
                                </div>
                            )}
                        </Body>
                        <Footer>
                            <Button size="sm" variant="outline" onClick={() => startAdding(true)}>
                                <Plus className="size-3.5" /> Add bot
                            </Button>
                            <Button size="sm" variant={offeredKinds.length > 0 ? 'outline' : 'default'} onClick={() => startAdding(false)}>
                                <Plus className="size-3.5" /> Add agent
                            </Button>
                            {offeredKinds.length > 0 && (
                                <Button size="sm" onClick={startCreating}>
                                    <Sparkles className="size-3.5" /> Create agent
                                </Button>
                            )}
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
                        <Header
                            title={addingBot ? 'Add a bot' : 'Add an agent'}
                            description={addingBot ? 'Choose the service. It answers commands with your key for it.' : 'Choose what runs it. The steps to connect it come next.'}
                            onBack={back}
                        />
                        <Body>
                            <div role="radiogroup" aria-label={addingBot ? 'Which service' : 'How it connects'} className="grid grid-cols-2 gap-2">
                                {offered.map((k) => (
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
                            {setup.kinds.length > 1 && !setup.bindsInstance && <KindChoice label={setup.kindChoice ?? 'Agent'} kinds={setup.kinds} selected={kind} onSelect={setChosenKind} />}
                            <label className="mt-4 flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-foreground">Name</span>
                                <Input
                                    value={shownName}
                                    onChange={(e) => {
                                        setNameEdited(true)
                                        setName(e.target.value)
                                    }}
                                    placeholder="e.g. Scout"
                                    aria-label={addingBot ? 'Bot name' : 'Agent name'}
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
                            {setup.id === 'agent37' && <InstancePicker credential={credential} choice={instance} onChoice={setInstance} />}
                            {setup.id === 'maritime' && <MaritimeAgentPicker credential={credential} choice={instance} onChoice={setInstance} />}
                            <SpacePicker
                                spaces={org.spaces}
                                skipped={skippedSpaces}
                                onChange={setSkippedSpaces}
                                direct={setup.wantsHomeChannel || isGroupChat(org) ? null : withDirect}
                                onDirectChange={setWithDirect}
                            />
                            {progress && <div className="mt-3 text-xs text-muted-foreground">{progress}</div>}
                            {addError && <div role="alert" className="mt-3 text-xs text-destructive">{addError}</div>}
                        </Body>
                        <Footer>
                            <Button type="button" size="sm" variant="ghost" onClick={back}>Cancel</Button>
                            <Button type="submit" size="sm" disabled={!ready || busy}>
                                {busy && <Loader2 className="size-3.5 animate-spin" />}
                                {addingBot ? 'Add bot' : 'Add agent'}
                            </Button>
                        </Footer>
                    </form>
                )}

                {screen.name === 'create' && (
                    <form
                        className="contents"
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (createReady) void create()
                        }}
                    >
                        <Header
                            title="Create an agent"
                            description="Rowboat runs it for you, on Maritime. Pick what it runs and a name; it's ready in a minute or two, with nothing to connect."
                            onBack={back}
                        />
                        <Body>
                            <div role="radiogroup" aria-label="Agent" className="grid grid-cols-2 gap-2">
                                {offeredKinds.map((m) => (
                                    <KindTile
                                        key={m.kind}
                                        kind={m.kind}
                                        description={m.description}
                                        selected={m.kind === chosenManaged}
                                        onSelect={() => {
                                            setCreateKind(m.kind)
                                            setAddError(null)
                                        }}
                                    />
                                ))}
                            </div>
                            <label className="mt-4 flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-foreground">Name</span>
                                <Input
                                    value={createName}
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
                            {chosenManaged === 'claude-code' && (
                                <label className="mt-4 flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-foreground">Anthropic API key</span>
                                    <Input
                                        type="password"
                                        value={anthropicKey}
                                        onChange={(e) => {
                                            setAnthropicKey(e.target.value)
                                            setAddError(null)
                                        }}
                                        placeholder="sk-ant-…"
                                        aria-label="Anthropic API key"
                                        className="h-9 text-sm"
                                        autoComplete="off"
                                    />
                                    <span className="text-[11px] text-muted-foreground">Claude Code runs on it. It goes to the agent's environment on Maritime and nowhere else; Rowboat keeps no copy.</span>
                                </label>
                            )}
                            <div className="mt-4 flex flex-col gap-1.5">
                                <button
                                    type="button"
                                    aria-expanded={envOpen}
                                    onClick={() => setEnvOpen((v) => !v)}
                                    className="flex items-center gap-1 self-start text-xs font-medium text-foreground"
                                >
                                    <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', !envOpen && '-rotate-90')} />
                                    Environment variables
                                </button>
                                {envOpen && (
                                    <>
                                        <Textarea
                                            value={envText}
                                            onChange={(e) => {
                                                setEnvText(e.target.value)
                                                setAddError(null)
                                            }}
                                            placeholder={'GH_TOKEN=ghp_…\nONE_PER_LINE=value'}
                                            aria-label="Environment variables"
                                            className="min-h-20 font-mono text-xs"
                                            spellCheck={false}
                                        />
                                        <span className="text-[11px] text-muted-foreground">
                                            {'bad' in parsedEnv
                                                ? `Not a KEY=value line: ${parsedEnv.bad}`
                                                : 'Tokens the agent needs in its VM, one KEY=value per line. Maritime keeps them as secrets; Rowboat keeps no copy.'}
                                        </span>
                                    </>
                                )}
                            </div>
                            <SpacePicker
                                spaces={org.spaces}
                                skipped={skippedSpaces}
                                onChange={setSkippedSpaces}
                                direct={isGroupChat(org) ? null : withDirect}
                                onDirectChange={setWithDirect}
                            />
                            {progress && <div className="mt-3 text-xs text-muted-foreground">{progress}</div>}
                            {addError && <div role="alert" className="mt-3 text-xs text-destructive">{addError}</div>}
                        </Body>
                        <Footer>
                            <Button type="button" size="sm" variant="ghost" onClick={back}>Cancel</Button>
                            <Button type="submit" size="sm" disabled={!createReady || busy}>
                                {busy && <Loader2 className="size-3.5 animate-spin" />}
                                Create agent
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
                                agentKind={screen.kind}
                                {...(screen.instance ? { agentInstance: screen.instance } : {})}
                                agentId={screen.agentId}
                                agentName={screen.agentName}
                                agentKey={screen.secret}
                            />
                        </Body>
                        <Footer>
                            <Button size="sm" onClick={back}>Done</Button>
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
                                onBack={back}
                            />
                            <Body>
                                <AgentPage org={org} listing={listing} isAdmin={isAdmin} onChanged={load} />
                            </Body>
                            <Footer>
                                <Button size="sm" onClick={back}>Done</Button>
                            </Footer>
                        </>
                    )
                })()}
            </DialogContent>
        </Dialog>
    )
}
