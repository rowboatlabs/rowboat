import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ShieldCheck, ShieldOff, UserMinus } from 'lucide-react'
import type { spaces } from '@x/shared'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { refreshMembers } from '@/hooks/use-space-members'
import { isDeparted } from '@/lib/spaces-direct'
import { toast } from '@/lib/toast'

// An admin's acts on a person or an agent (Harbor spec §4 Roles; per space
// since 2026-11-09): remove them from this space, make them an admin of it
// or a member again. They show in the member's profile popover, which closes
// as an act starts, so the confirmations live with the provider. Removing
// someone from the server went with the orgs: a space is the whole reach.

interface MemberAdmin {
    orgId: string
    selfId: string
    /** The viewer is an admin of this space. */
    isAdmin: boolean
    /** The shared space the viewer may act in; absent in a DM or outside a space. */
    space?: spaces.Space
    /** This space's row for a member, with their role; undefined when they are not in it. */
    rowOf: (memberId: string) => spaces.SpaceMember | undefined
    removeFromSpace: (member: spaces.Member) => void
}

const MemberAdminContext = createContext<MemberAdmin | null>(null)

export function MemberAdminProvider({ orgId, selfId, isAdmin, space, spaceMembers, children }: {
    orgId: string
    selfId: string
    isAdmin: boolean
    space?: spaces.Space
    spaceMembers: readonly spaces.SpaceMember[]
    children: ReactNode
}) {
    const [fromSpace, setFromSpace] = useState<spaces.Member | null>(null)
    const value = useMemo<MemberAdmin>(() => {
        const rows = new Map(spaceMembers.map((m) => [m.id, m]))
        return {
            orgId, selfId, isAdmin, space,
            rowOf: (id) => rows.get(id),
            removeFromSpace: setFromSpace,
        }
    }, [orgId, selfId, isAdmin, space, spaceMembers])
    return (
        <MemberAdminContext.Provider value={value}>
            {children}
            {space && fromSpace && (
                <RemoveFromSpaceDialog orgId={orgId} space={space} member={fromSpace} onClose={() => setFromSpace(null)} />
            )}
        </MemberAdminContext.Provider>
    )
}

/** The admin rows of a member's profile popover; nothing for a non-admin, outside a space, or for a departed member. */
export function MemberAdminActions({ member, onAct }: { member: spaces.Member | undefined; onAct: () => void }) {
    const admin = useContext(MemberAdminContext)
    const [busy, setBusy] = useState(false)
    if (!admin?.isAdmin || !admin.space || !member || isDeparted(member)) return null
    const space = admin.space
    const row = admin.rowOf(member.id)
    if (!row) return null
    const self = member.id === admin.selfId
    const canRemoveFromSpace = !self
    // An agent is never an admin (Harbor spec §4 Roles).
    const canSetRole = member.kind !== 'agent'
    if (!canRemoveFromSpace && !canSetRole) return null

    const setRole = async (role: 'admin' | 'member') => {
        onAct()
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:setMemberRole', { orgId: admin.orgId, spaceId: space.id, memberId: member.id, role })
            refreshMembers(admin.orgId, space.id, { force: true })
            toast(role === 'admin' ? `${member.displayName} is now an admin of ${space.name}` : `${member.displayName} is no longer an admin of ${space.name}`, 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not change their role', 'error')
        } finally {
            setBusy(false)
        }
    }
    const rowClass = 'flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent hover:text-foreground disabled:opacity-50'
    return (
        <div className="flex flex-col gap-1 border-t border-border p-2 text-xs text-muted-foreground">
            {canSetRole && (row.role === 'admin' ? (
                <button type="button" disabled={busy} className={rowClass} onClick={() => void setRole('member')}>
                    <ShieldOff className="size-3 shrink-0" /> {self ? `Step down as admin of ${space.name}` : `Remove admin of ${space.name}`}
                </button>
            ) : (
                <button type="button" disabled={busy} className={rowClass} onClick={() => void setRole('admin')}>
                    <ShieldCheck className="size-3 shrink-0" /> Make admin of {space.name}
                </button>
            ))}
            {canRemoveFromSpace && (
                <button type="button" className={`${rowClass} text-destructive hover:text-destructive`} onClick={() => { onAct(); admin.removeFromSpace(member) }}>
                    <UserMinus className="size-3 shrink-0" /> Remove from {space.name}
                </button>
            )}
        </div>
    )
}

function RemoveFromSpaceDialog({ orgId, space, member, onClose }: {
    orgId: string
    space: spaces.Space
    member: spaces.Member
    onClose: () => void
}) {
    const [busy, setBusy] = useState(false)
    const remove = async () => {
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:removeMember', { orgId, spaceId: space.id, memberId: member.id })
            refreshMembers(orgId, space.id, { force: true })
            toast(`Removed ${member.displayName} from ${space.name}`, 'success')
            onClose()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not remove them', 'error')
        } finally {
            setBusy(false)
        }
    }
    const agent = member.kind === 'agent'
    return (
        <AlertDialog open onOpenChange={(open) => { if (!open) onClose() }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Remove {member.displayName} from {space.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {agent
                            ? 'It stops seeing this group and answering here. What it wrote stays.'
                            : 'They stop seeing this group, and their agents leave with them. What they wrote stays; someone in the group can invite them back.'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void remove() }}>
                        {busy ? 'Removing…' : 'Remove'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
