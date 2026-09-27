import { useEffect, useMemo, useState } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

const LIMIT = 3
type Result = { page?: spaces.SpacesActivityPage; error?: string; loading: boolean }

/** Three from each org are sufficient to find the three newest across all orgs. */
export function useCrossOrgActivity(orgIds: readonly string[], active: boolean) {
    const orgKey = JSON.stringify([...new Set(orgIds)].sort())
    const [results, setResults] = useState<Record<string, Result>>({})
    const [retry, setRetry] = useState(0)
    useEffect(() => {
        if (!active) return
        const ids = JSON.parse(orgKey) as string[]
        let disposed = false
        const generations = new Map<string, number>()
        const timers = new Map<string, ReturnType<typeof setTimeout>>()
        const load = async (orgId: string) => {
            const generation = (generations.get(orgId) ?? 0) + 1
            generations.set(orgId, generation)
            setResults((previous) => ({ ...previous, [orgId]: { page: previous[orgId]?.page, loading: true } }))
            try {
                const page = await window.ipc.invoke('spaces:getActivity', { orgId, limit: LIMIT })
                if (!disposed && generations.get(orgId) === generation) {
                    setResults((previous) => ({ ...previous, [orgId]: { page, loading: false } }))
                }
            } catch (error) {
                if (!disposed && generations.get(orgId) === generation) {
                    setResults((previous) => ({ ...previous, [orgId]: {
                        page: previous[orgId]?.page, loading: false,
                        error: error instanceof Error ? error.message : 'Could not load activity',
                    } }))
                }
            }
        }
        // Each response paints independently; one offline org must not hold up the rest.
        for (const id of ids) void load(id)
        const off = subscribeSpacesFeed((event) => {
            if (!ids.includes(event.orgId) || !('frame' in event)) return
            const frame = event.frame
            if (frame.kind !== 'notify' && frame.kind !== 'read_mark' && frame.kind !== 'subscribed'
                && !(frame.kind === 'event' && ['reaction', 'message_deleted', 'message_edited'].includes(frame.event.type))) return
            if (timers.has(event.orgId)) return
            timers.set(event.orgId, setTimeout(() => { timers.delete(event.orgId); void load(event.orgId) }, 1_000))
        })
        return () => { disposed = true; off(); for (const timer of timers.values()) clearTimeout(timer) }
    }, [orgKey, active, retry])

    return useMemo(() => {
        const ids = JSON.parse(orgKey) as string[]
        const items = ids.flatMap((orgId) => {
            const page = results[orgId]?.page
            const names = new Map(Object.entries(page?.names ?? {}))
            return (page?.items ?? []).map((item) => ({ orgId, item, names }))
        }).sort((a, b) => b.item.at.localeCompare(a.item.at) || a.orgId.localeCompare(b.orgId) || a.item.id.localeCompare(b.item.id))
            .slice(0, LIMIT)
        return {
            items,
            loading: ids.some((id) => !results[id] || results[id].loading),
            failedOrgIds: ids.filter((id) => results[id]?.error),
            retry: () => setRetry((value) => value + 1),
        }
    }, [orgKey, results])
}
