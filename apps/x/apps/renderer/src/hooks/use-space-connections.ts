import { useEffect, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { isConnectionMember } from '@x/shared/dist/spaces.js'

// A space's connections as Harbor last listed them (spec §8 Space
// connections, 2026-11-28), held per space for the session. Two readers:
// Space settings' Connections panel, which lists and changes them, and every
// place a connection's member is drawn, which wants its app's logo. Harbor
// sends no live event for a connection, so nothing here updates on its own:
// the panel asks again after each change and while one waits on a person.

export interface SpaceConnections {
    connections: spaces.SpaceConnection[]
    /** False = this server connects no apps to spaces. */
    available: boolean
    /** False = no Jev on this server, so nothing is filtered or scored. */
    filterAvailable: boolean
}

type ConnectionApp = spaces.SpaceConnection['app']

let state: ReadonlyMap<string, SpaceConnections> = new Map()
/** The app behind each connection member, by `org/member`: derived from `state` when it changes, since every avatar on screen reads it. */
let apps: ReadonlyMap<string, ConnectionApp> = new Map()
const listeners = new Set<() => void>()
/** Spaces whose list was already asked for on a member's behalf, so an unknown member is not asked about again on every render. */
const askedFor = new Set<string>()

const key = (orgId: string, spaceId: string) => `${orgId}/${spaceId}`

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

/** Ask Harbor for a space's connections and keep the answer. The read itself moves a `pending` one to `active` once its app is authorised. */
export async function loadSpaceConnections(orgId: string, spaceId: string): Promise<SpaceConnections> {
    const listed = await window.ipc.invoke('spaces:listSpaceConnections', { orgId, spaceId })
    state = new Map(state).set(key(orgId, spaceId), listed)
    const next = new Map<string, ConnectionApp>()
    for (const [k, { connections }] of state) {
        const org = k.slice(0, k.lastIndexOf('/'))
        for (const connection of connections) next.set(`${org}/${connection.memberId}`, connection.app)
    }
    apps = next
    for (const listener of listeners) listener()
    return listed
}

/** The space's connections as last listed, or undefined before the first answer. */
export function useSpaceConnections(orgId: string, spaceId: string): SpaceConnections | undefined {
    return useSyncExternalStore(subscribe, () => state).get(key(orgId, spaceId))
}

/**
 * The app a connection member posts for, for its logo and its name. Undefined
 * for a member whose space's list was never read here, which then draws as a
 * plain connection.
 */
export function useConnectionApp(orgId: string | undefined, memberId: string): ConnectionApp | undefined {
    const known = useSyncExternalStore(subscribe, () => apps)
    return orgId ? known.get(`${orgId}/${memberId}`) : undefined
}

/**
 * Read a space's connections once it shows a connection member this session
 * knows nothing about, so its posts carry the app's logo for everyone, not
 * only for the admin who opened the panel. Asked once per space and newcomer:
 * a failure leaves the plain icon rather than a retry on every message.
 */
export function useConnectionAppsOf(orgId: string, spaceId: string, members: readonly spaces.Member[]): void {
    const known = useSyncExternalStore(subscribe, () => apps)
    const unknown = members.filter((m) => isConnectionMember(m) && !m.deactivatedAt && !known.has(`${orgId}/${m.id}`)).map((m) => m.id).join('|')
    useEffect(() => {
        if (!unknown) return
        const k = `${key(orgId, spaceId)}:${unknown}`
        if (askedFor.has(k)) return
        askedFor.add(k)
        void loadSpaceConnections(orgId, spaceId).catch(() => undefined)
    }, [orgId, spaceId, unknown])
}
