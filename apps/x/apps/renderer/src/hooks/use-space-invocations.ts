import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// Agent invocations in a space (Harbor spec §8, 2026-09-30): the snapshot
// (spaces:listInvocations) seeds a space when it opens; every change of state
// arrives live as an `invocation_state` frame and folds in; a resubscribe
// refetches, since frames are ephemeral. Module-level like the stream store,
// so the stream and the thread pane read one copy.

const EMPTY: ReadonlyMap<string, spaces.Invocation> = new Map()

let state: ReadonlyMap<string, ReadonlyMap<string, spaces.Invocation>> = new Map()
const listeners = new Set<() => void>()
const loading = new Set<string>()
const loaded = new Set<string>()

function key(orgId: string, spaceId: string): string {
    return `${orgId}/${spaceId}`
}

function emit(): void {
    for (const l of listeners) l()
}

/** Fold invocations in, keeping whichever copy of each is newer (a slow snapshot must not undo a live frame). */
function fold(k: string, incoming: readonly spaces.Invocation[]): void {
    if (incoming.length === 0) return
    const next = new Map(state.get(k) ?? EMPTY)
    for (const invocation of incoming) {
        const prev = next.get(invocation.id)
        if (!prev || prev.updatedAt <= invocation.updatedAt) next.set(invocation.id, invocation)
    }
    const all = new Map(state)
    all.set(k, next)
    state = all
    emit()
}

async function load(orgId: string, spaceId: string): Promise<void> {
    const k = key(orgId, spaceId)
    if (loading.has(k)) return
    loading.add(k)
    try {
        const { invocations } = await window.ipc.invoke('spaces:listInvocations', { orgId, spaceId })
        loaded.add(k)
        fold(k, invocations)
    } catch {
        // An older org without the route, or unreachable: no lines, nothing breaks.
    } finally {
        loading.delete(k)
    }
}

let wired = false
function wire(): void {
    if (wired) return
    wired = true
    subscribeSpacesFeed((event) => {
        if (!('frame' in event)) return
        const frame = event.frame
        if (frame.kind === 'invocation_state') fold(key(event.orgId, frame.spaceId), [frame.invocation])
        else if (frame.kind === 'subscribed' && loaded.has(key(event.orgId, frame.spaceId))) void load(event.orgId, frame.spaceId)
    })
}

/** Record a post's own invocations at once — the frames may trail the HTTP answer. */
export function noteInvocations(orgId: string, spaceId: string, invocations: readonly spaces.Invocation[] | undefined): void {
    if (invocations) fold(key(orgId, spaceId), invocations)
}

function subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => {
        listeners.delete(l)
    }
}

/** A space's invocations, grouped by the message that invoked them. */
export function useSpaceInvocations(orgId: string, spaceId: string): ReadonlyMap<string, spaces.Invocation[]> {
    wire()
    const all = useSyncExternalStore(subscribe, () => state)
    useEffect(() => {
        void load(orgId, spaceId)
    }, [orgId, spaceId])
    const forSpace = all.get(key(orgId, spaceId)) ?? EMPTY
    return useMemo(() => {
        const byMessage = new Map<string, spaces.Invocation[]>()
        for (const invocation of forSpace.values()) {
            const list = byMessage.get(invocation.trigger.messageId) ?? []
            list.push(invocation)
            byMessage.set(invocation.trigger.messageId, list)
        }
        return byMessage
    }, [forSpace])
}

// --- capabilities: what an agent's connector declared -------------------------------

const CAPABILITIES_TTL_MS = 60_000
const capabilities = new Map<string, { at: number; value: spaces.ConnectorCapabilities; defaults: Record<string, string | boolean> }>()
const capabilitiesLoading = new Set<string>()
let capabilitiesVersion = 0
const capabilityListeners = new Set<() => void>()

async function loadCapabilities(orgId: string, agentId: string): Promise<void> {
    const k = key(orgId, agentId)
    const cached = capabilities.get(k)
    if (capabilitiesLoading.has(k) || (cached && Date.now() - cached.at < CAPABILITIES_TTL_MS)) return
    capabilitiesLoading.add(k)
    try {
        const { capabilities: value, defaults } = await window.ipc.invoke('spaces:getAgentCapabilities', { orgId, agentId })
        capabilities.set(k, { at: Date.now(), value, defaults: defaults ?? {} })
        capabilitiesVersion += 1
        for (const l of capabilityListeners) l()
    } catch {
        // No capabilities known: no options, no Stop. Nothing else depends on it.
    } finally {
        capabilitiesLoading.delete(k)
    }
}

/** Fetch an agent's capabilities and defaults again now: after its owner changed its defaults. */
export function refreshAgentCapabilities(orgId: string, agentId: string): Promise<void> {
    capabilities.delete(key(orgId, agentId))
    return loadCapabilities(orgId, agentId)
}

/**
 * The defaults these agents' owners set for their options (Harbor spec §8,
 * 2026-10-01), as far as they still fit what the connector declares: Harbor
 * fills them into an invocation whose invoker picked none.
 */
export function useAgentOptionDefaults(orgId: string | undefined, agentIds: readonly string[]): ReadonlyMap<string, Record<string, string | boolean>> {
    const caps = useAgentCapabilities(orgId, agentIds)
    return useMemo(() => {
        const out = new Map<string, Record<string, string | boolean>>()
        if (!orgId) return out
        for (const [id, declared] of caps) {
            const stored = capabilities.get(key(orgId, id))?.defaults ?? {}
            const fit: Record<string, string | boolean> = {}
            for (const option of declared.options) {
                const value = stored[option.key]
                if (value === undefined) continue
                if (option.type === 'toggle' ? typeof value === 'boolean' : option.choices.some((c) => c.id === value)) fit[option.key] = value
            }
            out.set(id, fit)
        }
        return out
    }, [orgId, caps])
}

/** The declared capabilities of these agents, fetched on demand and refreshed after a minute. */
export function useAgentCapabilities(orgId: string | undefined, agentIds: readonly string[]): ReadonlyMap<string, spaces.ConnectorCapabilities> {
    const version = useSyncExternalStore(
        (l) => {
            capabilityListeners.add(l)
            return () => {
                capabilityListeners.delete(l)
            }
        },
        () => capabilitiesVersion,
    )
    const idsKey = agentIds.join('|')
    useEffect(() => {
        if (!orgId) return
        for (const id of agentIds) void loadCapabilities(orgId, id)
        // The joined key IS the dependency — the array identity changes every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, idsKey])
    return useMemo(() => {
        const out = new Map<string, spaces.ConnectorCapabilities>()
        if (!orgId) return out
        for (const id of agentIds) {
            const c = capabilities.get(key(orgId, id))
            if (c) out.set(id, c.value)
        }
        return out
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, idsKey, version])
}
