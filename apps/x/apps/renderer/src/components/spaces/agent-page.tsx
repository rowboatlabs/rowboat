import { useEffect, useState, type ReactNode } from 'react'
import { Bell, Clock, Folder, KeyRound, LayoutDashboard, ListChecks, Loader2, ScrollText, SlidersHorizontal, Sparkles, SquareTerminal, Terminal, Trash2, TriangleAlert } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CommandsScreen, EnvScreen, FilesScreen, HostingDangerRows, LogsScreen, MachineBlock, SkillsScreen, TriggersScreen } from '@/components/spaces/agent-hosting'
import { HOME, useHostingState, type HostingState } from '@/components/spaces/agent-hosting-state'
import { TerminalScreen } from '@/components/spaces/agent-terminal'
import { AccessChoice } from '@/components/spaces/agent-access'
import { ConnectAgent, CopyField } from '@/components/spaces/agent-setup'
import { AgentTabs, ConfirmButton, DangerRow, DangerZone, Empty, FormCard, Row, Rows, ScreenHeader, Tag, type AgentTab } from '@/components/spaces/agent-tabs'
import { refreshAgentCapabilities } from '@/hooks/use-space-invocations'
import { refreshOrgRoster, useOrgRoster } from '@/hooks/use-space-members'
import { LocalAgentSection } from '@/components/spaces/local-agent'
import { PersonalitySection } from '@/components/spaces/agent-personality'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { BUILT_IN_CONNECTION, LLM_PROVIDER_INFO, LLM_PROVIDERS_FOR_KIND, LOCAL_CONNECTION, PLATFORMS, setupFor } from '@/lib/agent-kinds'
import { toast } from '@/lib/toast'

// One agent's page in the Agents dialog (2026-10-01; tabs 2026-10-27): a rail
// of tabs down the left, one per job. Overview has its keys and the defaults
// for the options its connector declares (Harbor spec §8 Invocation options:
// Harbor fills them into every invocation whose invoker picked none, which is
// how a first mention from another agent or a DM skips Replicas's "which
// environment?"). Setup has the steps shown when it was added; Harbor keeps
// only a key's hash, so the key reads as a placeholder until its owner makes
// a new one, which fills the steps in. Alerts, for a bot that has them.
//
// A managed agent (2026-10-26), one Rowboat created on its own Maritime
// account, has nothing to set up: Overview shows its machine, from deploying
// to ready, and once ready its owner or an admin gets a tab for each part of
// the VM (agent-hosting.tsx). Who pays for its model comes first on Overview
// (2026-10-27): a new Hermes or Codex is on Rowboat's trial credit, there to
// try it, and the one thing to do is add your own key, which ends the trial
// for good; Claude Code runs on the owner's key from the start. Whatever
// cannot be undone, on any agent, is on the Danger zone tab and asks once
// more.
//
// Who can use it (2026-10-27): Overview says whether it is a channel or a
// personal agent, and its owner switches it there, either way, any time.
//
// A local agent (2026-10-28), its owner's own Claude Code or Codex that the
// app runs: Overview says which computer runs it, and there its owner picks
// the folder and approvals, or runs it on this one. No Setup tab: the app is
// its connector. Always personal, so there is no switch.

/** Stands in for the key in the setup steps: the real one was shown once, when it was made. */
export const KEY_PLACEHOLDER = 'YOUR_AGENT_KEY'

function when(iso: string | undefined): string {
    return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'never'
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div>
                <h3 className="text-xs font-semibold text-foreground">{title}</h3>
                {note && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{note}</p>}
            </div>
            {children}
        </section>
    )
}

export function AgentPage({ org, listing, isAdmin, onChanged }: {
    org: OrgWithSpaces
    listing: spaces.AgentListing
    isAdmin: boolean
    /** Reload the listing after a change to keys or the platform key. */
    onChanged: () => Promise<void>
}) {
    const { agent, keys, credential, hook, hosting } = listing
    const setup = setupFor(agent)
    const mine = agent.ownerId === org.memberId
    const canManage = mine || isAdmin
    const live = keys.filter((k) => !k.revokedAt)
    const ready = hosting?.status === 'ready'
    const gone = hosting?.status === 'deleting' || hosting?.status === 'deleted'
    const [tab, setTab] = useState('overview')
    // A key made here, shown this once and filled into the setup steps.
    const [secret, setSecret] = useState<string | null>(null)
    // An alerts address made here, shown this once.
    const [hookUrl, setHookUrl] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const hostingState = useHostingState(org.id, agent.id, Boolean(hosting) && ready && canManage)
    const isLocal = agent.agentConnection === LOCAL_CONNECTION
    const roster = useOrgRoster(org.id, [])
    const ownerName = roster.find((m) => m.id === agent.ownerId)?.displayName ?? 'its owner'

    const newKey = async () => {
        if (busy) return
        setBusy(true)
        try {
            const { key } = await window.ipc.invoke('spaces:createAgentKey', { orgId: org.id, agentId: agent.id })
            setSecret(key.secret)
            await onChanged()
            // The key is shown once, in the setup steps.
            if (!hosting) setTab('setup')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create a key', 'error')
        } finally {
            setBusy(false)
        }
    }

    const revoke = async (keyId: string) => {
        if (busy) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:revokeAgentKey', { orgId: org.id, agentId: agent.id, keyId })
            toast('Key revoked', 'success')
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not revoke the key', 'error')
        } finally {
            setBusy(false)
        }
    }

    // Jev is built in (2026-10-07): no setup steps, no keys, nothing to set.
    if (agent.agentConnection === BUILT_IN_CONNECTION) {
        return (
            <Section
                title="Built in"
                note={`${agent.displayName} comes with Rowboat and runs on Rowboat's own key. Add it to a space and it reads every message there, tagging the people and agents a message needs.`}
            >
                {null}
            </Section>
        )
    }

    const hermes = agent.agentKind === 'hermes'
    const tabs: AgentTab[] = [
        {
            id: 'overview',
            label: 'Overview',
            icon: <LayoutDashboard />,
            content: (
                <>
                    {hosting && <HostingOverview orgId={org.id} agent={agent} hosting={hosting} canManage={canManage} state={hostingState} onChanged={onChanged} />}
                    {/* Keyed on the saved values: a save elsewhere resets the form to them. */}
                    {agent.ownerId && <PersonalitySection key={`${agent.title ?? ''}|${agent.instructions ?? ''}`} orgId={org.id} agent={agent} canEdit={mine} onSaved={onChanged} />}
                    {isLocal && <LocalAgentSection orgId={org.id} agent={agent} mine={mine} ownerName={ownerName} />}
                    {agent.ownerId && !isLocal && <AccessSection orgId={org.id} agent={agent} canSwitch={mine} onChanged={onChanged} />}
                    {isLocal && (
                        <div className="flex flex-col gap-0.5">
                            <h3 className="text-sm font-semibold text-foreground">Who can use it</h3>
                            <p className="text-xs leading-snug text-muted-foreground">Personal: it runs on {mine ? 'your' : `${ownerName}’s`} computer, so only {mine ? 'you' : ownerName} can mention it or DM it. Everyone sees it and its replies.</p>
                        </div>
                    )}
                    <div className="flex flex-col gap-2">
                        <ScreenHeader
                            title="Keys"
                            note={
                                hosting
                                    ? 'Each key lets whatever runs the agent act as it. Rowboat made the first one when it created the agent; it lives on the VM.'
                                    : isLocal
                                      ? 'The computer that runs it holds its key. Running it on another computer makes a new key there and revokes this one.'
                                      : 'Each key lets whatever runs the agent act as it. Revoking one cuts that off at once.'
                            }
                            action={
                                mine && !isLocal && (
                                    <Button size="sm" variant={hosting ? 'outline' : 'default'} disabled={busy} onClick={() => void newKey()}>
                                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} New key
                                    </Button>
                                )
                            }
                        />
                        {live.length === 0 ? (
                            <Empty>No active keys.</Empty>
                        ) : (
                            <Rows label="Keys">
                                {live.map((k) => (
                                    <Row key={k.id}>
                                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                            Key made {when(k.createdAt)} · last used {when(k.lastUsedAt)}
                                        </span>
                                        {canManage && <ConfirmButton look="text" label="Revoke" confirmLabel="Confirm revoke" busy={busy} onConfirm={() => void revoke(k.id)} />}
                                    </Row>
                                ))}
                            </Rows>
                        )}
                        {credential && !hosting && <CredentialRow orgId={org.id} agent={agent} credential={credential} canReplace={mine} onReplaced={onChanged} />}
                        {agent.agentInstance && !hosting && (
                            <p className="text-[11px] text-muted-foreground">
                                {PLATFORMS[agent.agentConnection ?? '']?.label ?? 'Platform'} instance {agent.agentInstance}: this agent is that instance, and stays on it.
                            </p>
                        )}
                    </div>
                    <DefaultsSection orgId={org.id} agent={agent} canEdit={mine} />
                </>
            ),
        },
    ]

    if (!hosting && !isLocal) {
        tabs.push({
            id: 'setup',
            label: 'Setup',
            icon: <ListChecks />,
            content: (
                <>
                    <ScreenHeader
                        title="Setup"
                        note={
                            secret
                                ? 'This is the only time this key is shown. The steps below use it.'
                                : `A key is shown only once, when it is made. Where the steps say ${KEY_PLACEHOLDER}, use that key${mine ? ', or make a new one to fill them in' : ''}.`
                        }
                        action={
                            mine &&
                            !secret && (
                                <Button size="sm" disabled={busy} onClick={() => void newKey()}>
                                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} New key
                                </Button>
                            )
                        }
                    />
                    <ConnectAgent org={org} setup={setup} {...(agent.agentKind ? { agentKind: agent.agentKind } : {})} {...(agent.agentInstance ? { agentInstance: agent.agentInstance } : {})} agentId={agent.id} agentName={agent.displayName} agentKey={secret ?? KEY_PLACEHOLDER} canAddToSpaces={mine || !agent.personal} />
                </>
            ),
        })
    }

    if (hosting && ready && canManage) tabs.push(...vmTabs({ orgId: org.id, agent, hermes, state: hostingState }))

    if (setup.alerts) {
        tabs.push({
            id: 'alerts',
            label: 'Alerts',
            icon: <Bell />,
            content: <AlertsScreen org={org} agent={agent} hook={hook} note={setup.alerts.note} canSet={mine} url={hookUrl} onUrl={setHookUrl} onChanged={onChanged} />,
        })
    }

    const danger: ReactNode[] = []
    if (hosting && ready && canManage) danger.push(<HostingDangerRows key="vm" orgId={org.id} agent={agent} hermes={hermes} state={hostingState} />)
    if (setup.alerts && hook && canManage) {
        danger.push(
            <AlertsOffRow
                key="alerts"
                orgId={org.id}
                agent={agent}
                onCleared={async () => {
                    setHookUrl(null)
                    await onChanged()
                }}
            />,
        )
    }
    if (hosting && canManage && !gone) danger.push(<DeleteAgentRow key="agent" orgId={org.id} agent={agent} onChanged={onChanged} />)
    if (danger.length > 0) {
        tabs.push({
            id: 'danger',
            label: 'Danger zone',
            icon: <TriangleAlert />,
            danger: true,
            content: (
                <>
                    <ScreenHeader title="Danger zone" note="Nothing here can be undone. Each action asks once more before it runs." />
                    <DangerZone>{danger}</DangerZone>
                </>
            ),
        })
    }

    return <AgentTabs tabs={tabs} value={tab} onChange={setTab} />
}

/** Channel or personal: its owner switches it; everyone else reads which it is. */
function AccessSection({ orgId, agent, canSwitch, onChanged }: { orgId: string; agent: spaces.Member; canSwitch: boolean; onChanged: () => Promise<void> }) {
    const [busy, setBusy] = useState(false)
    const personal = agent.personal === true
    const choose = async (next: boolean) => {
        if (busy) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:setAgentPersonal', { orgId, agentId: agent.id, personal: next })
            // Pickers read the roster: someone else's personal agent leaves them, a channel one comes back.
            refreshOrgRoster(orgId)
            await onChanged()
            toast(next ? `${agent.displayName} is now personal` : `${agent.displayName} is now a channel agent`, 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not change who can use it', 'error')
        } finally {
            setBusy(false)
        }
    }
    if (canSwitch) {
        return (
            <AccessChoice
                personal={personal}
                onChange={(next) => void choose(next)}
                disabled={busy}
                note={personal ? 'It stays in its spaces; others see it and its replies but can’t ask it anything.' : 'Anyone who shares a space with it can mention it or DM it.'}
            />
        )
    }
    return (
        <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-foreground">Who can use it</h3>
            <p className="text-xs leading-snug text-muted-foreground">
                {personal ? 'Personal: only its owner can mention it or DM it. You see it and its replies.' : 'Channel: anyone who shares a space with it can mention it or DM it.'}
            </p>
        </div>
    )
}

/** The VM's tabs on a ready managed agent's page: one per part of the machine, Skills and Automations for Hermes only. */
function vmTabs({ orgId, agent, hermes, state }: { orgId: string; agent: spaces.Member; hermes: boolean; state: HostingState }): AgentTab[] {
    const agentId = agent.id
    const tabs: AgentTab[] = [
        { id: 'environment', label: 'Environment', icon: <SlidersHorizontal />, count: state.env?.length, content: <EnvScreen orgId={orgId} agentId={agentId} state={state} /> },
        { id: 'commands', label: 'Commands', icon: <Terminal />, content: <CommandsScreen orgId={orgId} agentId={agentId} /> },
        { id: 'terminal', label: 'Terminal', icon: <SquareTerminal />, content: <TerminalScreen orgId={orgId} agentId={agentId} agentName={agent.displayName} /> },
        { id: 'logs', label: 'Logs', icon: <ScrollText />, content: <LogsScreen orgId={orgId} agentId={agentId} /> },
        { id: 'files', label: 'Files', icon: <Folder />, content: <FilesScreen key={state.filesEpoch} orgId={orgId} agentId={agentId} home={HOME[agent.agentKind ?? ''] ?? '/'} /> },
    ]
    if (hermes) {
        tabs.push(
            { id: 'skills', label: 'Skills', icon: <Sparkles />, count: state.skills?.length, content: <SkillsScreen orgId={orgId} agentId={agentId} state={state} /> },
            { id: 'automations', label: 'Automations', icon: <Clock />, count: state.triggers?.length, content: <TriggersScreen orgId={orgId} agentId={agentId} state={state} /> },
        )
    }
    return tabs
}

/** The hosting states that are still moving: the page re-reads the listing while in one. */
const MOVING: ReadonlySet<string> = new Set(['creating', 'deploying', 'checking', 'deleting'])
const HOSTING_POLL_MS = 4_000

function hostingLine(hosting: spaces.AgentHosting, name: string): string {
    switch (hosting.status) {
        case 'creating':
            return 'Being created on Maritime…'
        case 'deploying':
            return 'Deploying on Maritime… a new agent takes a minute or three.'
        case 'checking':
            return 'Deployed. Waiting for it to take its first command…'
        case 'ready':
            return `Running on Rowboat's Maritime account since ${when(hosting.updatedAt)}. It sleeps between turns and wakes when mentioned.`
        case 'failed':
            return `Could not be set up: ${hosting.error ?? 'Maritime gave no reason'}. Delete it from the Danger zone and create it again.`
        case 'deleting':
            return 'Removing from Maritime… its keys are already revoked.'
        case 'deleted':
            return `Removed from Maritime on ${when(hosting.updatedAt)}. Its keys are revoked; remove ${name} from spaces like any member.`
    }
}

/**
 * A managed agent's machine on Overview (2026-10-26): where Maritime stands
 * with it, kept fresh while it moves, and once ready the machine itself with
 * its power, for its owner or an admin.
 */
function HostingOverview({ orgId, agent, hosting, canManage, state, onChanged }: {
    orgId: string
    agent: spaces.Member
    hosting: spaces.AgentHosting
    canManage: boolean
    state: HostingState
    onChanged: () => Promise<void>
}) {
    const moving = MOVING.has(hosting.status)
    useEffect(() => {
        if (!moving) return
        const timer = setInterval(() => void onChanged(), HOSTING_POLL_MS)
        return () => clearInterval(timer)
    }, [moving, onChanged])
    const gone = hosting.status === 'deleting' || hosting.status === 'deleted'
    return (
        <>
            {!gone && hosting.externalId && <FundingBlock orgId={orgId} agent={agent} hosting={hosting} state={state} canManage={canManage} onChanged={onChanged} />}
            <div className="flex flex-col gap-2">
                <ScreenHeader title="Machine" note="Rowboat created this agent on its own Maritime account and runs each turn inside its VM, with the Spaces tools. Nothing to set up." />
                {hosting.status === 'ready' && canManage && <MachineBlock orgId={orgId} agentId={agent.id} state={state} />}
                <p role="status" className={`text-[11px] ${hosting.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {moving && <Loader2 className="mr-1 inline size-3 animate-spin align-[-2px]" />}
                    {hostingLine(hosting, agent.displayName)}
                </p>
            </div>
        </>
    )
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Who pays for the model (2026-10-27), first thing on Overview. On the trial:
 * what it has drawn and when it ends, and the one way out, the owner's key.
 * Once the trial is over: that, in red, and the same way out. On the owner's
 * key: which, and Replace. The key goes to Maritime and nowhere else.
 */
function FundingBlock({ orgId, agent, hosting, state, canManage, onChanged }: {
    orgId: string
    agent: spaces.Member
    hosting: spaces.AgentHosting
    state: HostingState
    canManage: boolean
    onChanged: () => Promise<void>
}) {
    const kind = agent.agentKind ?? ''
    const providers = LLM_PROVIDERS_FOR_KIND[kind] ?? []
    const [editing, setEditing] = useState(false)
    const [provider, setProvider] = useState<spaces.LlmProvider>(hosting.llm?.provider ?? providers[0] ?? 'openai')
    const [apiKey, setApiKey] = useState('')
    const [model, setModel] = useState(hosting.llm?.model ?? '')
    const [busy, setBusy] = useState(false)
    const ready = hosting.status === 'ready'
    const closed = hosting.funding === 'trial' ? hosting.trial?.closedReason : undefined
    const spend = state.spend
    const info = LLM_PROVIDER_INFO[provider]

    const save = async () => {
        if (busy || apiKey.trim().length < 8) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:setHostingLlm', { orgId, agentId: agent.id, provider, apiKey: apiKey.trim(), ...(model.trim() ? { model: model.trim() } : {}) })
            setApiKey('')
            setEditing(false)
            state.setSpend(undefined)
            toast(`${agent.displayName} now runs on your ${info.label} key`, 'success')
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not save the key', 'error')
        } finally {
            setBusy(false)
        }
    }

    const form = editing && (
        <FormCard title={hosting.funding === 'own' ? 'Replace the key' : 'Your API key'} onSubmit={() => void save()}>
            <div className="flex flex-wrap items-center gap-1.5">
                {providers.length > 1 ? (
                    <select aria-label="Provider" value={provider} disabled={busy} onChange={(e) => setProvider(e.target.value as spaces.LlmProvider)} className="h-8 rounded-md border border-border bg-background px-2 text-xs">
                        {providers.map((p) => (
                            <option key={p} value={p}>{LLM_PROVIDER_INFO[p].label}</option>
                        ))}
                    </select>
                ) : (
                    <span className="text-xs text-foreground">{info.label}</span>
                )}
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={info.keyPlaceholder} aria-label="API key" className="h-8 min-w-0 flex-1 basis-48 font-mono text-xs" autoComplete="off" autoFocus />
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={`Model, e.g. ${info.modelPlaceholder}`} aria-label="Model" className="h-8 w-52 font-mono text-xs" />
                <Button type="submit" size="sm" disabled={apiKey.trim().length < 8 || busy}>
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    Use this key
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => (setEditing(false), setApiKey(''))}>
                    Cancel
                </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">The key goes to {agent.displayName}'s environment on Maritime and nowhere else; Rowboat keeps its last characters. {hosting.funding === 'trial' ? 'The trial ends the moment it is saved.' : ''}</p>
        </FormCard>
    )

    if (hosting.funding === 'own') {
        const llm = hosting.llm
        return (
            <div role="group" aria-label="Model access" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border p-3">
                    <div className="min-w-0 flex-1 basis-56">
                        <p className="text-sm font-semibold text-foreground">Runs on your {llm ? LLM_PROVIDER_INFO[llm.provider].label : ''} key{llm?.keyHint ? ` ${llm.keyHint}` : ''}</p>
                        <p className="text-[11px] text-muted-foreground">{llm?.model ? `Model ${llm.model}. ` : ''}You pay the provider; Rowboat pays for the machine.</p>
                    </div>
                    {canManage && !editing && (
                        <Button size="sm" variant="outline" disabled={!ready} onClick={() => setEditing(true)}>
                            Replace key
                        </Button>
                    )}
                </div>
                {form}
            </div>
        )
    }

    const limit = spend?.limitCents
    const pct = spend && limit ? Math.min(100, Math.round((spend.spentCents / limit) * 100)) : undefined
    return (
        <div role="group" aria-label="Model access" className="flex flex-col gap-2">
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 ${closed ? 'border-destructive/40 bg-destructive/5' : 'border-border'}`}>
                <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm font-semibold text-foreground">{closed === 'exhausted' ? 'Trial credit used up' : closed === 'expired' ? 'Trial ended' : "On Rowboat's trial credit"}</p>
                    <p className="text-[11px] text-muted-foreground">
                        {closed
                            ? `${agent.displayName} answers nothing until you add your own API key.`
                            : `${spend ? `${money(spend.spentCents)}${limit ? ` of ${money(limit)}` : ''} used this month. ` : ''}Ends ${when(hosting.trial?.endsAt)}, or the moment you add your own key. There to try ${agent.displayName}; it runs on your key from then on.`}
                    </p>
                    {pct !== undefined && !closed && (
                        <div role="progressbar" aria-label="Trial credit used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 h-1.5 w-full max-w-64 overflow-hidden rounded bg-muted">
                            <div className="h-full rounded bg-foreground" style={{ width: `${pct}%` }} />
                        </div>
                    )}
                </div>
                {canManage && !editing && (
                    <Button size="sm" disabled={!ready} onClick={() => setEditing(true)}>
                        <KeyRound className="size-3.5" /> Add your API key
                    </Button>
                )}
                {!canManage && closed && <Tag tone="warn">owner needed</Tag>}
            </div>
            {form}
        </div>
    )
}

/** Delete the agent from Maritime, on the Danger zone: the person types its name first. */
function DeleteAgentRow({ orgId, agent, onChanged }: { orgId: string; agent: spaces.Member; onChanged: () => Promise<void> }) {
    const [confirming, setConfirming] = useState(false)
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    const matches = name.trim() === agent.displayName
    const remove = async () => {
        if (busy || !matches) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:deleteManagedAgent', { orgId, agentId: agent.id })
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete the agent', 'error')
        } finally {
            setBusy(false)
            setConfirming(false)
        }
    }
    return (
        <DangerRow
            title={`Delete ${agent.displayName} from Maritime`}
            note="Removes the VM and its volume, revokes every key at once and leaves the agent in Rowboat as deleted. Its messages stay."
            below={
                confirming && (
                    <form
                        className="flex flex-wrap items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2"
                        onSubmit={(e) => {
                            e.preventDefault()
                            void remove()
                        }}
                    >
                        <span className="text-[11px] text-muted-foreground">
                            Type <b className="font-semibold text-foreground">{agent.displayName}</b> to confirm.
                        </span>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={agent.displayName} aria-label="Agent name" className="h-8 w-44 text-xs" autoComplete="off" autoFocus />
                        <Button type="submit" size="sm" variant="destructive" disabled={!matches || busy}>
                            {busy && <Loader2 className="size-3.5 animate-spin" />}
                            Delete {agent.displayName}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => (setConfirming(false), setName(''))}>
                            Cancel
                        </Button>
                    </form>
                )
            }
        >
            {!confirming && (
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirming(true)}>
                    <Trash2 className="size-3.5" /> Delete agent
                </Button>
            )}
        </DangerRow>
    )
}

/**
 * The defaults for the options the agent's connector declares (Environment,
 * Plan first, …). Its owner changes them; everyone else reads them. Each
 * change saves at once.
 */
function DefaultsSection({ orgId, agent, canEdit }: { orgId: string; agent: spaces.Member; canEdit: boolean }) {
    const [state, setState] = useState<{ options: spaces.InvocationOption[]; defaults: Record<string, string | boolean> } | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let live = true
        window.ipc.invoke('spaces:getAgentCapabilities', { orgId, agentId: agent.id }).then(
            ({ capabilities, defaults }) => live && setState({ options: capabilities.options, defaults: defaults ?? {} }),
            () => live && setState({ options: [], defaults: {} }),
        )
        return () => {
            live = false
        }
    }, [orgId, agent.id])

    if (!state || state.options.length === 0) return null

    const save = async (key: string, value: string | boolean | undefined) => {
        const next = { ...state.defaults }
        if (value === undefined || value === '') delete next[key]
        else next[key] = value
        setSaving(true)
        try {
            const { defaults } = await window.ipc.invoke('spaces:setAgentOptionDefaults', { orgId, agentId: agent.id, defaults: next })
            setState({ ...state, defaults })
            void refreshAgentCapabilities(orgId, agent.id)
            toast('Default saved', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not save the default', 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <ScreenHeader
                title="Defaults"
                note={`Used whenever whoever mentions ${agent.displayName} doesn't pick: a mention, a DM, or another agent handing work to it.${canEdit ? '' : ' Only its owner can change these.'}`}
            />
            <div className="flex flex-col gap-2">
                {state.options.map((option) =>
                    option.type === 'select' ? (
                        <label key={option.key} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-foreground">{option.label}</span>
                            <select
                                aria-label={`Default ${option.label}`}
                                value={String(state.defaults[option.key] ?? '')}
                                disabled={!canEdit || saving}
                                onChange={(e) => void save(option.key, e.target.value)}
                                className="h-8 max-w-[16rem] rounded-md border border-border bg-background px-2 text-xs disabled:opacity-60"
                            >
                                <option value="">No default (ask)</option>
                                {option.choices.map((choice) => (
                                    <option key={choice.id} value={choice.id}>{choice.label}</option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <label key={option.key} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-foreground">{option.label}</span>
                            <input
                                type="checkbox"
                                aria-label={`${option.label} by default`}
                                checked={state.defaults[option.key] === true}
                                disabled={!canEdit || saving}
                                onChange={(e) => void save(option.key, e.target.checked ? true : undefined)}
                                className="size-4 accent-foreground disabled:opacity-60"
                            />
                        </label>
                    ),
                )}
            </div>
        </div>
    )
}

/**
 * Where the service's alerts land (Harbor spec §8 Alerts, 2026-10-03): its
 * owner picks a space the agent is in and gets a secret address, shown this
 * once, to paste into the service's webhook settings. Getting a new one stops
 * the old; turning alerts off is on the Danger zone.
 */
function AlertsScreen({ org, agent, hook, note, canSet, url, onUrl, onChanged }: {
    org: OrgWithSpaces
    agent: spaces.Member
    hook: spaces.AgentHook | undefined
    note: string
    canSet: boolean
    url: string | null
    onUrl: (url: string) => void
    onChanged: () => Promise<void>
}) {
    const [spaceId, setSpaceId] = useState(hook?.spaceId ?? '')
    const [busy, setBusy] = useState(false)
    const spaceName = (id: string) => org.spaces.find((s) => s.id === id)?.name ?? 'a space'

    const set = async () => {
        if (!spaceId || busy) return
        setBusy(true)
        try {
            const result = await window.ipc.invoke('spaces:setAgentHook', { orgId: org.id, agentId: agent.id, spaceId })
            onUrl(result.url)
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not set up alerts', 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <ScreenHeader title="Alerts" note={url ? `This is the only time this address is shown. ${note}` : note} />
            {hook && !url && (
                <p className="text-xs text-muted-foreground">
                    Posting to #{spaceName(hook.spaceId)} since {when(hook.setAt)}. A new address stops the old one.
                </p>
            )}
            {url && <CopyField value={{ label: 'URL', text: url, secret: true }} />}
            {canSet && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <select
                        aria-label="Space for alerts"
                        value={spaceId}
                        disabled={busy}
                        onChange={(e) => setSpaceId(e.target.value)}
                        className="h-8 max-w-[16rem] rounded-md border border-border bg-background px-2 text-xs disabled:opacity-60"
                    >
                        <option value="">Pick a space {agent.displayName} is in</option>
                        {org.spaces.map((s) => (
                            <option key={s.id} value={s.id}>#{s.name}</option>
                        ))}
                    </select>
                    <Button size="sm" disabled={!spaceId || busy} onClick={() => void set()}>
                        {busy && <Loader2 className="size-3 animate-spin" />}
                        {hook ? 'New address' : 'Get address'}
                    </Button>
                </div>
            )}
        </>
    )
}

function AlertsOffRow({ orgId, agent, onCleared }: { orgId: string; agent: spaces.Member; onCleared: () => Promise<void> }) {
    const [busy, setBusy] = useState(false)
    const clear = async () => {
        if (busy) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:clearAgentHook', { orgId, agentId: agent.id })
            toast('Alerts turned off', 'success')
            await onCleared()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not turn alerts off', 'error')
        } finally {
            setBusy(false)
        }
    }
    return (
        <DangerRow title="Turn alerts off" note={`The address stops working at once. ${agent.displayName} can get a new one on the Alerts tab.`}>
            <ConfirmButton label="Turn alerts off" confirmLabel="Confirm turn off" busy={busy} onConfirm={() => void clear()} />
        </DangerRow>
    )
}

/** A platform agent's key (Replicas, PostHog, Cal.com): its last characters, whether the platform rejected it, and Replace for its owner. */
export function CredentialRow({ orgId, agent, credential, canReplace, onReplaced }: {
    orgId: string
    agent: spaces.Member
    credential: spaces.AgentCredential
    canReplace: boolean
    onReplaced: () => Promise<void>
}) {
    const [editing, setEditing] = useState(false)
    const [secret, setSecret] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const platform = PLATFORMS[agent.agentConnection ?? '']?.label ?? 'Platform'
    const save = async () => {
        setSaving(true)
        setError(null)
        try {
            await window.ipc.invoke('spaces:setAgentCredential', { orgId, agentId: agent.id, secret: secret.trim() })
            setEditing(false)
            setSecret('')
            toast(`${platform} key replaced`, 'success')
            await onReplaced()
        } catch (err) {
            setError(err instanceof Error ? err.message : `Could not replace the ${platform} key`)
        } finally {
            setSaving(false)
        }
    }
    return (
        <div className="mt-1 flex flex-col gap-1 text-[11px]">
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="min-w-0 truncate">
                    {platform} key {credential.hint}
                    {credential.rejectedAt && <span className="text-destructive"> · Key rejected: replace it to bring the agent back</span>}
                </span>
                {canReplace && !editing && (
                    <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
                        Replace
                    </button>
                )}
            </div>
            {editing && (
                <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (secret.trim()) void save()
                    }}
                >
                    <Input
                        type="password"
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        placeholder={`New ${platform} key`}
                        aria-label={`New ${platform} key`}
                        className="h-7 text-xs"
                        autoFocus
                    />
                    <Button type="submit" size="sm" className="h-7" disabled={!secret.trim() || saving}>
                        {saving && <Loader2 className="size-3 animate-spin" />}
                        Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => (setEditing(false), setSecret(''), setError(null))}>
                        Cancel
                    </Button>
                </form>
            )}
            {error && <span className="text-destructive">{error}</span>}
        </div>
    )
}
