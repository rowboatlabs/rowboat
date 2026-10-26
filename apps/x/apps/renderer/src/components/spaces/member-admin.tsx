import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ShieldCheck, ShieldOff, UserMinus, UserX } from 'lucide-react'
import type { spaces } from '@x/shared'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { refreshMembers, refreshOrgRoster } from '@/hooks/use-space-members'
import { isDeparted } from '@/lib/spaces-direct'
import { toast } from '@/lib/toast'

// An admin's acts on a person or an agent (Harbor spec §4 Roles, 2026-10-19):
// remove them from this space, remove them from the server, make them an
// admin or a member again. They show in the member's profile popover, which
// closes as an act starts, so the confirmations live with the provider.

interface MemberAdmin {
    orgId: string
    orgName: string
    selfId: string
    /** The viewer is an org admin. */
    isAdmin: boolean
    /** The shared space the viewer is in and may remove people from; absent in a DM, a group chat's one space, or outside a space. */
    space?: spaces.Space
    /** Whether a member is in that space now. */
    inSpace: (memberId: string) => boolean
    removeFromSpace: (member: spaces.Member) => void
    removeFromOrg: (member: spaces.Member) => void
}

const MemberAdminContext = createContext<MemberAdmin | null>(null)

export function MemberAdminProvider({ orgId, orgName, selfId, isAdmin, space, spaceMemberIds, children }: {
    orgId: string
    orgName: string
    selfId: string
    isAdmin: boolean
    space?: spaces.Space
    spaceMemberIds: readonly string[]
    children: ReactNode
}) {
    const [fromSpace, setFromSpace] = useState<spaces.Member | null>(null)
    const [fromOrg, setFromOrg] = useState<spaces.Member | null>(null)
    const value = useMemo<MemberAdmin>(() => {
        const ids = new Set(spaceMemberIds)
        return {
            orgId, orgName, selfId, isAdmin, space,
            inSpace: (id) => ids.has(id),
            removeFromSpace: setFromSpace,
            removeFromOrg: setFromOrg,
        }
    }, [orgId, orgName, selfId, isAdmin, space, spaceMemberIds])
    return (
        <MemberAdminContext.Provider value={value}>
            {children}
            {space && fromSpace && (
                <RemoveFromSpaceDialog orgId={orgId} space={space} member={fromSpace} onClose={() => setFromSpace(null)} />
            )}
            {fromOrg && <RemoveFromOrgDialog orgId={orgId} orgName={orgName} member={fromOrg} onClose={() => setFromOrg(null)} />}
        </MemberAdminContext.Provider>
    )
}

/** The admin rows of a member's profile popover; nothing for a non-admin, yourself where it can't apply, or a departed member. */
export function MemberAdminActions({ member, onAct }: { member: spaces.Member | undefined; onAct: () => void }) {
    const admin = useContext(MemberAdminContext)
    const [busy, setBusy] = useState(false)
    if (!admin?.isAdmin || !member || isDeparted(member)) return null
    const self = member.id === admin.selfId
    const canRemoveFromSpace = !!admin.space && !self && admin.inSpace(member.id)
    // An agent is never an admin; Jev is built into the org and can't be removed.
    const canSetRole = member.kind !== 'agent'
    const canRemoveFromOrg = !self && member.agentConnection !== 'builtin'
    if (!canRemoveFromSpace && !canSetRole && !canRemoveFromOrg) return null

    const setRole = async (role: 'admin' | 'member') => {
        onAct()
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:setMemberRole', { orgId: admin.orgId, memberId: member.id, role })
            refreshOrgRoster(admin.orgId)
            toast(role === 'admin' ? `${member.displayName} is now an admin` : `${member.displayName} is no longer an admin`, 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not change their role', 'error')
        } finally {
            setBusy(false)
        }
    }
    const row = 'flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent hover:text-foreground disabled:opacity-50'
    return (
        <div className="flex flex-col gap-1 border-t border-border p-2 text-xs text-muted-foreground">
            {canSetRole && (member.role === 'admin' ? (
                <button type="button" disabled={busy} className={row} onClick={() => void setRole('member')}>
                    <ShieldOff className="size-3 shrink-0" /> {self ? 'Step down as admin' : 'Remove admin'}
                </button>
            ) : (
                <button type="button" disabled={busy} className={row} onClick={() => void setRole('admin')}>
                    <ShieldCheck className="size-3 shrink-0" /> Make admin
                </button>
            ))}
            {canRemoveFromSpace && (
                <button type="button" className={row} onClick={() => { onAct(); admin.removeFromSpace(member) }}>
                    <UserMinus className="size-3 shrink-0" /> Remove from {admin.space!.name}
                </button>
            )}
            {canRemoveFromOrg && (
                <button type="button" className={`${row} text-destructive hover:text-destructive`} onClick={() => { onAct(); admin.removeFromOrg(member) }}>
                    <UserX className="size-3 shrink-0" /> Remove from {admin.orgName}
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
    return (
        <AlertDialog open onOpenChange={(open) => { if (!open) onClose() }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Remove {member.displayName} from {space.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        They stop seeing this space{space.visibility === 'open' ? ', though they can join it again while it’s open' : ''}. What they wrote here stays.
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

export function RemoveFromOrgDialog({ orgId, orgName, member, onClose }: {
    orgId: string
    orgName: string
    member: spaces.Member
    onClose: () => void
}) {
    const [busy, setBusy] = useState(false)
    const remove = async () => {
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:removeOrgMember', { orgId, memberId: member.id })
            refreshOrgRoster(orgId)
            toast(`Removed ${member.displayName} from ${orgName}`, 'success')
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
                    <AlertDialogTitle>Remove {member.displayName} from {orgName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {agent
                            ? 'The agent leaves every space and its keys stop working. Its messages stay.'
                            : 'They leave every space and can no longer sign in. Their messages stay, and their direct messages are kept. A new invite brings them back.'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void remove() }}>
                        {busy ? 'Removing…' : 'Remove from server'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
