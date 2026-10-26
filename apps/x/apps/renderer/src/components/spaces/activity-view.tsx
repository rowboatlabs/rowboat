import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Bell, CheckCheck, Loader2, RefreshCw } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FilterTabs, SpacesEmpty, SpacesPage } from '@/components/spaces/page-shell'
import { useSpaceNames, type OrgWithSpaces } from '@/hooks/use-spaces'
import { dayKey, formatDayLabel } from '@/lib/spaces-conventions'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'
import { activityFor, affectsActivity } from '@/lib/spaces-activity-cache'
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
    const cache = activityFor(org.id)
    const [tab, setTabState] = useState<Tab>(cache.tab)
    const [unreadOnly, setUnreadOnlyState] = useState(cache.unreadOnly)
    const setTab = (next: Tab) => { cache.tab = next; setTabState(next) }
    const setUnreadOnly = (next: boolean) => { cache.unreadOnly = next; setUnreadOnlyState(next) }
    const cacheKey = `${tab}:${unreadOnly ? 'unread' : 'all'}`
    const [page, setPage] = useState<Page | null>(() => cache.pages.get(cacheKey) ?? null)
    const [shownKey, setShownKey] = useState(cacheKey)
    // A filter change paints that filter's cached page at once (or nothing,
    // never the previous filter's rows) while it loads.
    if (shownKey !== cacheKey) {
        setShownKey(cacheKey)
        setPage(cache.pages.get(cacheKey) ?? null)
    }
    const [loading, setLoading] = useState(false)
    const [more, setMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const generation = useRef(0)
    const unreadId = useId()

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
            const entry = activityFor(query.orgId)
            entry.pages.set(cacheKey, next)
            entry.stale.delete(cacheKey)
            if (gen !== generation.current) return
            setPage(next)
        } catch (err) {
            if (gen !== generation.current) return
            setError(err instanceof Error ? err.message : 'Could not load activity')
        } finally {
            if (gen === generation.current) setLoading(false)
        }
    }, [query, cacheKey])

    // Fetch only what the cache can't answer: a filter never loaded, or one a
    // feed event has made stale since.
    useEffect(() => {
        const entry = activityFor(org.id)
        if (entry.pages.has(cacheKey) && !entry.stale.has(cacheKey)) return
        void load()
    }, [org.id, cacheKey, load])

    // Live while showing: the same events, coalesced into one quiet refetch
    // of the first page. The org's query is the truth, not a fold.
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
            if (affectsActivity(event.frame)) schedule()
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
            setPage((prev) => {
                const merged = prev ? { ...next, items: [...prev.items, ...next.items], names: { ...prev.names, ...next.names } } : next
                activityFor(org.id).pages.set(cacheKey, merged)
                return merged
            })
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
        <SpacesPage
            label="Activity"
            title="Activity"
            subtitle="Mentions, DMs, replies in threads you follow, and reactions to your messages."
            actions={<>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => void load()} title="Refresh" aria-label="Refresh">
                    <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
                </Button>
                <Button variant="outline" size="sm" onClick={() => void markAllRead()} disabled={clearing} title="Mark everything read — every space, thread and reaction">
                    <CheckCheck className="size-4" /> Mark all read
                </Button>
            </>}
            toolbar={<>
                <FilterTabs label="Show" value={tab} options={TABS} onChange={setTab} />
                <label htmlFor={unreadId} className="ml-auto flex cursor-pointer select-none items-center gap-2 text-[13px] text-muted-foreground">
                    Unread only
                    <Switch id={unreadId} checked={unreadOnly} onCheckedChange={setUnreadOnly} className="h-5 w-8 [&_[data-slot=switch-thumb]]:size-4" />
                </label>
            </>}
        >
            {error && <p className="py-4 text-sm text-destructive">{error}</p>}
            {!error && page && page.items.length === 0 && !loading && (
                <SpacesEmpty icon={<Bell />} title={unreadOnly ? 'You’re all caught up' : 'Nothing here yet'}>
                    {unreadOnly ? 'Nothing unread for you.' : 'Mentions, DMs, replies in threads you follow and reactions on your messages land here.'}
                </SpacesEmpty>
            )}
            {!page && loading && (
                <p className="flex items-center gap-2 px-3 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</p>
            )}
            {groups.map((group) => (
                <section key={group.day} className="mb-4">
                    <h2 className="px-3 pb-1.5 pt-2 text-[13px] font-medium text-muted-foreground">{formatDayLabel(group.items[0]!.at)}</h2>
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
                    <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={more}>
                        {more ? 'Loading…' : 'Show older'}
                    </Button>
                </div>
            )}
        </SpacesPage>
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
