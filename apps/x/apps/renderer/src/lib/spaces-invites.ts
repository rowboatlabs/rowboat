import type { spaces } from '@x/shared'
import { refreshSpacesOrgs } from '@/hooks/use-spaces'
import { invalidateSpaceDirectory, loadSpaceDirectory } from '@/hooks/use-space-directory'
import { toast } from '@/lib/toast'

// Team invites and default spaces (harbor, 2026-10-19): an invite is to the
// org, and everyone it admits joins the org's default spaces.

/** "a", "a and b", "a, b and c". */
export function listNames(names: string[]): string {
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Make an open space a default space, or take it off (harbor setDefaultSpace):
 * admin only. It changes no one's membership now, so it asks nothing.
 * Resolves true when the flag changed.
 */
export async function setDefaultSpace(orgId: string, space: spaces.Space, isDefault: boolean): Promise<boolean> {
    try {
        await window.ipc.invoke('spaces:setDefaultSpace', { orgId, spaceId: space.id, isDefault })
        invalidateSpaceDirectory(orgId)
        await Promise.all([refreshSpacesOrgs(), loadSpaceDirectory(orgId)])
        toast(isDefault ? `New members will join ${space.name}` : `New members won’t join ${space.name}`, 'success')
        return true
    } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not change the default spaces', 'error')
        return false
    }
}
