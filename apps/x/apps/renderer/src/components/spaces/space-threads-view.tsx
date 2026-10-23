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
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilterTabs, SpacesEmpty, SpacesPage } from '@/components/spaces/page-shell'

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
            if (root.pending || root.failed || root.threadRoot !== undefined || root.replyCount === 0 || archivedRoots.has(root.id)) continue
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
    const { writable } = useSpaceAccess()
    useReadStateVersion()
    const [filter, setFilter] = useState<ThreadsFilter>('all')
    const [archived, setArchived] = useState(false)
    const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    const showArchived = filter === 'named' && archived
    const rows = useMemo(() => threadRows(topics, roots, filter, showArchived, selfMemberId), [topics, roots, filter, showArchived, selfMemberId])
    const archivedCount = topics.filter((topic) => topic.archived).length
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
    return <SpacesPage label="Threads" title="Threads" count={rows.length}
        subtitle="Every conversation in this space. Named threads have a title so the team can find them again."
        toolbar={<>
            <FilterTabs label="Show threads" value={filter} onChange={setFilter}
                options={[{ value: 'all', label: 'All' }, { value: 'named', label: 'Named' }, { value: 'mine', label: 'By me' }]} />
            {filter === 'named' && <FilterTabs label="Show" value={archived ? 'archived' : 'active'} onChange={(value) => setArchived(value === 'archived')}
                options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived', count: archivedCount }]} />}
        </>}>
        <ul className="flex flex-col gap-0.5">
            {rows.map(({ rootMessageId, topic, root, activityAt }) => {
                const title = resolveMentions(topic?.title ?? threadLabelOf(root?.body ?? ''), memberNames, spaceNames)
                const author = root ? memberNames.get(root.author.memberId) ?? null : null
                const badge = threadBadge(orgId, spaceId, rootMessageId, direct)
                const replies = root?.replyCount ?? 0
                const working = (presence.working.get(rootMessageId)?.length ?? 0) > 0
                const copyLink = () => void copySpacesLink(messageUrl(orgAddress, spaceId, rootMessageId))
                const Icon = topic ? MessagesSquare : MessageSquare
                return <li key={rootMessageId}><ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div className="group relative flex items-center rounded-xl transition-colors hover:bg-accent/60 has-[[data-state=open]]:bg-accent/60">
                            {topic && renaming?.id === topic.id ? <form className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5" onSubmit={(event) => {
                                event.preventDefault()
                                if (renaming.title.trim()) void manage(topic.id, { action: 'retitle', title: renaming.title.trim() })
                            }}>
                                <Input autoFocus aria-label="Discussion title" className="h-9 min-w-0 flex-1 text-sm"
                                    value={renaming.title} onChange={(event) => setRenaming({ id: topic.id, title: event.target.value })}
                                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null) }} />
                                <Button type="submit" size="sm" disabled={pending === topic.id || !renaming.title.trim()}>Save</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                            </form> : <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 pr-12 text-left"
                                onMouseEnter={() => prefetchThread(orgId, spaceId, rootMessageId)} onClick={() => onOpen(rootMessageId)}>
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                    <Icon className="size-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className={cn('block truncate text-sm', badge.unread > 0 ? 'font-semibold text-foreground' : 'font-medium')}>{title}</span>{' '}
                                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <span className="truncate">{author ? `${author} · ` : ''}{replies} {replies === 1 ? 'reply' : 'replies'} · {formatFeedTime(activityAt)}</span>
                                        {working && <span className="inline-flex shrink-0 items-center gap-1 text-[var(--stream-link)]"><Bot className="size-3.5" aria-hidden /> Rowboat is working</span>}
                                    </span>
                                </span>
                                <UnreadBadge badge={badge} direct={direct} />
                            </button>}
                            {!(topic && renaming?.id === topic.id) && <DropdownMenu>
                                <DropdownMenuTrigger asChild><button type="button" aria-label={`Options for ${title}`} disabled={!!topic && pending === topic.id}
                                    className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</DropdownMenuItem>
                                    {topic && <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem disabled={!writable} onSelect={() => setRenaming({ id: topic.id, title })}><Pencil className="mr-2 size-3.5" />Rename</DropdownMenuItem>
                                        <DropdownMenuItem disabled={!writable} onSelect={() => void manage(topic.id, { action: topic.archived ? 'unarchive' : 'archive' })}>
                                            {topic.archived ? <ArchiveRestore className="mr-2 size-3.5" /> : <Archive className="mr-2 size-3.5" />}{topic.archived ? 'Unarchive' : 'Archive'}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem disabled={!writable} onSelect={() => void manage(topic.id, { action: 'remove' })}><MessageSquareOff className="mr-2 size-3.5" />Convert back to thread</DropdownMenuItem>
                                    </>}
                                </DropdownMenuContent>
                            </DropdownMenu>}
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onOpen(rootMessageId)}><Icon className="mr-2 size-3.5" />Open thread</ContextMenuItem>
                        <ContextMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu></li>
            })}
        </ul>
        {rows.length === 0 && (!loaded
            ? <p className="px-3 py-12 text-sm text-muted-foreground">Loading threads…</p>
            : showArchived
                ? <SpacesEmpty icon={<Archive />} title="No archived discussions">Archived discussions stay readable here.</SpacesEmpty>
                : filter === 'named'
                    ? <SpacesEmpty icon={<MessagesSquare />} title="No named threads yet">Give a thread a title from its ⋯ menu, or type /discussion in a reply, and it shows up here.</SpacesEmpty>
                    : filter === 'mine'
                        ? <SpacesEmpty icon={<MessageSquare />} title="No threads started by you">Threads whose first message you posted show up here.</SpacesEmpty>
                        : <SpacesEmpty icon={<MessageSquare />} title="No threads yet">Reply to a message to start a thread.</SpacesEmpty>)}
        {filter !== 'named' && hasMore && <Button type="button" size="sm" variant="ghost" className="mt-3" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? 'Loading…' : 'Load older threads'}
        </Button>}
    </SpacesPage>
}
