import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bell, ChevronRight, CornerDownRight, Hash, MessagesSquare, Pencil, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import {
    ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { type SpaceSelection } from '@/components/spaces-view'
import { openSelfDirect, useSpaceFeed, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { prefetchStream, spaceLastActivityAt, useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import { NO_BADGE, streamBadge, threadBadge, useReadStateVersion, type SpaceBadge } from '@/lib/spaces-read-state'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { AddOrgDialog, MemberAvatar } from '@/components/spaces/atoms'
import { NewDirectDialog } from '@/components/spaces/new-direct-dialog'
import { directAvatarId, isSelfDirect, isSelfDirectUnsupported, markSelfDirectUnsupported, selfDirectFailureMessage, selfDirectRefused, spaceDisplayName } from '@/lib/spaces-direct'
import { prefetchMembers, useSelfDisplayName } from '@/hooks/use-space-members'
import { readLastSpace, resolveSpacesLocation } from '@/lib/spaces-navigation'
import type { RailSelection } from '@/lib/spaces-selection'
import { toast } from '@/lib/toast'

const MAX_VISIBLE_DIRECTS = 3

export function SpacesSidebarSection({ active, activeSpace, onOpenSpaces, onOpenSpace }: {
    active: boolean
    activeSpace: SpaceSelection
    onOpenSpaces: () => void
    onOpenSpace: (orgId: string, spaceId: string) => void
}) {
    const { orgs, refresh } = useSpacesOrgs()
    const [addOrgOpen, setAddOrgOpen] = useState(false)
    const current = resolveSpacesLocation(orgs, activeSpace ?? readLastSpace())
    return <SidebarGroup className="pt-0">
        <SidebarGroupContent>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton data-tour-id="nav-spaces" isActive={active} onClick={onOpenSpaces}>
                        <MessagesSquare className="size-4 shrink-0" />
                        <span>Spaces</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction type="button" showOnHover aria-label="Add a server" title="Add a server"
                        onClick={() => setAddOrgOpen(true)}>
                        <Plus />
                    </SidebarMenuAction>
                    {orgs.length > 0 && <SidebarMenu className="ml-4 w-auto gap-0 border-l border-sidebar-border pl-2">
                        {orgs.map((org) => {
                            const selected = current?.orgId === org.id
                            return <SidebarMenuItem key={org.id}>
                                <SidebarMenuButton
                                    aria-current={active && selected ? 'page' : undefined}
                                    className="h-7 text-[13px]"
                                    onClick={() => {
                                        if (selected) onOpenSpaces()
                                        else onOpenSpace(org.id, org.spaces[0]?.id ?? org.directs[0]?.id ?? '')
                                    }}>
                                    <span className={cn('truncate', selected ? 'font-medium text-sidebar-foreground' : 'font-normal text-muted-foreground')}>{org.name}</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        })}
                    </SidebarMenu>}
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarGroupContent>
        <AddOrgDialog open={addOrgOpen} onOpenChange={setAddOrgOpen} onAdded={() => void refresh()} />
    </SidebarGroup>
}

function OrgRows({ org, activeSpace, unread, onOpenSpace, onOpenActivity, activityActive = false, onChanged, renderDiscussions, showArchived = false, activeDiscussionCount }: {
    org: OrgWithSpaces
    activeSpace: SpaceSelection
    unread: Map<string, SpaceBadge>
    showArchived?: boolean
    activeDiscussionCount?: number
    renderDiscussions?: (spaceId: string) => ReactNode
    onOpenSpace: (orgId: string, spaceId: string) => void
    /** The org's Activity surface (layer 3); absent = no row. */
    onOpenActivity?: (orgId: string) => void
    activityActive?: boolean
    onChanged: () => void
}) {
    // The Activity row's number: everything for me across the org's spaces —
    // the same "for you" the space rows show, summed.
    let forYou = 0
    for (const [key, badge] of unread) if (key.startsWith(`${org.id}/`)) forYou += badge.forYou
    const [directsCollapsed, setDirectsCollapsed] = useState(() => sessionStorage.getItem(`spaces:directsCollapsed:${org.id}`) === 'true')
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    // Rename-in-place: the row's label becomes an input (same shape as create).
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [newDirectOpen, setNewDirectOpen] = useState(false)
    const [showAllDirects, setShowAllDirects] = useState(() => sessionStorage.getItem(`spaces:directsExpanded:${org.id}`) === 'true')
    // A dead OAuth session shows as a gentle "Sign in again" (org.authError, from core);
    // an unreachable org shows Retry.
    const needsSignIn = !!org.authError
    const [signingIn, setSigningIn] = useState(false)
    const signInAgain = async () => {
        setSigningIn(true)
        try {
            await window.ipc.invoke('spaces:signInOrg', { orgId: org.id })
            toast(`Signed back into ${org.name}`, 'success')
            onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Sign-in failed', 'error')
        } finally {
            setSigningIn(false)
        }
    }

    const createSpace = async () => {
        const name = newName.trim()
        if (!name) return
        try {
            const { space } = await window.ipc.invoke('spaces:createSpace', { orgId: org.id, name })
            setCreating(false)
            setNewName('')
            onChanged()
            onOpenSpace(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the space', 'error')
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

    // DMs: people, most recent conversation first. A DM has no discussions
    // to badge from, so its stream is warmed here — unread and recency both
    // read the loaded tail.
    useEffect(() => {
        for (const dm of org.directs) prefetchStream(org.id, dm.id)
    }, [org.id, org.directs])
    // Your notes-to-self DM sits in the list like anyone else's, sorted by
    // activity, labelled the way conversation lists do: your name, then a quiet "you".
    // It shows before it exists — the org creates it on the first click.
    const selfDm = org.directs.find((dm) => isSelfDirect(dm, org.memberId))
    const directs = [...org.directs].sort((a, b) =>
        (spaceLastActivityAt(org.id, b.id) ?? b.createdAt).localeCompare(spaceLastActivityAt(org.id, a.id) ?? a.createdAt))
    const visibleDirects = showAllDirects ? directs : directs.slice(0, MAX_VISIBLE_DIRECTS)
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
            toast(selfDirectFailureMessage(org.name, err), 'error')
        } finally {
            setOpeningSelf(false)
        }
    }

    return (
        <>
            {onOpenActivity && (
                <SidebarMenuItem>
                    <SidebarMenuButton isActive={activityActive} onClick={() => onOpenActivity(org.id)} className="pl-6">
                        <Bell className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className={cn('flex-1 truncate', forYou > 0 && !activityActive && 'font-medium text-foreground')}>Activity</span>
                        {!activityActive && <UnreadBadge badge={{ unread: forYou, forYou }} />}
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
            <SidebarMenuItem>
                <div className="group/org flex h-7 items-center gap-1.5 rounded-md pl-6 pr-2 text-[11.5px] text-muted-foreground" title={`You are ${org.memberId}`}>
                    <button type="button" onClick={() => setCreating(true)} className="flex flex-1 items-center gap-1.5 text-left hover:text-foreground">
                        <Plus className="size-3.5" /> New space
                    </button>
                    {needsSignIn ? (
                        <button
                            type="button"
                            onClick={() => void signInAgain()}
                            disabled={signingIn}
                            className="rounded-sm border border-border bg-background px-1.5 py-px text-[10.5px] text-foreground/80 hover:bg-accent disabled:opacity-50"
                            title={`Session expired — ${org.authError}`}
                        >
                            {signingIn ? 'Signing in…' : 'Sign in again'}
                        </button>
                    ) : org.error ? (
                        <button
                            type="button"
                            onClick={onChanged}
                            className="rounded-sm border border-border bg-background px-1.5 py-px text-[10.5px] text-foreground/80 hover:bg-accent"
                            title={org.error}
                        >
                            Retry
                        </button>
                    ) : null}

                </div>
            </SidebarMenuItem>
            {org.spaces.map((space) => {
                const active = activeSpace?.orgId === org.id && activeSpace.spaceId === space.id
                // Collapsed, the row carries the stream plus every followed
                // discussion; expanded, the discussions show their own and the
                // row keeps the stream's.
                const summed = unread.get(`${org.id}/${space.id}`) ?? NO_BADGE
                if (renamingId === space.id) {
                    return <SidebarMenuItem key={space.id}>
                        <div className="flex items-center gap-1 py-0.5 pl-9 pr-2">
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
                        showArchived={showArchived} countOverride={active ? activeDiscussionCount : undefined}
                        discussions={() => renderDiscussions?.(space.id)}>
                            {(expanded) => { const badge = expanded ? streamBadge(org.id, space.id, false) : summed; return (
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
                                        className="min-w-0 flex-1 pl-1"
                                    >
                                        {/* A space is a channel — # says so. */}
                                        <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                                        <span className={cn('flex-1 truncate', badge.unread > 0 && !active && 'font-medium text-foreground')}>{space.name}</span>
                                        {!active && <UnreadBadge badge={badge} />}
                                    </SidebarMenuButton>
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                    <ContextMenuItem
                                        onClick={() => {
                                            setRenameValue(space.name)
                                            setRenamingId(space.id)
                                        }}
                                    >
                                        <Pencil className="mr-2 size-3.5" /> Rename space
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                            ) }}
                    </CollapsibleSpace>
                )
            })}
            {org.spaces.length === 0 && !org.error && !creating && (
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setCreating(true)} className="pl-6 text-muted-foreground">
                        <Plus className="size-3.5 shrink-0" />
                        <span className="flex-1 truncate text-xs">Create the first space</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
            {/* Direct messages: the org's people you talk to, most recent first.
                A DM is a space with a two-person roster (contract 2026-09-07);
                the row is the person, not a channel. */}
            {!org.error && (
                <SidebarMenuItem>
                    <button type="button" aria-expanded={!directsCollapsed} onClick={() => setDirectsCollapsed((v) => { sessionStorage.setItem(`spaces:directsCollapsed:${org.id}`, String(!v)); return !v })} className="flex h-8 w-full items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
                        <ChevronRight className={cn("size-3.5", !directsCollapsed && "rotate-90")} />
                        <span className="truncate">Direct messages</span>
                    </button>
                </SidebarMenuItem>
            )}
            {!directsCollapsed && !org.error && visibleDirects.map((dm) => {
                const active = activeSpace?.orgId === org.id && activeSpace.spaceId === dm.id
                const badge = unread.get(`${org.id}/${dm.id}`) ?? NO_BADGE
                const self = isSelfDirect(dm, org.memberId)
                const label = self ? selfName : spaceDisplayName(org, dm)
                const other = directAvatarId(dm, org.memberId)
                return (
                    <SidebarMenuItem key={dm.id}>
                        <SidebarMenuButton
                            isActive={active}
                            onClick={() => onOpenSpace(org.id, dm.id)}
                            onMouseEnter={() => {
                                prefetchStream(org.id, dm.id)
                                prefetchMembers(org.id, dm.id)
                            }}
                            className="pl-6"
                        >
                            <MemberAvatar id={other} name={label} size="sm" className="size-4 rounded-[3px] text-[8px]" />
                            <span className={cn('flex-1 truncate', badge.unread > 0 && !active && 'font-medium text-foreground')}>
                                {label}
                                {self && <span className="ml-1.5 font-normal text-muted-foreground">you</span>}
                            </span>
                            {!active && <UnreadBadge badge={badge} direct />}
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )
            })}
            {/* Not created yet: the same row, waiting for its first click. */}
            {!directsCollapsed && !org.error && !selfDm && (
                <SidebarMenuItem>
                    <SidebarMenuButton
                        onClick={() => void openSelf()}
                        className={cn('pl-6', selfUnsupported && 'opacity-50')}
                        title={selfUnsupported
                            ? `Notes to self need a newer server — ${org.name} hasn't been updated yet`
                            : 'Notes to self — only you (and your agent) can see this'}
                    >
                        <MemberAvatar id={org.memberId} name={selfName} size="sm" className="size-4 rounded-[3px] text-[8px]" />
                        <span className="flex-1 truncate">
                            {selfName}
                            <span className="ml-1.5 font-normal text-muted-foreground">{openingSelf ? 'opening…' : 'you'}</span>
                        </span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
            {!directsCollapsed && !org.error && directs.length > MAX_VISIBLE_DIRECTS && (
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setShowAllDirects((v) => { sessionStorage.setItem(`spaces:directsExpanded:${org.id}`, String(!v)); return !v })} className="pl-6 text-muted-foreground">
                        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', showAllDirects && 'rotate-90')} />
                        <span className="flex-1 truncate text-xs">{showAllDirects ? 'Show less' : 'View all'}</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
            {!org.error && (
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setNewDirectOpen(true)} className="pl-6 text-muted-foreground">
                        <Plus className="size-3.5 shrink-0" />
                        <span className="flex-1 truncate text-xs">New message</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
            <NewDirectDialog org={org} open={newDirectOpen} onOpenChange={setNewDirectOpen} onOpened={onOpenSpace} />
            {creating && (
                <SidebarMenuItem>
                    <div className="flex items-center gap-1 py-0.5 pl-9 pr-2">
                        <Input
                            autoFocus
                            value={newName}
                            placeholder="Space name"
                            className="h-7 text-xs"
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void createSpace()
                                if (e.key === 'Escape') {
                                    setCreating(false)
                                    setNewName('')
                                }
                            }}
                            onBlur={() => {
                                if (!newName.trim()) setCreating(false)
                            }}
                        />
                    </div>
                </SidebarMenuItem>
            )}
        </>
    )
}

/** Server navigation lives above the selected space's existing files pane. */
export function ServerSpaceNavigation({ org, spaceId, onOpenSpace, onOpenActivity, activityActive = false, onOpenDiscussion, renderActiveDiscussions, activeDiscussionCount, showArchived = false }: {
    org: OrgWithSpaces
    spaceId: string
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenActivity?: (orgId: string) => void
    activityActive?: boolean
    onOpenDiscussion: (spaceId: string, selection: RailSelection) => void
    renderActiveDiscussions: (limit: number) => ReactNode
    activeDiscussionCount: number
    showArchived?: boolean
}) {
    const { refresh } = useSpacesOrgs()
    const unread = useSpacesUnreadCounts()
    return <SidebarMenu>
        <OrgRows org={org} activeSpace={{ orgId: org.id, spaceId }} unread={unread} showArchived={showArchived} activeDiscussionCount={activeDiscussionCount}
            onOpenSpace={onOpenSpace} onOpenActivity={onOpenActivity} activityActive={activityActive} onChanged={() => void refresh()}
            renderDiscussions={(id) => <SpaceDiscussions orgId={org.id} spaceId={id}
                active={id === spaceId} activeCount={activeDiscussionCount} showArchived={showArchived} renderActive={renderActiveDiscussions}
                onSelect={(selection) => onOpenDiscussion(id, selection)} />} />
    </SidebarMenu>
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

function CollapsibleSpace({ orgId, spaceId, name, showArchived, countOverride, discussions, children }: {
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
    const key = `spaces:spaceExpanded:${orgId}/${spaceId}`
    const [expanded, setExpanded] = useState(() => sessionStorage.getItem(key) === 'true')
    const count = countOverride ?? feed.topics.filter((topic) => showArchived || !topic.archived).length
    return <SidebarMenuItem>
        <div className="flex items-center">
            {count > 0 ? <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} #${name}`} aria-expanded={expanded}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
                onClick={() => setExpanded((value) => { sessionStorage.setItem(key, String(!value)); return !value })}>
                <ChevronRight className={cn('size-3.5', expanded && 'rotate-90')} />
            </button> : <span className="w-5.5 shrink-0" />}
            {children(expanded)}
        </div>
        {count > 0 && expanded && discussions()}
    </SidebarMenuItem>
}
