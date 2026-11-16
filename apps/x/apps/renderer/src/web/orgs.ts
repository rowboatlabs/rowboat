import { SpacesClient, SpacesLive } from '@x/spaces-client'
import type { spaces } from '@x/shared'
import { registerOrgOrigin } from '@/lib/spaces-presentation'
import { hasSession } from './account'
import { DEV_HARBOR, DEV_MEMBER, SERVER_URL } from './config'
import { harborSession } from './session'

// The server this browser is signed into, and its REST client and live
// socket: the desktop's core/spaces/orgs.ts without a registry on disk. One
// server since 2026-11-09 (the record keeps the many-org name of the shared
// summary type): the deployment's, reached on Harbor's session cookie
// (session.ts), or a dev Harbor on a dev token. The account becomes a member
// on first contact (POST /v1/me), so the list is one entry once signed in.

export type WebOrg = spaces.SpacesOrgSummary

/** The one record's id, as core names it (SPACES_SERVER_ID). */
export const SERVER_ID = 'server'

interface Runtime {
    client: SpacesClient
    live: SpacesLive
}

let orgs: WebOrg[] = []
const runtimes = new Map<string, Runtime>()
const memberFrameListeners = new Set<(orgId: string, frame: spaces.ServerFrame) => void>()
const resetListeners = new Set<(orgId: string) => void>()

async function fetchOrgs(): Promise<WebOrg[]> {
    if (DEV_HARBOR) {
        const health = await new SpacesClient({ baseUrl: DEV_HARBOR, token: harborSession }).health()
        return [{ id: SERVER_ID, name: health.server.name, address: new URL(DEV_HARBOR).host, baseUrl: DEV_HARBOR, memberId: DEV_MEMBER, authKind: 'dev' }]
    }
    if (!hasSession()) return []
    await harborSession.ensure()
    const client = new SpacesClient({ baseUrl: SERVER_URL, token: harborSession })
    const [health, { member }] = await Promise.all([client.health(), client.enroll()])
    return [{ id: SERVER_ID, name: health.server.name, address: new URL(SERVER_URL).host, baseUrl: SERVER_URL, memberId: member.id, authKind: 'session' as const }]
}

/** Refresh the record; a runtime whose server is gone (signed out) is closed. */
export async function loadOrgs(): Promise<WebOrg[]> {
    const next = await fetchOrgs()
    for (const [id, runtime] of runtimes) {
        const current = orgs.find((org) => org.id === id)
        if (current && next.some((org) => org.id === id && org.baseUrl === current.baseUrl)) continue
        runtime.live.close()
        runtimes.delete(id)
        for (const listener of resetListeners) listener(id)
    }
    orgs = next
    // Blob URLs are the server's own Harbor URLs (spaces-presentation).
    for (const org of orgs) registerOrgOrigin(org.id, org.baseUrl)
    return orgs
}

export function listOrgs(): WebOrg[] {
    return orgs
}

function runtime(orgId: string): Runtime {
    const cached = runtimes.get(orgId)
    if (cached) return cached
    const org = orgs.find((o) => o.id === orgId)
    if (!org) throw new Error(`unknown server ${orgId}`)
    const created: Runtime = {
        client: new SpacesClient({ baseUrl: org.baseUrl, token: harborSession }),
        live: new SpacesLive({ baseUrl: org.baseUrl, token: harborSession }),
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
