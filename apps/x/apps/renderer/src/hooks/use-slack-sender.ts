import { useCallback, useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'

type Entry = { memberId: string | null; version: number; listeners: Set<() => void>; stop: () => void }
const entries = new Map<string, Entry>()
const key = (orgId: string, message: spaces.Message) =>
    JSON.stringify([orgId, message.spaceId, message.author.slack?.workspace, message.author.slack?.userId])

function publish(entry: Entry, memberId: string | null) {
    entry.version++
    entry.memberId = memberId
    for (const listener of entry.listeners) listener()
}

export function updateSlackSender(orgId: string, message: spaces.Message, memberId: string | null) {
    const entry = entries.get(key(orgId, message))
    if (entry) publish(entry, memberId)
}

// 2026-11-17: one request per visible source author, shared by feed and thread.
// Resolve presentation only; the imported attribution and permissions stay intact.
export function useSlackSender(orgId: string | undefined, message: spaces.Message) {
    const source = message.author.slack
    const k = orgId && source ? key(orgId, message) : ''
    const subscribe = useCallback((listener: () => void) => {
        if (!k || !orgId || !source) return () => {}
        let entry = entries.get(k)
        if (!entry) {
            entry = { memberId: null, version: 0, listeners: new Set(), stop: () => {} }
            entries.set(k, entry)
            const current = entry
            const load = () => {
                const version = current.version
                void window.ipc.invoke('spaces:getSlackProfile', { orgId, spaceId: message.spaceId, messageId: message.id })
                    .then(profile => {
                        if (entries.get(k) === current && current.version === version) publish(current, profile.memberId)
                    }).catch(() => { /* Keep the original author when resolution is unavailable. */ })
            }
            current.stop = window.ipc.on('spaces:events', event => {
                if (event.orgId !== orgId || !('frame' in event)) return
                const frame = event.frame
                if (frame.kind === 'event' && frame.spaceId === message.spaceId &&
                    frame.event.type === 'slack_profile_linked' &&
                    frame.event.workspace === source.workspace && frame.event.userId === source.userId) {
                    publish(current, frame.event.memberId)
                }
            })
            window.addEventListener('focus', load)
            const stop = current.stop
            current.stop = () => { stop(); window.removeEventListener('focus', load) }
            load()
        }
        entry.listeners.add(listener)
        return () => {
            entry.listeners.delete(listener)
            if (!entry.listeners.size) { entry.stop(); entries.delete(k) }
        }
    }, [k, orgId, message.id, message.spaceId, source?.workspace, source?.userId])
    return useSyncExternalStore(subscribe, () => entries.get(k)?.memberId ?? null)
}
