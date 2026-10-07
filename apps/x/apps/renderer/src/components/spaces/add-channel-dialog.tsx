import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import * as analytics from '@/lib/analytics'
import { toast } from '@/lib/toast'

/**
 * A group chat's way to grow (2026-10-07): its channel list is out of sight,
 * so the menu offers the second space — and with it the group becomes a
 * workspace with channels.
 */
export function AddChannelDialog({ org, open, onOpenChange, onCreated }: {
    org: OrgWithSpaces
    open: boolean
    onOpenChange: (open: boolean) => void
    onCreated: (spaceId: string) => void
}) {
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    const create = async () => {
        const trimmed = name.trim()
        if (!trimmed || busy) return
        setBusy(true)
        try {
            const { space } = await window.ipc.invoke('spaces:createSpace', { orgId: org.id, name: trimmed })
            analytics.spacesSpaceCreated()
            setName('')
            onOpenChange(false)
            onCreated(space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not add the channel', 'error')
        } finally {
            setBusy(false)
        }
    }
    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
            <DialogHeader>
                <DialogTitle>Add a channel</DialogTitle>
                <DialogDescription>
                    {org.name} becomes a workspace: the chat stays as it is, and channels show beside it for each topic or team.
                </DialogDescription>
            </DialogHeader>
            <Input autoFocus aria-label="Channel name" value={name} placeholder="design, trips, random…"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void create()} />
            <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={() => void create()} disabled={busy || !name.trim()}>
                    {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />} Add channel
                </Button>
            </div>
        </DialogContent>
    </Dialog>
}
