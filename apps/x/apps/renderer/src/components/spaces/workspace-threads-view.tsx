import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, MessagesSquare, RefreshCw } from 'lucide-react'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { useSpaceNames } from '@/hooks/use-spaces'
import { useThreadsPreference, useThreadsScroll } from '@/hooks/use-threads-view-memory'
import { useWorkspaceThreads } from '@/hooks/use-workspace-threads'
import { prefetchThread } from '@/hooks/use-space-chat'
import { threadBadge, useReadStateVersion } from '@/lib/spaces-read-state'
import { threadLabelOf } from '@/lib/spaces-conventions'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import type { RailSelection } from '@/lib/spaces-selection'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { FilterTabs, SpacesEmpty, SpacesPage } from './page-shell'
import { UnreadBadge } from './unread-badge'
import { MemberAvatar } from './atoms'
import { ThreadResizeHandle, THREAD_DEFAULT_WIDTH, THREAD_MIN_WIDTH, STREAM_MIN_WIDTH, THREAD_DIVIDER_WIDTH } from './thread-resize-handle'
import { WorkspaceThreadPane } from './workspace-thread-pane'

export function WorkspaceThreadsView({ org, active = true, selectedSpaceId, selectedRootId, onOpenThread, onCloseThread, onOpenSpace, onOpenSession }: {
    org: OrgWithSpaces; active?: boolean; selectedSpaceId?: string; selectedRootId?: string
    onOpenThread: (spaceId: string, rootId: string) => void; onCloseThread: () => void
    onOpenSpace: (orgId: string, spaceId: string, rail?: RailSelection) => void; onOpenSession?: (id: string) => void
}) {
    useReadStateVersion()
    const memoryKey = `spaces:workspace-threads:${org.id}:${org.memberId}`
    const [filter, setFilter] = useThreadsPreference<'all' | 'named' | 'mine'>(`${memoryKey}:filter`, (v) => v === 'named' || v === 'mine' ? v : 'all')
    const [savedSource, setSource] = useThreadsPreference(`${memoryKey}:source`, (v) => v)
    const [participant, setParticipant] = useThreadsPreference(`${memoryKey}:participant`, (v) => v)
    const [archive, setArchive] = useThreadsPreference(`${memoryKey}:archive`, (v) => v === 'archived' ? v : 'active')
    const rooms = useMemo(() => [...org.spaces, ...org.directs], [org.spaces, org.directs])
    const source = rooms.some((s) => s.id === savedSource) ? savedSource : null
    const query: spaces.ThreadsQuery = { filter, ...(source ? { spaceId: source } : {}), ...(participant ? { participantId: participant } : {}), archived: filter === 'named' && archive === 'archived' }
    const data = useWorkspaceThreads(org.id, org.memberId, query, active)
    // 2026-11-03: membership changes remove cached rows immediately, before a refetch.
    const allowed = new Set(rooms.map((s) => s.id))
    const rows = (data.page?.items ?? []).filter((item) => allowed.has(item.space.id))
    const names = useMemo(() => new Map(Object.entries(data.page?.names ?? {})), [data.page?.names])
    const spaceNames = useSpaceNames(org.id)
    const label = (s: spaces.Space) => s.kind === 'direct' ? org.directLabels[s.id] ?? s.name : `#${s.name}`
    const participants = new Set(rows.flatMap((r) => [r.root.author.memberId, ...(r.root.replyAuthors ?? [])]))
    if (participant) participants.add(participant)
    const scroll = useThreadsScroll(`${memoryKey}:scroll:${JSON.stringify(query)}`, { loaded: !!data.page, hasMore: !!data.page?.nextCursor && !data.error, loadingOlder: data.more || data.loading, onLoadOlder: data.loadMore, rowCount: rows.length })
    const selectedSpace = rooms.find((s) => s.id === selectedSpaceId)
    const selected = rows.find((r) => r.space.id === selectedSpaceId && r.root.id === selectedRootId)
    const open = !!selectedSpace && !!selectedRootId
    const container = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    const [expanded, setExpanded] = useState(false)
    const [threadWidth, setThreadWidth] = useState(() => {
        const stored = Number(localStorage.getItem('spaces:threadWidth'))
        return Number.isFinite(stored) && stored >= THREAD_MIN_WIDTH ? stored : THREAD_DEFAULT_WIDTH
    })
    useEffect(() => {
        const el = container.current
        if (!el) return
        const observer = new ResizeObserver(() => setWidth(el.clientWidth))
        observer.observe(el); setWidth(el.clientWidth)
        return () => observer.disconnect()
    }, [])
    const beside = open && !expanded && width >= 840
    const maxWidth = Math.max(THREAD_MIN_WIDTH, width - STREAM_MIN_WIDTH - THREAD_DIVIDER_WIDTH)
    const paneWidth = Math.min(threadWidth, maxWidth)
    return <div ref={container} className="flex min-w-0 min-h-0 flex-1">
        <div className={cn('min-w-0 min-h-0 flex-1', open && !beside ? 'hidden' : 'flex')}>
            <SpacesPage label="Threads" title="Threads" subtitle="Conversations across your channels and direct messages." scrollRef={scroll.ref} onScroll={scroll.onScroll}
                actions={<Button variant="ghost" size="sm" onClick={() => void data.reload()} disabled={data.loading} aria-label="Refresh threads"><RefreshCw className={cn('size-4', data.loading && 'animate-spin')} /></Button>}
                toolbar={<>
                    <FilterTabs label="Show threads" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'named', label: 'Named' }, { value: 'mine', label: 'By me' }]} />
                    {filter === 'named' && <FilterTabs label="Show" value={archive} onChange={setArchive} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />}
                    <select aria-label="Filter by channel or DM" value={source ?? ''} onChange={(e) => setSource(e.target.value || null)} className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-sm">
                        <option value="">All channels &amp; DMs</option>
                        <optgroup label="Channels">{org.spaces.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</optgroup>
                        <optgroup label="Direct messages">{org.directs.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</optgroup>
                    </select>
                    <select aria-label="Filter by participant" value={participant ?? ''} onChange={(e) => setParticipant(e.target.value || null)} className="h-8 max-w-48 rounded-md border border-border bg-background px-2 text-sm">
                        <option value="">Everyone</option>
                        {[...participants].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b)).map((id) => <option key={id} value={id}>{names.get(id) ?? id}</option>)}
                    </select>
                </>}>
                {selectedRootId && !selectedSpace && <p role="alert" className="mb-4 text-sm">This conversation is no longer available. <button className="underline" onClick={onCloseThread}>Dismiss</button></p>}
                {data.error && <p role="alert" className="mb-4 text-sm text-destructive">{data.error} <button className="underline" onClick={() => void data.reload()}>Retry</button></p>}
                <ul className="flex flex-col gap-0.5">{rows.map((item) => {
                    const { root, topic, space } = item
                    const badge = threadBadge(org.id, space.id, root.id, space.kind === 'direct')
                    const title = resolveMentions(topic?.title ?? threadLabelOf(root.body), names, spaceNames)
                    const chosen = space.id === selectedSpaceId && root.id === selectedRootId
                    const Icon = topic ? MessagesSquare : MessageSquare
                    const people = [...new Set([root.author.memberId, ...(root.replyAuthors ?? [])])]
                    return <li key={`${space.id}/${root.id}`}>
                        <button type="button" aria-current={chosen ? 'true' : undefined} onClick={() => onOpenThread(space.id, root.id)} onMouseEnter={() => prefetchThread(org.id, space.id, root.id)}
                            className={cn('flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-accent/60', chosen && 'bg-accent/60')}>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
                            <span className="min-w-0 flex-1">
                                <span className={cn('block truncate text-sm', badge.unread > 0 ? 'font-semibold' : 'font-medium')}>{title || 'Deleted message'}</span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{label(space)} · {names.get(root.author.memberId) ?? 'Unknown member'} · {root.replyCount} {root.replyCount === 1 ? 'reply' : 'replies'} · {formatFeedTime(item.lastActivityAt)}</span>
                            </span>
                            <span aria-hidden className="flex shrink-0 -space-x-1.5" title={people.map((id) => names.get(id) ?? id).join(', ')}>{people.slice(0, 3).map((id) => <MemberAvatar key={id} id={id} name={names.get(id) ?? id} size="sm" className="rounded-full ring-2 ring-background" />)}</span>
                            <UnreadBadge badge={badge} direct={space.kind === 'direct'} />
                        </button>
                    </li>
                })}</ul>
                {!data.page && !data.error && <p className="px-3 py-12 text-sm text-muted-foreground">Loading threads…</p>}
                {data.page && rows.length === 0 && <SpacesEmpty icon={<MessagesSquare />} title="No threads match these filters">Threads appear when someone replies or gives a conversation a title.</SpacesEmpty>}
                {data.page?.nextCursor && <Button size="sm" variant="ghost" className="mt-3" disabled={data.more || data.loading} onClick={() => void data.loadMore()}>{data.more ? 'Loading…' : 'Load older threads'}</Button>}
            </SpacesPage>
        </div>
        {beside && <ThreadResizeHandle width={paneWidth} maxWidth={maxWidth} onResize={setThreadWidth} onCommit={(v) => localStorage.setItem('spaces:threadWidth', String(v))} />}
        {open && <section aria-label="Thread" style={beside ? { width: paneWidth } : undefined} className={cn('spaces-thread-column flex min-w-0 min-h-0 flex-col', beside ? 'shrink-0' : 'flex-1')}>
            <button className="shrink-0 border-b border-border px-4 py-2 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => onOpenSpace(org.id, selectedSpace.id)}>{label(selectedSpace)}</button>
            <WorkspaceThreadPane key={`${selectedSpace.id}/${selectedRootId}`} org={org} space={selectedSpace} rootId={selectedRootId} item={selected} active={active}
                onClose={onCloseThread} onOpenThread={onOpenThread} onOpenSpace={onOpenSpace} onOpenSession={onOpenSession}
                expanded={expanded} onToggleExpanded={() => setExpanded((v) => !v)} showBack={!beside} />
        </section>}
    </div>
}
