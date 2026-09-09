import { useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { toast } from '@/lib/toast'

export function RemoveServerDialog({ org, open, onOpenChange, onRemoved }: {
    org: { id: string; name: string }
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
                <AlertDialogDescription>This only removes the server from this device — you can rejoin with an invite link.</AlertDialogDescription>
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
