import { SpacesClient, SpacesLive } from '@x/spaces-client'
import type { spaces } from '@x/shared'
import { getAccessToken, hasSession } from './account'
import { APEX_HOST, APEX_URL, DEV_HARBOR, DEV_MEMBER } from './config'

// The orgs this browser is signed into, and one REST client and live socket
// per org: the desktop's core/spaces/orgs.ts without a registry on disk. The
// apex's "my orgs" is the list (as on the phone), refreshed on every listing;
// under a dev Harbor it is that one org, signed in with a dev token.

export type WebOrg = spaces.SpacesOrgSummary

interface Runtime {
    client: SpacesClient
    live: SpacesLive
}

let orgs: WebOrg[] = []
const runtimes = new Map<string, Runtime>()
const memberFrameListeners = new Set<(orgId: string, frame: spaces.ServerFrame) => void>()
const resetListeners = new Set<(orgId: string) => void>()

function tokenFor(org: WebOrg): string | ((opts?: { forceRefresh?: boolean }) => Promise<string>) {
    return org.authKind === 'dev' ? `dev-${org.memberId}` : getAccessToken
}

async function fetchOrgs(): Promise<WebOrg[]> {
    if (DEV_HARBOR) {
        const health = await new SpacesClient({ baseUrl: DEV_HARBOR, token: `dev-${DEV_MEMBER}` }).health()
        return [{ id: 'dev', name: health.org.name, address: new URL(DEV_HARBOR).host, baseUrl: DEV_HARBOR, memberId: DEV_MEMBER, authKind: 'dev' }]
    }
    if (!hasSession()) return []
    const send = async (token: string) => fetch(`${APEX_URL}/v1/orgs`, { headers: { authorization: `Bearer ${token}` } })
    let res = await send(await getAccessToken())
    if (res.status === 401) res = await send(await getAccessToken({ forceRefresh: true }))
    if (!res.ok) throw new Error(`Could not list your servers (${res.status}).`)
    const { orgs: listed } = (await res.json()) as { orgs: Array<{ id: string; name: string; address: string; memberId: string }> }
    return listed.map((org) => ({
        id: org.id,
        name: org.name,
        address: org.address,
        baseUrl: `https://${org.address}`,
        memberId: org.memberId,
        authKind: 'session' as const,
    }))
}

/** Refresh the list from the apex; a runtime whose org left the list is closed. */
export async function loadOrgs(): Promise<WebOrg[]> {
    const next = await fetchOrgs()
    for (const [id, runtime] of runtimes) {
        if (next.some((org) => org.id === id)) continue
        runtime.live.close()
        runtimes.delete(id)
        for (const listener of resetListeners) listener(id)
    }
    orgs = next
    return orgs
}

export function listOrgs(): WebOrg[] {
    return orgs
}

/** The path segment that names an org: its slug on the deployment, `dev` for a dev Harbor, else its whole address. */
export function orgKey(org: Pick<WebOrg, 'address' | 'authKind'>): string {
    if (org.authKind === 'dev') return 'dev'
    return org.address.endsWith(`.${APEX_HOST}`) ? org.address.slice(0, -(APEX_HOST.length + 1)) : org.address
}

function runtime(orgId: string): Runtime {
    const cached = runtimes.get(orgId)
    if (cached) return cached
    const org = orgs.find((o) => o.id === orgId)
    if (!org) throw new Error(`unknown org ${orgId}`)
    const token = tokenFor(org)
    const created: Runtime = {
        client: new SpacesClient({ baseUrl: org.baseUrl, token }),
        live: new SpacesLive({ baseUrl: org.baseUrl, token: typeof token === 'string' ? token : () => token() }),
    }
    created.live.onMemberFrame((frame) => {
        for (const listener of memberFrameListeners) listener(orgId, frame)
    })
    runtimes.set(orgId, created)
    return created
}

export const getClient = (orgId: string): SpacesClient => runtime(orgId).client
export const getLive = (orgId: string): SpacesLive => runtime(orgId).live

/** Frames addressed to the member, not a space (someone opened a DM with us). */
export function onMemberFrame(listener: (orgId: string, frame: spaces.ServerFrame) => void): () => void {
    memberFrameListeners.add(listener)
    return () => memberFrameListeners.delete(listener)
}

export function onRuntimeReset(listener: (orgId: string) => void): () => void {
    resetListeners.add(listener)
    return () => resetListeners.delete(listener)
}

/** Reconnect every socket now (the tab came back, or the network did). */
export function bounceAllLive(): void {
    for (const { live } of runtimes.values()) live.bounce()
}
