import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'

// Invite controls follow the org policy on every signed-in device (2026-11-24).

const DEFAULTS: spaces.OrgSettings = { invitePolicy: 'members' }
let state: ReadonlyMap<string, spaces.OrgSettings> = new Map()
const listeners = new Set<() => void>()
const loading = new Set<string>()

function set(orgId: string, settings: spaces.OrgSettings): void {
    state = new Map(state).set(orgId, settings)
    for (const l of listeners) l()
}

export async function refreshOrgSettings(orgId: string): Promise<void> {
    if (!orgId || loading.has(orgId)) return
    loading.add(orgId)
    try {
        set(orgId, (await window.ipc.invoke('spaces:getOrgSettings', { orgId })).settings)
    } catch {
        // An org that predates the route has no policy: members may invite.
    } finally {
        loading.delete(orgId)
    }
}

/** Set the invite policy (admins only; the org refuses anyone else). */
export async function setInvitePolicy(orgId: string, invitePolicy: spaces.OrgSettings['invitePolicy']): Promise<void> {
    set(orgId, (await window.ipc.invoke('spaces:setInvitePolicy', { orgId, invitePolicy })).settings)
}


function subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => {
        listeners.delete(l)
    }
}

export function useOrgSettings(orgId: string): spaces.OrgSettings {
    const all = useSyncExternalStore(subscribe, () => state)
    useEffect(() => {
        if (!state.has(orgId)) void refreshOrgSettings(orgId)
    }, [orgId])
    return all.get(orgId) ?? DEFAULTS
}

/** Every org's settings at once, for a hook that spans orgs (the mention targets). */
export function useOrgsSettings(orgIds: readonly string[]): (orgId: string) => spaces.OrgSettings {
    const all = useSyncExternalStore(subscribe, () => state)
    const key = orgIds.join(',')
    useEffect(() => {
        for (const orgId of orgIds) if (!state.has(orgId)) void refreshOrgSettings(orgId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])
    return useCallback((orgId: string) => all.get(orgId) ?? DEFAULTS, [all])
}

/** Whether this member may create invite links under the org's policy. */
export function canInvite(settings: spaces.OrgSettings, isAdmin: boolean): boolean {
    return settings.invitePolicy === 'members' || isAdmin
}
