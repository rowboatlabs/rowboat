import { useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { toast } from '@/lib/toast'

export function RemoveServerDialog({ org, groupChat = false, open, onOpenChange, onRemoved }: {
    org: { id: string; name: string }
    /** A group chat says what removing does not do: you stay in the group (2026-10-07). */
    groupChat?: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
    onRemoved: () => void
}) {
    const [removing, setRemoving] = useState(false)
    const remove = async () => {
        if (removing) return
        setRemoving(true)
        try {
            await window.ipc.invoke('spaces:removeOrg', { orgId: org.id })
            onOpenChange(false)
            onRemoved()
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not remove the server', 'error')
        } finally {
            setRemoving(false)
        }
    }
    return <AlertDialog open={open} onOpenChange={(next) => { if (!removing) onOpenChange(next) }}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Remove {org.name}?</AlertDialogTitle>
                <AlertDialogDescription>{groupChat
                    ? 'This only removes the chat from this device. You stay in the group, and can come back with an invite link.'
                    : 'This only removes the server from this device — you can rejoin with an invite link.'}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={removing} className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={(event) => { event.preventDefault(); void remove() }}>
                    {removing ? 'Removing…' : 'Remove'}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
}
