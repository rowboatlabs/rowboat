import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSpaceDirectory, invalidateSpaceDirectory } from '@/hooks/use-space-directory'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Archive, Bell, Bot, ChevronDown, ChevronRight, Compass, CornerDownRight, Hash, Lock, LogIn, MoreHorizontal, Pencil, Plus, RotateCw, UserPlus } from 'lucide-react'
// Phosphor's chat bubbles for Spaces (2026-10-22), matching the dock.
import { ChatsCircle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { SidebarNavSection } from '@/components/sidebar-section'
import {
    ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { type SpaceSelection } from '@/components/spaces-view'
import { openSelfDirect, useSpaceFeed, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { prefetchStream, spaceLastActivityAt, useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import { NO_BADGE, streamBadge, threadBadge, useReadStateVersion, type SpaceBadge } from '@/lib/spaces-read-state'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { MemberAvatar, OrgMonogram } from '@/components/spaces/atoms'
import { NewDirectDialog } from '@/components/spaces/new-direct-dialog'
import { InviteDialog } from '@/components/spaces/invite-dialog'
import { directAvatarId, isSelfDirect, isSelfDirectUnsupported, markSelfDirectUnsupported, selfDirectFailureMessage, selfDirectRefused, spaceDisplayName } from '@/lib/spaces-direct'
import { prefetchMembers, useOrgRoster, useSelfDisplayName } from '@/hooks/use-space-members'
import { canInvite, useOrgSettings } from '@/hooks/use-org-settings'
import { isSpaceExpanded, setSpaceExpanded, useSpaceExpansionVersion } from '@/lib/spaces-expansion'
import type { RailSelection } from '@/lib/spaces-selection'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'
import { openServerDialog } from '@/lib/server-dialog'
import { isGroupChat, serverLandingSpaceId } from '@/lib/spaces-navigation'
import { AddServerDialog } from '@/components/spaces/add-server-dialog'

/**
 * Group chats and workspaces (2026-10-07): a server that is one conversation
 * is a row that opens it, most recent first, whichever server you were in;
 * a server with channels is a shortcut into its own navigation.
 */
export function SpacesSidebarSection({ active, activeSpace, onOpenSpace, onOpenSpaces }: {
    active: boolean
    activeSpace?: SpaceSelection
    onOpenSpace: (orgId: string, spaceId: string) => void
    /** The Spaces row itself: the last space, or the Spaces home. */
    onOpenSpaces?: () => void
}) {
    const { orgs } = useSpacesOrgs()
    const [addingServer, setAddingServer] = useState(false)
    const unread = useSpacesUnreadCounts()
    const serverBadges = new Map<string, SpaceBadge>()
    for (const org of orgs) {
        const badge = { unread: 0, forYou: 0 }
        for (const space of [...org.spaces, ...org.directs]) {
            const count = unread.get(`${org.id}/${space.id}`)
            badge.unread += count?.unread ?? 0
            badge.forYou += count?.forYou ?? 0
        }
        serverBadges.set(org.id, badge)
    }
    const chats = orgs.filter(isGroupChat)
    const workspaces = orgs.filter((org) => !isGroupChat(org))
    // Warm each chat's tail so recency (and its unread) can read it.
    const chatKeys = chats.map((org) => `${org.id}/${org.spaces[0].id}`).join(',')
    useEffect(() => {
        for (const org of chats) prefetchStream(org.id, org.spaces[0].id)
    }, [chatKeys]) // eslint-disable-line react-hooks/exhaustive-deps
    const lastActivity = (org: OrgWithSpaces) => spaceLastActivityAt(org.id, org.spaces[0].id) ?? org.spaces[0].createdAt
    chats.sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
    // Sidebar redesign (2026-10-21): server rows line up with every other row
    // (the monogram sits in the icon column), under a heading that folds.
    const row = (org: OrgWithSpaces, spaceId: string) => <SidebarMenuItem key={org.id}>
        <SidebarMenuButton isActive={active && activeSpace?.orgId === org.id}
            title={org.name} onClick={() => onOpenSpace(org.id, spaceId)}>
            <OrgMonogram org={org} size="sm" />
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            <UnreadBadge badge={serverBadges.get(org.id)!} />
        </SidebarMenuButton>
    </SidebarMenuItem>
    // Headings only when both kinds are there: one kind needs no label.
    const both = chats.length > 0 && workspaces.length > 0
    // Spaces is a nav row like Email or Apps (2026-10-21): it opens Spaces,
    // its servers nest under it, and the chevron folds them. Folded, the row
    // carries the unread from all of them.
    const total = { unread: 0, forYou: 0 }
    for (const badge of serverBadges.values()) { total.unread += badge.unread; total.forYou += badge.forYou }
    const onAServer = active && orgs.some((org) => org.id === activeSpace?.orgId)
    return <SidebarNavSection id="spaces" label="Spaces" tourId="nav-spaces"
        icon={<ChatsCircle />}
        active={active && !onAServer}
        onOpen={onOpenSpaces}
        foldedBadge={<UnreadBadge badge={total} />}
        tools={<button type="button" aria-label="New group chat" title="New group chat"
            className="sb-row-action" onClick={() => setAddingServer(true)}>
            <Plus />
        </button>}>
        <div>
            {both && <h3 className="sb-subhead">Chats</h3>}
            <SidebarMenu aria-label="Chats">
                {chats.map((org) => row(org, org.spaces[0].id))}
            </SidebarMenu>
            {both && <h3 className="sb-subhead">Workspaces</h3>}
            <SidebarMenu aria-label="Workspaces">
                {workspaces.map((org) => row(org, serverLandingSpaceId(org)))}
            </SidebarMenu>
        </div>
        {addingServer && <AddServerDialog onClose={() => setAddingServer(false)} onChoose={(kind) => {
            setAddingServer(false)
            openServerDialog({ kind })
        }} />}
    </SidebarNavSection>
}

function OrgRows({ org, activeSpace, unread, onOpenSpace, onOpenActivity, onOpenBrowse, browseActive = false, onOpenAgents, agentsActive = false, activityActive = false, onChanged, renderDiscussions, showArchived = false, activeDiscussionCount }: {
    org: OrgWithSpaces
    activeSpace: SpaceSelection
    unread: Map<string, SpaceBadge>
    showArchived?: boolean
    activeDiscussionCount?: number
    renderDiscussions?: (spaceId: string) => ReactNode
    onOpenSpace: (orgId: string, spaceId: string) => void
    /** The org's Activity surface (layer 3); absent = no row. */
    onOpenBrowse?: (orgId: string) => void
    browseActive?: boolean
    /** Every agent in the org (2026-10-21); absent = no row. */
    onOpenAgents?: (orgId: string) => void
    agentsActive?: boolean
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
    const [visibility, setVisibility] = useState<'private' | 'open'>('private')
    const [submitting, setSubmitting] = useState(false)
    const directory = useSpaceDirectory(org.id, creating)
    // Rename-in-place: the row's label becomes an input (same shape as create).
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [newDirectOpen, setNewDirectOpen] = useState(false)
    const [inviteOpen, setInviteOpen] = useState(false)
    // Under an admins-only invite policy (2026-10-19) a member's invite is refused, so Invite hides.
    const orgSpaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const selfIsAdmin = useOrgRoster(org.id, orgSpaceIds).find((m) => m.id === org.memberId)?.role === 'admin'
    const mayInvite = canInvite(useOrgSettings(org.id), selfIsAdmin)
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
        if (!name || submitting || (visibility === 'open' && (!directory.loaded || !directory.supported || directory.error))) return
        setSubmitting(true)
        try {
            const { space } = await window.ipc.invoke('spaces:createSpace', { orgId: org.id, name, visibility })
            if (space.visibility !== visibility) toast('The server created this space as private. Update the server to create open spaces.', 'info')
            invalidateSpaceDirectory(org.id)
            setVisibility('private')
            analytics.spacesSpaceCreated()
            setCreating(false)
            setNewName('')
            onChanged()
            onOpenSpace(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the space', 'error')
        } finally {
            setSubmitting(false)
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
    // DMs are off in a group chat, notes to self included (2026-10-07).
    const directsOn = !org.error && !isGroupChat(org)
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

    // Archived spaces (harbor #1186, 2026-10-14) leave the list for a
    // collapsed section at its foot — still readable, out of the way.
    const liveSpaces = org.spaces.filter((space) => !space.archived)
    const archivedSpaces = org.spaces.filter((space) => space.archived)
    const [archivedOpen, setArchivedOpen] = useState(false)
    // Viewing an archived space keeps its row in sight.
    const archivedShown = archivedOpen || archivedSpaces.some((space) => activeSpace?.orgId === org.id && activeSpace.spaceId === space.id)
    const startRename = (space: OrgWithSpaces['spaces'][number]) => {
        setRenameValue(space.name)
        setRenamingId(space.id)
    }
    const spaceRow = (space: OrgWithSpaces['spaces'][number]) => {
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
                                {space.visibility === 'open' ? <Hash className="size-3.5 shrink-0 text-muted-foreground" /> : <Lock aria-label="Private space" className="size-3.5 shrink-0 text-muted-foreground" />}
                                <span className={cn('flex-1 truncate', badge.unread > 0 && !active && 'font-semibold text-foreground')}>{space.name}</span>
                                {!active && <UnreadBadge badge={badge} />}
                            </SidebarMenuButton>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
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
                            <DropdownMenuItem onSelect={() => startRename(space)}>
                                <Pencil className="size-3.5" /> Rename space
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>}
                    </>) }}
            </CollapsibleSpace>
        )
    }

    const navRows = !!(onOpenActivity || onOpenAgents || onOpenBrowse || needsSignIn || org.error)
    return (
        <>
            {/* Spaces redesign (2026-10-21): Activity is a nav row like Agents and
                Browse (no more bottom panel), in that order, all on one left edge. */}
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
                {onOpenAgents && (
                    <SidebarMenuItem>
                        <SidebarMenuButton isActive={agentsActive} onClick={() => onOpenAgents(org.id)} className="spaces-rail-row">
                            <Bot className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">Agents</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )}
                {onOpenBrowse && (
                    <SidebarMenuItem>
                        <SidebarMenuButton isActive={browseActive} onClick={() => onOpenBrowse(org.id)} className="spaces-rail-row">
                            <Compass className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">Browse spaces</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )}
            </SidebarMenu>}
            <RailSection section="spaces" label="Spaces" addLabel="New space" onAdd={() => setCreating(true)}>
                <SidebarMenu className="gap-0.5">
                    {liveSpaces.map(spaceRow)}
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
                    <SidebarMenu className="gap-0.5 pt-0.5">{archivedSpaces.map(spaceRow)}</SidebarMenu>
                </RailCollapse>}
            </RailSection>
            <Dialog open={creating} onOpenChange={(open) => { if (!submitting) { setCreating(open); if (!open) { setNewName(''); setVisibility('private') } } }}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Create a space</DialogTitle><DialogDescription>Choose who can discover and read this space.</DialogDescription></DialogHeader>
                    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void createSpace() }}>
                        <label className="text-sm">Name<Input autoFocus maxLength={128} value={newName} onChange={event => setNewName(event.target.value)} placeholder="Space name" /></label>
                        <fieldset className="space-y-3" disabled={submitting}><legend className="mb-2 text-sm font-medium">Visibility</legend>
                            <label className="flex items-start gap-2 text-sm"><input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} /><span>Private<span className="block text-xs text-muted-foreground">Only space members can read and participate.</span></span></label>
                            <label className="flex items-start gap-2 text-sm"><input type="radio" name="visibility" checked={visibility === 'open'} disabled={!directory.loaded || !directory.supported || !!directory.error} onChange={() => setVisibility('open')} /><span>Open<span className="block text-xs text-muted-foreground">Anyone in the team can browse and join.</span></span></label>
                        </fieldset>
                        {directory.error && <p role="alert" className="text-sm text-muted-foreground">Could not check open-space support. You can still create a private space.</p>}
                        {directory.loaded && !directory.supported && <p className="text-sm text-muted-foreground">Update this server to create open spaces.</p>}
                        <Button type="submit" disabled={!newName.trim() || submitting}>{submitting ? 'Creating…' : 'Create space'}</Button>
                    </form>
                </DialogContent>
            </Dialog>
            {/* Direct messages: the org's people you talk to, most recent first.
                A DM is a space with a two-person roster (contract 2026-09-07);
                the row is the person, not a channel. */}
            {directsOn && <RailSection section="directs" label="Direct messages" addLabel="New direct message" onAdd={() => setNewDirectOpen(true)}>
                <SidebarMenu className="gap-0.5">
                    {directs.map((dm) => {
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
                                    className="spaces-rail-row"
                                >
                                    <MemberAvatar id={other} name={label} size="sm" />
                                    <span className={cn('flex-1 truncate', badge.unread > 0 && !active && 'font-semibold text-foreground')}>
                                        {label}
                                        {self && <span className="ml-1.5 font-normal text-muted-foreground">you</span>}
                                    </span>
                                    {!active && <UnreadBadge badge={badge} direct />}
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        )
                    })}
                    {/* Not created yet: the same row, waiting for its first click. */}
                    {!selfDm && (
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                onClick={() => void openSelf()}
                                className={cn('spaces-rail-row', selfUnsupported && 'opacity-50')}
                                title={selfUnsupported
                                    ? `Notes to self need a newer server — ${org.name} hasn't been updated yet`
                                    : 'Notes to self — only you (and your agent) can see this'}
                            >
                                <MemberAvatar id={org.memberId} name={selfName} size="sm" />
                                <span className="flex-1 truncate">
                                    {selfName}
                                    <span className="ml-1.5 font-normal text-muted-foreground">{openingSelf ? 'opening…' : 'you'}</span>
                                </span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    )}
                </SidebarMenu>
            </RailSection>}
            {/* An invite is to the server (harbor, 2026-10-19), so it lives with the server, not a space.
                Spaces redesign (2026-10-21): a full row pinned to the rail's foot. */}
            {!needsSignIn && !org.error && mayInvite && (
                <div className="sticky bottom-0 mt-auto bg-[var(--rowboat-panel-soft)] pb-2 pt-3" title={`You are ${org.memberId}`}>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton onClick={() => setInviteOpen(true)} title={`Invite people to ${org.name}`} className="spaces-rail-row text-muted-foreground">
                                <UserPlus className="size-4 shrink-0" />
                                <span className="flex-1 truncate">Invite people</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </div>
            )}
            <NewDirectDialog org={org} open={newDirectOpen} onOpenChange={setNewDirectOpen} onOpened={onOpenSpace} />
            <InviteDialog org={org} open={inviteOpen} onOpenChange={setInviteOpen} />
        </>
    )
}

// Spaces redesign (2026-10-21): each rail section remembers whether it is open,
// across launches; every section starts open.
function readSectionOpen(key: string) {
    try { return localStorage.getItem(key) !== 'false' } catch { return true }
}

/** A collapsible rail section: a quiet header with a chevron, and a + that shows on hover. */
function RailSection({ section, label, addLabel, onAdd, children }: {
    section: 'spaces' | 'directs'
    label: string
    addLabel: string
    onAdd: () => void
    children: ReactNode
}) {
    const key = `spaces:sectionOpen:${section}`
    const [open, setOpen] = useState(() => readSectionOpen(key))
    const bodyId = useId()
    const toggle = () => {
        const next = !open
        setOpen(next)
        try { localStorage.setItem(key, String(next)) } catch { /* private window: open state just isn't remembered */ }
    }
    return <div className="spaces-sec mt-3.5">
        <div className="flex items-center gap-0.5">
            <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
                className="spaces-sec-h flex h-6.5 min-w-0 flex-1 items-center gap-1 rounded-md pl-1.5 pr-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                <ChevronDown data-closed={!open || undefined} className="spaces-chev size-3 shrink-0" />
                <span className="truncate">{label}</span>
            </button>
            <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel}
                className="spaces-sec-add flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                <Plus className="size-3.5" />
            </button>
        </div>
        <RailCollapse id={bodyId} open={open}>{children}</RailCollapse>
    </div>
}

/** Animated height via grid rows (spaces.css); closed content is inert, so it can't take focus. */
function RailCollapse({ id, open, children }: { id?: string, open: boolean, children: ReactNode }) {
    return <div id={id} data-open={open} inert={!open} className="spaces-collapse">
        <div>{children}</div>
    </div>
}

/** Space and DM destinations; nested discussions are optional for legacy consumers. */
export function ServerSpaceNavigation({ org, spaceId, onOpenSpace, onOpenActivity, onOpenBrowse, browseActive = false, onOpenAgents, agentsActive = false, activityActive = false, onOpenDiscussion, renderActiveDiscussions, activeDiscussionCount = 0, showArchived = false, showDiscussions = true }: {
    org: OrgWithSpaces
    spaceId: string
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenBrowse?: (orgId: string) => void
    browseActive?: boolean
    /** Every agent in the org (2026-10-21); absent = no row. */
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
    // A column that fills its scroller, so the Invite row can sit at the foot.
    return <div className="spaces-rail-nav flex min-h-full flex-1 flex-col">
        <OrgRows org={org} activeSpace={{ orgId: org.id, spaceId }} unread={unread} showArchived={showArchived} activeDiscussionCount={activeDiscussionCount}
            onOpenSpace={onOpenSpace} onOpenActivity={onOpenActivity} onOpenBrowse={onOpenBrowse} browseActive={browseActive} onOpenAgents={onOpenAgents} agentsActive={agentsActive} activityActive={activityActive} onChanged={() => void refresh()}
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
    // lines up with the full-width rows above (Browse spaces, Agents). Without
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
