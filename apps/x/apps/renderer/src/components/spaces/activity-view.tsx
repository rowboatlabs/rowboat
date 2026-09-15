import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, Loader2, RefreshCw } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Segmented } from '@/components/spaces/atoms'
import { DayDivider } from '@/components/spaces/message-row'
import { useSpaceNames, type OrgWithSpaces } from '@/hooks/use-spaces'
import { dayKey, formatDayLabel } from '@/lib/spaces-conventions'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'
import { loadUnread } from '@/lib/spaces-read-state'
import { toast } from '@/lib/toast'
import { targetOf, type ActivityTarget } from '@/lib/spaces-activity'
import { ActivityRow } from '@/components/spaces/activity-row'
export type { ActivityTarget } from '@/lib/spaces-activity'
import { cn } from '@/lib/utils'

// Activity (layer 3, 2026-09-10): everything that involves you in this org,
// newest first — the org's query (spaces:getActivity), not a client-side
// fold. Slack's Activity tab, cut to what the org can decide today: mentions,
// @here, DMs, replies in threads you follow, reactions on your messages.
// Unread is the read marks' answer (reading in place clears it); reactions
// clear with their conversation’s read mark. Every row opens its message.

type Tab = 'all' | 'mentions' | 'dms' | 'replies' | 'reactions'
const TABS: Array<{ value: Tab; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'mentions', label: 'Mentions' },
    { value: 'dms', label: 'DMs' },
    { value: 'replies', label: 'Replies' },
    { value: 'reactions', label: 'Reactions' },
]
const TAB_KINDS: Record<Tab, spaces.SpacesActivityKind[] | undefined> = {
    all: undefined,
    mentions: ['mention', 'here'],
    dms: ['dm'],
    replies: ['reply'],
    reactions: ['reaction'],
}
const PAGE = 40
const RELOAD_DEBOUNCE_MS = 1_000

type Page = spaces.SpacesActivityPage
type Item = spaces.SpacesActivityItem

export function ActivityView({ org, active = true, onOpenMessage }: {
    org: OrgWithSpaces
    /** False while kept mounted but hidden — no marking seen, no reloads. */
    active?: boolean
    onOpenMessage: (target: ActivityTarget) => void
}) {
    const [tab, setTab] = useState<Tab>('all')
    const [unreadOnly, setUnreadOnly] = useState(false)
    const [page, setPage] = useState<Page | null>(null)
    const [loading, setLoading] = useState(true)
    const [more, setMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const generation = useRef(0)

    const query = useMemo(
        () => ({ orgId: org.id, ...(TAB_KINDS[tab] ? { kinds: TAB_KINDS[tab] } : {}), ...(unreadOnly ? { unread: true } : {}), limit: PAGE }),
        [org.id, tab, unreadOnly],
    )

    const load = useCallback(async () => {
        const gen = ++generation.current
        setLoading(true)
        setError(null)
        try {
            const next = await window.ipc.invoke('spaces:getActivity', query)
            if (gen !== generation.current) return
            setPage(next)
        } catch (err) {
            if (gen !== generation.current) return
            setError(err instanceof Error ? err.message : 'Could not load activity')
        } finally {
            if (gen === generation.current) setLoading(false)
        }
    }, [query])

    useEffect(() => {
        void load()
    }, [load])

    // Live: the org's notify frames, our own read marks moving, and reactions
    // or deletions in any space the app is subscribed to — coalesced into one
    // refetch of the first page. The org's query is the truth, not a fold.
    useEffect(() => {
        if (!active) return
        let timer: ReturnType<typeof setTimeout> | null = null
        const schedule = () => {
            if (timer) return
            timer = setTimeout(() => {
                timer = null
                void load()
            }, RELOAD_DEBOUNCE_MS)
        }
        const off = subscribeSpacesFeed((event) => {
            if (event.orgId !== org.id || !('frame' in event)) return
            const frame = event.frame
            if (frame.kind === 'notify' || frame.kind === 'read_mark') schedule()
            else if (frame.kind === 'event' && (frame.event.type === 'reaction' || frame.event.type === 'message_deleted' || frame.event.type === 'message_edited')) schedule()
        })
        return () => {
            off()
            if (timer) clearTimeout(timer)
        }
    }, [active, org.id, load])

    // "Mark all read" (2026-09-11): the org moves every mark at once — streams
    // to head, involved threads to their newest reply, reactions seen — then
    // the snapshot refetch clears the rail and this list reloads. Other
    // devices hear the read_mark echoes.
    const [clearing, setClearing] = useState(false)
    const markAllRead = async () => {
        if (clearing) return
        setClearing(true)
        try {
            await window.ipc.invoke('spaces:readAll', { orgId: org.id })
            await loadUnread(org.id, org.memberId)
            await load()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not mark everything read', 'error')
        } finally {
            setClearing(false)
        }
    }

    const loadMore = async () => {
        if (!page?.nextCursor || more) return
        setMore(true)
        try {
            const next = await window.ipc.invoke('spaces:getActivity', { ...query, cursor: page.nextCursor })
            setPage((prev) => (prev ? { ...next, items: [...prev.items, ...next.items], names: { ...prev.names, ...next.names } } : next))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load more')
        } finally {
            setMore(false)
        }
    }

    const names = useMemo(() => new Map(Object.entries(page?.names ?? {})), [page?.names])
    const spaceNames = useSpaceNames(org.id)
    const groups = useMemo(() => groupByDay(page?.items ?? []), [page?.items])

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-5 py-3">
                <h2 className="text-[15px] font-semibold">Activity</h2>
                <Segmented value={tab} options={TABS} onChange={setTab} size="sm" />
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" className="size-3.5 accent-[var(--stream-alert)]" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                    Unread only
                </label>
                <button type="button" onClick={() => void markAllRead()} disabled={clearing} title="Mark everything read — every space, thread and reaction"
                    className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                    <CheckCheck className="size-3.5" /> Mark all read
                </button>
                <button type="button" onClick={() => void load()} title="Refresh" aria-label="Refresh"
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {error && <p className="px-2 py-4 text-sm text-destructive">{error}</p>}
                {!error && page && page.items.length === 0 && !loading && (
                    <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                        {unreadOnly ? 'Nothing unread for you.' : 'Nothing for you yet. Mentions, DMs, replies in threads you follow and reactions on your messages land here.'}
                    </p>
                )}
                {!page && loading && (
                    <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</p>
                )}
                {groups.map((group) => (
                    <section key={group.day} className="mb-2">
                        <div className="py-2"><DayDivider label={formatDayLabel(group.items[0]!.at)} /></div>
                        <ul className="flex flex-col gap-0.5">
                            {group.items.map((item) => (
                                <li key={item.id}>
                                    <ActivityRow item={item} names={names} spaceNames={spaceNames} onOpen={() => onOpenMessage(targetOf(org.id, item))} />
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
                {page?.nextCursor && (
                    <div className="flex justify-center py-3">
                        <button type="button" onClick={() => void loadMore()} disabled={more}
                            className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                            {more ? 'Loading…' : 'Show older'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

function groupByDay(items: Item[]): Array<{ day: string; items: Item[] }> {
    const out: Array<{ day: string; items: Item[] }> = []
    for (const item of items) {
        const day = dayKey(item.at)
        const last = out[out.length - 1]
        if (last && last.day === day) last.items.push(item)
        else out.push({ day, items: [item] })
    }
    return out
}
