import { useState } from 'react'
import { Check, ChevronsUpDown, LogIn, Plus } from 'lucide-react'
import { AddOrgDialog, OrgMonogram } from '@/components/spaces/atoms'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { getSpacesOrgs, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'

export function ServerSwitcher({ org, onOpenSpace, onMenuOpenChange }: {
    org: OrgWithSpaces
    onOpenSpace: (orgId: string, spaceId: string) => void
    onMenuOpenChange?: (open: boolean) => void
}) {
    const { orgs, refresh } = useSpacesOrgs()
    const [menuOpen, setMenuOpen] = useState(false)
    const [action, setAction] = useState<'create' | 'join' | null>(null)
    const openServer = (server: OrgWithSpaces, spaceId?: string) => {
        onOpenSpace(server.id, spaceId ?? server.spaces[0]?.id ?? server.directs[0]?.id ?? '')
    }

    return <>
        <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); onMenuOpenChange?.(open || action !== null) }}>
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
            <DropdownMenuContent align="start" sideOffset={4} className="w-64">
                {orgs.map((server) => <DropdownMenuItem key={server.id}
                    onSelect={() => { if (server.id !== org.id) openServer(server) }}>
                    <OrgMonogram org={server} />
                    <span className="min-w-0 flex-1 truncate">{server.name}</span>
                    {server.id === org.id && <Check className="size-4 shrink-0" aria-label="Active server" />}
                </DropdownMenuItem>)}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setMenuOpen(false); setAction('create'); onMenuOpenChange?.(true) }}><Plus className="size-4" /> Create a server</DropdownMenuItem>
                <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setMenuOpen(false); setAction('join'); onMenuOpenChange?.(true) }}><LogIn className="size-4" /> Join a server</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
        <AddOrgDialog key={action ?? 'closed'} open={action !== null} initialAction={action ?? undefined}
            onOpenChange={(open) => { if (!open) { setAction(null); onMenuOpenChange?.(false) } }}
            onAdded={(orgId, spaceId) => {
                void refresh().then(() => {
                    const added = getSpacesOrgs().find((server) => server.id === orgId)
                    if (added) openServer(added, spaceId)
                })
            }} />
    </>
}
