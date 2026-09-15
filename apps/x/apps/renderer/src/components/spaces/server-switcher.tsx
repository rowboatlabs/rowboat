import { useState } from 'react'
import { orgUrl } from '@x/shared/dist/spaces.js'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { Check, ChevronsUpDown, Link as LinkIcon, LogIn, Plus, Trash2 } from 'lucide-react'
import { OrgMonogram } from '@/components/spaces/atoms'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { serverLandingSpaceId } from '@/lib/spaces-navigation'
import { openServerDialog } from '@/lib/server-dialog'
import { RemoveServerDialog } from './remove-server-dialog'

export function ServerSwitcher({ org, onOpenSpace, onMenuOpenChange }: {
    org: OrgWithSpaces
    onOpenSpace: (orgId: string, spaceId: string) => void
    onMenuOpenChange?: (open: boolean) => void
}) {
    const { orgs, refresh } = useSpacesOrgs()
    const [menuOpen, setMenuOpen] = useState(false)
    const [confirmRemove, setConfirmRemove] = useState(false)
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
            <DropdownMenuContent align="start" sideOffset={4} className="w-64" onCloseAutoFocus={(event) => { if (confirmRemove) event.preventDefault() }}>
                {orgs.map((server) => <DropdownMenuItem key={server.id}
                    onSelect={() => { if (server.id !== org.id) openServer(server) }}>
                    <OrgMonogram org={server} />
                    <span className="min-w-0 flex-1 truncate">{server.name}</span>
                    {server.id === org.id && <Check className="size-4 shrink-0" aria-label="Active server" />}
                </DropdownMenuItem>)}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void copySpacesLink(orgUrl(org.address))}><LinkIcon className="size-4" /> Copy server link</DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* The dialogs are hosted once in App (lib/server-dialog.ts); a finished one lands in the new server itself. */}
                <DropdownMenuItem onSelect={() => openServerDialog({ kind: 'create' })}><Plus className="size-4" /> Create a server</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openServerDialog({ kind: 'join' })}><LogIn className="size-4" /> Join a server</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(event) => {
                    event.preventDefault()
                    setMenuOpen(false)
                    setConfirmRemove(true)
                    onMenuOpenChange?.(true)
                }}><Trash2 className="size-4" />Remove server</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
        <RemoveServerDialog org={org} open={confirmRemove} onOpenChange={(open) => { setConfirmRemove(open); onMenuOpenChange?.(open) }} onRemoved={() => void refresh()} />
    </>
}
