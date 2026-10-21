import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, Hash, KeyRound, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AgentsDialog, type AgentsDialogStart } from '@/components/spaces/agents-dialog'
import { MemberAvatar } from '@/components/spaces/atoms'
import { RemoveFromOrgDialog } from '@/components/spaces/member-admin'
import { refreshOrgRoster, useOrgRoster, useSpaceRosters } from '@/hooks/use-space-members'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { BUILT_IN_CONNECTION, agentLabel, kindInfo } from '@/lib/agent-kinds'
import { avatarColorClass, initials } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// Agents (2026-10-21): every agent in the org on one page — how many there
// are, what each one is, who added it, and which of your spaces it is in.
// Everyone sees every agent (the org roster already lists them); its owner
// renames it and opens its keys and setup; an admin can also open its keys
// (to revoke) and remove it from the server. Adding one, connecting it and
// its keys reuse the Agents dialog's screens.

type Filter = 'all' | 'mine'

export function AgentsView({ org }: { org: OrgWithSpaces }) {
    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const roster = useOrgRoster(org.id, spaceIds)
    const rosters = useSpaceRosters(org.id, spaceIds)
    const [filter, setFilter] = useState<Filter>('all')
    const [dialog, setDialog] = useState<AgentsDialogStart | null>(null)
    const [removing, setRemoving] = useState<spaces.Member | null>(null)

    const isAdmin = roster.find((m) => m.id === org.memberId)?.role === 'admin'
    const names = useMemo(() => new Map(roster.map((m) => [m.id, m.displayName])), [roster])
    const agents = useMemo(
        () => roster.filter((m) => m.kind === 'agent' && !m.removedAt && !m.deactivatedAt)
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        [roster],
    )
    const mine = agents.filter((a) => a.ownerId === org.memberId)
    const others = agents.filter((a) => a.ownerId !== org.memberId)
    // Which of your spaces each agent is in: the only spaces you can see the rosters of.
    const spacesOf = useMemo(() => {
        const out = new Map<string, string[]>()
        for (const space of org.spaces) {
            for (const member of rosters.get(space.id) ?? []) {
                if (member.kind !== 'agent') continue
                const list = out.get(member.id) ?? []
                list.push(space.name)
                out.set(member.id, list)
            }
        }
        return out
    }, [org.spaces, rosters])

    const card = (agent: spaces.Member) => (
        <AgentCard
            key={agent.id}
            orgId={org.id}
            agent={agent}
            owner={agent.ownerId === org.memberId ? 'you' : agent.ownerId ? { id: agent.ownerId, name: names.get(agent.ownerId) ?? 'Someone' } : 'built-in'}
            spaceNames={spacesOf.get(agent.id) ?? []}
            isAdmin={isAdmin}
            onOpenSettings={() => setDialog({ name: 'agent', agentId: agent.id })}
            onRemove={() => setRemoving(agent)}
        />
    )

    return (
        <section aria-label="Agents" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="flex items-baseline gap-2.5 text-2xl font-semibold tracking-tight">
                            Agents
                            <span className="text-base font-normal tabular-nums text-muted-foreground">{agents.length}</span>
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">Every agent in {org.name}, what it runs on, and who added it.</p>
                    </div>
                    <Segmented
                        label="Show"
                        value={filter}
                        onChange={setFilter}
                        options={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }]}
                    />
                </header>

                <Group title="Yours" count={mine.length}>
                    {mine.map(card)}
                    <NewAgentCard onAdd={(bot) => setDialog({ name: 'add', bot })} />
                </Group>

                {filter === 'all' && others.length > 0 && (
                    <Group title="Everyone else’s" count={others.length}>
                        {others.map(card)}
                    </Group>
                )}
            </div>

            <AgentsDialog
                org={org}
                open={dialog !== null}
                onOpenChange={(open) => { if (!open) setDialog(null) }}
                {...(dialog ? { start: dialog } : {})}
            />
            {removing && <RemoveFromOrgDialog orgId={org.id} orgName={org.name} member={removing} onClose={() => setRemoving(null)} />}
        </section>
    )
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
    return (
        <section aria-label={title} className="mt-10">
            <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-medium text-muted-foreground">
                {title}
                {count > 0 && <span className="tabular-nums text-muted-foreground/70">{count}</span>}
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{children}</ul>
        </section>
    )
}

function Segmented<T extends string>({ label, value, onChange, options }: {
    label: string
    value: T
    onChange: (value: T) => void
    options: ReadonlyArray<{ value: T; label: string }>
}) {
    return (
        <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'rounded-md px-3 py-1 text-xs transition-colors',
                        value === o.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

/** The agent's face: its initials in its color, with what it runs on in the corner. */
function AgentFace({ agent }: { agent: spaces.Member }) {
    const logo = kindInfo(agent.agentKind).logo
    return (
        <span className="relative inline-flex">
            <span className={cn('inline-flex size-12 items-center justify-center rounded-full text-base font-semibold select-none', avatarColorClass(agent.id))}>
                {initials(agent.displayName)}
            </span>
            {/* `[.dark_&]:`, not `dark:`: the app's theme class, not the OS setting (agent-setup.tsx). */}
            <span aria-hidden className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center overflow-hidden rounded-md bg-background ring-2 ring-[var(--card-surface)]">
                {logo ? (
                    <>
                        <img src={logo.light} alt="" className="size-full [.dark_&]:hidden" />
                        <img src={logo.dark} alt="" className="hidden size-full [.dark_&]:block" />
                    </>
                ) : (
                    <Bot className="size-3.5 text-muted-foreground" />
                )}
            </span>
        </span>
    )
}

function AgentCard({ orgId, agent, owner, spaceNames, isAdmin, onOpenSettings, onRemove }: {
    orgId: string
    agent: spaces.Member
    owner: 'you' | 'built-in' | { id: string; name: string }
    spaceNames: string[]
    isAdmin: boolean
    onOpenSettings: () => void
    onRemove: () => void
}) {
    const yours = owner === 'you'
    const builtIn = agent.agentConnection === BUILT_IN_CONNECTION
    // The owner's settings, or an admin's off switch (revoking keys); Ro has no keys.
    const canOpen = !builtIn && (yours || isAdmin)
    const canRemove = isAdmin && !builtIn
    const [renaming, setRenamingState] = useState(false)
    const renamingRef = useRef(false)
    const setRenaming = (on: boolean) => {
        renamingRef.current = on
        setRenamingState(on)
    }
    const [draft, setDraft] = useState('')
    const [pendingName, setPendingName] = useState<string | null>(null)

    const startRename = () => {
        setDraft(agent.displayName)
        setRenaming(true)
    }
    const saveRename = async () => {
        if (!renamingRef.current) return
        setRenaming(false)
        const name = draft.replace(/\s+/g, ' ').trim()
        if (!name || name === agent.displayName) return
        setPendingName(name)
        try {
            await window.ipc.invoke('spaces:renameAgent', { orgId, agentId: agent.id, displayName: name })
            refreshOrgRoster(orgId)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not rename the agent', 'error')
        } finally {
            setPendingName(null)
        }
    }
    const shownName = pendingName ?? agent.displayName

    return (
        <li
            className={cn(
                'group relative flex min-h-[188px] flex-col rounded-xl border border-border bg-[var(--card-surface)] p-4 transition-[border-color,box-shadow,transform] duration-150',
                canOpen && 'hover:-translate-y-px hover:border-foreground/15 hover:shadow-[var(--rowboat-shadow-soft)]',
            )}
        >
            {canOpen && !renaming && (
                // The whole card opens the agent; the menu and rename sit above it.
                <button type="button" aria-label={`Open ${shownName}`} onClick={onOpenSettings} className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
            )}
            <div className="flex items-start justify-between">
                <AgentFace agent={{ ...agent, displayName: shownName }} />
                {(yours || canOpen || canRemove) && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label={`${shownName} options`}
                                className="relative z-10 -mr-1.5 -mt-1.5 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                            >
                                <MoreHorizontal className="size-4" />
                            </button>
                        </DropdownMenuTrigger>
                        {/* Rename focuses its field: the menu must not pull focus back to its trigger as it closes. */}
                        <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={(e) => { if (renamingRef.current) e.preventDefault() }}>
                            {yours && (
                                <DropdownMenuItem onSelect={() => window.setTimeout(startRename, 0)}>
                                    <Pencil className="size-3.5" /> Rename
                                </DropdownMenuItem>
                            )}
                            {canOpen && (
                                <DropdownMenuItem onSelect={onOpenSettings}>
                                    <KeyRound className="size-3.5" /> {yours ? 'Keys and setup' : 'Keys'}
                                </DropdownMenuItem>
                            )}
                            {canRemove && (
                                <>
                                    {(yours || canOpen) && <DropdownMenuSeparator />}
                                    <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                                        <Trash2 className="size-3.5" /> Remove from server
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            <div className="mt-5 min-w-0">
                {renaming ? (
                    <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => void saveRename()}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveRename()
                            if (e.key === 'Escape') setRenaming(false)
                        }}
                        aria-label="Agent name"
                        maxLength={128}
                        autoFocus
                        className="relative z-10 -mx-2 h-7 px-2 text-sm font-medium"
                    />
                ) : (
                    <div className="truncate text-sm font-medium" title={shownName}>{shownName}</div>
                )}
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{agentLabel(agent.agentKind, agent.agentConnection)}</div>
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                    {owner === 'you' ? (
                        <span>Yours</span>
                    ) : owner === 'built-in' ? (
                        <span>Built in</span>
                    ) : (
                        <>
                            <MemberAvatar id={owner.id} name={owner.name} size="sm" agent={false} />
                            <span className="truncate">{owner.name}</span>
                        </>
                    )}
                </span>
                <SpacesBadge names={spaceNames} />
            </div>
        </li>
    )
}

function SpacesBadge({ names }: { names: string[] }) {
    if (names.length === 0) return <span className="shrink-0 text-muted-foreground/70">No shared spaces</span>
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="relative z-10 flex shrink-0 cursor-default items-center gap-1 tabular-nums">
                    <Hash className="size-3" />
                    {names.length} {names.length === 1 ? 'space' : 'spaces'}
                </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-60">
                {names.map((n) => `#${n}`).join(', ')}
            </TooltipContent>
        </Tooltip>
    )
}

function NewAgentCard({ onAdd }: { onAdd: (bot: boolean) => void }) {
    return (
        <li className="flex min-h-[188px] flex-col rounded-xl border border-dashed border-border transition-colors hover:border-foreground/25">
            <button
                type="button"
                onClick={() => onAdd(false)}
                className="flex flex-1 flex-col items-center justify-center gap-2 rounded-t-xl text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
                <span className="flex size-9 items-center justify-center rounded-full border border-border">
                    <Plus className="size-4" />
                </span>
                New agent
            </button>
            <button
                type="button"
                onClick={() => onAdd(true)}
                className="pb-3 text-[11px] text-muted-foreground/80 transition-colors hover:text-foreground"
            >
                or add a bot
            </button>
        </li>
    )
}
