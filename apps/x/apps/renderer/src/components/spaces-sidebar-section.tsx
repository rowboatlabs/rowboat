import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Hash, Loader2, MessagesSquare, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { AddOrgDialog, OrgMonogram, type SpaceSelection } from '@/components/spaces-view'
import { openSelfDirect, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { prefetchStream, spaceLastActivityAt, useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import { MemberAvatar } from '@/components/spaces/atoms'
import { NewDirectDialog } from '@/components/spaces/new-direct-dialog'
import { directAvatarId, isSelfDirect, isSelfDirectUnsupported, markSelfDirectUnsupported, selfDirectFailureMessage, selfDirectRefused, spaceDisplayName } from '@/lib/spaces-direct'
import { prefetchMembers, useSelfDisplayName } from '@/hooks/use-space-members'
import { bumpSpaceUse, readSpaceUse, spaceUseKey } from '@/lib/space-usage'
import { toast } from '@/lib/toast'

/** The fold: how many spaces the section shows before "Show all". */
const MAX_VISIBLE_SPACES = 5
/** DMs fold too, by recency — the people you talk to stay in view. */
const MAX_VISIBLE_DIRECTS = 5

// The sidebar's SPACES section (design: "App shell scope planning"): every
// org this install is signed into, its spaces underneath with unread counts,
// and a Sign in chip on an org that can't be reached.

export function SpacesSidebarSection({ activeSpace, onOpenSpace }: {
    activeSpace: SpaceSelection
    onOpenSpace: (orgId: string, spaceId: string) => void
}) {
    const { orgs, loading, refresh } = useSpacesOrgs()
    const unread = useSpacesUnreadCounts()
    const [expanded, setExpanded] = useState(true)
    const [addOrgOpen, setAddOrgOpen] = useState(false)
    // Top-5 fold: the section shows the most-opened spaces; the rest sit
    // behind "Show all" (Gmail's Spaces treatment). Per-session toggle.
    const [showAll, setShowAll] = useState(false)
    const totalSpaces = orgs.reduce((n, o) => n + o.spaces.length, 0)
    const folded = !showAll && totalSpaces > MAX_VISIBLE_SPACES
    let visibleSpaceKeys: ReadonlySet<string> | null = null
    if (folded) {
        const counts = readSpaceUse()
        const ranked = orgs
            .flatMap((o) => o.spaces.map((sp) => ({ key: spaceUseKey(o.id, sp.id), count: counts[spaceUseKey(o.id, sp.id)] ?? 0 })))
            .sort((a, b) => b.count - a.count)
            .slice(0, MAX_VISIBLE_SPACES)
            .map((r) => r.key)
        const keys = new Set(ranked)
        // The open space never falls below the fold.
        if (activeSpace) {
            const activeKey = spaceUseKey(activeSpace.orgId, activeSpace.spaceId)
            if (!keys.has(activeKey)) {
                keys.delete(ranked[ranked.length - 1]!)
                keys.add(activeKey)
            }
        }
        visibleSpaceKeys = keys
    }
    const openSpace = (orgId: string, spaceId: string) => {
        bumpSpaceUse(orgId, spaceId)
        onOpenSpace(orgId, spaceId)
    }

    return (
        <SidebarGroup className="flex flex-col pt-0">
            <SidebarGroupContent>
                <div className="group/spaces-head flex items-center pr-1.5">
                    <button
                        type="button"
                        data-tour-id="nav-spaces"
                        onClick={() => setExpanded((v) => !v)}
                        className="flex h-8 flex-1 items-center gap-2.5 rounded-md px-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                        <MessagesSquare className="size-4 shrink-0" />
                        <span className="flex-1 truncate text-left">Spaces</span>
                        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                    </button>
                    <button
                        type="button"
                        aria-label="Add a server"
                        title="Add a server"
                        onClick={() => setAddOrgOpen(true)}
                        className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/spaces-head:opacity-100"
                    >
                        <Plus className="size-3.5" />
                    </button>
                </div>
                {expanded && (
                    loading ? (
                        <div className="flex items-center gap-2 pl-6 pr-4 pb-2 text-[11.5px] text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" /> Loading…
                        </div>
                    ) : orgs.length === 0 ? (
                        <button
                            type="button"
                            onClick={() => setAddOrgOpen(true)}
                            className="pl-6 pr-4 pb-2 text-left text-[11.5px] italic text-muted-foreground hover:text-foreground"
                        >
                            Add a server to see its spaces here.
                        </button>
                    ) : (
                        <SidebarMenu>
                            {orgs.map((org) => (
                                <OrgRows
                                    key={org.id}
                                    org={org}
                                    activeSpace={activeSpace}
                                    unread={unread}
                                    visibleSpaceKeys={visibleSpaceKeys}
                                    onOpenSpace={openSpace}
                                    onChanged={() => void refresh()}
                                />
                            ))}
                            {totalSpaces > MAX_VISIBLE_SPACES && (
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={() => setShowAll((v) => !v)} className="pl-6 text-muted-foreground">
                                        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', showAll && 'rotate-90')} />
                                        <span className="flex-1 truncate">{showAll ? 'Show less' : `Show all ${totalSpaces} spaces`}</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            )}
                        </SidebarMenu>
                    )
                )}
            </SidebarGroupContent>
            <AddOrgDialog open={addOrgOpen} onOpenChange={setAddOrgOpen} onAdded={() => void refresh()} />
        </SidebarGroup>
    )
}

function OrgRows({ org, activeSpace, unread, visibleSpaceKeys, onOpenSpace, onChanged }: {
    org: OrgWithSpaces
    activeSpace: SpaceSelection
    unread: Map<string, number>
    /** Non-null while folded: only these org/space keys render. */
    visibleSpaceKeys?: ReadonlySet<string> | null
    onOpenSpace: (orgId: string, spaceId: string) => void
    onChanged: () => void
}) {
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    // Rename-in-place: the row's label becomes an input (same shape as create).
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [newDirectOpen, setNewDirectOpen] = useState(false)
    const [showAllDirects, setShowAllDirects] = useState(false)
    const [confirmRemove, setConfirmRemove] = useState(false)
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
    // activity, labelled the way Slack does it: your name, then a quiet "you".
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
            <SidebarMenuItem>
                <div className="group/org flex h-7 items-center gap-1.5 rounded-md pl-6 pr-2 text-[11.5px] text-muted-foreground" title={`You are ${org.memberId}`}>
                    <OrgMonogram org={org} size="sm" />
                    <span className="flex-1 truncate">{org.name}</span>
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
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Server options"
                                className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/org:opacity-100 data-[state=open]:opacity-100"
                            >
                                <MoreVertical className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                            <DropdownMenuItem onClick={() => setCreating(true)}>
                                <Plus className="mr-2 size-3.5" /> New space
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setNewDirectOpen(true)}>
                                <MessagesSquare className="mr-2 size-3.5" /> New message
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setConfirmRemove(true)}
                            >
                                <Trash2 className="mr-2 size-3.5" /> Remove server
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Remove {org.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This only removes the server from this device — you can rejoin with an invite link.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    className="bg-destructive text-white hover:bg-destructive/90"
                                    onClick={() => {
                                        setConfirmRemove(false)
                                        void window.ipc.invoke('spaces:removeOrg', { orgId: org.id }).then(onChanged)
                                    }}
                                >
                                    Remove
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </SidebarMenuItem>
            {org.spaces.filter((space) => !visibleSpaceKeys || visibleSpaceKeys.has(spaceUseKey(org.id, space.id))).map((space) => {
                const active = activeSpace?.orgId === org.id && activeSpace.spaceId === space.id
                const count = unread.get(`${org.id}/${space.id}`) ?? 0
                if (renamingId === space.id) {
                    return (
                        <SidebarMenuItem key={space.id}>
                            <div className="flex items-center gap-1 py-0.5 pl-9 pr-2">
                                <Input
                                    autoFocus
                                    value={renameValue}
                                    className="h-7 text-xs"
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') void renameSpace(space.id)
                                        if (e.key === 'Escape') setRenamingId(null)
                                    }}
                                    onBlur={() => void renameSpace(space.id)}
                                />
                            </div>
                        </SidebarMenuItem>
                    )
                }
                return (
                    <SidebarMenuItem key={space.id}>
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
                                    className="pl-9"
                                >
                                    {/* A space is a channel — # says so. */}
                                    <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                                    <span className={cn('flex-1 truncate', count > 0 && !active && 'font-medium text-foreground')}>{space.name}</span>
                                    {count > 0 && (
                                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground/80">{count}</span>
                                    )}
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
                    </SidebarMenuItem>
                )
            })}
            {org.spaces.length === 0 && !org.error && !creating && (
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setCreating(true)} className="pl-9 text-muted-foreground">
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
                    <div className="flex h-6 items-end pl-9 pr-2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
                        <span className="truncate">Direct messages</span>
                    </div>
                </SidebarMenuItem>
            )}
            {!org.error && visibleDirects.map((dm) => {
                const active = activeSpace?.orgId === org.id && activeSpace.spaceId === dm.id
                const count = unread.get(`${org.id}/${dm.id}`) ?? 0
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
                            className="pl-9"
                        >
                            <MemberAvatar id={other} name={label} size="sm" className="size-4 rounded-[3px] text-[8px]" />
                            <span className={cn('flex-1 truncate', count > 0 && !active && 'font-medium text-foreground')}>
                                {label}
                                {self && <span className="ml-1.5 font-normal text-muted-foreground">you</span>}
                            </span>
                            {count > 0 && (
                                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground/80">{count}</span>
                            )}
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )
            })}
            {/* Not created yet: the same row, waiting for its first click. */}
            {!org.error && !selfDm && (
                <SidebarMenuItem>
                    <SidebarMenuButton
                        onClick={() => void openSelf()}
                        className={cn('pl-9', selfUnsupported && 'opacity-50')}
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
            {!org.error && directs.length > MAX_VISIBLE_DIRECTS && (
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setShowAllDirects((v) => !v)} className="pl-9 text-muted-foreground">
                        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', showAllDirects && 'rotate-90')} />
                        <span className="flex-1 truncate text-xs">{showAllDirects ? 'Show less' : `Show all ${directs.length}`}</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
            {!org.error && (
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setNewDirectOpen(true)} className="pl-9 text-muted-foreground">
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
