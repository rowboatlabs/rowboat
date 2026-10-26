import { useMemo, useState } from 'react'
import { orgUrl } from '@x/shared/dist/spaces.js'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { Bot, Check, ChevronsUpDown, Hash, Link as LinkIcon, LogIn, Plus, Trash2, UserPlus } from 'lucide-react'
import { OrgMonogram } from '@/components/spaces/atoms'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
    DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useOrgRoster } from '@/hooks/use-space-members'
import { setInvitePolicy, useOrgSettings } from '@/hooks/use-org-settings'
import { toast } from '@/lib/toast'
import { useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { isGroupChat, serverLandingSpaceId } from '@/lib/spaces-navigation'
import { openServerDialog } from '@/lib/server-dialog'
import { AddChannelDialog } from './add-channel-dialog'
import { AgentsDialog } from './agents-dialog'
import { RemoveServerDialog } from './remove-server-dialog'

export function ServerSwitcher({ org, onOpenSpace, onOpenAgents, onMenuOpenChange }: {
    org: OrgWithSpaces
    onOpenSpace: (orgId: string, spaceId: string) => void
    /** The Agents page (2026-10-21); without it, Agents opens the dialog. */
    onOpenAgents?: (orgId: string) => void
    onMenuOpenChange?: (open: boolean) => void
}) {
    const { orgs, refresh } = useSpacesOrgs()
    const [menuOpen, setMenuOpen] = useState(false)
    const [confirmRemove, setConfirmRemove] = useState(false)
    const [agentsOpen, setAgentsOpen] = useState(false)
    const [addingChannel, setAddingChannel] = useState(false)
    // Who may create invite links is the org's admins' to set (harbor admin controls, 2026-10-19).
    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const isAdmin = useOrgRoster(org.id, spaceIds).find((m) => m.id === org.memberId)?.role === 'admin'
    const { invitePolicy } = useOrgSettings(org.id)
    const changeInvitePolicy = (next: string) => {
        if (next !== 'members' && next !== 'admins') return
        setInvitePolicy(org.id, next).catch((err: unknown) => {
            toast(err instanceof Error ? err.message : 'Could not change who can invite', 'error')
        })
    }
    const openServer = (server: OrgWithSpaces, spaceId?: string) => {
        onOpenSpace(server.id, spaceId ?? serverLandingSpaceId(server))
    }

    return <>
        <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); onMenuOpenChange?.(open) }}>
            <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`Switch server: ${org.name}`} title={orgs.length > 1 ? 'Switch server · more servers available' : 'Switch server'}
                    className="flex h-9 min-w-0 max-w-64 shrink items-center gap-2 rounded-md px-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="relative isolate flex size-7 shrink-0 items-start justify-start">
                        {orgs.length > 1 && <span aria-hidden="true" className="pointer-events-none absolute inset-0">
                            <span className="absolute left-1 top-1 size-6 rounded-md border border-foreground/20 bg-muted" />
                            <span className="absolute left-0.5 top-0.5 size-6 rounded-md border border-foreground/25 bg-muted" />
                        </span>}
                        <OrgMonogram org={org} className="relative size-6 rounded-md text-[10px] font-medium" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{org.name}</span>
                    <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className="w-64" onCloseAutoFocus={(event) => { if (confirmRemove || agentsOpen) event.preventDefault() }}>
                {orgs.map((server) => <DropdownMenuItem key={server.id}
                    onSelect={() => { if (server.id !== org.id) openServer(server) }}>
                    <OrgMonogram org={server} />
                    <span className="min-w-0 flex-1 truncate">{server.name}</span>
                    {server.id === org.id && <Check className="size-4 shrink-0" aria-label="Active server" />}
                </DropdownMenuItem>)}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void copySpacesLink(orgUrl(org.address))}><LinkIcon className="size-4" /> Copy server link</DropdownMenuItem>
                <DropdownMenuItem onSelect={(event) => {
                    event.preventDefault()
                    setMenuOpen(false)
                    if (onOpenAgents) return onOpenAgents(org.id)
                    setAgentsOpen(true)
                    onMenuOpenChange?.(true)
                }}><Bot className="size-4" /> Agents and bots</DropdownMenuItem>
                {isGroupChat(org) && <DropdownMenuItem onSelect={(event) => {
                    event.preventDefault()
                    setMenuOpen(false)
                    setAddingChannel(true)
                    onMenuOpenChange?.(true)
                }}><Hash className="size-4" /> Add a channel</DropdownMenuItem>}
                {isAdmin && <DropdownMenuSub>
                    <DropdownMenuSubTrigger><UserPlus className="size-4" /> Who can invite</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup value={invitePolicy} onValueChange={changeInvitePolicy}>
                            <DropdownMenuRadioItem value="members">Everyone</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="admins">Admins only</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>}
                <DropdownMenuSeparator />
                {/* The dialogs are hosted once in App (lib/server-dialog.ts); a finished one lands in the new server itself. */}
                <DropdownMenuItem onSelect={() => openServerDialog({ kind: 'create' })}><Plus className="size-4" /> Create a group chat</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openServerDialog({ kind: 'join' })}><LogIn className="size-4" /> Join a server</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(event) => {
                    event.preventDefault()
                    setMenuOpen(false)
                    setConfirmRemove(true)
                    onMenuOpenChange?.(true)
                }}><Trash2 className="size-4" />{isGroupChat(org) ? 'Remove from this app' : 'Remove server'}</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
        <AddChannelDialog org={org} open={addingChannel} onOpenChange={(open) => { setAddingChannel(open); onMenuOpenChange?.(open) }}
            onCreated={(spaceId) => void refresh().then(() => onOpenSpace(org.id, spaceId))} />
        <AgentsDialog org={org} open={agentsOpen} onOpenChange={(open) => { setAgentsOpen(open); onMenuOpenChange?.(open) }} />
        <RemoveServerDialog org={org} groupChat={isGroupChat(org)} open={confirmRemove} onOpenChange={(open) => { setConfirmRemove(open); onMenuOpenChange?.(open) }} onRemoved={() => void refresh()} />
    </>
}
