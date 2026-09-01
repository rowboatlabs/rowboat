import { useState } from 'react'
import { ChevronRight, Loader2, MoreVertical, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { AddOrgDialog, OrgMonogram, type SpaceSelection } from '@/components/spaces-view'
import { useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { prefetchStream, useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import { toast } from '@/lib/toast'

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

    return (
        <SidebarGroup className="flex flex-col">
            <SidebarGroupContent>
                <div className="group/spaces-head flex items-center pr-1.5">
                    <button
                        type="button"
                        data-tour-id="nav-spaces"
                        onClick={() => setExpanded((v) => !v)}
                        className="flex flex-1 items-center gap-1.5 px-3 py-1 text-[13px] text-muted-foreground"
                    >
                        <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
                        <span className="flex-1 text-left">Spaces</span>
                    </button>
                    <button
                        type="button"
                        aria-label="Add an org"
                        title="Add an org"
                        onClick={() => setAddOrgOpen(true)}
                        className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/spaces-head:opacity-100"
                    >
                        <Plus className="size-3.5" />
                    </button>
                </div>
                {expanded && (
                    loading ? (
                        <div className="flex items-center gap-2 px-4 pb-2 text-[11.5px] text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" /> Loading…
                        </div>
                    ) : orgs.length === 0 ? (
                        <button
                            type="button"
                            onClick={() => setAddOrgOpen(true)}
                            className="px-4 pb-2 text-left text-[11.5px] italic text-muted-foreground hover:text-foreground"
                        >
                            Add an org to see its spaces here.
                        </button>
                    ) : (
                        <SidebarMenu>
                            {orgs.map((org) => (
                                <OrgRows
                                    key={org.id}
                                    org={org}
                                    activeSpace={activeSpace}
                                    unread={unread}
                                    onOpenSpace={onOpenSpace}
                                    onChanged={() => void refresh()}
                                />
                            ))}
                        </SidebarMenu>
                    )
                )}
            </SidebarGroupContent>
            <AddOrgDialog open={addOrgOpen} onOpenChange={setAddOrgOpen} onAdded={() => void refresh()} />
        </SidebarGroup>
    )
}

function OrgRows({ org, activeSpace, unread, onOpenSpace, onChanged }: {
    org: OrgWithSpaces
    activeSpace: SpaceSelection
    unread: Map<string, number>
    onOpenSpace: (orgId: string, spaceId: string) => void
    onChanged: () => void
}) {
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
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

    return (
        <>
            <SidebarMenuItem>
                <div className="group/org flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground" title={`${org.address} · you are ${org.memberId}`}>
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
                                aria-label="Org options"
                                className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/org:opacity-100 data-[state=open]:opacity-100"
                            >
                                <MoreVertical className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                            <DropdownMenuItem onClick={() => setCreating(true)}>
                                <Plus className="mr-2 size-3.5" /> New space
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                    void window.ipc.invoke('spaces:removeOrg', { orgId: org.id }).then(onChanged)
                                }}
                            >
                                <Trash2 className="mr-2 size-3.5" /> Remove org
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </SidebarMenuItem>
            {org.spaces.map((space) => {
                const active = activeSpace?.orgId === org.id && activeSpace.spaceId === space.id
                const count = unread.get(`${org.id}/${space.id}`) ?? 0
                return (
                    <SidebarMenuItem key={space.id}>
                        <SidebarMenuButton
                            isActive={active}
                            onClick={() => onOpenSpace(org.id, space.id)}
                            // Hover = intent: warm the cached tail + start the
                            // refresh, so the click paints instantly.
                            onMouseEnter={() => prefetchStream(org.id, space.id)}
                            className="pl-4"
                        >
                            <span className={cn('flex-1 truncate', count > 0 && !active && 'font-medium text-foreground')}>{space.name}</span>
                            {count > 0 && (
                                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground/80">{count}</span>
                            )}
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )
            })}
            {org.spaces.length === 0 && !org.error && !creating && (
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setCreating(true)} className="pl-4 text-muted-foreground">
                        <Plus className="size-3.5 shrink-0" />
                        <span className="flex-1 truncate text-xs">Create the first space</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
            {creating && (
                <SidebarMenuItem>
                    <div className="flex items-center gap-1 py-0.5 pl-4 pr-2">
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
