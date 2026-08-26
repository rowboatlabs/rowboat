import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Columns2, FileText, FolderOpen, Link as LinkIcon, Loader2, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AddOrgDialog, AvatarStack, MemberAvatar, OrgMonogram } from '@/components/spaces/atoms'
import { FileColumn, TrashDialog, UploadFilesDialog } from '@/components/spaces/files-tab'
import { GeneralStream } from '@/components/spaces/general-stream'
import { SelectionCopy } from '@/components/spaces/selection-copy'
import { SpaceRail } from '@/components/spaces/space-rail'
import { railKey, type RailSelection } from '@/lib/spaces-selection'
import { DraftThreadPane, ThreadPane } from '@/components/spaces/thread-pane'
import { useGeneral, useSpacePresence, useThreadIndex } from '@/hooks/use-space-chat'
import { useSpaceFeed, useSpaceLastReadAt, useSpaceLive, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { SpaceMembersProvider } from '@/components/spaces/member-text'
import { SpaceNavProvider, SpaceRefsProvider } from '@/components/spaces/space-markdown'
import { artifactsForThread, stripThreadMarker } from '@/lib/spaces-conventions'
import { isUnreadChange, resolveMentions } from '@/lib/spaces-presentation'
import { markRead, markTopicRead } from '@/lib/spaces-read-state'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import * as analytics from '@/lib/analytics'

export { AddOrgDialog, OrgMonogram } from '@/components/spaces/atoms'

// Spaces — one surface at a time ("One Surface" layout). A space opens in
// Talk (the stream); Read shows the document; Split shows both, and declines
// below SPLIT_FLOOR. One edge rail carries the same sidebar on every surface
// (topics with the files below them): it peeks briefly to teach, opens on
// hover by pushing the surface over, and can be pinned. Data stays the
// v0 contract; general/topic/artifact semantics come from the contract with
// legacy fallbacks in lib/spaces-conventions.ts.

/** Which space is open (org + space) — the app-level selection the sidebar drives. */
export type SpaceSelection = { orgId: string; spaceId: string } | null

/** Which surface(s) a space shows: the stream, the document, or both. */
type SpaceMode = 'talk' | 'read' | 'split'

/** Chat never squeezes below this in Split; the document takes the rest. */
const CHAT_FLOOR = 460

/**
 * Below this content width Split falls back to one surface (CHAT_FLOOR of
 * chat + ~466px of document + the 28px rail edge and divider). Kept low on
 * purpose — a non-maximized laptop window must still get Split; the doc-width
 * clamp handles the squeeze from here up.
 */
const SPLIT_FLOOR = 960

const MODES: { k: SpaceMode; label: string; Icon: typeof MessageSquare; kb: string }[] = [
    { k: 'talk', label: 'Talk', Icon: MessageSquare, kb: '⌘1' },
    { k: 'read', label: 'Read', Icon: FileText, kb: '⌘2' },
    { k: 'split', label: 'Split', Icon: Columns2, kb: '⌘3' },
]


// ---------------------------------------------------------------------------
// Root view: the selected space (the org/space list lives in the app sidebar)
// ---------------------------------------------------------------------------

export function SpacesView({ selection, onSelect, railSelection, onRailSelect, onOpenSession, active = true }: {
    selection: SpaceSelection
    onSelect: (selection: SpaceSelection) => void
    /** What's selected inside the space (general / a topic / a file) — part of the app's history. */
    railSelection: RailSelection
    onRailSelect: (selection: RailSelection) => void
    onOpenSession?: (sessionId: string) => void
    /**
     * False while the view is kept mounted but hidden (the app shows another
     * section). Gates presence and read marks — a hidden pane must not report
     * "viewing" or mark arriving messages read.
     */
    active?: boolean
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
                active={active}
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

function SpacePane({ org, space, selection, onSelect, onOpenSession, active = true }: {
    org: OrgWithSpaces
    space: spaces.Space
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    onOpenSession?: (sessionId: string) => void
    /** False while the Spaces view is kept mounted but hidden. */
    active?: boolean
}) {
    const [members, setMembers] = useState<spaces.Member[]>([])
    const [entries, setEntries] = useState<spaces.SpacesAssetEntry[]>([])
    // Local-only empty folders: folders are key prefixes, so an empty one has
    // nothing to store — it lives here until its first file lands (then the
    // real entries carry it and it's pruned), or until removed.
    const [draftFolders, setDraftFolders] = useState<string[]>([])
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

    // A draft folder is done the moment a real file lives under it.
    useEffect(() => {
        setDraftFolders((prev) => {
            const next = prev.filter((f) => !entries.some((e) => e.path.startsWith(`${f}/`)))
            return next.length === prev.length ? prev : next
        })
    }, [entries])
    const addFolder = (path: string) => {
        const cleaned = path.split('/').filter((s) => s && s !== '.' && s !== '..').join('/')
        if (!cleaned) return
        setDraftFolders((prev) =>
            prev.includes(cleaned) || entries.some((e) => e.path.startsWith(`${cleaned}/`)) ? prev : [...prev, cleaned])
    }
    const removeFolder = (path: string) =>
        setDraftFolders((prev) => prev.filter((f) => f !== path && !f.startsWith(`${path}/`)))

    useSpaceLive(org.id, space.id, (frame) => {
        // Coarse-grained on purpose: any durable event refreshes the open
        // panes — and so does a (re)subscribe, since events published while a
        // socket was dead may have no replay to arrive by.
        if (frame.kind !== 'event' && frame.kind !== 'subscribed') return
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
    const [mode, setMode] = useState<SpaceMode>(() => (selection.kind === 'file' ? 'read' : 'talk'))
    // The topics/files rail has two modes, persisted: PINNED (default) — a
    // plain sidebar, always open; or AUTO-HIDE — a collapsed edge that opens
    // on hover and lingers a few seconds after the cursor leaves, so moving
    // to the stream and back doesn't slam it shut mid-thought. (The first
    // design closed the instant the cursor left — too twitchy to use.)
    const [railPinned, setRailPinned] = useState(() => localStorage.getItem('spaces:railOpen') !== '0')
    const [railHover, setRailHover] = useState(false)
    const railCloseTimer = useRef<number | null>(null)

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

    // Stable listener; requestMode itself re-derives per render (splitFits).
    const requestModeRef = useRef<(next: SpaceMode) => void>(() => {})
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((!e.metaKey && !e.ctrlKey) || e.altKey || e.shiftKey) return
            if (e.key === '1') { e.preventDefault(); requestModeRef.current('talk') }
            else if (e.key === '2') { e.preventDefault(); requestModeRef.current('read') }
            else if (e.key === '3') { e.preventDefault(); requestModeRef.current('split') }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const splitFits = paneWidth >= SPLIT_FLOOR
    // What actually renders: a Split that doesn't fit falls back to the one
    // surface the selection needs.
    const effMode: SpaceMode = mode === 'split' && !splitFits ? (selection.kind === 'file' ? 'read' : 'talk') : mode
    const railOpen = railPinned || railHover

    /** The header buttons and ⌘1/2/3: say why when Split can't render. */
    const requestMode = (next: SpaceMode) => {
        if (next === 'split' && !splitFits) toast('Window is too narrow for Split — it will appear when you widen it')
        setMode(next)
    }
    requestModeRef.current = requestMode

    /** Auto-hide grace: how long the rail lingers after the cursor leaves. */
    const RAIL_LINGER_MS = 3_500
    const clearRailTimer = () => {
        if (railCloseTimer.current) {
            window.clearTimeout(railCloseTimer.current)
            railCloseTimer.current = null
        }
    }
    useEffect(() => clearRailTimer, [])
    const onRailHover = (hovering: boolean) => {
        clearRailTimer()
        if (hovering) setRailHover(true)
        else railCloseTimer.current = window.setTimeout(() => setRailHover(false), RAIL_LINGER_MS)
    }
    const toggleRailPin = () => {
        const pin = !railPinned
        localStorage.setItem('spaces:railOpen', pin ? '1' : '0')
        setRailPinned(pin)
        // Unpinning closes NOW (the cursor is on the button, inside the rail —
        // without this the hover hold keeps it open and the click reads as dead).
        if (!pin) {
            clearRailTimer()
            setRailHover(false)
        }
    }

    // Selecting is also choreography: a topic opened from Read grows into
    // Split; a file opened from Talk (or from a topic's artifact link) opens
    // beside the conversation in Split. The rail stays where it is — it is a
    // sidebar, not a flyout.
    const select = (next: RailSelection) => {
        onSelect(next)
        analytics.spacesTabViewed(next.kind === 'general' ? 'general' : next.kind === 'file' ? 'files' : 'topics')
        if ((next.kind === 'topic' || next.kind === 'draft') && mode === 'read') setMode('split')
        else if (next.kind === 'general' && mode === 'read') setMode('talk')
        else if (next.kind === 'file') {
            // A file opened while talking keeps the conversation beside it:
            // Split (effMode falls back to Read below the floor).
            if (next.fromTopicId || mode === 'talk') setMode('split')
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
        if (selection.kind === 'file' && mode === 'talk') setMode('split')
        else if (selection.kind !== 'file' && mode === 'read') setMode('talk')
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
            // Chat keeps its floor; rail edge + divider ≈ 34px.
            setDocWidth(Math.min(Math.max(next, 420), Math.max(420, pane - CHAT_FLOOR - 34)))
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

    // A persisted width from a wider window must not crush the chat side.
    const docWidthEff = Math.max(420, Math.min(docWidth, paneWidth - CHAT_FLOOR - 34))

    const here = presence.here.filter((id) => members.some((m) => m.id === id))
    // Roster for the members popover: whoever is here floats up, then A–Z.
    const hereSet = new Set(here)
    const roster = [...members].sort(
        (a, b) => Number(hereSet.has(b.id)) - Number(hereSet.has(a.id)) || a.displayName.localeCompare(b.displayName),
    )

    // The chat surface keeps its context while a file has focus: a topic
    // stays open beside the document it changed (fromTopicId), otherwise the
    // last chat selection sticks until the user picks another.
    const chatContextRef = useRef<string | null>(null)
    if (selection.kind === 'topic') chatContextRef.current = selection.topicId
    else if (selection.kind === 'general' || selection.kind === 'draft') chatContextRef.current = null
    else if (selection.kind === 'file' && selection.fromTopicId) chatContextRef.current = selection.fromTopicId
    const chatTopicId = chatContextRef.current

    // Draft thread: the reply pane before any topic exists. The parent lives
    // in the general stream; a stale draft (relaunch, deep link) falls back.
    const draftParent = selection.kind === 'draft'
        ? general.messages.find((m) => m.id === selection.parentMessageId) ?? null
        : null
    const draftMissing = selection.kind === 'draft' && general.ready && !draftParent
    useEffect(() => {
        if (draftMissing) onSelect({ kind: 'general' })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftMissing])

    const selectedTopic = chatTopicId ? feed.topics.find((t) => t.id === chatTopicId) : undefined
    const selectedInfo = chatTopicId ? threads.byTopic.get(chatTopicId) : undefined
    const selectedAnchor = selectedTopic?.anchorChangeSetId ? feed.changeSets.find((c) => c.id === selectedTopic.anchorChangeSetId) ?? null : null
    const selectedGroups = chatTopicId ? artifactsForThread(feed.changeSets, chatTopicId) : []
    const artifactsRailOpen = chatTopicId ? (railPins.get(chatTopicId) ?? selectedGroups.length > 0) : false
    const toggleArtifactsRail = () => {
        if (!chatTopicId) return
        setRailPins((prev) => new Map(prev).set(chatTopicId, !artifactsRailOpen))
    }

    // Split: dismissing the document closes it and returns to Talk, landing
    // on the conversation that was beside it.
    const dismissFile = () => {
        if (selection.kind === 'file') onSelect(chatTopicId ? { kind: 'topic', topicId: chatTopicId } : { kind: 'general' })
        setMode('talk')
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

    // Files picked (rail Upload button) or dropped on the tree, awaiting the
    // destination-folder dialog. Prefill the open file's folder when there is one.
    const [uploadFiles, setUploadFiles] = useState<File[] | null>(null)
    const [trashOpen, setTrashOpen] = useState(false)
    const uploadDefaultFolder = centerPath?.includes('/') ? centerPath.slice(0, centerPath.lastIndexOf('/')) : ''

    return (
        <SpaceMembersProvider members={memberNames}>
        <SpaceRefsProvider refs={{ orgId: org.id, orgAddress: org.address, spaceId: space.id }}>
        <SpaceNavProvider onOpenFile={openFile}>
        <div className="flex-1 min-h-0 flex flex-col">
            {/* One per pane — covers the stream and thread panes alike. */}
            {active && <SelectionCopy />}
            <header className="flex items-center gap-3 px-4 h-12 shrink-0 border-b border-border">
                <OrgMonogram org={org} />
                <h1 className="text-[15px] font-semibold truncate">{space.name}</h1>
                <span className="text-xs text-muted-foreground truncate hidden md:inline" title={`${org.address} · you are ${org.memberId}`}>
                    {org.address}
                </span>
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="group flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent/60 data-[state=open]:bg-accent/60"
                            title="See who's in this space"
                        >
                            <AvatarStack members={members} />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {members.length} {members.length === 1 ? 'member' : 'members'}
                            </span>
                            <ChevronDown className="-ml-1 size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-data-[state=open]:opacity-100" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-64 p-1.5">
                        <div className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Members — {members.length}
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                            {roster.map((m) => {
                                const isHere = hereSet.has(m.id)
                                return (
                                    <div key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                                        <span className="relative shrink-0">
                                            <MemberAvatar id={m.id} name={m.displayName} size="md" />
                                            {isHere && <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-popover" />}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm">
                                            {m.displayName}
                                            {m.id === org.memberId && <span className="text-muted-foreground"> (you)</span>}
                                        </span>
                                        {m.role === 'admin' && (
                                            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground">admin</span>
                                        )}
                                        {isHere && <span className="shrink-0 text-[10.5px] text-emerald-600">here</span>}
                                    </div>
                                )
                            })}
                        </div>
                        <div className="mt-1 border-t border-border pt-1">
                            <button
                                type="button"
                                onClick={() => void invite()}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <LinkIcon className="size-3.5" /> Copy invite link
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>
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
                            onClick={() => requestMode(k)}
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
                    draftFolders={draftFolders}
                    presence={presence}
                    unreadPaths={unreadPaths}
                    selection={selection}
                    onSelect={select}
                    onCreateFile={openFile}
                    onUploadFiles={setUploadFiles}
                    onOpenTrash={() => setTrashOpen(true)}
                    onAddFolder={addFolder}
                    onRemoveFolder={removeFolder}
                    open={railOpen}
                    pinned={railPinned}
                    onHoverChange={onRailHover}
                    onTogglePin={toggleRailPin}
                />
                {/* The surfaces. Talk = the stream or an open topic; Read =
                    the document; Split shows both around a draggable divider.
                    The stream is the expensive surface, so it never unmounts
                    while the space is open — a topic, a draft, or read mode
                    HIDE it (keep-alive), and closing them is instant. */}
                <div className={cn('flex-1 min-w-0 min-h-0', effMode === 'read' ? 'hidden' : 'flex')}>
                    {draftParent ? (
                        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
                            <DraftThreadPane
                                key={draftParent.id}
                                org={org}
                                space={space}
                                parent={draftParent}
                                members={members}
                                memberNames={memberNames}
                                entries={entries}
                                onBack={() => select({ kind: 'general' })}
                                onCreated={(topicId) => select({ kind: 'topic', topicId })}
                            />
                        </section>
                    ) : chatTopicId ? (
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
                                visible={active && effMode !== 'read'}
                            />
                        </section>
                    ) : null}
                    <div className={cn('flex-1 min-w-0 min-h-0', draftParent || chatTopicId ? 'hidden' : 'flex')}>
                        <GeneralStream
                            org={org}
                            space={space}
                            general={general}
                            threads={threads}
                            topics={feed.topics}
                            presence={presence}
                            members={members}
                            memberNames={memberNames}
                            entries={entries}
                            onOpenThread={(id) => select({ kind: 'topic', topicId: id })}
                            onStartThread={(m) => select({ kind: 'draft', parentMessageId: m.id })}
                            onOpenSession={onOpenSession}
                            visible={active && effMode !== 'read' && !draftParent && !chatTopicId}
                        />
                    </div>
                </div>
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
                        style={effMode === 'split' ? { width: docWidthEff } : undefined}
                        className={cn('min-w-0 min-h-0 flex', effMode === 'split' ? 'shrink-0' : 'flex-1 justify-center')}
                    >
                        <div className={cn('flex min-w-0 min-h-0 flex-1', effMode !== 'split' && 'mx-auto max-w-[880px]')}>
                            {centerPath ? (
                                <FileColumn
                                    key={centerPath}
                                    org={org}
                                    space={space}
                                    path={centerPath}
                                    entries={entries}
                                    memberNames={memberNames}
                                    refreshTick={refreshTick}
                                    onChanged={() => setRefreshTick((t) => t + 1)}
                                    onRenamed={openFile}
                                    onRedirect={openFile}
                                    onOpenFile={openFile}
                                    onDeleted={() => select({ kind: 'general' })}
                                    crumb={selection.kind === 'file' && crumbTopicId && crumbLabel ? {
                                        label: crumbLabel,
                                        // Back to the topic means back to the conversation: Talk.
                                        onBack: () => { select({ kind: 'topic', topicId: crumbTopicId }); setMode('talk') },
                                    } : null}
                                    onDismiss={effMode === 'split' ? dismissFile : null}
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
            {trashOpen && (
                <TrashDialog org={org} space={space} onClose={() => { setTrashOpen(false); setRefreshTick((t) => t + 1) }} />
            )}
            {uploadFiles && (
                <UploadFilesDialog
                    org={org}
                    space={space}
                    files={uploadFiles}
                    entries={entries}
                    defaultFolder={uploadDefaultFolder}
                    onClose={() => setUploadFiles(null)}
                    onDone={() => setRefreshTick((t) => t + 1)}
                />
            )}
        </div>
        </SpaceNavProvider>
        </SpaceRefsProvider>
        </SpaceMembersProvider>
    )
}
