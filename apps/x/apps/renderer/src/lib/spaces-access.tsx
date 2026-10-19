import { createContext, useContext } from 'react'

export const SpaceAccessContext = createContext({ member: true, join: () => {}, joining: false })
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

export function JoinSpacePrompt() {
    const { join, joining } = useSpaceAccess()
    return <div className="flex items-center justify-between gap-3 border-t border-border p-4 text-sm text-muted-foreground">
        <span>Join this space to post</span>
        <button type="button" onClick={join} disabled={joining} className="rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-50">
            {joining ? 'Joining…' : 'Join space'}
        </button>
    </div>
}
