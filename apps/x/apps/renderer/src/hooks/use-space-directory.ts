import { useEffect, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { setSpacePreview } from '@/lib/spaces-access'

export type DirectoryEntry = { space: spaces.Space; joined: boolean }
type Directory = { entries: DirectoryEntry[]; loading: boolean; loaded: boolean; supported: boolean; error: string | null }
const empty: Directory = { entries: [], loading: false, loaded: false, supported: true, error: null }
const states = new Map<string, Directory>()
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const generations = new Map<string, number>()
function publish(orgId: string, state: Directory) {
    states.set(orgId, state)
    for (const listener of listeners) listener()
}
export function invalidateSpaceDirectory(orgId: string) {
    generations.set(orgId, (generations.get(orgId) ?? 0) + 1)
    publish(orgId, { ...(states.get(orgId) ?? empty), loaded: false })
}
export function updateDirectoryMembership(orgId: string, space: spaces.Space, joined: boolean) {
    invalidateSpaceDirectory(orgId)
    setSpacePreview(orgId, space.id, !joined)
    const state = states.get(orgId) ?? empty
    publish(orgId, { ...state, entries: [...state.entries.filter(e => e.space.id !== space.id), ...(space.kind === 'shared' && space.visibility === 'open' ? [{ space, joined }] : [])] })
}
export async function loadSpaceDirectory(orgId: string): Promise<void> {
    const existing = pending.get(orgId)
    if (existing) return existing
    const generation = generations.get(orgId) ?? 0
    publish(orgId, { ...(states.get(orgId) ?? empty), loading: true, error: null })
    const request = (async () => {
        try {
            const result = await window.ipc.invoke('spaces:browseSpaces', { orgId })
            if ((generations.get(orgId) ?? 0) !== generation) return
            for (const entry of result.spaces) setSpacePreview(orgId, entry.space.id, !entry.joined)
            publish(orgId, { entries: result.spaces, loading: false, loaded: true, supported: result.supported, error: null })
        } catch (error) {
            if ((generations.get(orgId) ?? 0) !== generation) return
            publish(orgId, { ...(states.get(orgId) ?? empty), loading: false, loaded: true, error: error instanceof Error ? error.message : 'Could not load spaces' })
        }
    })().finally(() => {
        pending.delete(orgId)
        if ((generations.get(orgId) ?? 0) !== generation) void loadSpaceDirectory(orgId)
    })
    pending.set(orgId, request)
    return request
}
export function getDirectorySpace(orgId: string, spaceId: string) {
    return states.get(orgId)?.entries.find(e => e.space.id === spaceId)
}
export function useSpaceDirectory(orgId: string | null, active = true) {
    const state = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => orgId ? states.get(orgId) ?? empty : empty)
    useEffect(() => {
        if (!orgId || !active) return
        void loadSpaceDirectory(orgId)
        const refresh = () => { void loadSpaceDirectory(orgId) }
        window.addEventListener('focus', refresh)
        return () => window.removeEventListener('focus', refresh)
    }, [orgId, active])
    return state
}
