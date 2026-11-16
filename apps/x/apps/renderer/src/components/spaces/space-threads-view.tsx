import { useThreadsPreference, useThreadsScroll } from '@/hooks/use-threads-view-memory'
import { useSpaceAccess } from '@/lib/spaces-access'
import { invokeSpace } from '@/lib/spaces-invoke'
import { useEffect, useMemo, useState } from 'react'
import { Archive, MessageSquare, MessagesSquare, Timer, Users } from 'lucide-react'
import type { spaces } from '@x/shared'
import { messageUrl } from '@x/shared/dist/spaces.js'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import { prefetchThread, updateStreamMessage, type ChatMessage, type SpacePresence } from '@/hooks/use-space-chat'
import { threadBadge, useReadStateVersion } from '@/lib/spaces-read-state'
import { useFallbackReplyAuthors } from '@/lib/spaces-thread-participants'
import { threadLabelOf } from '@/lib/spaces-conventions'
import { resolveMentions } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { FilterTabs, SpacesEmpty, SpacesPage } from '@/components/spaces/page-shell'
import { ParticipantFilter, ThreadList, participantsOf, type ThreadItem } from '@/components/spaces/thread-list'

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
    const [archiveFilter, setArchiveFilter] = useThreadsPreference(`spaces:threads-archive:${memoryKey}`, (raw) => raw === 'archived' ? 'archived' : 'active')
    const archived = archiveFilter === 'archived'
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
    const participantOptions = [...new Set(allRows.flatMap((row) => participantsOf(row.root, replyAuthors)))]
    const archivedCount = useMemo(() => threadRows(topics, [], archivedPlain, filter, true, selfMemberId).length, [topics, archivedPlain, filter, selfMemberId])
    const manage = async (id: string, action: spaces.SpacesManageTopicAction) => {
        setPending(`${spaceId}/${topics.find((t) => t.id === id)?.rootMessageId ?? id}`)
        try {
            await invokeSpace('spaces:manageTopic', { orgId, spaceId, topicId: id, action })
            await refreshSpaceFeed(orgId, spaceId)
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not update the discussion', 'error')
        } finally { setPending(null) }
    }
    const archivePlain = async (root: spaces.Message, archive: boolean) => {
        setPending(`${spaceId}/${root.id}`)
        try {
            const res = await invokeSpace('spaces:archiveThread', { orgId, spaceId, rootMessageId: root.id, archived: archive })
            updateStreamMessage(orgId, spaceId, res.root)
            setFetchedArchived((prev) => [...prev.filter((m) => m.id !== res.root.id), res.root])
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not archive the thread', 'error')
        } finally { setPending(null) }
    }
    // A session's title (harbor setSession, 2026-11-06), from the same Rename as a discussion's.
    const renameSession = async (rootMessageId: string, title: string) => {
        setPending(`${spaceId}/${rootMessageId}`)
        try {
            const res = await invokeSpace('spaces:setSession', { orgId, spaceId, rootMessageId, session: { title } })
            updateStreamMessage(orgId, spaceId, res.root)
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not rename the session', 'error')
        } finally { setPending(null) }
    }
    const items: ThreadItem[] = rows.map(({ rootMessageId, topic, root, activityAt }) => ({
        spaceId, rootMessageId, root, topic, activityAt,
        title: resolveMentions(topic?.title ?? root?.session?.title ?? threadLabelOf(root?.body ?? ''), memberNames, spaceNames),
        people: participantsOf(root, replyAuthors),
        badge: threadBadge(orgId, spaceId, rootMessageId, direct),
        direct,
        working: (presence.working.get(rootMessageId)?.length ?? 0) > 0,
    }))
    return <SpacesPage scrollRef={scroll.ref} onScroll={scroll.onScroll} label="Threads" title="Threads" count={rows.length}
        subtitle="Every conversation in this space. Named threads have a title so the team can find them again."
        toolbar={<>
            <FilterTabs label="Show threads" value={filter} onChange={setFilter}
                options={[{ value: 'all', label: 'All' }, { value: 'named', label: 'Named' }, { value: 'sessions', label: 'Sessions' }, { value: 'mine', label: 'By me' }]} />
            <FilterTabs label="Show" value={archiveFilter} onChange={setArchiveFilter}
                options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived', count: archivedCount }]} />
            <ParticipantFilter chosen={participants} options={participantOptions} nameOf={nameOf} onChange={setParticipants} />
        </>}>
        <ThreadList items={items} nameOf={nameOf} writable={writable} pendingKey={pending} selectedRootMessageId={selectedRootMessageId} inline={inline}
            actions={{
                onOpen: (item) => onOpen(item.rootMessageId),
                onPrefetch: (item) => prefetchThread(orgId, spaceId, item.rootMessageId),
                onCopyLink: (item) => void copySpacesLink(messageUrl(orgAddress, spaceId, item.rootMessageId)),
                onArchive: (item, archive) => item.topic
                    ? void manage(item.topic.id, { action: archive ? 'archive' : 'unarchive' })
                    : item.root && void archivePlain(item.root, archive),
                onRename: (item, title) => item.topic ? manage(item.topic.id, { action: 'retitle', title }) : renameSession(item.rootMessageId, title),
                onRemoveTopic: (item) => item.topic && void manage(item.topic.id, { action: 'remove' }),
            }} />
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
