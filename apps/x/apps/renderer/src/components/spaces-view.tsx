import { useEffect, useMemo, useState } from 'react'
import { Check, FolderOpen, Link as LinkIcon, Loader2, MoreHorizontal, Plus } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArtifactsRail } from '@/components/spaces/artifacts'
import { AddOrgDialog, AvatarStack, OrgMonogram } from '@/components/spaces/atoms'
import { FileColumn } from '@/components/spaces/files-tab'
import { GeneralStream } from '@/components/spaces/general-stream'
import { SpaceRail } from '@/components/spaces/space-rail'
import type { RailSelection } from '@/lib/spaces-selection'
import { ThreadPane } from '@/components/spaces/thread-pane'
import { useGeneral, useSpacePresence, useThreadIndex } from '@/hooks/use-space-chat'
import { useSpaceFeed, useSpaceLastReadAt, useSpaceLive, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { artifactsForThread, stripThreadMarker } from '@/lib/spaces-conventions'
import { isUnreadChange } from '@/lib/spaces-presentation'
import { maybeInvokeRowboat } from '@/lib/spaces-rowboat'
import { markRead, markTopicRead } from '@/lib/spaces-read-state'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'

export { AddOrgDialog, OrgMonogram } from '@/components/spaces/atoms'

// Spaces — chat-first (push-1 spike, see the daily-chat plan). Inside a space:
// a rail with General (the chat) on top, every topic below it (replying to a
// general message makes one), then the space's files; the main area shows
// whatever is selected. Data stays the v0 contract; the general/topic/artifact
// semantics are client conventions (lib/spaces-conventions.ts) until the
// contract PR names them.

/** Which space is open (org + space) — the app-level selection the sidebar drives. */
export type SpaceSelection = { orgId: string; spaceId: string } | null


// ---------------------------------------------------------------------------
// Root view: the selected space (the org/space list lives in the app sidebar)
// ---------------------------------------------------------------------------

export function SpacesView({ selection, onSelect, railSelection, onRailSelect, onOpenSession }: {
    selection: SpaceSelection
    onSelect: (selection: SpaceSelection) => void
    /** What's selected inside the space (general / a topic / a file) — part of the app's history. */
    railSelection: RailSelection
    onRailSelect: (selection: RailSelection) => void
    onOpenSession?: (sessionId: string) => void
}) {
    const { orgs, loading, refresh } = useSpacesOrgs()
    const [addOrgOpen, setAddOrgOpen] = useState(false)

    const selectedOrg = selection ? (orgs.find((o) => o.id === selection.orgId) ?? null) : null
    const selectedSpace = selection && selectedOrg ? (selectedOrg.spaces.find((s) => s.id === selection.spaceId) ?? null) : null

    // No (valid) selection: land on the first space there is.
    useEffect(() => {
        if (loading) return
        if (selectedOrg && selectedSpace) return
        const first = orgs.find((o) => o.spaces.length > 0)
        const space = first?.spaces[0]
        if (first && space) {
            if (!selection || selection.orgId !== first.id || selection.spaceId !== space.id) onSelect({ orgId: first.id, spaceId: space.id })
        } else if (selection) {
            onSelect(null)
        }
    }, [loading, orgs, selection, selectedOrg, selectedSpace, onSelect])

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
        )
    }

    if (selectedOrg && selectedSpace) {
        return (
            <SpacePane
                key={`${selectedOrg.id}/${selectedSpace.id}`}
                org={selectedOrg}
                space={selectedSpace}
                selection={railSelection}
                onSelect={onRailSelect}
                onOpenSession={onOpenSession}
            />
        )
    }

    return (
        <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-sm text-center">
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-muted">
                    <FolderOpen className="size-5 text-muted-foreground" />
                </div>
                {orgs.length === 0 ? (
                    <>
                        <h2 className="text-sm font-semibold">No spaces yet</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Spaces are where your team talks every day — and where the files you decide on live. Your agent and
                            your teammates&apos; agents work in them with you.
                        </p>
                        <Button size="sm" className="mt-4" onClick={() => setAddOrgOpen(true)}>
                            <Plus className="size-4 mr-1" /> Add an org
                        </Button>
                    </>
                ) : (
                    <>
                        <h2 className="text-sm font-semibold">No space to open</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {orgs.some((o) => o.error)
                                ? 'An org is unreachable — check it is running and you are signed in.'
                                : 'Create the first space from the org row in the sidebar.'}
                        </p>
                    </>
                )}
            </div>
            <AddOrgDialog open={addOrgOpen} onOpenChange={setAddOrgOpen} onAdded={() => void refresh()} />
        </div>
    )
}

// ---------------------------------------------------------------------------
// One space: header across the top, then the space rail | the selected thing
// ---------------------------------------------------------------------------

function SpacePane({ org, space, selection, onSelect, onOpenSession }: {
    org: OrgWithSpaces
    space: spaces.Space
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    onOpenSession?: (sessionId: string) => void
}) {
    const [members, setMembers] = useState<spaces.Member[]>([])
    const [entries, setEntries] = useState<spaces.SpacesAssetEntry[]>([])
    const [refreshTick, setRefreshTick] = useState(0)
    const [folding, setFolding] = useState(false)

    const feed = useSpaceFeed(org.id, space.id)
    const general = useGeneral(org.id, space.id)
    const threads = useThreadIndex(org.id, space.id)
    const presence = useSpacePresence(org.id, space.id, org.memberId)
    const lastReadAt = useSpaceLastReadAt(org.id, space.id)
    const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m.displayName])), [members])

    // The artifacts rail: open by default when a topic has artifacts, collapsed
    // when it has none; a per-topic pin remembers a manual toggle.
    const [railPins, setRailPins] = useState<ReadonlyMap<string, boolean>>(new Map())

    useEffect(() => {
        let cancelled = false
        void Promise.all([
            window.ipc.invoke('spaces:listMembers', { orgId: org.id, spaceId: space.id }),
            window.ipc.invoke('spaces:listAssets', { orgId: org.id, spaceId: space.id }),
        ])
            .then(([membersRes, assetsRes]) => {
                if (cancelled) return
                setMembers(membersRes.members)
                setEntries(assetsRes.entries)
            })
            .catch(() => {
                // org unreachable; panes show their own error states
            })
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, refreshTick])

    useSpaceLive(org.id, space.id, (frame) => {
        if (frame.kind !== 'event') return
        // Coarse-grained on purpose: any durable event refreshes the open panes.
        setRefreshTick((t) => t + 1)
    })

    const invite = async () => {
        try {
            const result = await window.ipc.invoke('spaces:createInvite', { orgId: org.id, spaceId: space.id })
            await navigator.clipboard.writeText(result.link)
            toast('Invite link copied to clipboard', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create an invite', 'error')
        }
    }

    const markAllRead = () => {
        markRead(org.id, space.id)
        if (general.topic) markTopicRead(org.id, space.id, general.topic.id)
        for (const t of feed.topics) markTopicRead(org.id, space.id, t.id)
    }

    const unreadPaths = useMemo(
        () => new Set(feed.changeSets.filter((c) => isUnreadChange(c, lastReadAt, org.memberId)).map((c) => c.assetPath)),
        [feed.changeSets, lastReadAt, org.memberId],
    )

    const select = (next: RailSelection) => {
        onSelect(next)
        analytics.spacesTabViewed(next.kind === 'general' ? 'general' : next.kind === 'topic' ? 'topics' : 'files')
    }
    const openFile = (path: string) => select({ kind: 'file', path })
    /** Open a file from inside a topic — the file view gets a crumb back to the topic. */
    const openFileFromTopic = (topicId: string) => (path: string) => select({ kind: 'file', path, fromTopicId: topicId })

    const here = presence.here.filter((id) => members.some((m) => m.id === id))
    const selectedTopicId = selection.kind === 'topic' ? selection.topicId : null
    const selectedTopic = selectedTopicId ? feed.topics.find((t) => t.id === selectedTopicId) : undefined
    const selectedInfo = selectedTopicId ? threads.byTopic.get(selectedTopicId) : undefined
    const selectedAnchor = selectedTopic?.anchorChangeSetId ? feed.changeSets.find((c) => c.id === selectedTopic.anchorChangeSetId) ?? null : null
    const selectedGroups = selectedTopicId ? artifactsForThread(feed.changeSets, selectedTopicId) : []
    const artifactsRailOpen = selectedTopicId ? (railPins.get(selectedTopicId) ?? selectedGroups.length > 0) : false
    const toggleArtifactsRail = () => {
        if (!selectedTopicId) return
        setRailPins((prev) => new Map(prev).set(selectedTopicId, !artifactsRailOpen))
    }

    // Crumb for a file opened from a topic.
    const crumbTopicId = selection.kind === 'file' ? selection.fromTopicId ?? null : null
    const crumbTopic = crumbTopicId ? feed.topics.find((t) => t.id === crumbTopicId) : undefined
    const crumbInfo = crumbTopicId ? threads.byTopic.get(crumbTopicId) : undefined
    const crumbLabel = crumbTopic
        ? crumbInfo?.marker && crumbInfo.firstMessage
            ? stripThreadMarker(crumbInfo.firstMessage.body).split('\n')[0] ?? crumbTopic.title
            : crumbTopic.title
        : crumbTopicId ? 'Back to topic' : null

    const fold = async (path: string) => {
        if (!selectedTopicId) return
        setFolding(true)
        try {
            const body = `@rowboat fold this topic’s decision into \`${path}\` — keep the file’s structure and put it under the right section. End your change reason with “· topic:${selectedTopicId}”.`
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, topicId: selectedTopicId, body })
            analytics.spacesFoldRequested()
            maybeInvokeRowboat(org, space, result.topic, result.message.id, body)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not ask Rowboat', 'error')
        } finally {
            setFolding(false)
        }
    }

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <header className="flex items-center gap-3 px-4 h-12 shrink-0 border-b border-border">
                <OrgMonogram org={org} />
                <h1 className="text-[15px] font-semibold truncate">{space.name}</h1>
                <span className="text-xs text-muted-foreground truncate hidden md:inline" title={`${org.address} · you are ${org.memberId}`}>
                    {org.address}
                </span>
                <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent/60"
                    title={`${members.map((m) => m.displayName).join(', ')}\nClick to copy an invite link`}
                    onClick={() => void invite()}
                >
                    <AvatarStack members={members} />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {members.length} {members.length === 1 ? 'member' : 'members'}
                    </span>
                </button>
                {here.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={here.map((id) => memberNames.get(id) ?? id).join(', ')}>
                        <span className="size-1.5 rounded-full bg-emerald-500" /> {here.length} here
                    </span>
                )}
                <div className="flex-1" />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void invite()}>
                            <LinkIcon className="size-3.5 mr-2" /> Copy invite link
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={markAllRead}>
                            <Check className="size-3.5 mr-2" /> Mark all read
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>

            <div className="flex-1 min-h-0 flex">
                <SpaceRail
                    orgId={org.id}
                    spaceId={space.id}
                    selfMemberId={org.memberId}
                    general={general}
                    topics={feed.topics}
                    threads={threads}
                    changeSets={feed.changeSets}
                    entries={entries}
                    presence={presence}
                    unreadPaths={unreadPaths}
                    selection={selection}
                    onSelect={select}
                    onCreateFile={openFile}
                />
                <div className="flex-1 min-w-0 min-h-0 flex">
                    {selection.kind === 'general' && (
                        <GeneralStream
                            org={org}
                            space={space}
                            general={general}
                            threads={threads}
                            topics={feed.topics}
                            presence={presence}
                            memberNames={memberNames}
                            onOpenThread={(id) => select({ kind: 'topic', topicId: id })}
                        />
                    )}
                    {selection.kind === 'topic' && (
                        <>
                            <section className="flex-1 min-w-0 min-h-0 flex flex-col">
                                <ThreadPane
                                    key={selection.topicId}
                                    org={org}
                                    space={space}
                                    topicId={selection.topicId}
                                    threadInfo={selectedInfo}
                                    topic={selectedTopic}
                                    changeSets={feed.changeSets}
                                    entries={entries}
                                    presence={presence}
                                    memberNames={memberNames}
                                    refreshTick={refreshTick}
                                    anchorChange={selectedAnchor}
                                    showBack={false}
                                    onBack={() => select({ kind: 'general' })}
                                    onOpenFile={openFileFromTopic(selection.topicId)}
                                    onOpenSession={onOpenSession}
                                    artifactsRailOpen={artifactsRailOpen}
                                    onToggleArtifactsRail={toggleArtifactsRail}
                                    onFolding={setFolding}
                                />
                            </section>
                            {artifactsRailOpen && (
                                <ArtifactsRail
                                    org={org}
                                    space={space}
                                    groups={selectedGroups}
                                    memberNames={memberNames}
                                    working={(presence.working.get(selection.topicId) ?? []).length > 0}
                                    entries={entries}
                                    onFold={(path) => void fold(path)}
                                    folding={folding}
                                    onOpenFile={openFileFromTopic(selection.topicId)}
                                    onCollapse={toggleArtifactsRail}
                                />
                            )}
                        </>
                    )}
                    {selection.kind === 'file' && (
                        <FileColumn
                            key={selection.path}
                            org={org}
                            space={space}
                            path={selection.path}
                            memberNames={memberNames}
                            refreshTick={refreshTick}
                            onChanged={() => setRefreshTick((t) => t + 1)}
                            crumb={crumbTopicId && crumbLabel ? { label: crumbLabel, onBack: () => select({ kind: 'topic', topicId: crumbTopicId }) } : null}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
