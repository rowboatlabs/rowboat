import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { ActivityRow } from '@/components/spaces/activity-row'
import { targetOf, type ActivityTarget } from '@/lib/spaces-activity'
import { useSpaceNames } from '@/hooks/use-spaces'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

const LIMIT = 45

/** A preview of the org's Activity query. Reading the rail doesn't mark events seen. */
export function RecentActivity({ orgId, active = true, onOpenMessage, onOpenActivity }: {
    orgId: string
    active?: boolean
    onOpenMessage: (target: ActivityTarget) => void
    onOpenActivity?: (orgId: string) => void
}) {
    const [result, setResult] = useState<{ orgId: string; page: spaces.SpacesActivityPage } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [retry, setRetry] = useState(0)
    const page = result?.orgId === orgId ? result.page : null
    const names = useMemo(() => new Map(Object.entries(page?.names ?? {})), [page?.names])
    const spaceNames = useSpaceNames(orgId)

    useEffect(() => {
        if (!active) return
        let disposed = false
        let generation = 0
        let timer: ReturnType<typeof setTimeout> | undefined
        const load = async () => {
            const current = ++generation
            setError(null)
            try {
                const next = await window.ipc.invoke('spaces:getActivity', { orgId, limit: LIMIT })
                if (!disposed && current === generation) setResult({ orgId, page: next })
            } catch (err) {
                if (!disposed && current === generation) setError(err instanceof Error ? err.message : 'Could not load activity')
            }
        }
        void load()
        const off = subscribeSpacesFeed((event) => {
            if (event.orgId !== orgId || !('frame' in event)) return
            const frame = event.frame
            if (frame.kind !== 'notify' && frame.kind !== 'read_mark' && frame.kind !== 'subscribed'
                && !(frame.kind === 'event' && ['reaction', 'message_deleted', 'message_edited'].includes(frame.event.type))) return
            if (timer) return
            timer = setTimeout(() => { timer = undefined; void load() }, 1_000)
        })
        return () => { disposed = true; off(); if (timer) clearTimeout(timer) }
    }, [orgId, active, retry])

    return <section aria-label="Recent activity">
        {error && <div className="px-2 py-2 text-xs text-muted-foreground">
            <p>{error}</p>
            <button type="button" onClick={() => setRetry((v) => v + 1)} className="mt-1 underline">Retry activity</button>
        </div>}
        {!page && !error && <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading activity…</p>}
        {page?.items.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No activity yet.</p>}
        <ul className="flex flex-col gap-0.5">
            {page?.items.slice(0, LIMIT).map((item) => <li key={item.id}>
                <ActivityRow compact item={item} names={names} spaceNames={spaceNames} onOpen={() => onOpenMessage(targetOf(orgId, item))} />
            </li>)}
        </ul>
        {onOpenActivity && <button type="button" onClick={() => onOpenActivity(orgId)}
            className="mx-2 my-3 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
            View all activity
        </button>}
    </section>
}
