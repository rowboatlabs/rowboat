import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, CircleCheck, Loader2, MessageSquare, MessagesSquare, MoreHorizontal, Timer } from 'lucide-react'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { useSpaceNames } from '@/hooks/use-spaces'
import { useOrgRoster } from '@/hooks/use-space-members'
import { useThreadsPreference } from '@/hooks/use-threads-view-memory'
import { FilterTabs, SpacesEmpty, SpacesPage } from '@/components/spaces/page-shell'
import { ThreadStatusDot } from '@/components/spaces/session-status'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { invokeSpace } from '@/lib/spaces-invoke'
import { refreshMyThreads, threadStatusLabel, useMyThreads } from '@/lib/spaces-my-threads'
import { sessionArchiveLabel, threadLabelOf } from '@/lib/spaces-conventions'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/**
 * Your threads across the server (2026-11-05, "coding session: threads" in
 * Main): every thread you started or follow, in every space, newest activity
 * first, each with where it stands for you. Sessions narrows to the ones
 * marked with /session; Named to discussions. The space's own Threads tab is
 * everyone's threads in that space; this page is yours in all of them.
 */
type Kind = 'all' | 'sessions' | 'named'

const KINDS = [
    { value: 'all', label: 'All' },
    { value: 'sessions', label: 'Sessions' },
    { value: 'named', label: 'Named' },
] as const

function matches(thread: spaces.ThreadListing, kind: Kind): boolean {
    if (kind === 'sessions') return !!thread.root.session
    if (kind === 'named') return !!thread.topic
    return true
}

export function MyThreadsView({ org, active = true, onOpenThread }: {
    org: OrgWithSpaces
    active?: boolean
    onOpenThread: (spaceId: string, rootMessageId: string) => void
}) {
    const [kind, setKind] = useThreadsPreference<Kind>(`spaces:my-threads-kind:${org.id}`, (raw) => raw === 'sessions' || raw === 'named' ? raw : 'all')
    const [state, setState] = useThreadsPreference(`spaces:my-threads-archive:${org.id}`, (raw) => raw === 'archived' ? 'archived' : 'active')
    const archived = state === 'archived'
    const live = useMyThreads(active ? org.id : null)
    const [ended, setEnded] = useState<spaces.ThreadListing[] | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    // The archived list is fetched when it is shown, and again after a change.
    const loadArchived = async () => {
        try {
            setEnded((await invokeSpace('spaces:myThreads', { orgId: org.id, archived: true })).threads)
        } catch {
            setEnded([])
        }
    }
    useEffect(() => {
        if (active && archived) void loadArchived()
    }, [active, archived, org.id]) // eslint-disable-line react-hooks/exhaustive-deps
    const all = archived ? ended ?? [] : live.threads
    const loaded = archived ? ended !== null : live.loaded
    const rows = all.filter((t) => matches(t, kind))
    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const roster = useOrgRoster(org.id, spaceIds)
    const memberNames = useMemo(() => new Map(roster.map((m) => [m.id, m.displayName])), [roster])
    const spaceNames = useSpaceNames(org.id)

    const setArchived = async (thread: spaces.ThreadListing, archive: boolean) => {
        setPending(thread.root.id)
        try {
            if (thread.topic) {
                await invokeSpace('spaces:manageTopic', { orgId: org.id, spaceId: thread.spaceId, topicId: thread.topic.id, action: { action: archive ? 'archive' : 'unarchive' } })
            } else {
                await invokeSpace('spaces:archiveThread', { orgId: org.id, spaceId: thread.spaceId, rootMessageId: thread.root.id, archived: archive })
            }
            await refreshMyThreads(org.id)
            if (archived) await loadArchived()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not update the thread', 'error')
        } finally {
            setPending(null)
        }
    }

    return (
        <SpacesPage label="Your threads" title="Threads" count={rows.length}
            subtitle="Threads you started or follow, in every space. Start a session with /session and a title in any message box."
            toolbar={<>
                <FilterTabs label="Show threads" value={kind} options={KINDS} onChange={setKind} />
                <FilterTabs label="Show" value={state} onChange={setState}
                    options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
            </>}>
            {!loaded && <p className="flex items-center gap-2 px-3 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</p>}
            <ul className="flex flex-col gap-0.5">
                {rows.map((thread) => {
                    const { root, topic } = thread
                    const title = resolveMentions(topic?.title ?? root.session?.title ?? threadLabelOf(root.body), memberNames, spaceNames)
                    const Icon = topic ? MessagesSquare : root.session ? Timer : MessageSquare
                    const author = memberNames.get(root.author.memberId)
                    const archiveLabel = topic ? (archived ? 'Unarchive' : 'Archive') : sessionArchiveLabel(root)
                    return <li key={root.id} className="group relative flex items-center rounded-xl transition-colors hover:bg-accent/60 has-[[data-state=open]]:bg-accent/60">
                        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 pr-12 text-left"
                            onClick={() => onOpenThread(thread.spaceId, root.id)}>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
                            <span className="min-w-0 flex-1">
                                <span className={cn('block truncate text-sm', thread.unreadReplies > 0 ? 'font-semibold text-foreground' : 'font-medium')}>{title}</span>{' '}
                                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span className="truncate">
                                        {thread.spaceName}{author ? ` · ${author}` : ''} · {root.replyCount} {root.replyCount === 1 ? 'reply' : 'replies'} · {formatFeedTime(thread.lastActivityAt)}
                                    </span>
                                    {!archived && thread.status !== 'idle' && <span className="inline-flex shrink-0 items-center gap-1">
                                        · <ThreadStatusDot status={thread.status} /> {threadStatusLabel(thread.status)}
                                    </span>}
                                </span>
                            </span>
                            <UnreadBadge badge={{ unread: thread.unreadReplies, forYou: thread.unreadMentions }} />
                        </button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button type="button" aria-label={`Options for ${title}`} disabled={pending === root.id}
                                    className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
                                    <MoreHorizontal className="size-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => void setArchived(thread, !archived)}>
                                    {archived ? <ArchiveRestore className="mr-2 size-3.5" /> : root.session && !topic ? <CircleCheck className="mr-2 size-3.5" /> : <Archive className="mr-2 size-3.5" />}
                                    {archiveLabel}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </li>
                })}
            </ul>
            {loaded && rows.length === 0 && (archived
                ? <SpacesEmpty icon={<Archive />} title="Nothing archived">Threads you archive and sessions you end stay readable here. A new reply brings one back.</SpacesEmpty>
                : kind === 'sessions'
                    ? <SpacesEmpty icon={<Timer />} title="No sessions">Type /session and a title in any message box to start one. End it when the work is done.</SpacesEmpty>
                    : kind === 'named'
                        ? <SpacesEmpty icon={<MessagesSquare />} title="No named threads">Discussions you started or follow show up here.</SpacesEmpty>
                        : <SpacesEmpty icon={<MessageSquare />} title="No threads yet">Threads you start or reply to, in any space, show up here.</SpacesEmpty>)}
        </SpacesPage>
    )
}
