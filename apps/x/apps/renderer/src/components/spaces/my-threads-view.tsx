import { useEffect, useMemo, useState } from 'react'
import { Archive, Loader2, MessageSquare, MessagesSquare, Timer, Users } from 'lucide-react'
import type { spaces } from '@x/shared'
import { messageUrl } from '@x/shared/dist/spaces.js'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { useSpaceNames } from '@/hooks/use-spaces'
import { useOrgRoster } from '@/hooks/use-space-members'
import { useThreadsPreference } from '@/hooks/use-threads-view-memory'
import { FilterTabs, SpacesEmpty, SpacesPage } from '@/components/spaces/page-shell'
import { ParticipantFilter, SpaceFilter, ThreadList, participantsOf, type ThreadItem } from '@/components/spaces/thread-list'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { invokeSpace } from '@/lib/spaces-invoke'
import { refreshMyThreads, useMyThreads } from '@/lib/spaces-my-threads'
import { threadLabelOf } from '@/lib/spaces-conventions'
import { resolveMentions } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'

/**
 * Your threads across the server (2026-11-05, "coding session: threads" in
 * Main): every thread you started or follow, in every space, newest activity
 * first, each with where it stands for you. The rows, menus and filters are
 * the space's Threads tab's (thread-list.tsx, 2026-11-06), plus a Space
 * filter; the tab is everyone's threads in one space, this page is yours in
 * all of them.
 */
type Kind = 'all' | 'named' | 'sessions' | 'mine'

const KINDS = [
    { value: 'all', label: 'All' },
    { value: 'named', label: 'Named' },
    { value: 'sessions', label: 'Sessions' },
    { value: 'mine', label: 'By me' },
] as const

function matches(thread: spaces.ThreadListing, kind: Kind, selfMemberId: string): boolean {
    if (kind === 'sessions') return !!thread.root.session && !thread.topic
    if (kind === 'named') return !!thread.topic
    if (kind === 'mine') return thread.root.author.memberId === selfMemberId
    return true
}

const list = (raw: string | null) => raw?.split(',').filter(Boolean) ?? []

export function MyThreadsView({ org, active = true, onOpenThread }: {
    org: OrgWithSpaces
    active?: boolean
    onOpenThread: (spaceId: string, rootMessageId: string) => void
}) {
    const [kind, setKind] = useThreadsPreference<Kind>(`spaces:my-threads-kind:${org.id}`, (raw) => raw === 'named' || raw === 'sessions' || raw === 'mine' ? raw : 'all')
    const [state, setState] = useThreadsPreference(`spaces:my-threads-archive:${org.id}`, (raw) => raw === 'archived' ? 'archived' : 'active')
    const [savedPeople, setSavedPeople] = useThreadsPreference(`spaces:my-threads-participant:${org.id}`, (raw) => raw || null)
    const [savedSpaces, setSavedSpaces] = useThreadsPreference(`spaces:my-threads-space:${org.id}`, (raw) => raw || null)
    const people = useMemo(() => list(savedPeople), [savedPeople])
    const chosenSpaces = useMemo(() => list(savedSpaces), [savedSpaces])
    const archived = state === 'archived'
    const live = useMyThreads(active ? org.id : null)
    const [ended, setEnded] = useState<spaces.ThreadListing[] | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    // The archived list is fetched on open (its count rides the Archived pill) and after a change.
    const loadArchived = async () => {
        try {
            setEnded((await invokeSpace('spaces:myThreads', { orgId: org.id, archived: true })).threads)
        } catch {
            setEnded([])
        }
    }
    useEffect(() => {
        if (active) void loadArchived()
    }, [active, org.id]) // eslint-disable-line react-hooks/exhaustive-deps

    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const roster = useOrgRoster(org.id, spaceIds)
    const memberNames = useMemo(() => new Map(roster.map((m) => [m.id, m.displayName])), [roster])
    const spaceNames = useSpaceNames(org.id)
    const nameOf = (memberId: string) => memberNames.get(memberId) ?? 'Unknown member'

    const all = archived ? ended ?? [] : live.threads
    const loaded = archived ? ended !== null : live.loaded
    const ofKind = all.filter((t) => matches(t, kind, org.memberId))
    const rows = ofKind.filter((t) =>
        (chosenSpaces.length === 0 || chosenSpaces.includes(t.spaceId)) &&
        (people.length === 0 || participantsOf(t.root).some((id) => people.includes(id))))
    const archivedCount = (ended ?? []).filter((t) => matches(t, kind, org.memberId)).length
    // A DM's listing carries Harbor's placeholder name ("Direct message"), so
    // it is named for the other person, as the sidebar does (2026-11-06,
    // "thread filter" in Main: every DM read "Direct message").
    const whereOf = (t: spaces.ThreadListing) => t.spaceKind === 'direct' ? spaceNames.get(t.spaceId) ?? t.spaceName : t.spaceName
    const spaceLabel = new Map(all.map((t) => [t.spaceId, whereOf(t)]))
    const directIds = new Set(all.filter((t) => t.spaceKind === 'direct').map((t) => t.spaceId))
    const spaceOptions = [...new Set(ofKind.map((t) => t.spaceId))]
    const participantOptions = [...new Set(ofKind.flatMap((t) => participantsOf(t.root)))]

    const items: ThreadItem[] = rows.map((t) => ({
        spaceId: t.spaceId,
        rootMessageId: t.root.id,
        root: t.root,
        ...(t.topic ? { topic: t.topic } : {}),
        title: resolveMentions(t.topic?.title ?? t.root.session?.title ?? threadLabelOf(t.root.body), memberNames, spaceNames),
        activityAt: t.lastActivityAt,
        people: participantsOf(t.root),
        badge: { unread: t.unreadReplies, forYou: t.unreadMentions },
        direct: t.spaceKind === 'direct',
        spaceName: whereOf(t),
        status: t.status,
    }))

    /** One change to a thread, then both lists again. */
    const act = async (item: ThreadItem, run: () => Promise<unknown>, failure: string) => {
        setPending(`${item.spaceId}/${item.rootMessageId}`)
        try {
            await run()
            await Promise.all([refreshMyThreads(org.id), loadArchived()])
        } catch (err) {
            toast(err instanceof Error ? err.message : failure, 'error')
        } finally {
            setPending(null)
        }
    }
    const manage = (item: ThreadItem, action: spaces.SpacesManageTopicAction) =>
        act(item, () => invokeSpace('spaces:manageTopic', { orgId: org.id, spaceId: item.spaceId, topicId: item.topic!.id, action }), 'Could not update the discussion')

    return (
        <SpacesPage label="Your threads" title="Threads" count={rows.length}
            subtitle="Threads you started or follow, in every space. Start a session with /session and a title in any message box."
            toolbar={<>
                <FilterTabs label="Show threads" value={kind} options={KINDS} onChange={setKind} />
                <FilterTabs label="Show" value={state} onChange={setState}
                    options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived', count: archivedCount }]} />
                <ParticipantFilter chosen={people} options={participantOptions} nameOf={nameOf} onChange={(ids) => setSavedPeople(ids.length ? ids.join(',') : null)} />
                <SpaceFilter chosen={chosenSpaces} options={spaceOptions} nameOf={(id) => spaceLabel.get(id) ?? spaceNames.get(id) ?? 'Unknown space'}
                    isDirect={(id) => directIds.has(id)}
                    onChange={(ids) => setSavedSpaces(ids.length ? ids.join(',') : null)} />
            </>}>
            {!loaded && <p className="flex items-center gap-2 px-3 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</p>}
            <ThreadList items={items} nameOf={nameOf} writable pendingKey={pending}
                actions={{
                    onOpen: (item) => onOpenThread(item.spaceId, item.rootMessageId),
                    onCopyLink: (item) => void copySpacesLink(messageUrl(org.address, item.spaceId, item.rootMessageId)),
                    onArchive: (item, archive) => item.topic
                        ? void manage(item, { action: archive ? 'archive' : 'unarchive' })
                        : void act(item, () => invokeSpace('spaces:archiveThread', { orgId: org.id, spaceId: item.spaceId, rootMessageId: item.rootMessageId, archived: archive }), 'Could not archive the thread'),
                    onRename: (item, title) => item.topic
                        ? manage(item, { action: 'retitle', title })
                        : act(item, () => invokeSpace('spaces:setSession', { orgId: org.id, spaceId: item.spaceId, rootMessageId: item.rootMessageId, session: { title } }), 'Could not rename the session'),
                    onRemoveTopic: (item) => void manage(item, { action: 'remove' }),
                }} />
            {loaded && rows.length === 0 && (archived
                ? <SpacesEmpty icon={<Archive />} title="Nothing archived">Threads you archive and sessions you end stay readable here. A new reply brings one back.</SpacesEmpty>
                : people.length || chosenSpaces.length
                    ? <SpacesEmpty icon={<Users />} title="No threads match">
                        Try fewer people or spaces. <button type="button" className="underline" onClick={() => { setSavedPeople(null); setSavedSpaces(null) }}>Show all</button>
                    </SpacesEmpty>
                : kind === 'sessions'
                    ? <SpacesEmpty icon={<Timer />} title="No sessions">Type /session and a title in any message box to start one. End it when the work is done.</SpacesEmpty>
                    : kind === 'named'
                        ? <SpacesEmpty icon={<MessagesSquare />} title="No named threads">Discussions you started or follow show up here.</SpacesEmpty>
                        : kind === 'mine'
                            ? <SpacesEmpty icon={<MessageSquare />} title="No threads started by you">Threads whose first message you posted show up here.</SpacesEmpty>
                            : <SpacesEmpty icon={<MessageSquare />} title="No threads yet">Threads you start or reply to, in any space, show up here.</SpacesEmpty>)}
        </SpacesPage>
    )
}
