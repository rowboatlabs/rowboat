import { useState } from 'react'
import type { spaces } from '@x/shared'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { refreshSpacesOrgs } from '@/hooks/use-spaces'
import { toast } from '@/lib/toast'

// An admin archives or deletes a shared space (harbor #1186 and #1189,
// 2026-10-14). Archive is reversible and asks once; delete is not, so it
// asks for the space's name — the server does not confirm on its own.

export function ArchiveSpaceDialog({ orgId, space, open, onOpenChange }: {
    orgId: string
    space: spaces.Space
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const [busy, setBusy] = useState(false)
    const archive = async () => {
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:archiveSpace', { orgId, spaceId: space.id })
            await refreshSpacesOrgs()
            toast(`Archived ${space.name}`, 'success')
            onOpenChange(false)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not archive the space', 'error')
        } finally {
            setBusy(false)
        }
    }
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Archive {space.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Members can still read it, but nobody can post, upload or change anything until an admin unarchives it.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void archive() }}>
                        {busy ? 'Archiving…' : 'Archive'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export function DeleteSpaceDialog({ orgId, space, open, onOpenChange }: {
    orgId: string
    space: spaces.Space
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const [typed, setTyped] = useState('')
    const [busy, setBusy] = useState(false)
    const confirmed = typed.trim() === space.name
    const remove = async () => {
        if (!confirmed) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:deleteSpace', { orgId, spaceId: space.id })
            // The space_removed frame drops it everywhere; the refetch covers a missed frame.
            await refreshSpacesOrgs()
            toast(`Deleted ${space.name}`, 'success')
            onOpenChange(false)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete the space', 'error')
        } finally {
            setBusy(false)
        }
    }
    return (
        <AlertDialog open={open} onOpenChange={(next) => { if (!next) setTyped(''); onOpenChange(next) }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {space.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Every message, file and membership in this space is deleted for everyone. This cannot be undone. Type the space name to confirm.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <Input autoFocus value={typed} placeholder={space.name} aria-label="Space name"
                    onChange={(event) => setTyped(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void remove() }} />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={!confirmed || busy} onClick={(event) => { event.preventDefault(); void remove() }}>
                        {busy ? 'Deleting…' : 'Delete space'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

/**
 * Open or close a shared space (harbor admin controls, 2026-10-19). Going
 * private cuts off everyone who isn't a member, readers included, so it
 * says so; going open lets anyone in the server find and join it.
 */
export function SpaceVisibilityDialog({ orgId, orgName, space, open, onOpenChange }: {
    orgId: string
    orgName: string
    space: spaces.Space
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const [busy, setBusy] = useState(false)
    const next = space.visibility === 'open' ? 'private' : 'open'
    const apply = async () => {
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:setSpaceVisibility', { orgId, spaceId: space.id, visibility: next })
            await refreshSpacesOrgs()
            toast(next === 'open' ? `${space.name} is now open` : `${space.name} is now private`, 'success')
            onOpenChange(false)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not change who can see the space', 'error')
        } finally {
            setBusy(false)
        }
    }
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{next === 'open' ? `Make ${space.name} open?` : `Make ${space.name} private?`}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {next === 'open'
                            ? `Anyone in ${orgName} can find it, read it and join it.`
                            : 'Only its members can see it. Anyone reading it without joining loses access.'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void apply() }}>
                        {busy ? 'Saving…' : next === 'open' ? 'Make open' : 'Make private'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
