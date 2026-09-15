import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Bell, ChevronDown, ChevronRight, CornerDownRight, Hash, MessagesSquare, Pencil, Plus } from 'lucide-react'
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
import { MemberAvatar } from '@/components/spaces/atoms'
import { NewDirectDialog } from '@/components/spaces/new-direct-dialog'
import { directAvatarId, isSelfDirect, isSelfDirectUnsupported, markSelfDirectUnsupported, selfDirectFailureMessage, selfDirectRefused, spaceDisplayName } from '@/lib/spaces-direct'
import { prefetchMembers, useSelfDisplayName } from '@/hooks/use-space-members'
import { isSpaceExpanded, setSpaceExpanded, useSpaceExpansionVersion } from '@/lib/spaces-expansion'
import type { RailSelection } from '@/lib/spaces-selection'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'
import { useCrossOrgActivity } from '@/hooks/use-cross-org-activity'
import { actorLabel, excerptOf, reasonLabel, targetOf, type ActivityTarget } from '@/lib/spaces-activity'
import { formatFeedTime } from '@/lib/spaces-presentation'


/** Cross-organization attention feed; the space rail owns conversation navigation. */
export function SpacesSidebarSection({ active, onOpenSpaces, onOpenMessage }: {
    active: boolean
    onOpenSpaces: () => void
    onOpenMessage: (target: ActivityTarget) => void
}) {
    const { orgs, loading: orgsLoading } = useSpacesOrgs()
    const [expanded, setExpanded] = useState(() => localStorage.getItem('spaces:sidebarActivityCollapsed') !== 'true')
    const contentId = useId()
    const activity = useCrossOrgActivity(orgs.map((org) => org.id), expanded)
    const unread = useSpacesUnreadCounts()
    const badge = { unread: 0, forYou: 0 }
    for (const org of orgs) for (const space of [...org.spaces, ...org.directs]) {
        const count = unread.get(`${org.id}/${space.id}`)
        badge.unread += count?.unread ?? 0
        badge.forYou += count?.forYou ?? 0
    }
    const orgById = new Map(orgs.map((org) => [org.id, org]))
    return <SidebarGroup className="pt-0">
        <SidebarGroupContent>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton data-tour-id="nav-spaces" isActive={active} onClick={onOpenSpaces}>
                        <MessagesSquare className="size-4 shrink-0" />
                        <span className="flex-1">Spaces</span>
                        <UnreadBadge badge={badge} />
                    </SidebarMenuButton>
                    <SidebarMenuAction type="button" aria-label={expanded ? 'Collapse Spaces activity' : 'Expand Spaces activity'}
                        title={expanded ? 'Collapse Spaces activity' : 'Expand Spaces activity'} aria-expanded={expanded} aria-controls={contentId}
                        onClick={() => setExpanded((value) => { localStorage.setItem('spaces:sidebarActivityCollapsed', String(value)); return !value })}>
                        <ChevronDown className={cn('transition-transform', !expanded && '-rotate-90')} />
                    </SidebarMenuAction>
                    {expanded && <div id={contentId} role="region" aria-label="Activity across organizations" className="mt-1">
                        <ul className="flex flex-col gap-1 px-1">
                            {activity.items.map(({ orgId, item, names }) => {
                                const org = orgById.get(orgId)!
                                const who = actorLabel(item.actors, names)
                                const reason = reasonLabel(item)
                                const spaceNames = new Map([...org.spaces, ...org.directs].map((space) => [space.id, space.name]))
                                const excerpt = excerptOf(item.message.body, names, spaceNames)
                                return <li key={`${orgId}/${item.id}`}>
                                    <button type="button" onClick={() => onOpenMessage(targetOf(orgId, item))}
                                        title={`${org.name} · ${who} ${reason}\n${excerpt}\n${new Date(item.at).toLocaleString()}`}
                                        className={cn(
                                            'w-full min-w-0 rounded-lg px-2 py-1.5 text-left ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                                            item.unread
                                                ? 'bg-sidebar-accent/65 ring-sidebar-border/50 hover:bg-sidebar-accent dark:bg-sidebar-accent/50'
                                                : 'bg-sidebar-accent/30 ring-sidebar-border/30 hover:bg-sidebar-accent/60 dark:bg-black/20 dark:ring-white/[0.035]',
                                        )}>
                                        <span className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                                            <span className="min-w-0 flex-1 truncate">{org.name}</span>
                                            <span className="shrink-0 tabular-nums">{formatFeedTime(item.at)}</span>
                                        </span>
                                        <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                                            <span className="min-w-0 flex-1 truncate"><span className={cn(item.unread ? 'font-semibold text-sidebar-foreground' : 'font-medium')}>{who}</span>{' '}
                                                <span className="text-muted-foreground">{reason}</span>{excerpt && <span className="text-muted-foreground"> · {item.kind === 'reaction' ? 'You: ' : ''}<span>{excerpt}</span></span>}</span>
                                            {item.unread && <span aria-label="unread" className="size-1.5 shrink-0 rounded-full bg-[var(--stream-alert)]" />}
                                        </span>
                                    </button>
                                </li>
                            })}
                        </ul>
                        {activity.items.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">
                            {orgsLoading || activity.loading ? 'Loading activity…' : orgs.length === 0 ? 'Connect a server to see activity.' : activity.failedOrgIds.length ? 'Activity is unavailable.' : 'No activity yet.'}
                        </p>}
                        {activity.failedOrgIds.length > 0 && <button type="button" onClick={activity.retry}
                            title={activity.failedOrgIds.map((id) => orgById.get(id)?.name).join(', ')}
                            className="px-2 py-1 text-xs text-muted-foreground hover:text-sidebar-foreground">
                            {activity.failedOrgIds.length} {activity.failedOrgIds.length === 1 ? 'organization' : 'organizations'} unavailable · Retry
                        </button>}
                    </div>}
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarGroupContent>
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
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    // Rename-in-place: the row's label becomes an input (same shape as create).
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [newDirectOpen, setNewDirectOpen] = useState(false)
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
            analytics.spacesSpaceCreated()
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

    // DMs: people, most recent conversation first. Warm their streams so
    // unread and recency can read the loaded tail.
    useEffect(() => {
        for (const dm of org.directs) prefetchStream(org.id, dm.id)
    }, [org.id, org.directs])
    // Your notes-to-self DM sits in the list like anyone else's, sorted by
    // activity, labelled the way conversation lists do: your name, then a quiet "you".
    // It shows before it exists — the org creates it on the first click.
    const selfDm = org.directs.find((dm) => isSelfDirect(dm, org.memberId))
    const directs = [...org.directs].sort((a, b) =>
        (spaceLastActivityAt(org.id, b.id) ?? b.createdAt).localeCompare(spaceLastActivityAt(org.id, a.id) ?? a.createdAt))
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
                        showArchived={showArchived} countOverride={active ? activeDiscussionCount : undefined} enabled={!!renderDiscussions}
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
            <SidebarMenuItem>
                <div className="group/org flex h-8 items-center gap-1.5 rounded-md pl-6 pr-2 text-xs text-muted-foreground" title={`You are ${org.memberId}`}>
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
            {/* Direct messages: the org's people you talk to, most recent first.
                A DM is a space with a two-person roster (contract 2026-09-07);
                the row is the person, not a channel. */}
            {!org.error && (
                <SidebarMenuItem>
                    <h3 className="flex h-8 items-center px-1 text-[13px] font-semibold text-muted-foreground">DMs</h3>
                </SidebarMenuItem>
            )}
            {!org.error && directs.map((dm) => {
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
            {!org.error && !selfDm && (
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
            {!org.error && (
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setNewDirectOpen(true)} className="pl-6 text-muted-foreground">
                        <Plus className="size-3.5 shrink-0" />
                        <span className="flex-1 truncate text-xs">New DM</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
            <NewDirectDialog org={org} open={newDirectOpen} onOpenChange={setNewDirectOpen} onOpened={onOpenSpace} />
        </>
    )
}

/** Space and DM destinations; nested discussions are optional for legacy consumers. */
export function ServerSpaceNavigation({ org, spaceId, onOpenSpace, onOpenActivity, activityActive = false, onOpenDiscussion, renderActiveDiscussions, activeDiscussionCount = 0, showArchived = false, showDiscussions = true }: {
    org: OrgWithSpaces
    spaceId: string
    onOpenSpace: (orgId: string, spaceId: string) => void
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
    return <SidebarMenu>
        <OrgRows org={org} activeSpace={{ orgId: org.id, spaceId }} unread={unread} showArchived={showArchived} activeDiscussionCount={activeDiscussionCount}
            onOpenSpace={onOpenSpace} onOpenActivity={onOpenActivity} activityActive={activityActive} onChanged={() => void refresh()}
            renderDiscussions={showDiscussions && renderActiveDiscussions ? (id) => <SpaceDiscussions orgId={org.id} spaceId={id}
                active={id === spaceId} activeCount={activeDiscussionCount} showArchived={showArchived} renderActive={renderActiveDiscussions}
                onSelect={(selection) => onOpenDiscussion?.(id, selection)} /> : undefined} />
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
    return <SidebarMenuItem>
        <div className="flex items-center">
            {count > 0 ? <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} #${name}`} aria-expanded={expanded}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
                onClick={() => setSpaceExpanded(orgId, spaceId, !expanded)}>
                <ChevronRight className={cn('size-3.5', expanded && 'rotate-90')} />
            </button> : <span className="w-5.5 shrink-0" />}
            {children(expanded)}
        </div>
        {count > 0 && expanded && discussions()}
    </SidebarMenuItem>
}
