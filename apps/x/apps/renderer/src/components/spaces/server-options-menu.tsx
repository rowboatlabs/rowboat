import { useState } from 'react'
import { Archive, MoreHorizontal, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { RemoveServerDialog } from './remove-server-dialog'

export function ServerOptionsMenu({ org, showArchived, onToggleArchived, onMenuOpenChange }: {
    org: { id: string; name: string }
    showArchived: boolean
    onToggleArchived: () => void
    onMenuOpenChange: (open: boolean) => void
}) {
    const { refresh } = useSpacesOrgs()
    const [menuOpen, setMenuOpen] = useState(false)
    const [confirmRemove, setConfirmRemove] = useState(false)
    return <>
        <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); onMenuOpenChange(open) }}>
            <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Server options" className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                    <MoreHorizontal className="size-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (confirmRemove) event.preventDefault() }}>
                <DropdownMenuItem onSelect={onToggleArchived}><Archive className="mr-2 size-3.5" />{showArchived ? 'Hide archived' : 'Show Archived'}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(event) => {
                    event.preventDefault()
                    setMenuOpen(false)
                    setConfirmRemove(true)
                    onMenuOpenChange(true)
                }}><Trash2 className="mr-2 size-3.5" />Remove server</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
        <RemoveServerDialog org={org} open={confirmRemove} onOpenChange={(open) => { setConfirmRemove(open); onMenuOpenChange(open) }} onRemoved={() => void refresh()} />
    </>
}
