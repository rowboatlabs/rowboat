import type { OrgWithSpaces } from '@/hooks/use-spaces'

export const LAST_SPACE_STORAGE_KEY = 'x:last-space'

type SpaceLocation = { orgId: string; spaceId: string }

/** Restore a valid location, preferring another space on the same server if it was deleted. */
export function resolveSpacesLocation(orgs: OrgWithSpaces[], previous: unknown): SpaceLocation | null {
    const saved = previous && typeof previous === 'object' && 'orgId' in previous && 'spaceId' in previous
        && typeof previous.orgId === 'string' && typeof previous.spaceId === 'string' ? { orgId: previous.orgId, spaceId: previous.spaceId } : null
    const previousOrg = saved ? orgs.find((org) => org.id === saved.orgId) : undefined
    if (previousOrg && saved && [...previousOrg.spaces, ...previousOrg.directs].some((space) => space.id === saved.spaceId)) {
        return { orgId: previousOrg.id, spaceId: saved.spaceId }
    }
    const org = previousOrg ?? orgs.find((org) => org.spaces.length > 0 || org.directs.length > 0) ?? orgs[0]
    return org ? { orgId: org.id, spaceId: org.spaces[0]?.id ?? org.directs[0]?.id ?? '' } : null
}

export function readLastSpace(): unknown {
    try { return JSON.parse(localStorage.getItem(LAST_SPACE_STORAGE_KEY) ?? 'null') }
    catch { return null }
}
