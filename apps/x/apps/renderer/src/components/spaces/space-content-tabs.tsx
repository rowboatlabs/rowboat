import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { spaces } from '@x/shared'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { streamBadge, threadBadge, useReadStateVersion, type SpaceBadge } from '@/lib/spaces-read-state'
import type { RailSelection } from '@/lib/spaces-selection'
import { cn } from '@/lib/utils'

// Spaces redesign (2026-10-21): the three views are one segmented control in
// the header, with a highlight that slides to the chosen tab. The hover
// "recent" menus and their decorative ▾ are gone — they opened by surprise and
// duplicated the full Discussions and Files views one click away.

type Tab = 'messages' | 'discussions' | 'files'

export function SpaceContentTabs({ orgId, spaceId, direct, topics, entries, unreadAssetIds, selection, onSelect }: {
    orgId: string
    spaceId: string
    direct: boolean
    topics: spaces.TopicListing[]
    entries: spaces.SpacesAssetEntry[]
    unreadAssetIds: ReadonlySet<string>
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
}) {
    useReadStateVersion()
    const liveTopics = useMemo(() => topics.filter((topic) => !topic.archived), [topics])
    const discussionBadge = liveTopics.reduce<SpaceBadge>((sum, topic) => {
        const badge = threadBadge(orgId, spaceId, topic.rootMessageId, direct)
        return { unread: sum.unread + badge.unread, forYou: sum.forYou + badge.forYou }
    }, { unread: 0, forYou: 0 })
    const filesBadge = { unread: entries.filter((entry) => !entry.state && unreadAssetIds.has(entry.id)).length, forYou: 0 }
    const current: Tab = selection.kind === 'discussions' || selection.kind === 'thread' ? 'discussions'
        : ['files', 'file', 'whiteboard', 'attachment'].includes(selection.kind) ? 'files'
            : 'messages'

    const tabs: { id: Tab; label: string; badge: SpaceBadge; go: RailSelection }[] = [
        { id: 'messages', label: 'Messages', badge: streamBadge(orgId, spaceId, direct), go: { kind: 'general' } },
        { id: 'discussions', label: 'Threads', badge: discussionBadge, go: { kind: 'discussions' } },
        { id: 'files', label: 'Files', badge: filesBadge, go: { kind: 'files' } },
    ]

    // The highlight is measured from the selected button, so badges that come
    // and go resize it too. It only animates after the first paint — the
    // control should not slide in from the left edge when a space opens.
    const listRef = useRef<HTMLDivElement>(null)
    const [indicator, setIndicator] = useState<{ x: number; width: number } | null>(null)
    const [animate, setAnimate] = useState(false)
    useLayoutEffect(() => {
        const list = listRef.current
        if (!list) return
        const measure = () => {
            const selected = list.querySelector<HTMLElement>('[data-selected="true"]')
            if (selected) setIndicator({ x: selected.offsetLeft, width: selected.offsetWidth })
        }
        measure()
        const frame = requestAnimationFrame(() => setAnimate(true))
        if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame)
        const observer = new ResizeObserver(measure)
        for (const child of Array.from(list.children)) observer.observe(child)
        return () => { cancelAnimationFrame(frame); observer.disconnect() }
    }, [current])

    return <nav ref={listRef} aria-label="Space content" className="spaces-segmented">
        {indicator && <span aria-hidden="true" className={cn('spaces-segmented-indicator', animate && 'is-animated')}
            style={{ transform: `translateX(${indicator.x}px)`, width: indicator.width }} />}
        {tabs.map((tab) => <button key={tab.id} type="button" data-selected={current === tab.id}
            aria-current={current === tab.id ? 'page' : undefined}
            className={cn('spaces-segmented-tab', current === tab.id && 'is-selected')}
            onClick={() => onSelect(tab.go)}>
            <span>{tab.label}</span>{' '}
            <UnreadBadge badge={tab.badge} direct={direct} />
        </button>)}
    </nav>
}
