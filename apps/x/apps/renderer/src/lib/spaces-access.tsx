import { createContext, useContext, type ReactNode } from 'react'
import type { spaces } from '@x/shared'
import { useSpaceMembers } from '@/hooks/use-space-members'
import { isDeparted } from '@/lib/spaces-direct'

// `writable` (2026-10-14, harbor #1186): a member of an archived space keeps
// reading, read marks and presence, but every write control goes. Since
// 2026-11-09 membership is the one gate (open spaces retired): a space you
// can open is one you are in, so there is no preview and nothing to join.
export const SpaceAccessContext = createContext<{ writable: boolean; archived: boolean; deletedAgent?: boolean }>({ writable: true, archived: false })
export const useSpaceAccess = () => useContext(SpaceAccessContext)

export function SpaceAccessProvider({ orgId, space, children }: { orgId: string; space: spaces.Space; children: ReactNode }) {
    const members = useSpaceMembers(orgId, space.id)
    const deletedAgent = space.kind === 'direct' && members.some((m) => m.kind === 'agent' && isDeparted(m))
    return <SpaceAccessContext.Provider value={{ writable: !space.archived && !deletedAgent, archived: space.archived === true, deletedAgent }}>{children}</SpaceAccessContext.Provider>
}

// Mirrors the server's space lock (policy.ts canWriteSpace) so a write retained
// by a timer or dialog is refused here, not after the round trip.
const archivedSpaces = new Set<string>()
export function setSpaceArchived(orgId: string, spaceId: string, archived: boolean): void {
    const key = `${orgId}/${spaceId}`
    if (archived) archivedSpaces.add(key)
    else archivedSpaces.delete(key)
}
export function isSpaceArchived(orgId: string, spaceId: string): boolean {
    return archivedSpaces.has(`${orgId}/${spaceId}`)
}

/** The notice under an archived space's stream, where the composer would be. */
export function ArchivedNotice() {
    const { archived, deletedAgent } = useSpaceAccess()
    if (deletedAgent) return <div className="border-t border-border p-4 text-sm text-muted-foreground">This agent was deleted. You can still read this conversation.</div>
    if (!archived) return null
    return <div className="border-t border-border p-4 text-sm text-muted-foreground">This group is archived. You can read it, but nobody can post.</div>
}
