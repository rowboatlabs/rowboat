import { useSpaceAccess } from '@/lib/spaces-access'
import { invokeSpace } from '@/lib/spaces-invoke'
import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Bot, Link as LinkIcon, MessageSquare, MessageSquareOff, MessagesSquare, MoreHorizontal, Pencil } from 'lucide-react'
import type { spaces } from '@x/shared'
import { messageUrl } from '@x/shared/dist/spaces.js'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import { prefetchThread, type ChatMessage, type SpacePresence } from '@/hooks/use-space-chat'
import { threadBadge, useReadStateVersion } from '@/lib/spaces-read-state'
import { threadLabelOf } from '@/lib/spaces-conventions'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'

/**
 * The Threads view (2026-10-15, "threads" discussion in Main): every thread
 * in the space, not only the named ones, so a person can find their earlier
 * coding sessions. All = loaded stream roots that have replies plus every
 * discussion; Named = discussions (the wire's Topic rows); By me = All whose
 * root the reader posted. Unnamed threads come from the stream's loaded
 * window, so "Load older" pages the stream itself rather than a new route.
 */
type ThreadsFilter = 'all' | 'named' | 'mine'

interface ThreadRow {
    rootMessageId: string
    topic?: spaces.TopicListing
    root?: spaces.Message
    activityAt: string
}

function threadRows(topics: readonly spaces.TopicListing[], roots: readonly ChatMessage[], filter: ThreadsFilter, archived: boolean, selfMemberId: string): ThreadRow[] {
    const rows = new Map<string, ThreadRow>()
    for (const topic of topics) {
        if (!!topic.archived !== archived) continue
        rows.set(topic.rootMessageId, { rootMessageId: topic.rootMessageId, topic, root: topic.rootMessage ?? undefined, activityAt: topic.lastActivityAt })
    }
    // Archive is a discussion's lifecycle; an unnamed thread is always active.
    // Archived topics' roots are skipped so archiving still hides them from All.
    const archivedRoots = new Set(topics.filter((topic) => topic.archived).map((topic) => topic.rootMessageId))
    if (filter !== 'named' && !archived) {
        for (const root of roots) {
            if (root.pending || root.failed || root.replyCount === 0 || archivedRoots.has(root.id)) continue
            const row = rows.get(root.id)
            if (row) row.root = root
            else rows.set(root.id, { rootMessageId: root.id, root, activityAt: root.lastReplyAt ?? root.postedAt })
        }
    }
    return [...rows.values()]
        .filter((row) => filter !== 'mine' || row.root?.author.memberId === selfMemberId)
        .sort((a, b) => b.activityAt.localeCompare(a.activityAt) || a.rootMessageId.localeCompare(b.rootMessageId))
}

export function SpaceThreadsView({ orgId, orgAddress, spaceId, direct, selfMemberId, topics, roots, hasMore, loadingOlder, onLoadOlder, loaded, memberNames, spaceNames, presence, onOpen }: {
    orgId: string
    orgAddress: string
    spaceId: string
    direct: boolean
    selfMemberId: string
    topics: spaces.TopicListing[]
    /** The stream's loaded roots: unnamed threads are the ones with replies. */
    roots: ChatMessage[]
    hasMore: boolean
    loadingOlder: boolean
    onLoadOlder: () => void
    loaded: boolean
    memberNames: ReadonlyMap<string, string>
    spaceNames: ReadonlyMap<string, string>
    presence: SpacePresence
    onOpen: (rootMessageId: string) => void
}) {
    const { member } = useSpaceAccess()
    useReadStateVersion()
    const [filter, setFilter] = useState<ThreadsFilter>('all')
    const [archived, setArchived] = useState(false)
    const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    const showArchived = filter === 'named' && archived
    const rows = useMemo(() => threadRows(topics, roots, filter, showArchived, selfMemberId), [topics, roots, filter, showArchived, selfMemberId])
    const manage = async (id: string, action: spaces.SpacesManageTopicAction) => {
        setPending(id)
        try {
            await invokeSpace('spaces:manageTopic', { orgId, spaceId, topicId: id, action })
            setRenaming(null)
            await refreshSpaceFeed(orgId, spaceId)
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not update the discussion', 'error')
        } finally { setPending(null) }
    }
    const empty = !loaded ? 'Loading threads…'
        : showArchived ? 'No archived discussions.'
        : filter === 'named' ? 'No named threads. Make a thread a discussion to give it a title and a place here.'
        : filter === 'mine' ? 'No threads started by you yet.'
        : 'No threads yet. Reply to a message to start one.'
    return <section aria-label="Threads" className="flex min-h-0 flex-1 flex-col">
        <div className="spaces-pane-header flex shrink-0 items-center gap-3 border-b border-border">
            <h2 className="text-[13px] font-semibold">Threads</h2>
            <div role="group" aria-label="Show threads" className="flex flex-1 items-center gap-1">
                <button type="button" aria-pressed={filter === 'all'} className="spaces-collection-filter" onClick={() => setFilter('all')}>All</button>
                <button type="button" aria-pressed={filter === 'named'} className="spaces-collection-filter" onClick={() => setFilter('named')}>Named</button>
                <button type="button" aria-pressed={filter === 'mine'} className="spaces-collection-filter" onClick={() => setFilter('mine')}>By me</button>
            </div>
            {filter === 'named' && <>
                <button type="button" aria-pressed={!archived} className="spaces-collection-filter" onClick={() => setArchived(false)}>Active</button>
                <button type="button" aria-pressed={archived} className="spaces-collection-filter" onClick={() => setArchived(true)}>Archived</button>
            </>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {rows.map(({ rootMessageId, topic, root, activityAt }) => {
                const title = resolveMentions(topic?.title ?? threadLabelOf(root?.body ?? ''), memberNames, spaceNames)
                const author = root ? memberNames.get(root.author.memberId) ?? null : null
                const badge = threadBadge(orgId, spaceId, rootMessageId, direct)
                const copyLink = () => void copySpacesLink(messageUrl(orgAddress, spaceId, rootMessageId))
                const Icon = topic ? MessagesSquare : MessageSquare
                return <ContextMenu key={rootMessageId}>
                    <ContextMenuTrigger asChild>
                        <div className="group flex items-center gap-2 border-b border-border/60 py-1">
                            {topic && renaming?.id === topic.id ? <form className="flex min-w-0 flex-1 gap-2 py-2" onSubmit={(event) => {
                                event.preventDefault()
                                if (renaming.title.trim()) void manage(topic.id, { action: 'retitle', title: renaming.title.trim() })
                            }}>
                                <input autoFocus aria-label="Discussion title" className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                                    value={renaming.title} onChange={(event) => setRenaming({ id: topic.id, title: event.target.value })}
                                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null) }} />
                                <button type="submit" className="spaces-collection-filter" disabled={pending === topic.id || !renaming.title.trim()}>Save</button>
                                <button type="button" className="spaces-collection-filter" onClick={() => setRenaming(null)}>Cancel</button>
                            </form> : <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded py-3 text-left hover:bg-accent/50"
                                onMouseEnter={() => prefetchThread(orgId, spaceId, rootMessageId)} onClick={() => onOpen(rootMessageId)}>
                                <Icon className="size-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1"><span className={`block truncate text-[13px] ${badge.unread > 0 ? 'font-semibold' : ''}`}>{title}</span>{' '}
                                    <span className="mt-1 block truncate text-xs text-muted-foreground">{author ? `${author} · ` : ''}{root?.replyCount ?? 0} replies · {formatFeedTime(activityAt)}</span></span>
                                {(presence.working.get(rootMessageId)?.length ?? 0) > 0 && <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-label="A Rowboat is working here" />}
                                <UnreadBadge badge={badge} direct={direct} />
                            </button>}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild><button type="button" aria-label={`Options for ${title}`} disabled={!!topic && pending === topic.id}
                                    className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</DropdownMenuItem>
                                    {topic && <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem disabled={!member} onSelect={() => setRenaming({ id: topic.id, title })}><Pencil className="mr-2 size-3.5" />Rename</DropdownMenuItem>
                                        <DropdownMenuItem disabled={!member} onSelect={() => void manage(topic.id, { action: topic.archived ? 'unarchive' : 'archive' })}>
                                            {topic.archived ? <ArchiveRestore className="mr-2 size-3.5" /> : <Archive className="mr-2 size-3.5" />}{topic.archived ? 'Unarchive' : 'Archive'}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem disabled={!member} onSelect={() => void manage(topic.id, { action: 'remove' })}><MessageSquareOff className="mr-2 size-3.5" />Convert back to thread</DropdownMenuItem>
                                    </>}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onOpen(rootMessageId)}><Icon className="mr-2 size-3.5" />Open thread</ContextMenuItem>
                        <ContextMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            })}
            {rows.length === 0 && <p className="py-8 text-sm text-muted-foreground">{empty}</p>}
            {filter !== 'named' && hasMore && <button type="button" className="spaces-collection-filter mt-3" disabled={loadingOlder} onClick={onLoadOlder}>
                {loadingOlder ? 'Loading…' : 'Load older threads'}
            </button>}
        </div>
    </section>
}
