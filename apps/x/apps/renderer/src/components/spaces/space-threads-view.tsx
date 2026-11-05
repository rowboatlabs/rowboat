import { useThreadsPreference, useThreadsScroll } from '@/hooks/use-threads-view-memory'
import { useSpaceAccess } from '@/lib/spaces-access'
import { invokeSpace } from '@/lib/spaces-invoke'
import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Bot, Timer, ChevronDown, Link as LinkIcon, MessageSquare, MessageSquareOff, MessagesSquare, MoreHorizontal, Pencil, Users } from 'lucide-react'
import type { spaces } from '@x/shared'
import { messageUrl } from '@x/shared/dist/spaces.js'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { MemberAvatar } from '@/components/spaces/atoms'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import { prefetchThread, updateStreamMessage, type ChatMessage, type SpacePresence } from '@/hooks/use-space-chat'
import { threadBadge, useReadStateVersion } from '@/lib/spaces-read-state'
import { useFallbackReplyAuthors } from '@/lib/spaces-thread-participants'
import { sessionArchiveLabel, threadLabelOf } from '@/lib/spaces-conventions'
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
 * discussion; Named = discussions (the wire's Topic rows); Sessions = roots
 * marked as sessions (2026-11-05), replies or not; By me = All whose root
 * the reader posted. Unnamed threads come from the stream's loaded window,
 * so "Load older" pages the stream itself rather than a new route.
 */
type ThreadsFilter = 'all' | 'named' | 'sessions' | 'mine'

/** A thread's participants: the root's author, then everyone who replied, in first-reply order. */
function participantsOf(root: spaces.Message | undefined, replyAuthors: (root: spaces.Message) => readonly string[]): string[] {
    if (!root) return []
    return [...new Set([root.author.memberId, ...replyAuthors(root)])]
}

interface ThreadRow {
    rootMessageId: string
    topic?: spaces.TopicListing
    root?: spaces.Message
    activityAt: string
}

/**
 * The archived unnamed threads (2026-11-03, "archive threads" in Main): the
 * Archived list's fetch, overridden by the stream's copies of the same roots,
 * which live events keep current, plus any root the stream saw archived since.
 */
function archivedPlainRoots(fetched: readonly spaces.Message[], roots: readonly ChatMessage[]): spaces.Message[] {
    const byId = new Map(fetched.map((root) => [root.id, root]))
    for (const root of roots) if (root.archived || byId.has(root.id)) byId.set(root.id, root)
    return [...byId.values()].filter((root) => root.archived)
}

function threadRows(topics: readonly spaces.TopicListing[], roots: readonly ChatMessage[], archivedPlain: readonly spaces.Message[], filter: ThreadsFilter, archived: boolean, selfMemberId: string): ThreadRow[] {
    const rows = new Map<string, ThreadRow>()
    for (const topic of topics) {
        if (!!topic.archived !== archived) continue
        rows.set(topic.rootMessageId, { rootMessageId: topic.rootMessageId, topic, root: topic.rootMessage ?? undefined, activityAt: topic.lastActivityAt })
    }
    // A discussion archives on its topic row, an unnamed thread on its root;
    // either way it leaves All for the Archived list.
    const archivedRoots = new Set(topics.filter((topic) => topic.archived).map((topic) => topic.rootMessageId))
    // Naming a thread unarchives its root on the server; a stale copy here must not outlive that.
    const namedRoots = new Set(topics.map((topic) => topic.rootMessageId))
    if (filter === 'sessions') rows.clear() // discussions are never sessions
    if (filter !== 'named' && archived) {
        for (const root of archivedPlain) {
            if (!namedRoots.has(root.id) && (filter !== 'sessions' || root.session)) rows.set(root.id, { rootMessageId: root.id, root, activityAt: root.lastReplyAt ?? root.postedAt })
        }
    }
    if (filter !== 'named' && !archived) {
        for (const root of roots) {
            // A session is a thread from its first message, replies or not (2026-11-05).
            if (root.pending || root.failed || root.threadRoot !== undefined || (root.replyCount === 0 && !root.session) || archivedRoots.has(root.id) || root.archived) continue
            if (filter === 'sessions' && !root.session) continue
            const row = rows.get(root.id)
            if (row) row.root = root
            else rows.set(root.id, { rootMessageId: root.id, root, activityAt: root.lastReplyAt ?? root.postedAt })
        }
    }
    return [...rows.values()]
        .filter((row) => filter !== 'mine' || row.root?.author.memberId === selfMemberId)
        .sort((a, b) => b.activityAt.localeCompare(a.activityAt) || a.rootMessageId.localeCompare(b.rootMessageId))
}

export function SpaceThreadsView({ orgId, orgAddress, spaceId, direct, selfMemberId, topics, roots, hasMore, loadingOlder, onLoadOlder, loaded, memberNames, spaceNames, presence, inline = false, selectedRootMessageId, onOpen }: {
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
    /** Inline spaces call the side pane a conversation. */
    inline?: boolean
    selectedRootMessageId?: string | null
    onOpen: (rootMessageId: string) => void
}) {
    const { writable } = useSpaceAccess()
    useReadStateVersion()
    const memoryKey = `${orgId}:${spaceId}`
    const [filter, setFilter] = useThreadsPreference<ThreadsFilter>(`spaces:threads-filter:${memoryKey}`, (raw) => raw === 'named' || raw === 'sessions' || raw === 'mine' ? raw : 'all')
    // Several participants at once (2026-11-03, "threads ui" in Main): a thread
    // shows when any chosen person is in it. Stored comma-joined under the old
    // key, so a single saved choice from before still reads back.
    const [savedParticipants, setSavedParticipants] = useThreadsPreference(`spaces:threads-participant:${memoryKey}`, (raw) => raw || null)
    const participants = useMemo(() => savedParticipants?.split(',') ?? [], [savedParticipants])
    const setParticipants = (ids: string[]) => setSavedParticipants(ids.length ? ids.join(',') : null)
    const toggleParticipant = (id: string) => setParticipants(participants.includes(id) ? participants.filter((p) => p !== id) : [...participants, id])
    const [archiveFilter, setArchiveFilter] = useThreadsPreference(`spaces:threads-archive:${memoryKey}`, (raw) => raw === 'archived' ? 'archived' : 'active')
    const archived = archiveFilter === 'archived'
    const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    const [fetchedArchived, setFetchedArchived] = useState<spaces.Message[]>([])
    useEffect(() => {
        let live = true
        invokeSpace('spaces:listArchivedThreads', { orgId, spaceId })
            .then(({ threads }) => { if (live) setFetchedArchived(threads) })
            .catch(() => { /* an older Harbor has no such route: nothing archived to show */ })
        return () => { live = false }
    }, [orgId, spaceId])
    const archivedPlain = useMemo(() => archivedPlainRoots(fetchedArchived, roots), [fetchedArchived, roots])
    const allRows = useMemo(() => threadRows(topics, roots, archivedPlain, filter, archived, selfMemberId), [topics, roots, archivedPlain, filter, archived, selfMemberId])
    const shownRoots = useMemo(() => allRows.flatMap((row) => row.root ? [row.root] : []), [allRows])
    const replyAuthors = useFallbackReplyAuthors(orgId, spaceId, shownRoots)
    const rows = participants.length ? allRows.filter((row) => participantsOf(row.root, replyAuthors).some((id) => participants.includes(id))) : allRows
    // The Archived list loads whole: no stream paging there.
    const pagesStream = filter !== 'named' && !archived
    const scroll = useThreadsScroll(`spaces:threads-scroll:${memoryKey}:${filter}:${archived}:${savedParticipants ?? ''}`, {
        loaded, hasMore: pagesStream && hasMore, loadingOlder, onLoadOlder, rowCount: rows.length,
    })
    const nameOf = (memberId: string) => memberNames.get(memberId) ?? 'Unknown member'
    const chosenNames = new Intl.ListFormat('en', { type: 'disjunction' }).format(participants.map(nameOf))
    // The menu offers whoever appears in the threads on screen, plus a sticky
    // choice that the loaded window doesn't reach yet so it can be cleared.
    const participantIds = new Set([...allRows.flatMap((row) => participantsOf(row.root, replyAuthors)), ...participants])
    const participantOptions = [...participantIds].sort((a, b) => (memberNames.get(a) ?? '').localeCompare(memberNames.get(b) ?? ''))
    const archivedCount = useMemo(() => threadRows(topics, [], archivedPlain, filter, true, selfMemberId).length, [topics, archivedPlain, filter, selfMemberId])
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
    const archivePlain = async (root: spaces.Message, archive: boolean) => {
        setPending(root.id)
        try {
            const res = await invokeSpace('spaces:archiveThread', { orgId, spaceId, rootMessageId: root.id, archived: archive })
            updateStreamMessage(orgId, spaceId, res.root)
            setFetchedArchived((prev) => [...prev.filter((m) => m.id !== res.root.id), res.root])
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not archive the thread', 'error')
        } finally { setPending(null) }
    }
    return <SpacesPage scrollRef={scroll.ref} onScroll={scroll.onScroll} label="Threads" title="Threads" count={rows.length}
        subtitle="Every conversation in this space. Named threads have a title so the team can find them again."
        toolbar={<>
            <FilterTabs label="Show threads" value={filter} onChange={setFilter}
                options={[{ value: 'all', label: 'All' }, { value: 'named', label: 'Named' }, { value: 'sessions', label: 'Sessions' }, { value: 'mine', label: 'By me' }]} />
            <FilterTabs label="Show" value={archiveFilter} onChange={setArchiveFilter}
                options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived', count: archivedCount }]} />
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="ghost" aria-label={participants.length ? `Participants: ${chosenNames}` : 'Filter by participant'}
                        className={cn('h-8 gap-1.5 px-2.5 text-[13px]', participants.length ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
                        {participants.length
                            ? <span className="flex items-center -space-x-1">{participants.slice(0, 3).map((id) => <MemberAvatar key={id} id={id} name={nameOf(id)} size="sm" className="rounded-full ring-2 ring-background" />)}</span>
                            : <Users className="size-3.5" />}
                        {participants.length === 0 ? 'Everyone' : participants.length === 1 ? nameOf(participants[0]) : `${participants.length} people`}
                        <ChevronDown className="size-3.5 opacity-60" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                    <DropdownMenuCheckboxItem checked={participants.length === 0} onCheckedChange={() => setParticipants([])}>
                        <Users className="size-3.5" />Everyone
                    </DropdownMenuCheckboxItem>
                    {participantOptions.length > 0 && <DropdownMenuSeparator />}
                    {/* The menu stays open so several people can be picked in one go. */}
                    {participantOptions.map((id) => <DropdownMenuCheckboxItem key={id} checked={participants.includes(id)}
                        onCheckedChange={() => toggleParticipant(id)} onSelect={(event) => event.preventDefault()}>
                        <MemberAvatar id={id} name={nameOf(id)} size="sm" className="rounded-full" />{nameOf(id)}
                    </DropdownMenuCheckboxItem>)}
                </DropdownMenuContent>
            </DropdownMenu>
        </>}>
        <ul className="flex flex-col gap-0.5">
            {rows.map(({ rootMessageId, topic, root, activityAt }) => {
                const title = resolveMentions(topic?.title ?? root?.session?.title ?? threadLabelOf(root?.body ?? ''), memberNames, spaceNames)
                const author = root ? memberNames.get(root.author.memberId) ?? null : null
                const badge = threadBadge(orgId, spaceId, rootMessageId, direct)
                const replies = root?.replyCount ?? 0
                const working = (presence.working.get(rootMessageId)?.length ?? 0) > 0
                const copyLink = () => void copySpacesLink(messageUrl(orgAddress, spaceId, rootMessageId))
                const Icon = topic ? MessagesSquare : root?.session ? Timer : MessageSquare
                const people = participantsOf(root, replyAuthors)
                return <li key={rootMessageId}><ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div className={cn('group relative flex items-center rounded-xl transition-colors hover:bg-accent/60 has-[[data-state=open]]:bg-accent/60', selectedRootMessageId === rootMessageId && 'bg-accent/60')}>
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
                                aria-current={selectedRootMessageId === rootMessageId ? 'true' : undefined}
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
                                {people.length > 0 && <ParticipantStack ids={people} nameOf={nameOf} />}
                                <UnreadBadge badge={badge} direct={direct} />
                            </button>}
                            {!(topic && renaming?.id === topic.id) && <DropdownMenu>
                                <DropdownMenuTrigger asChild><button type="button" aria-label={`Options for ${title}`} disabled={pending === (topic?.id ?? rootMessageId)}
                                    className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</DropdownMenuItem>
                                    {!topic && root && <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem disabled={!writable} onSelect={() => void archivePlain(root, !root.archived)}>
                                            {root.archived ? <ArchiveRestore className="mr-2 size-3.5" /> : <Archive className="mr-2 size-3.5" />}{sessionArchiveLabel(root)}
                                        </DropdownMenuItem>
                                    </>}
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
                        <ContextMenuItem onSelect={() => onOpen(rootMessageId)}><Icon className="mr-2 size-3.5" />{inline ? 'Open conversation' : 'Open thread'}</ContextMenuItem>
                        <ContextMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu></li>
            })}
        </ul>
        {rows.length === 0 && (!loaded
            ? <p className="px-3 py-12 text-sm text-muted-foreground">Loading threads…</p>
            : archived
                ? <SpacesEmpty icon={<Archive />} title="No archived threads">Archived threads stay readable here. A new reply brings one back.</SpacesEmpty>
                : filter === 'sessions'
                    ? <SpacesEmpty icon={<Timer />} title="No sessions">Type /session and a title in the message box to start one. End it from its ⋯ menu when the work is done.</SpacesEmpty>
                : filter === 'named'
                    ? <SpacesEmpty icon={<MessagesSquare />} title="No named threads yet">Give a thread a title from its ⋯ menu, or type /discussion in a reply, and it shows up here.</SpacesEmpty>
                    : participants.length
                        ? <SpacesEmpty icon={<Users />} title={`No threads with ${chosenNames}`}>
                            Threads {chosenNames} started or replied to show up here. <button type="button" className="underline" onClick={() => setParticipants([])}>Show everyone</button>
                        </SpacesEmpty>
                    : filter === 'mine'
                        ? <SpacesEmpty icon={<MessageSquare />} title="No threads started by you">Threads whose first message you posted show up here.</SpacesEmpty>
                        : <SpacesEmpty icon={<MessageSquare />} title="No threads yet">Reply to a message to start a thread.</SpacesEmpty>)}
        {pagesStream && hasMore && <Button type="button" size="sm" variant="ghost" className="mt-3" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? 'Loading…' : 'Load older threads'}
        </Button>}
    </SpacesPage>
}

/**
 * A thread's participants as overlapping circles (2026-10-25, "managing
 * sessions" in Main: asked for circular, so people are round here too, unlike
 * the stream's square tiles). Names ride the title; the row's label stays the title.
 */
function ParticipantStack({ ids, nameOf, max = 4 }: { ids: string[]; nameOf: (memberId: string) => string; max?: number }) {
    const shown = ids.slice(0, max)
    return <span aria-hidden title={ids.map(nameOf).join(', ')} className="flex shrink-0 items-center -space-x-1.5">
        {shown.map((id) => <MemberAvatar key={id} id={id} name={nameOf(id)} size="md" className="rounded-full ring-2 ring-background" />)}
        {ids.length > max && <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
            +{ids.length - max}
        </span>}
    </span>
}
