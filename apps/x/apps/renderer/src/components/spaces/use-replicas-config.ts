import { useCallback, useEffect, useState } from 'react'
import type { ipc } from '@x/shared'
import { markReplicasMember } from './replicas-identity'

export type ReplicasConfig = ipc.IPCChannels['spaces:getReplicasConfig']['res']
export const REPLICAS_CONFIG_CHANGED = 'spaces-replicas-config-changed'
export const REPLICAS_REQUEST_SENT = 'spaces-replicas-request-sent'

/** A message addressed to Replicas left this thread: its status shows queued at once instead of waiting for the next poll. */
export function noteReplicasRequestSent(threadRootId: string): void {
    window.dispatchEvent(new CustomEvent(REPLICAS_REQUEST_SENT, { detail: { threadRootId } }))
}

/** The Space's Replicas connection, kept fresh on focus, on a slow poll, and after any save. */
export function useReplicasConfig(orgId: string | undefined, spaceId: string | undefined) {
    const key = orgId && spaceId ? `${orgId}/${spaceId}` : null
    // Tagged with its Space so a switch never shows the previous Space's connection.
    const [loaded, setLoaded] = useState<{ key: string; config: ReplicasConfig } | null>(null)
    const reload = useCallback(async () => {
        if (!orgId || !spaceId) return
        const config = await window.ipc.invoke('spaces:getReplicasConfig', { orgId, spaceId })
        if (config.botMemberId) markReplicasMember(config.botMemberId)
        setLoaded({ key: `${orgId}/${spaceId}`, config })
    }, [orgId, spaceId])
    useEffect(() => {
        if (!orgId || !spaceId) return
        let alive = true
        const refresh = () => { void window.ipc.invoke('spaces:getReplicasConfig', { orgId, spaceId })
            .then(config => { if (config.botMemberId) markReplicasMember(config.botMemberId); if (alive) setLoaded({ key: `${orgId}/${spaceId}`, config }) })
            .catch(() => { /* Older Harbor versions do not expose this integration. */ }) }
        refresh()
        window.addEventListener('focus', refresh)
        window.addEventListener(REPLICAS_CONFIG_CHANGED, refresh)
        const interval = setInterval(refresh, 30_000)
        return () => { alive = false; clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener(REPLICAS_CONFIG_CHANGED, refresh) }
    }, [orgId, spaceId])
    return { config: loaded && loaded.key === key ? loaded.config : null, reload }
}
