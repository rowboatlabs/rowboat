import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { spaces } from '@x/shared'
import { MemberAvatar, Segmented } from '@/components/spaces/atoms'
import { DayDivider } from '@/components/spaces/message-row'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { dayKey, formatDayLabel } from '@/lib/spaces-conventions'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import type { RailSelection } from '@/lib/spaces-selection'
import { cn } from '@/lib/utils'

// Activity (layer 3, 2026-09-10): everything that involves you in this org,
// newest first — the org's query (spaces:getActivity), not a client-side
// fold. Slack's Activity tab, cut to what the org can decide today: mentions,
// @here, DMs, replies in threads you follow, reactions on your messages.
// Unread is the read marks' answer (reading in place clears it); reactions
// clear when you look here. Every row opens the message it is about.

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

/** Where a row leads: the space (or its thread), landing on the message. */
export interface ActivityTarget {
    orgId: string
    spaceId: string
    rail: RailSelection
    messageId: string
}

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

    // Looking here is what reads a reaction (message kinds read where they
    // live). The rows you are looking at keep their unread mark for this visit.
    const seenFor = useRef<string | null>(null)
    useEffect(() => {
        if (!active || !page) return
        const newest = page.items.find((i) => i.kind === 'reaction' && i.unread)
        if (!newest || seenFor.current === newest.at) return
        seenFor.current = newest.at
        void window.ipc.invoke('spaces:markActivitySeen', { orgId: org.id, at: newest.at }).catch(() => {})
    }, [active, page, org.id])

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
                <button type="button" onClick={() => void load()} title="Refresh" aria-label="Refresh"
                    className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
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
                                    <ActivityRow item={item} names={names} onOpen={() => onOpenMessage(targetOf(org.id, item))} />
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

function targetOf(orgId: string, item: Item): ActivityTarget {
    return {
        orgId,
        spaceId: item.spaceId,
        rail: item.threadRootId ? { kind: 'thread', rootMessageId: item.threadRootId } : { kind: 'general' },
        messageId: item.message.id,
    }
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

/** "Harsh", "Harsh's Rowboat", "Arjun and Harsh", "Arjun, Harsh and 2 others". */
export function actorLabel(actors: Item['actors'], names: ReadonlyMap<string, string>): string {
    const one = (a: Item['actors'][number]) => {
        const name = names.get(a.memberId) ?? a.memberId
        return a.actingMode === 'agent' ? `${name}'s ${a.agentName ?? 'Rowboat'}` : name
    }
    const labels = actors.map(one)
    if (labels.length <= 1) return labels[0] ?? 'Someone'
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
    if (labels.length === 3) return `${labels[0]}, ${labels[1]} and ${labels[2]}`
    return `${labels[0]}, ${labels[1]} and ${labels.length - 2} others`
}

/** The reason line after the actor: what they did, and where. */
export function reasonLabel(item: Item): string {
    const where = item.spaceKind === 'direct' ? '' : item.threadRootId ? ` in a thread in #${item.spaceName}` : ` in #${item.spaceName}`
    switch (item.kind) {
        case 'mention': return `mentioned you${where}`
        case 'here': return `notified everyone${where}`
        case 'dm': return item.threadRootId ? 'replied in a thread' : 'messaged you'
        case 'reply': return `replied${where}`
        case 'reaction': return `reacted ${item.emoji ?? ''} to your message${where}`
    }
}

/** One line of the message, mention tokens as names, markdown scaffolding dropped. */
export function excerptOf(body: string, names: ReadonlyMap<string, string>, max = 160): string {
    const flat = resolveMentions(body, names)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_#>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function ActivityRow({ item, names, onOpen }: { item: Item; names: ReadonlyMap<string, string>; onOpen: () => void }) {
    const lead = item.actors[0]
    const who = actorLabel(item.actors, names)
    const excerpt = excerptOf(item.message.body, names)
    return (
        <button type="button" onClick={onOpen}
            className={cn('group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent/60', item.unread && 'bg-accent/30')}
            title={new Date(item.at).toLocaleString()}>
            <span className="mt-[9px] flex w-1.5 shrink-0 justify-center">
                {item.unread && <span className="size-1.5 rounded-full bg-[var(--stream-alert)]" aria-label="unread" />}
            </span>
            <MemberAvatar id={lead?.memberId ?? ''} name={names.get(lead?.memberId ?? '') ?? who} size="sm" className="mt-0.5 size-6 rounded-[5px] text-[9px]" />
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-[13px]">
                        <span className={cn('font-semibold', !item.unread && 'font-medium')}>{who}</span>
                        <span className="text-muted-foreground"> {reasonLabel(item)}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatFeedTime(item.at)}</span>
                </span>
                <span className={cn('mt-0.5 line-clamp-2 block text-[13px]', item.unread ? 'text-foreground' : 'text-muted-foreground')}>
                    {item.kind === 'reaction' && <span className="text-muted-foreground">You: </span>}
                    {excerpt || <span className="italic text-muted-foreground">(no text)</span>}
                </span>
            </span>
        </button>
    )
}
