import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Columns2, FileText, FolderOpen, Link as LinkIcon, Loader2, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AddOrgDialog, AvatarStack, OrgMonogram } from '@/components/spaces/atoms'
import { FileColumn } from '@/components/spaces/files-tab'
import { GeneralStream } from '@/components/spaces/general-stream'
import { SpaceRail, type RailList } from '@/components/spaces/space-rail'
import { railKey, type RailSelection } from '@/lib/spaces-selection'
import { ThreadPane } from '@/components/spaces/thread-pane'
import { useGeneral, useSpacePresence, useThreadIndex } from '@/hooks/use-space-chat'
import { useSpaceFeed, useSpaceLastReadAt, useSpaceLive, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { SpaceMembersProvider } from '@/components/spaces/member-text'
import { artifactsForThread, stripThreadMarker } from '@/lib/spaces-conventions'
import { isUnreadChange, resolveMentions } from '@/lib/spaces-presentation'
import { markRead, markTopicRead } from '@/lib/spaces-read-state'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import * as analytics from '@/lib/analytics'

export { AddOrgDialog, OrgMonogram } from '@/components/spaces/atoms'

// Spaces — one surface at a time ("One Surface" layout). A space opens in
// Talk (the stream); Read shows the document; Split shows both, and declines
// below SPLIT_FLOOR. One edge rail carries the list the rendered surface
// needs (topics / files / tabbed in Split): it peeks briefly to teach, opens
// on hover by pushing the surface over, and pins per surface. Data stays the
// v0 contract; general/topic/artifact semantics come from the contract with
// legacy fallbacks in lib/spaces-conventions.ts.

/** Which space is open (org + space) — the app-level selection the sidebar drives. */
export type SpaceSelection = { orgId: string; spaceId: string } | null

/** Which surface(s) a space shows: the stream, the document, or both. */
type SpaceMode = 'talk' | 'read' | 'split'

/** Split needs 600px of document + 480px of chat + the 28px rail edge. */
const SPLIT_FLOOR = 1108

const MODES: { k: SpaceMode; label: string; Icon: typeof MessageSquare; kb: string }[] = [
    { k: 'talk', label: 'Talk', Icon: MessageSquare, kb: '⌘1' },
    { k: 'read', label: 'Read', Icon: FileText, kb: '⌘2' },
    { k: 'split', label: 'Split', Icon: Columns2, kb: '⌘3' },
]


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
    const [, setFolding] = useState(false)

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

    // ------------------------------------------------------------------
    // Mode: which surface(s) are on screen. Talk = the stream (default),
    // Read = the document, Split = both. Split declines below SPLIT_FLOOR
    // (600px document + 480px chat + the 28px rail edge).
    // ------------------------------------------------------------------
    const [mode, setModeRaw] = useState<SpaceMode>(() => (selection.kind === 'file' ? 'read' : 'talk'))
    const [splitList, setSplitList] = useState<RailList>('topics')
    const [railHover, setRailHover] = useState(false)
    const [railPeek, setRailPeek] = useState(false)
    const peekTimer = useRef<number | null>(null)
    const seenRead = useRef(selection.kind === 'file')
    const [pins, setPins] = useState(() => ({
        talk: localStorage.getItem('spaces:railPin:talk') === '1',
        read: localStorage.getItem('spaces:railPin:read') === '1',
    }))

    // Width of the pane drives the Split floor and pinnability.
    const paneRef = useRef<HTMLDivElement | null>(null)
    const [paneWidth, setPaneWidth] = useState(() => window.innerWidth)
    useEffect(() => {
        const el = paneRef.current
        if (!el) return
        const ro = new ResizeObserver(() => setPaneWidth(el.clientWidth))
        ro.observe(el)
        setPaneWidth(el.clientWidth)
        return () => ro.disconnect()
    }, [])

    // The teach-peek: push the rail open, hold a beat, release — the same
    // motion the cursor makes at the edge. Once the user has hovered or
    // pinned that list themselves, it has done its job and stays quiet.
    const peekRail = useCallback((list: RailList) => {
        if (localStorage.getItem(`spaces:railTaught:${list}`) === '1') return
        if (peekTimer.current) window.clearTimeout(peekTimer.current)
        setRailPeek(true)
        peekTimer.current = window.setTimeout(() => setRailPeek(false), 1900)
    }, [])
    useEffect(() => () => {
        if (peekTimer.current) window.clearTimeout(peekTimer.current)
    }, [])
    useEffect(() => {
        peekRail(seenRead.current ? 'files' : 'topics')
        // Landing peek only — once per space open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const setMode = useCallback((next: SpaceMode) => {
        setModeRaw(next)
        if (next === 'read' && !seenRead.current) {
            seenRead.current = true
            peekRail('files')
        }
    }, [peekRail])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((!e.metaKey && !e.ctrlKey) || e.altKey || e.shiftKey) return
            if (e.key === '1') { e.preventDefault(); setMode('talk') }
            else if (e.key === '2') { e.preventDefault(); setMode('read') }
            else if (e.key === '3') { e.preventDefault(); setMode('split') }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [setMode])

    const splitFits = paneWidth >= SPLIT_FLOOR
    // What actually renders: a Split that doesn't fit falls back to the one
    // surface the selection needs. The rail follows the rendered surface.
    const effMode: SpaceMode = mode === 'split' && !splitFits ? (selection.kind === 'file' ? 'read' : 'talk') : mode
    const railList: RailList = effMode === 'split' ? splitList : effMode === 'read' ? 'files' : 'topics'
    const railPinned = (mode === 'read' ? pins.read : pins.talk) && splitFits
    const railOpen = railPeek || railHover || railPinned

    const onRailHover = (hovering: boolean) => {
        setRailHover(hovering)
        if (hovering) localStorage.setItem(`spaces:railTaught:${railList}`, '1')
    }
    const toggleRailPin = () => {
        localStorage.setItem(`spaces:railTaught:${railList}`, '1')
        setPins((p) => {
            const key = mode === 'read' ? 'read' : 'talk'
            const next = { ...p, [key]: !p[key] }
            localStorage.setItem(`spaces:railPin:${key}`, next[key] ? '1' : '0')
            return next
        })
    }

    // Selecting is also choreography: a topic opened from Read grows into
    // Split; a file opened from Talk switches to Read; a file opened from a
    // topic (an artifact link) opens beside the thread. The rail slides away
    // once it has been used.
    const select = (next: RailSelection) => {
        onSelect(next)
        analytics.spacesTabViewed(next.kind === 'general' ? 'general' : next.kind === 'topic' ? 'topics' : 'files')
        setRailHover(false)
        setRailPeek(false)
        if (next.kind === 'topic' && mode === 'read') setMode('split')
        else if (next.kind === 'general' && mode === 'read') setMode('talk')
        else if (next.kind === 'file') {
            if (next.fromTopicId) { setMode('split'); setSplitList('files') }
            else if (mode === 'talk') setMode('read')
        }
    }
    const openFile = (path: string) => select({ kind: 'file', path })

    // Selection can also change under us (history ‹ ›, deep links). Only
    // reconcile when the current mode cannot show what arrived.
    const selKey = railKey(selection)
    const prevSelKey = useRef(selKey)
    useEffect(() => {
        if (prevSelKey.current === selKey) return
        prevSelKey.current = selKey
        if (selection.kind === 'file' && mode === 'talk') setModeRaw('read')
        else if (selection.kind !== 'file' && mode === 'read') setModeRaw('talk')
    }, [selKey, selection.kind, mode])

    // The document pane: an explicitly opened file, else the space's front
    // page (README.md), else the first file there is.
    const defaultDocPath = entries.some((e) => e.path === 'README.md') ? 'README.md' : (entries[0]?.path ?? null)
    const centerPath = selection.kind === 'file' ? selection.path : defaultDocPath

    // Resizable Split divider: drag it; the document width persists.
    const [docWidth, setDocWidth] = useState<number>(() => {
        const stored = Number(localStorage.getItem('spaces:docWidth'))
        return Number.isFinite(stored) && stored >= 480 ? stored : 600
    })
    const [resizingDoc, setResizingDoc] = useState(false)
    const dragStart = useRef<{ x: number; width: number } | null>(null)
    const startDocResize = (e: React.MouseEvent) => {
        e.preventDefault()
        dragStart.current = { x: e.clientX, width: docWidth }
        setResizingDoc(true)
        const onMove = (ev: MouseEvent) => {
            if (!dragStart.current) return
            // Doc sits on the right: dragging the divider left grows it.
            const next = dragStart.current.width + (dragStart.current.x - ev.clientX)
            const pane = paneRef.current?.clientWidth ?? window.innerWidth
            // Keep the chat side at its 480px floor (rail edge + divider ≈ 40px).
            setDocWidth(Math.min(Math.max(next, 480), Math.max(480, pane - 520)))
        }
        const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            dragStart.current = null
            setResizingDoc(false)
            setDocWidth((w) => {
                localStorage.setItem('spaces:docWidth', String(w))
                return w
            })
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }
    /** Open a file from inside a topic — the file view gets a crumb back to the topic. */
    const openFileFromTopic = (topicId: string) => (path: string) => select({ kind: 'file', path, fromTopicId: topicId })

    const here = presence.here.filter((id) => members.some((m) => m.id === id))

    // The chat surface keeps its context while a file has focus: a topic
    // stays open beside the document it changed (fromTopicId), otherwise the
    // last chat selection sticks until the user picks another.
    const chatContextRef = useRef<string | null>(null)
    if (selection.kind === 'topic') chatContextRef.current = selection.topicId
    else if (selection.kind === 'general') chatContextRef.current = null
    else if (selection.fromTopicId) chatContextRef.current = selection.fromTopicId
    const chatTopicId = chatContextRef.current

    const selectedTopic = chatTopicId ? feed.topics.find((t) => t.id === chatTopicId) : undefined
    const selectedInfo = chatTopicId ? threads.byTopic.get(chatTopicId) : undefined
    const selectedAnchor = selectedTopic?.anchorChangeSetId ? feed.changeSets.find((c) => c.id === selectedTopic.anchorChangeSetId) ?? null : null
    const selectedGroups = chatTopicId ? artifactsForThread(feed.changeSets, chatTopicId) : []
    const artifactsRailOpen = chatTopicId ? (railPins.get(chatTopicId) ?? selectedGroups.length > 0) : false
    const toggleArtifactsRail = () => {
        if (!chatTopicId) return
        setRailPins((prev) => new Map(prev).set(chatTopicId, !artifactsRailOpen))
    }

    // Crumb for a file opened from a topic.
    const crumbTopicId = selection.kind === 'file' ? selection.fromTopicId ?? null : null
    const crumbTopic = crumbTopicId ? feed.topics.find((t) => t.id === crumbTopicId) : undefined
    const crumbInfo = crumbTopicId ? threads.byTopic.get(crumbTopicId) : undefined
    const crumbLabelRaw = crumbTopic
        ? crumbInfo?.parentMessageId && crumbInfo.firstMessage
            ? stripThreadMarker(crumbInfo.firstMessage.body).split('\n')[0] ?? crumbTopic.title
            : crumbTopic.title
        : crumbTopicId ? 'Back to topic' : null
    const crumbLabel = crumbLabelRaw === null ? null : resolveMentions(crumbLabelRaw, memberNames)


    return (
        <SpaceMembersProvider members={memberNames}>
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
                <div className="inline-flex items-center rounded-md bg-muted p-0.5">
                    {MODES.map(({ k, label, Icon, kb }) => (
                        <button
                            key={k}
                            type="button"
                            title={`${label} ${kb}`}
                            onClick={() => setMode(k)}
                            className={cn(
                                'inline-flex h-6 items-center gap-1.5 rounded px-2 text-xs',
                                mode === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <Icon className="size-3.5" />
                            <span className="hidden lg:inline">{label}</span>
                        </button>
                    ))}
                </div>
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

            <div ref={paneRef} className="flex-1 min-h-0 flex">
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
                    list={railList}
                    tabbed={effMode === 'split'}
                    onPickList={setSplitList}
                    open={railOpen}
                    pinned={railPinned}
                    canPin={splitFits}
                    hint={railPinned ? 'pinned' : railPeek ? 'sliding away' : 'hover · pin to keep'}
                    onHoverChange={onRailHover}
                    onTogglePin={toggleRailPin}
                />
                {/* The surfaces. Talk = the stream or an open topic; Read =
                    the document; Split shows both around a draggable divider. */}
                {effMode !== 'read' && (
                    <div className="flex-1 min-w-0 min-h-0 flex">
                        {chatTopicId ? (
                            <section className="flex-1 min-w-0 min-h-0 flex flex-col">
                                <ThreadPane
                                    key={chatTopicId}
                                    org={org}
                                    space={space}
                                    topicId={chatTopicId}
                                    threadInfo={selectedInfo}
                                    topic={selectedTopic}
                                    changeSets={feed.changeSets}
                                    entries={entries}
                                    presence={presence}
                                    members={members}
                                    memberNames={memberNames}
                                    refreshTick={refreshTick}
                                    anchorChange={selectedAnchor}
                                    showBack
                                    onBack={() => select({ kind: 'general' })}
                                    onOpenFile={openFileFromTopic(chatTopicId)}
                                    onOpenSession={onOpenSession}
                                    artifactsRailOpen={artifactsRailOpen}
                                    onToggleArtifactsRail={toggleArtifactsRail}
                                    onFolding={setFolding}
                                />
                            </section>
                        ) : (
                            <GeneralStream
                                org={org}
                                space={space}
                                general={general}
                                threads={threads}
                                topics={feed.topics}
                                presence={presence}
                                members={members}
                                memberNames={memberNames}
                                onOpenThread={(id) => select({ kind: 'topic', topicId: id })}
                                onOpenSession={onOpenSession}
                            />
                        )}
                    </div>
                )}
                {effMode === 'split' && (
                    <div
                        onMouseDown={startDocResize}
                        className={cn(
                            'relative z-10 w-1.5 shrink-0 cursor-col-resize border-l border-border transition-colors hover:bg-primary/20',
                            resizingDoc && 'bg-primary/30',
                        )}
                    />
                )}
                {effMode !== 'talk' && (
                    <aside
                        style={effMode === 'split' ? { width: docWidth } : undefined}
                        className={cn('min-w-0 min-h-0 flex', effMode === 'split' ? 'shrink-0' : 'flex-1 justify-center')}
                    >
                        <div className={cn('flex min-w-0 min-h-0 flex-1', effMode !== 'split' && 'mx-auto max-w-[880px]')}>
                            {centerPath ? (
                                <FileColumn
                                    key={centerPath}
                                    org={org}
                                    space={space}
                                    path={centerPath}
                                    memberNames={memberNames}
                                    refreshTick={refreshTick}
                                    onChanged={() => setRefreshTick((t) => t + 1)}
                                    crumb={selection.kind === 'file' && crumbTopicId && crumbLabel ? {
                                        label: crumbLabel,
                                        // Back to the topic means back to the conversation: Talk.
                                        onBack: () => { select({ kind: 'topic', topicId: crumbTopicId }); setModeRaw('talk') },
                                    } : null}
                                />
                            ) : (
                                <div className="flex-1 flex items-center justify-center p-8 text-center">
                                    <div className="max-w-xs text-sm text-muted-foreground">
                                        <p>No files yet. Files are the space&apos;s record — what the team agrees on lives here.</p>
                                        <Button size="sm" className="mt-3" onClick={() => openFile('README.md')}>Create README.md</Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </aside>
                )}
            </div>
        </div>
        </SpaceMembersProvider>
    )
}
