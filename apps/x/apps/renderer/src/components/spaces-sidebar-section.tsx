import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, Bell, ChevronDown, ChevronRight, CornerDownRight, Hash, Link as LinkIcon, LogIn, MessageSquarePlus, MessagesSquare, MoreHorizontal, Settings, Pencil, Plus, RotateCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import {
    ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type SpaceSelection } from '@/components/spaces-view'
import { openSelfDirect, useSpaceFeed, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { prefetchStream, spaceLastActivityAt, useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import { NO_BADGE, streamBadge, threadBadge, useReadStateVersion, type SpaceBadge } from '@/lib/spaces-read-state'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { MemberAvatar, MemberStatus } from '@/components/spaces/atoms'
import { NewChatDialog } from '@/components/spaces/new-chat-dialog'
import { PersonalLinkDialog } from '@/components/spaces/personal-link-dialog'
import { RemoveServerDialog } from '@/components/spaces/remove-server-dialog'
import { directAvatarId, isSelfDirect, isSelfDirectUnsupported, markSelfDirectUnsupported, selfDirectFailureMessage, selfDirectRefused, spaceDisplayName } from '@/lib/spaces-direct'
import { prefetchMembers, useOrgRoster, useSelfDisplayName, usePeopleOnline } from '@/hooks/use-space-members'
import { isSpaceExpanded, setSpaceExpanded, useSpaceExpansionVersion } from '@/lib/spaces-expansion'
import type { RailSelection } from '@/lib/spaces-selection'
import { toast } from '@/lib/toast'
import { needsYouCount, useMyThreads } from '@/lib/spaces-my-threads'

type NewChatStart = 'menu' | 'group' | 'message'

/**
 * The chat list (spec §10, 2026-11-09, sections since the evening's design
 * pass): New space leads as the one primary action, Activity and Threads sit
 * above, and the chats come in three sections — Agents first, then Spaces,
 * then People — each newest activity first and ending in its own "new" row.
 * Your personal link is pinned to the foot; the host adds your account row
 * under it (SpaceRail's `account`).
 */
function ChatList({ org, activeSpace, unread, onOpenSpace, onOpenSettings, onOpenThreads, threadsActive = false, onOpenActivity, onOpenAgents, agentsActive = false, activityActive = false, onChanged, renderDiscussions, showArchived = false, activeDiscussionCount }: {
    org: OrgWithSpaces
    /** Your threads across the server's spaces, sessions among them (2026-11-05); absent = no row. */
    onOpenThreads?: (orgId: string) => void
    threadsActive?: boolean
    activeSpace: SpaceSelection
    unread: Map<string, SpaceBadge>
    showArchived?: boolean
    activeDiscussionCount?: number
    renderDiscussions?: (spaceId: string) => ReactNode
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenSettings?: (orgId: string, spaceId: string) => void
    /** Your agents (2026-10-21); absent = no Agents header row or "Add an agent". */
    onOpenAgents?: (orgId: string) => void
    agentsActive?: boolean
    /** The Activity surface (layer 3); absent = no row. */
    onOpenActivity?: (orgId: string) => void
    activityActive?: boolean
    onChanged: () => void
}) {
    // The Activity row's number: everything for me across every chat — the
    // same "for you" the chat rows show, summed.
    let forYou = 0
    for (const [key, badge] of unread) if (key.startsWith(`${org.id}/`)) forYou += badge.forYou
    // The New chat sheet, opened on the screen the click meant: a group, a message, or the menu.
    const [newChat, setNewChat] = useState<NewChatStart | null>(null)
    const [linkOpen, setLinkOpen] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)
    // Rename-in-place: the row's label becomes an input.
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const contacts = useOrgRoster(org.id, spaceIds)
    const peopleOnline = usePeopleOnline(org.id)
    // A dead OAuth session shows as a gentle "Sign in again" (org.authError, from core);
    // an unreachable server shows Retry.
    const needsSignIn = !!org.authError
    const [signingIn, setSigningIn] = useState(false)
    const signInAgain = async () => {
        setSigningIn(true)
        try {
            await window.ipc.invoke('spaces:signInOrg', { orgId: org.id })
            toast('Signed back in', 'success')
            onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Sign-in failed', 'error')
        } finally {
            setSigningIn(false)
        }
    }

    const renameSpace = async (spaceId: string) => {
        const name = renameValue.trim()
        setRenamingId(null)
        if (!name || name === org.spaces.find((s) => s.id === spaceId)?.name) return
        try {
            await window.ipc.invoke('spaces:renameSpace', { orgId: org.id, spaceId, name })
            onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not rename the space', 'error')
        }
    }

    // Warm every chat's tail so recency (and its unread) can read it.
    useEffect(() => {
        for (const room of [...org.spaces, ...org.directs]) prefetchStream(org.id, room.id)
    }, [org.id, org.spaces, org.directs])

    // Your notes-to-self DM sits in the list like anyone else's, labelled the way
    // conversation lists do: your name, then a quiet "you". It shows before it
    // exists — the server creates it on the first click.
    const selfDm = org.directs.find((dm) => isSelfDirect(dm, org.memberId))
    const selfRosterIds = useMemo(
        () => (selfDm ? [selfDm.id] : org.spaces.slice(0, 1).map((s) => s.id)),
        [selfDm, org.spaces],
    )
    const selfName = useSelfDisplayName(org.id, org.memberId, selfRosterIds)
        ?? (selfDm ? spaceDisplayName(org, selfDm).replace(/ \(you\)$/, '') : org.memberId)
    const [openingSelf, setOpeningSelf] = useState(false)
    const [selfUnsupported, setSelfUnsupported] = useState(() => isSelfDirectUnsupported(org.id))
    const openSelf = async () => {
        if (selfDm) return onOpenSpace(org.id, selfDm.id)
        if (openingSelf) return
        setOpeningSelf(true)
        try {
            onOpenSpace(org.id, await openSelfDirect(org.id, org.memberId))
        } catch (err) {
            if (selfDirectRefused(err)) {
                markSelfDirectUnsupported(org.id)
                setSelfUnsupported(true)
            }
            toast(selfDirectFailureMessage(err), 'error')
        } finally {
            setOpeningSelf(false)
        }
    }

    // Each section newest activity first. A DM is a person or an agent (its
    // other participant's kind, from your contacts); a space is a shared one.
    type Direct = { space: OrgWithSpaces['directs'][number]; otherId: string; agent: boolean }
    const lastActivity = (space: { id: string; createdAt: string }) => spaceLastActivityAt(org.id, space.id) ?? space.createdAt
    const byActivity = <T extends { space: { id: string; createdAt: string } }>(a: T, b: T) => lastActivity(b.space).localeCompare(lastActivity(a.space))
    const groups = org.spaces.filter((space) => !space.archived).map((space) => ({ space })).sort(byActivity).map((row) => row.space)
    const directs: Direct[] = org.directs.map((space) => {
        const otherId = directAvatarId(space, org.memberId)
        return { space, otherId, agent: contacts.find((m) => m.id === otherId)?.kind === 'agent' }
    }).sort(byActivity)
    const agentChats = directs.filter((row) => row.agent)
    const peopleChats = directs.filter((row) => !row.agent)
    const selfShown = !selfDm

    // Archived spaces (harbor #1186, 2026-10-14) leave the list for a
    // collapsed section at its foot — still readable, out of the way.
    const archivedSpaces = org.spaces.filter((space) => space.archived)
    const [archivedOpen, setArchivedOpen] = useState(false)
    // Viewing an archived space keeps its row in sight.
    const archivedShown = archivedOpen || archivedSpaces.some((space) => activeSpace?.orgId === org.id && activeSpace.spaceId === space.id)
    const startRename = (space: OrgWithSpaces['spaces'][number]) => {
        setRenameValue(space.name)
        setRenamingId(space.id)
    }
    const groupRow = (space: OrgWithSpaces['spaces'][number]) => {
        const active = activeSpace?.orgId === org.id && activeSpace.spaceId === space.id
        // Collapsed, the row carries the stream plus every followed
        // discussion; expanded, the discussions show their own and the
        // row keeps the stream's.
        const summed = unread.get(`${org.id}/${space.id}`) ?? NO_BADGE
        if (renamingId === space.id) {
            return <SidebarMenuItem key={space.id}>
                <div className="flex items-center gap-1 px-1 py-0.5">
                    <Input autoFocus value={renameValue} className="h-7 text-xs"
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') void renameSpace(space.id)
                            if (event.key === 'Escape') setRenamingId(null)
                        }} onBlur={() => void renameSpace(space.id)} />
                </div>
            </SidebarMenuItem>
        }
        return (
            <CollapsibleSpace key={space.id} orgId={org.id} spaceId={space.id} name={space.name}
                showArchived={showArchived} countOverride={active ? activeDiscussionCount : undefined} enabled={!!renderDiscussions}
                discussions={() => renderDiscussions?.(space.id)}>
                {(expanded) => { const badge = expanded ? streamBadge(org.id, space.id, false) : summed; return (<>
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <SidebarMenuButton
                                isActive={active}
                                onClick={() => onOpenSpace(org.id, space.id)}
                                // Hover = intent: warm the cached tail + roster and
                                // start the refresh, so the click paints instantly.
                                onMouseEnter={() => {
                                    prefetchStream(org.id, space.id)
                                    prefetchMembers(org.id, space.id)
                                }}
                                // The row behind it carries the hover and the selection (CollapsibleSpace).
                                className={cn('min-w-0 flex-1 hover:bg-transparent active:bg-transparent data-[active=true]:bg-transparent', renderDiscussions && 'pl-1')}
                            >
                                {/* A space is a channel — # says so. */}
                                <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className={cn('flex-1 truncate', badge.unread > 0 && !active && 'font-semibold text-foreground')}>{space.name}</span>
                                {!active && <UnreadBadge badge={badge} />}
                            </SidebarMenuButton>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            {onOpenSettings && <ContextMenuItem onSelect={() => onOpenSettings(org.id, space.id)}><Settings className="mr-2 size-3.5" />Space settings</ContextMenuItem>}
                            <ContextMenuItem disabled={space.archived} onClick={() => startRename(space)}>
                                <Pencil className="mr-2 size-3.5" /> Rename space
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                    {/* Spaces redesign (2026-10-21): rename was right-click only; a quiet
                        ⋯ on hover opens the same menu so it can be found. */}
                    {!space.archived && <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`Options for ${space.name}`} title="Space options"
                                className="spaces-row-more mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                                <MoreHorizontal className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        {/* Focus returning to the trigger would blur the rename input and commit it. */}
                        <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
                            <DropdownMenuItem onSelect={() => onOpenSettings?.(org.id, space.id)} disabled={!onOpenSettings}><Settings className="size-3.5" /> Space settings</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => startRename(space)}>
                                <Pencil className="size-3.5" /> Rename space
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>}
                </>) }}
            </CollapsibleSpace>
        )
    }
    const directRow = (row: Direct) => {
        const { space: dm, otherId } = row
        const active = activeSpace?.orgId === org.id && activeSpace.spaceId === dm.id
        const badge = unread.get(`${org.id}/${dm.id}`) ?? NO_BADGE
        const self = isSelfDirect(dm, org.memberId)
        const contact = contacts.find((m) => m.id === otherId)
        const label = self ? selfName : contact?.displayName ?? spaceDisplayName(org, dm)
        return (
            <SidebarMenuItem key={dm.id}>
                <SidebarMenuButton
                    isActive={active}
                    onClick={() => onOpenSpace(org.id, dm.id)}
                    onMouseEnter={() => {
                        prefetchStream(org.id, dm.id)
                        prefetchMembers(org.id, dm.id)
                    }}
                    className="spaces-rail-row"
                >
                    <MemberAvatar orgId={org.id} avatarUrl={contact?.avatarUrl} id={otherId} name={label} size="sm" online={peopleOnline.has(otherId)} availability={contact?.availability} agent={row.agent} agentKind={contact?.agentKind} />
                    <span className={cn('flex-1 truncate', badge.unread > 0 && !active && 'font-semibold text-foreground')}>
                        {label}<MemberStatus member={contact} />
                        {self && <span className="ml-1.5 font-normal text-muted-foreground">you</span>}
                    </span>
                    {!active && <UnreadBadge badge={badge} direct />}
                </SidebarMenuButton>
            </SidebarMenuItem>
        )
    }

    // A section: a plain label, and on the right, shown on hover, one quiet action.
    const sectionHead = (label: string, action?: { label: string; text: string; onClick: () => void }) => (
        <div className="flex items-center gap-0.5">
            <span className="flex h-6.5 min-w-0 flex-1 items-center pl-1.5 pr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
            {action && <button type="button" onClick={action.onClick} aria-label={action.label} title={action.label}
                className="spaces-sec-add flex h-6 shrink-0 items-center rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                {action.text}
            </button>}
        </div>
    )
    // The row that ends each section: its own "new", in the accent, one shape for all three.
    const actionRow = (text: string, title: string, onClick: () => void) => (
        <SidebarMenuItem>
            <SidebarMenuButton onClick={onClick} className="spaces-rail-row text-primary hover:text-primary" title={title}>
                <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-md border border-dashed border-primary/60"><Plus className="size-3" /></span>
                <span className="flex-1 truncate font-medium">{text}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    )
    const navRows = !!(onOpenActivity || onOpenThreads || needsSignIn || org.error)
    return (
        <>
            {/* The one primary action (2026-11-09): a space is where people and agents meet. */}
            <div className="mb-1.5 flex items-center gap-1 px-0.5">
                <Button size="sm" className="h-8 flex-1 justify-center gap-1.5 font-semibold" onClick={() => setNewChat('group')}>
                    <Plus className="size-3.5" /> New space
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="Spaces options" title="Options"
                            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                            <MoreHorizontal className="size-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setNewChat('menu')}><MessageSquarePlus className="size-3.5" /> New chat…</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setLinkOpen(true)}><LinkIcon className="size-3.5" /> Your link</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDisconnecting(true)}>
                            <Trash2 className="size-3.5" /> Sign out of Spaces on this device
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {/* Spaces redesign (2026-10-21): Activity is a nav row, all on one left edge. */}
            {navRows && <SidebarMenu className="gap-0.5">
                {/* A dead session or an unreachable server leads the rail, so it is seen. */}
                {needsSignIn ? (
                    <SidebarMenuItem>
                        <SidebarMenuButton onClick={() => void signInAgain()} disabled={signingIn} title={`Session expired — ${org.authError}`}
                            className="spaces-rail-row text-foreground">
                            <LogIn className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">{signingIn ? 'Signing in…' : 'Sign in again'}</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                ) : org.error ? (
                    <SidebarMenuItem>
                        <SidebarMenuButton onClick={onChanged} title={org.error} className="spaces-rail-row text-foreground">
                            <RotateCw className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">Retry</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                ) : null}
                {onOpenActivity && (
                    <SidebarMenuItem>
                        <SidebarMenuButton isActive={activityActive} onClick={() => onOpenActivity(org.id)} className="spaces-rail-row">
                            <Bell className="size-4 shrink-0 text-muted-foreground" />
                            <span className={cn('flex-1 truncate', forYou > 0 && !activityActive && 'font-semibold text-foreground')}>Activity</span>
                            {!activityActive && <UnreadBadge badge={{ unread: forYou, forYou }} />}
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )}
                {onOpenThreads && <ThreadsRow orgId={org.id} active={threadsActive} onOpen={() => onOpenThreads(org.id)} />}
            </SidebarMenu>}

            {/* Agents lead: your agents' chats, then Add an agent; the Agents page is a quiet "View all" on the header. */}
            <section aria-label="Agents" className="spaces-sec mt-3.5">
                {sectionHead('Agents', onOpenAgents ? { label: 'View all agents', text: agentsActive ? 'Viewing' : 'View all', onClick: () => onOpenAgents(org.id) } : undefined)}
                <SidebarMenu className="mt-0.5 gap-0.5">
                    {agentChats.map(directRow)}
                    {onOpenAgents
                        ? actionRow('Add an agent', 'Claude Code, Codex, Hermes and more — yours to bring into spaces', () => onOpenAgents(org.id))
                        : agentChats.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No agents yet.</li>}
                </SidebarMenu>
            </section>

            <section aria-label="Spaces" className="spaces-sec mt-3.5">
                {sectionHead('Spaces')}
                <SidebarMenu className="mt-0.5 gap-0.5">
                    {groups.map(groupRow)}
                    {actionRow('New space', 'A space for a project or a team: name it, add people and agents, share its link', () => setNewChat('group'))}
                    {archivedSpaces.length > 0 && (
                        <SidebarMenuItem>
                            <SidebarMenuButton onClick={() => setArchivedOpen((open) => !open)} aria-expanded={archivedShown}
                                className="spaces-rail-row text-muted-foreground">
                                <Archive className="size-3.5 shrink-0" />
                                <span className="flex-1 truncate">Archived ({archivedSpaces.length})</span>
                                <ChevronDown data-closed={!archivedShown || undefined} className="spaces-chev size-3.5 shrink-0" />
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    )}
                </SidebarMenu>
                {archivedSpaces.length > 0 && <RailCollapse open={archivedShown}>
                    <SidebarMenu className="gap-0.5 pt-0.5">{archivedSpaces.map(groupRow)}</SidebarMenu>
                </RailCollapse>}
            </section>

            <section aria-label="People" className="spaces-sec mt-3.5">
                {sectionHead('People')}
                <SidebarMenu className="mt-0.5 gap-0.5">
                    {peopleChats.map(directRow)}
                    {/* Not created yet: the same row, waiting for its first click. */}
                    {selfShown && (
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                onClick={() => void openSelf()}
                                className={cn('spaces-rail-row', selfUnsupported && 'opacity-50')}
                                title={selfUnsupported
                                    ? 'Notes to self need a newer server'
                                    : 'Notes to self — only you (and your agents) can see this'}
                            >
                                <MemberAvatar orgId={org.id} avatarUrl={contacts.find((m) => m.id === org.memberId)?.avatarUrl} id={org.memberId} name={selfName} size="sm" online={peopleOnline.has(org.memberId)} availability={contacts.find((m) => m.id === org.memberId)?.availability} />
                                <span className="flex-1 truncate">
                                    {selfName}<MemberStatus member={contacts.find((m) => m.id === org.memberId)} />
                                    <span className="ml-1.5 font-normal text-muted-foreground">{openingSelf ? 'opening…' : 'you'}</span>
                                </span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    )}
                    {actionRow('New message', 'Someone you share a space with, or one of your agents', () => setNewChat('message'))}
                </SidebarMenu>
            </section>
            {/* Your personal link (spec §4 Invites, 2026-11-09): how someone outside your groups reaches you. A full row pinned to the rail's foot. */}
            {!needsSignIn && !org.error && (
                <div className="sticky bottom-0 mt-auto bg-[var(--rowboat-panel-soft)] pb-1 pt-3" title={`You are ${org.memberId}`}>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton onClick={() => setLinkOpen(true)} title="Share a link that opens a direct message with you" className="spaces-rail-row text-muted-foreground">
                                <LinkIcon className="size-4 shrink-0" />
                                <span className="flex-1 truncate">Share your link</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </div>
            )}
            <NewChatDialog org={org} open={newChat !== null} start={newChat ?? 'menu'} onOpenChange={(open) => { if (!open) setNewChat(null) }} onOpenSpace={onOpenSpace} {...(onOpenAgents ? { onOpenAgents } : {})} />
            <PersonalLinkDialog orgId={org.id} open={linkOpen} onOpenChange={setLinkOpen} />
            <RemoveServerDialog org={org} open={disconnecting} onOpenChange={setDisconnecting} onRemoved={onChanged} />
        </>
    )
}

/**
 * Threads (2026-11-05, "coding session: threads" in Main): one row for every
 * thread you are in across your chats, sessions among them. The rail is for
 * places, so it lists no threads itself; its number is the threads that need
 * you (an agent waiting on you, or replies you haven't read).
 */
function ThreadsRow({ orgId, active, onOpen }: { orgId: string; active: boolean; onOpen: () => void }) {
    const { threads } = useMyThreads(orgId)
    const needsYou = needsYouCount(threads)
    return <SidebarMenuItem>
        <SidebarMenuButton isActive={active} onClick={onOpen} className="spaces-rail-row">
            <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn('flex-1 truncate', needsYou > 0 && !active && 'font-semibold text-foreground')}>Threads</span>
            {!active && <UnreadBadge badge={{ unread: needsYou, forYou: needsYou }} />}
        </SidebarMenuButton>
    </SidebarMenuItem>
}

/** Animated height via grid rows (spaces.css); closed content is inert, so it can't take focus. */
function RailCollapse({ id, open, children }: { id?: string, open: boolean, children: ReactNode }) {
    return <div id={id} data-open={open} inert={!open} className="spaces-collapse">
        <div>{children}</div>
    </div>
}

/** The Spaces rail's navigation: the server-level rows, then the chat list; nested discussions are optional for legacy consumers. */
export function ServerSpaceNavigation({ org, spaceId, onOpenSpace, onOpenSettings, onOpenThreads, threadsActive = false, onOpenActivity, onOpenAgents, agentsActive = false, activityActive = false, onOpenDiscussion, renderActiveDiscussions, activeDiscussionCount = 0, showArchived = false, showDiscussions = true }: {
    org: OrgWithSpaces
    spaceId: string
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenSettings?: (orgId: string, spaceId: string) => void
    onOpenThreads?: (orgId: string) => void
    threadsActive?: boolean
    /** Your agents (2026-10-21); absent = no row. */
    onOpenAgents?: (orgId: string) => void
    agentsActive?: boolean
    onOpenActivity?: (orgId: string) => void
    activityActive?: boolean
    onOpenDiscussion?: (spaceId: string, selection: RailSelection) => void
    renderActiveDiscussions?: (limit: number) => ReactNode
    activeDiscussionCount?: number
    showDiscussions?: boolean
    showArchived?: boolean
}) {
    const { refresh } = useSpacesOrgs()
    const unread = useSpacesUnreadCounts()
    // A hair between rows (gap-0.5 on each list), so a hovered row's highlight never touches the selected one's.
    // A column that fills its scroller, so the link row can sit at the foot.
    return <div className="spaces-rail-nav flex min-h-full flex-1 flex-col">
        <ChatList org={org} activeSpace={{ orgId: org.id, spaceId }} unread={unread} showArchived={showArchived} activeDiscussionCount={activeDiscussionCount}
            onOpenSpace={onOpenSpace} onOpenSettings={onOpenSettings} onOpenThreads={onOpenThreads} threadsActive={threadsActive} onOpenActivity={onOpenActivity} onOpenAgents={onOpenAgents} agentsActive={agentsActive} activityActive={activityActive} onChanged={() => void refresh()}
            renderDiscussions={showDiscussions && renderActiveDiscussions ? (id) => <SpaceDiscussions orgId={org.id} spaceId={id}
                active={id === spaceId} activeCount={activeDiscussionCount} showArchived={showArchived} renderActive={renderActiveDiscussions}
                onSelect={(selection) => onOpenDiscussion?.(id, selection)} /> : undefined} />
    </div>
}

function SpaceDiscussions({ orgId, spaceId, active, activeCount, renderActive, onSelect, showArchived }: {
    orgId: string
    spaceId: string
    active: boolean
    activeCount: number
    showArchived: boolean
    renderActive: (limit: number) => ReactNode
    onSelect: (selection: RailSelection) => void
}) {
    const feed = useSpaceFeed(orgId, spaceId)
    useReadStateVersion() // each discussion row reads its own badge
    const foldKey = `spaces:discussionsExpanded:${orgId}/${spaceId}`
    const [showAll, setShowAll] = useState(() => sessionStorage.getItem(foldKey) === 'true')
    const topics = feed.topics.filter((topic) => showArchived || !topic.archived).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    const count = active ? activeCount : topics.length
    return <div className="ml-3 border-l border-border pl-1">
        {active ? renderActive(showAll ? Infinity : 3) : (showAll ? topics : topics.slice(0, 3)).map((topic) => {
            // Followed discussions only: one you are not in never bolds or counts.
            const badge = threadBadge(orgId, spaceId, topic.rootMessageId, false)
            return <button key={topic.id} type="button" onClick={() => onSelect({ kind: 'thread', rootMessageId: topic.rootMessageId })}
                title={topic.title} className={cn('flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] hover:bg-accent/50', topic.archived && 'opacity-60')}>
                <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span className={cn('min-w-0 flex-1 truncate', badge.unread > 0 && 'font-semibold')}>{topic.title}</span>
                <UnreadBadge badge={badge} />
            </button>
        })}
        {count > 3 && <button type="button" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll((value) => { sessionStorage.setItem(foldKey, String(!value)); return !value })}>
            {showAll ? 'Show less' : 'View all'}
        </button>}
    </div>
}

function CollapsibleSpace({ orgId, spaceId, name, showArchived, countOverride, discussions, children, enabled = true }: {
    enabled?: boolean
    orgId: string
    spaceId: string
    name: string
    showArchived: boolean
    countOverride?: number
    discussions: () => ReactNode
    /** The row itself; told whether its discussions are showing, so its badge can step back to the stream's share. */
    children: (expanded: boolean) => ReactNode
}) {
    const feed = useSpaceFeed(orgId, spaceId)
    // Shared with the rail's expand-all / collapse-all, so one click can move every row.
    useSpaceExpansionVersion()
    const expanded = enabled && isSpaceExpanded(orgId, spaceId)
    const count = !enabled ? 0 : countOverride ?? feed.topics.filter((topic) => showArchived || !topic.archived).length
    // The highlight spans the whole row, arrow gutter included (2026-10-21), so it
    // lines up with the full-width rows above (Activity, Agents). Without
    // discussions there is no gutter (spaces redesign, 2026-10-21): one left edge.
    return <SidebarMenuItem>
        <div className="spaces-row spaces-rail-row flex items-center rounded-md hover:bg-sidebar-accent has-[[data-active=true]]:bg-sidebar-accent">
            {count > 0 ? <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} #${name}`} aria-expanded={expanded}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
                onClick={() => setSpaceExpanded(orgId, spaceId, !expanded)}>
                <ChevronRight className={cn('size-3.5', expanded && 'rotate-90')} />
            </button> : enabled ? <span className="w-5.5 shrink-0" /> : null}
            {children(expanded)}
        </div>
        {count > 0 && expanded && discussions()}
    </SidebarMenuItem>
}
