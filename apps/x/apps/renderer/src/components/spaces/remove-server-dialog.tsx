import { useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { toast } from '@/lib/toast'

/** Forget the server on this device (2026-11-09: one server, so this is signing out of Spaces here). Nothing on the server changes. */
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
            toast(error instanceof Error ? error.message : 'Could not sign out of Spaces', 'error')
        } finally {
            setRemoving(false)
        }
    }
    return <AlertDialog open={open} onOpenChange={(next) => { if (!removing) onOpenChange(next) }}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Sign out of Spaces on this device?</AlertDialogTitle>
                <AlertDialogDescription>Your chats stay on {org.name}; this device just stops showing them. Sign in again, or open any invite link, to come back.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={removing} className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={(event) => { event.preventDefault(); void remove() }}>
                    {removing ? 'Signing out…' : 'Sign out'}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
}
