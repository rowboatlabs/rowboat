import { createContext, useContext } from 'react'

// `writable` (2026-10-14, harbor #1186): a member of an archived space keeps
// reading, read marks and presence, but every write control goes; `member`
// still gates the personal state, `writable` gates what adds to the space.
export const SpaceAccessContext = createContext({ member: true, writable: true, archived: false, join: () => {}, joining: false })
export const useSpaceAccess = () => useContext(SpaceAccessContext)

// 2026-09-28, spec §5: content caches may contain previews; personal state must not.
const previews = new Set<string>()
export function setSpacePreview(orgId: string, spaceId: string, preview: boolean): void {
    const key = `${orgId}/${spaceId}`
    if (preview) previews.add(key)
    else previews.delete(key)
}
export function canActInSpace(orgId: string, spaceId: string): boolean {
    return !previews.has(`${orgId}/${spaceId}`)
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

export function JoinSpacePrompt() {
    const { member, archived, join, joining } = useSpaceAccess()
    if (member && archived) {
        return <div className="border-t border-border p-4 text-sm text-muted-foreground">This space is archived. You can read it, but nobody can post.</div>
    }
    return <div className="flex items-center justify-between gap-3 border-t border-border p-4 text-sm text-muted-foreground">
        <span>Join this space to post</span>
        <button type="button" onClick={join} disabled={joining} className="rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-50">
            {joining ? 'Joining…' : 'Join space'}
        </button>
    </div>
}
