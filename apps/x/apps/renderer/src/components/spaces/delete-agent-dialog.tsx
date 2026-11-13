import { useState } from 'react'
import type { spaces } from '@x/shared'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { refreshOrgRoster } from '@/hooks/use-space-members'
import { LOCAL_CONNECTION } from '@/lib/agent-kinds'
import { LOCAL_RUNTIME } from '@/lib/feature-flags'
import { toast } from '@/lib/toast'

// Delete an agent you own (2026-11-13): one dialog, opened from the agent
// card's ⋯ menu or the agent page's Danger zone, in place of the inline form
// that grew under the Danger zone row. Like deleting a space, it asks for the
// name: the server does not confirm on its own.

export function DeleteAgentDialog({ orgId, agent, hosted, open, onOpenChange, onDeleted }: {
    orgId: string
    agent: spaces.Member
    /** Runs on Maritime: its VM goes too. Unknown (the Agents page) reads as "if". */
    hosted?: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
    onDeleted?: () => Promise<void> | void
}) {
    const [typed, setTyped] = useState('')
    const [busy, setBusy] = useState(false)
    const local = agent.agentConnection === LOCAL_CONNECTION
    const confirmed = typed.trim() === agent.displayName
    const remove = async () => {
        if (!confirmed || busy) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:deleteAgent', { orgId, agentId: agent.id })
            // A local agent's key and folder live on this computer: they go with it.
            if (local && LOCAL_RUNTIME) await window.ipc.invoke('spaces:forgetLocalAgent', { orgId, agentId: agent.id }).catch(() => {})
            refreshOrgRoster(orgId)
            toast(`Deleted ${agent.displayName}`, 'success')
            onOpenChange(false)
            await onDeleted?.()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete the agent', 'error')
        } finally {
            setBusy(false)
        }
    }
    const what = local
        ? 'It stops on this computer, leaves every space and loses its keys. Its messages and your folder stay.'
        : `It leaves every space and loses its keys${hosted ? ', and its Maritime VM is deleted' : hosted === undefined ? ' (a Maritime VM goes too)' : ''}. Its messages stay.`
    return (
        <AlertDialog open={open} onOpenChange={(next) => { if (!next) setTyped(''); onOpenChange(next) }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {agent.displayName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {what} Type its name to confirm.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <Input autoFocus value={typed} placeholder={agent.displayName} aria-label="Agent name" autoComplete="off"
                    onChange={(event) => setTyped(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void remove() }} />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={!confirmed || busy} onClick={(event) => { event.preventDefault(); void remove() }}>
                        {busy ? 'Deleting…' : `Delete ${agent.displayName}`}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
