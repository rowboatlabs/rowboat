import { useSpaceAccess } from '@/lib/spaces-access'
import { invokeSpace } from '@/lib/spaces-invoke'
import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Bot, Check, ChevronDown, Link as LinkIcon, MessageSquare, MessageSquareOff, MessagesSquare, MoreHorizontal, Pencil, Users } from 'lucide-react'
import type { spaces } from '@x/shared'
import { messageUrl } from '@x/shared/dist/spaces.js'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MemberAvatar } from '@/components/spaces/atoms'
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
import { useThreadsFilter, type ThreadsTab } from '@/lib/spaces-threads-filter'

/**
 * The Threads view (2026-10-15, "threads" discussion in Main): every thread
 * in the space, not only the named ones, so a person can find their earlier
 * coding sessions. All = loaded stream roots that have replies plus every
 * discussion; Named = discussions (the wire's Topic rows); By me = All whose
 * root the reader posted. Unnamed threads come from the stream's loaded
 * window, so "Load older" pages the stream itself rather than a new route.
 */
interface ThreadRow {
    rootMessageId: string
    topic?: spaces.TopicListing
    root?: spaces.Message
    activityAt: string
}

/**
 * Who has posted in a thread, as the org folds it onto the root
 * (`Message.participants`, CONTRACT.md 2026-10-25). The fallback covers a
 * root the live frame added to the stream before any read folded it, and an
 * older server: its author is the one participant we know of.
 */
function participantsOf(row: ThreadRow): readonly string[] {
    if (!row.root) return []
    return row.root.participants?.length ? row.root.participants : [row.root.author.memberId]
}

function threadRows(topics: readonly spaces.TopicListing[], roots: readonly ChatMessage[], filter: ThreadsTab, archived: boolean, selfMemberId: string): ThreadRow[] {
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

/**
 * The thread's faces (2026-10-25, Ro's request in Main): the people and
 * agents who have posted in it, oldest first, circles here rather than the
 * stream's squares — a row of faces reads as one group, and the agent's kind
 * mark still says which of them is an agent (docs/spaces-design-language.md).
 */
function ThreadFaces({ ids, memberNames, max = 4 }: { ids: readonly string[]; memberNames: ReadonlyMap<string, string>; max?: number }) {
    if (ids.length === 0) return null
    const shown = ids.slice(0, max)
    const names = ids.map((id) => memberNames.get(id) ?? id)
    return (
        <span className="flex shrink-0 items-center -space-x-1" aria-label={`In this thread: ${names.join(', ')}`}>
            {shown.map((id) => (
                <MemberAvatar key={id} id={id} name={memberNames.get(id) ?? id} size="sm" className="rounded-full ring-2 ring-background" />
            ))}
            {ids.length > max && (
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-medium tabular-nums text-muted-foreground ring-2 ring-background">
                    +{ids.length - max}
                </span>
            )}
        </span>
    )
}

/** The participant filter: pick any number of people, or Anyone to clear it. */
function ParticipantFilter({ people, selected, memberNames, onChange }: {
    people: readonly string[]
    selected: readonly string[]
    memberNames: ReadonlyMap<string, string>
    onChange: (next: string[]) => void
}) {
    const nameOf = (id: string) => memberNames.get(id) ?? id
    const label = selected.length === 0 ? 'Anyone'
        : selected.length === 1 ? nameOf(selected[0]!)
        : `${selected.length} people`
    // A chosen person who has since dropped out of every loaded thread stays
    // on the list — otherwise the filter hiding every row could not be undone.
    const options = [...new Set([...people, ...selected])].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
    return (
        <div className="inline-flex rounded-lg bg-black/[0.05] p-0.5 [.dark_&]:bg-white/[0.06]">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label="Filter by participant"
                        className={cn(
                            'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] transition-[color,background-color,box-shadow] duration-150',
                            selected.length > 0
                                ? 'bg-white font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)] [.dark_&]:bg-white/[0.1] [.dark_&]:shadow-none'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        <Users className="size-3.5" aria-hidden />
                        {label}
                        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
                    <DropdownMenuItem onSelect={() => onChange([])}>
                        <span className="flex w-full items-center gap-2">
                            <span className="flex size-5 items-center justify-center">{selected.length === 0 && <Check className="size-3.5" />}</span>
                            Anyone
                        </span>
                    </DropdownMenuItem>
                    {options.length > 0 && <DropdownMenuSeparator />}
                    {options.map((id) => (
                        <DropdownMenuItem key={id} onSelect={(event) => { event.preventDefault(); toggle(id) }}>
                            <span className="flex w-full min-w-0 items-center gap-2">
                                <span className="flex size-5 items-center justify-center">{selected.includes(id) && <Check className="size-3.5" />}</span>
                                <MemberAvatar id={id} name={nameOf(id)} size="sm" className="rounded-full" />
                                <span className="truncate">{nameOf(id)}</span>
                            </span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
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
    // The filter outlives the view: opening a thread unmounts this page
    // (2026-10-25, Ro's request in Main), so it is remembered per space.
    const [{ tab, participants }, setFilter] = useThreadsFilter(orgId, spaceId)
    const [archived, setArchived] = useState(false)
    const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    const showArchived = tab === 'named' && archived
    const inTab = useMemo(() => threadRows(topics, roots, tab, showArchived, selfMemberId), [topics, roots, tab, showArchived, selfMemberId])
    // Everyone on the tab's threads — the people worth offering, whichever of
    // them is picked, so narrowing to one never empties the list.
    const people = useMemo(() => [...new Set(inTab.flatMap((row) => [...participantsOf(row)]))], [inTab])
    const rows = useMemo(
        () => (participants.length === 0 ? inTab : inTab.filter((row) => participantsOf(row).some((id) => participants.includes(id)))),
        [inTab, participants],
    )
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
            <FilterTabs label="Show threads" value={tab} onChange={(next) => setFilter({ tab: next, participants })}
                options={[{ value: 'all', label: 'All' }, { value: 'named', label: 'Named' }, { value: 'mine', label: 'By me' }]} />
            <ParticipantFilter people={people} selected={participants} memberNames={memberNames}
                onChange={(next) => setFilter({ tab, participants: next })} />
            {tab === 'named' && <FilterTabs label="Show" value={archived ? 'archived' : 'active'} onChange={(value) => setArchived(value === 'archived')}
                options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived', count: archivedCount }]} />}
        </>}>
        <ul className="flex flex-col gap-0.5">
            {rows.map((row) => {
                const { rootMessageId, topic, root, activityAt } = row
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
                                <ThreadFaces ids={participantsOf(row)} memberNames={memberNames} />
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
                : tab === 'named'
                    ? <SpacesEmpty icon={<MessagesSquare />} title="No named threads yet">Give a thread a title from its ⋯ menu, or type /discussion in a reply, and it shows up here.</SpacesEmpty>
                    : tab === 'mine'
                        ? <SpacesEmpty icon={<MessageSquare />} title="No threads started by you">Threads whose first message you posted show up here.</SpacesEmpty>
                        : <SpacesEmpty icon={<MessageSquare />} title="No threads yet">Reply to a message to start a thread.</SpacesEmpty>)}
        {tab !== 'named' && hasMore && <Button type="button" size="sm" variant="ghost" className="mt-3" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? 'Loading…' : 'Load older threads'}
        </Button>}
    </SpacesPage>
}
