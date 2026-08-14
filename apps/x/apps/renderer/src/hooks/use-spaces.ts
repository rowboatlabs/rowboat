import { useCallback, useEffect, useRef, useState } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

export interface OrgWithSpaces extends spaces.SpacesOrgSummary {
    spaces: spaces.Space[]
    /** Set when the org could not be reached — the sidebar's "org unreachable" state. */
    error?: string
}

/** The orgs this install is signed into, each with its live space list. */
export function useSpacesOrgs() {
    const [orgs, setOrgs] = useState<OrgWithSpaces[]>([])
    const [loading, setLoading] = useState(true)

    const refresh = useCallback(async () => {
        try {
            const { orgs: records } = await window.ipc.invoke('spaces:listOrgs', null)
            const withSpaces = await Promise.all(
                records.map(async (org): Promise<OrgWithSpaces> => {
                    try {
                        const { spaces: list } = await window.ipc.invoke('spaces:listSpaces', { orgId: org.id })
                        return { ...org, spaces: list }
                    } catch (err) {
                        return { ...org, spaces: [], error: err instanceof Error ? err.message : String(err) }
                    }
                }),
            )
            setOrgs(withSpaces)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void refresh()
    }, [refresh])

    return { orgs, loading, refresh }
}

/**
 * Live frames for one space. Subscribes main's per-org socket to the space
 * (live-only; initial data comes from REST) and filters the broadcast feed.
 */
export function useSpaceLive(
    orgId: string | null,
    spaceId: string | null,
    onFrame: (frame: spaces.ServerFrame) => void,
): void {
    const handlerRef = useRef(onFrame)
    handlerRef.current = onFrame

    useEffect(() => {
        if (!orgId || !spaceId) return
        let cancelled = false
        void window.ipc.invoke('spaces:subscribeSpace', { orgId, spaceId }).catch(() => {
            // org unreachable — REST fetches surface the error state
        })
        const unsubscribe = subscribeSpacesFeed((event) => {
            if (cancelled || event.orgId !== orgId) return
            const frame = event.frame
            if ('spaceId' in frame && frame.spaceId === spaceId) handlerRef.current(frame)
        })
        return () => {
            cancelled = true
            unsubscribe()
            void window.ipc.invoke('spaces:unsubscribeSpace', { orgId, spaceId }).catch(() => {})
        }
    }, [orgId, spaceId])
}
