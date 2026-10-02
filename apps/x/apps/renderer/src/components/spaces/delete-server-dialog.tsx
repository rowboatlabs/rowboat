import { useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'

// Deleting a server for everyone (Baarali, 2026-10-02): unlike Remove, which
// only forgets it on this device, this cannot be undone, so the name typed
// back is the confirmation — the server checks it again.
export function DeleteServerDialog({ org, open, onOpenChange, onDeleted }: {
    org: { id: string; name: string }
    open: boolean
    onOpenChange: (open: boolean) => void
    onDeleted: () => void
}) {
    const [typed, setTyped] = useState('')
    const [deleting, setDeleting] = useState(false)
    const confirmed = typed.trim() === org.name
    const close = (next: boolean) => {
        if (deleting) return
        if (!next) setTyped('')
        onOpenChange(next)
    }
    const remove = async () => {
        if (deleting || !confirmed) return
        setDeleting(true)
        try {
            await window.ipc.invoke('spaces:deleteOrg', { orgId: org.id, confirmName: typed.trim() })
            setTyped('')
            onOpenChange(false)
            onDeleted()
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not delete the server', 'error')
        } finally {
            setDeleting(false)
        }
    }
    return <AlertDialog open={open} onOpenChange={close}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>{`Delete the server ${org.name}?`}</AlertDialogTitle>
                <AlertDialogDescription>Every space, message and file in this server is deleted for all its members. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Type the server name to confirm</span>
                <Input value={typed} autoFocus disabled={deleting} placeholder={org.name} aria-label="Server name"
                    onChange={(event) => setTyped(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void remove() } }} />
            </label>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={deleting || !confirmed} className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={(event) => { event.preventDefault(); void remove() }}>
                    {deleting ? 'Deleting…' : 'Delete server'}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
}
