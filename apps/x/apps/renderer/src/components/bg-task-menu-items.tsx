import { FolderOpen, Info, Pause, Play, Trash2 } from 'lucide-react'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'

export function BgTaskMenuItems({ context = false, active, busy, updating, onOpen, onDetails, onToggleActive, onRun, onDelete }: {
    context?: boolean
    active: boolean
    busy: boolean
    updating: boolean
    onOpen: () => void
    onDetails: () => void
    onToggleActive: () => void
    onRun: () => void
    onDelete: () => void
}) {
    const Item = context ? ContextMenuItem : DropdownMenuItem
    const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator
    return (
        <>
            <Item onSelect={onOpen}><FolderOpen className="size-3.5" /> Open task</Item>
            <Item onSelect={onDetails}><Info className="size-3.5" /> View details</Item>
            <Separator />
            <Item disabled={busy || updating} onSelect={onToggleActive}>
                {active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {active ? 'Pause' : 'Resume'}
            </Item>
            <Item disabled={busy || updating} onSelect={onRun}><Play className="size-3.5" /> Run now</Item>
            <Separator />
            <Item variant="destructive" onSelect={onDelete}><Trash2 className="size-3.5" /> Delete task</Item>
        </>
    )
}
