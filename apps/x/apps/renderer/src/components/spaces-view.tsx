import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Columns2, FileText, FolderOpen, Link as LinkIcon, Loader2, MessageSquare, MoreHorizontal, PenTool, Plus } from 'lucide-react'
import { spaces } from '@x/shared'
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
import { ThreadPane } from '@/components/spaces/thread-pane'
import { STREAM_READ_KEY, useSpacePresence, useStream } from '@/hooks/use-space-chat'
import { useSpaceFeed, useSpaceLastReadAt, useSpaceLive, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { SpaceMembersProvider } from '@/components/spaces/member-text'
import { SpaceNavProvider, SpaceRefsProvider } from '@/components/spaces/space-markdown'
import { artifactsForThread, threadLabelOf } from '@/lib/spaces-conventions'
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

// The whiteboard is heavy (the Excalidraw editor); it loads as its own chunk
// the first time a board opens, never inflating the main renderer bundle.
const WhiteboardPane = lazy(() => import('@/components/spaces/whiteboard-pane'))


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
    const stream = useStream(org.id, space.id)
    const presence = useSpacePresence(org.id, space.id, org.memberId)
    const lastReadAt = useSpaceLastReadAt(org.id, space.id)
    const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m.displayName])), [members])

    // The artifacts rail: open by default when a thread has artifacts, collapsed
    // when it has none; a per-thread pin remembers a manual toggle.
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
        markTopicRead(org.id, space.id, STREAM_READ_KEY)
        for (const t of feed.topics) markTopicRead(org.id, space.id, t.rootMessageId)
        for (const m of stream.messages) {
            if (!m.pending && !m.failed && (m.replyCount ?? 0) > 0) markTopicRead(org.id, space.id, m.id)
        }
    }

    const unreadPaths = useMemo(
        // Boards are excluded: their saves are throttled snapshots, not reading
        // material — the boards rail is their surface, not the files tree.
        () => new Set(feed.changeSets.filter((c) => isUnreadChange(c, lastReadAt, org.memberId) && !spaces.isWhiteboardPath(c.assetPath)).map((c) => c.assetPath)),
        [feed.changeSets, lastReadAt, org.memberId],
    )

    // ------------------------------------------------------------------
    // Mode: which surface(s) are on screen. Talk = the stream (default),
    // Read = the document, Split = both. Split declines below SPLIT_FLOOR
    // (600px document + 480px chat + the 28px rail edge).
    // ------------------------------------------------------------------
    const [mode, setMode] = useState<SpaceMode>(() => (selection.kind === 'file' ? 'read' : 'talk'))
    // The discussions/files rail is a plain sticky sidebar (persisted):
    // open by default, collapsed to a slim edge strip on demand. No hover
    // behavior — the strip reopens on click only. (Two earlier designs
    // auto-opened on hover; both read as random. The shell sidebar contracts
    // to the dock while in Spaces, so this rail is THE sidebar here.)
    const [railPinned, setRailPinned] = useState(() => localStorage.getItem('spaces:railOpen') !== '0')

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
    const toggleWhiteboardRef = useRef<() => void>(() => {})
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((!e.metaKey && !e.ctrlKey) || e.altKey || e.shiftKey) return
            if (e.key === '1') { e.preventDefault(); requestModeRef.current('talk') }
            else if (e.key === '2') { e.preventDefault(); requestModeRef.current('read') }
            else if (e.key === '3') { e.preventDefault(); requestModeRef.current('split') }
            else if (e.key === '4') { e.preventDefault(); toggleWhiteboardRef.current() }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const splitFits = paneWidth >= SPLIT_FLOOR
    // What actually renders: a Split that doesn't fit falls back to the one
    // surface the selection needs.
    const effMode: SpaceMode = mode === 'split' && !splitFits ? (selection.kind === 'file' ? 'read' : 'talk') : mode
    const railOpen = railPinned

    /** The header buttons and ⌘1/2/3: say why when Split can't render. */
    const requestMode = (next: SpaceMode) => {
        if (next === 'split' && !splitFits) toast('Window is too narrow for Split — it will appear when you widen it')
        // Talk/Read while a board is open leave the board; Split KEEPS it —
        // the board docks where the document goes, chat alongside.
        if (next !== 'split' && (selection.kind === 'whiteboard' || (selection.kind === 'file' && spaces.isWhiteboardPath(selection.path)))) {
            onSelect({ kind: 'general' })
        }
        setMode(next)
    }
    requestModeRef.current = requestMode

    // ------------------------------------------------------------------
    // Whiteboard: a full-bleed surface of its own. The header button (and
    // ⌘4) opens the space's most recent board — created on its first save
    // when none exists yet; the rail lists and creates named boards.
    // ------------------------------------------------------------------
    // A board reached through any file-shaped path (artifact link, deep link,
    // history) is still a board — it must never render as raw JSON in the
    // document pane.
    const boardPath = selection.kind === 'whiteboard' ? selection.path
        : selection.kind === 'file' && spaces.isWhiteboardPath(selection.path) ? selection.path
        : null
    const isWhiteboard = boardPath !== null
    // Split with a board = chat + live board around the divider (the board
    // takes the document slot); any other mode shows the board full-bleed.
    // Narrow windows fall back through effMode to full-bleed automatically.
    const boardSplit = isWhiteboard && effMode === 'split'
    const boardFull = isWhiteboard && !boardSplit
    const boards = entries.filter((e) => spaces.isWhiteboardPath(e.path) && !e.state)
    const toggleWhiteboard = () => {
        if (isWhiteboard) {
            onSelect({ kind: 'general' })
        } else {
            const recent = [...boards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
            onSelect({ kind: 'whiteboard', path: recent?.path ?? spaces.DEFAULT_WHITEBOARD_PATH })
            analytics.spacesTabViewed('whiteboard')
        }
    }
    toggleWhiteboardRef.current = toggleWhiteboard
    /**
     * The rail's "+": an explicitly named board exists from the moment it is
     * created — an empty snapshot files the asset right away, so the rail
     * lists it (highlighted) before the first stroke and an untouched board
     * still survives navigating away. A taken name just opens that board.
     */
    const createBoard = (path: string) => {
        select({ kind: 'whiteboard', path })
        if (entries.some((e) => e.path === path && !e.state)) return
        void window.ipc.invoke('spaces:proposeChange', {
            orgId: org.id,
            spaceId: space.id,
            input: { assetPath: path, baseVersion: 0, newContent: spaces.EMPTY_WHITEBOARD_CONTENT, reason: 'new whiteboard' },
        }).catch(() => {}) // org unreachable — the pane's own first save creates it instead
    }

    /** Auto-hide grace: how long the rail lingers after the cursor leaves. */
    const toggleRailPin = () => {
        const pin = !railPinned
        localStorage.setItem('spaces:railOpen', pin ? '1' : '0')
        setRailPinned(pin)
    }

    // Selecting is also choreography: a topic opened from Read grows into
    // Split; a file opened from Talk (or from a topic's artifact link) opens
    // beside the conversation in Split. The rail stays where it is — it is a
    // sidebar, not a flyout.
    const select = (next: RailSelection) => {
        onSelect(next)
        analytics.spacesTabViewed(next.kind === 'general' ? 'general' : next.kind === 'file' ? 'files' : next.kind === 'whiteboard' ? 'whiteboard' : 'topics')
        if (next.kind === 'whiteboard') return // full-bleed surface; mode is untouched and resumes on the way back
        if (next.kind === 'thread' && mode === 'read') setMode('split')
        else if (next.kind === 'general' && mode === 'read') setMode('talk')
        else if (next.kind === 'file') {
            // A file opened while talking keeps the conversation beside it:
            // Split (effMode falls back to Read below the floor).
            if (next.fromThreadRootId || mode === 'talk') setMode('split')
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

    // The last dismissed file — Read/Split and the header chip reopen it.
    const [lastDoc, setLastDoc] = useState<{ path: string; fromThreadRootId?: string } | null>(null)

    // The document pane: an explicitly opened file, else the one that was
    // just dismissed, else the space's front page (README.md), else the
    // first file there is. Boards never qualify — their JSON is not a
    // document, and they have their own surface.
    const docEntries = entries.filter((e) => !spaces.isWhiteboardPath(e.path))
    const defaultDocPath = docEntries.some((e) => e.path === 'README.md') ? 'README.md' : (docEntries[0]?.path ?? null)
    const centerPath = selection.kind === 'file' && !spaces.isWhiteboardPath(selection.path) ? selection.path : (lastDoc?.path ?? defaultDocPath)

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
    /** Open a file from inside a thread — the file view gets a crumb back to it. */
    const openFileFromThread = (rootMessageId: string) => (path: string) => select({ kind: 'file', path, fromThreadRootId: rootMessageId })

    // A persisted width from a wider window must not crush the chat side.
    const docWidthEff = Math.max(420, Math.min(docWidth, paneWidth - CHAT_FLOOR - 34))

    const here = presence.here.filter((id) => members.some((m) => m.id === id))
    // Roster for the members popover: whoever is here floats up, then A–Z.
    const hereSet = new Set(here)
    const roster = [...members].sort(
        (a, b) => Number(hereSet.has(b.id)) - Number(hereSet.has(a.id)) || a.displayName.localeCompare(b.displayName),
    )

    // The chat surface keeps its context while a file has focus: a thread
    // stays open beside the document it changed (fromThreadRootId), otherwise
    // the last chat selection sticks until the user picks another.
    const chatContextRef = useRef<string | null>(null)
    if (selection.kind === 'thread') chatContextRef.current = selection.rootMessageId
    else if (selection.kind === 'general') chatContextRef.current = null
    else if (selection.kind === 'file' && selection.fromThreadRootId) chatContextRef.current = selection.fromThreadRootId
    const chatRootId = chatContextRef.current

    const selectedTopic = chatRootId ? feed.topics.find((t) => t.rootMessageId === chatRootId) : undefined
    const selectedGroups = chatRootId ? artifactsForThread(feed.changeSets, chatRootId) : []
    const artifactsRailOpen = chatRootId ? (railPins.get(chatRootId) ?? selectedGroups.length > 0) : false
    const toggleArtifactsRail = () => {
        if (!chatRootId) return
        setRailPins((prev) => new Map(prev).set(chatRootId, !artifactsRailOpen))
    }

    // Split: dismissing the document closes it and returns to Talk, landing
    // on the conversation that was beside it. The dismissed file is remembered
    // (lastDoc) so it can be reopened — from the header chip, or by
    // re-entering Read/Split (which prefer it over the README default).
    const dismissFile = () => {
        if (selection.kind === 'file') {
            setLastDoc({ path: selection.path, fromThreadRootId: selection.fromThreadRootId })
            onSelect(chatRootId ? { kind: 'thread', rootMessageId: chatRootId } : { kind: 'general' })
        }
        setMode('talk')
    }
    const reopenDoc = () => {
        if (lastDoc) select({ kind: 'file', path: lastDoc.path, fromThreadRootId: lastDoc.fromThreadRootId })
    }

    // Crumb for a file opened from a thread: the discussion's goal, else the
    // root's first line, else a generic label.
    const crumbRootId = selection.kind === 'file' ? selection.fromThreadRootId ?? null : null
    const crumbTopic = crumbRootId ? feed.topics.find((t) => t.rootMessageId === crumbRootId) : undefined
    const crumbRoot = crumbRootId ? stream.messages.find((m) => m.id === crumbRootId) : undefined
    const crumbLabelRaw = crumbTopic?.title ?? (crumbRoot ? threadLabelOf(crumbRoot.body) : crumbRootId ? 'Back to thread' : null)
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
                        <div className="px-2 pb-1 pt-0.5 text-[13px] text-muted-foreground">
                            Members — {members.length}
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                            {roster.map((m) => {
                                const isHere = hereSet.has(m.id)
                                return (
                                    <div key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                                        <span className="relative shrink-0">
                                            <MemberAvatar id={m.id} name={m.displayName} size="md" />
                                            {isHere && <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-[var(--rowboat-success)] ring-2 ring-popover" />}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm">
                                            {m.displayName}
                                            {m.id === org.memberId && <span className="text-muted-foreground"> (you)</span>}
                                        </span>
                                        {m.role === 'admin' && (
                                            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">admin</span>
                                        )}
                                        {isHere && <span className="shrink-0 text-[10.5px] text-[var(--rowboat-success)]">here</span>}
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
                        <span className="size-1.5 rounded-full bg-[var(--rowboat-success)]" /> {here.length} here
                    </span>
                )}
                <div className="flex-1" />
                {effMode === 'talk' && !isWhiteboard && selection.kind !== 'file' && lastDoc && entries.some((e) => e.path === lastDoc.path) && (
                    <button
                        type="button"
                        onClick={reopenDoc}
                        title={`Reopen ${lastDoc.path} beside the conversation`}
                        className="inline-flex h-6 max-w-[14rem] items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    >
                        <FileText className="size-3 shrink-0" />
                        <span className="truncate font-mono text-[11px]">{lastDoc.path.split('/').pop()}</span>
                        <Columns2 className="size-3 shrink-0" />
                    </button>
                )}
                <button
                    type="button"
                    title={isWhiteboard ? 'Back to the conversation ⌘4' : 'Whiteboard — draw together, live ⌘4'}
                    onClick={toggleWhiteboard}
                    className={cn(
                        'inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs',
                        isWhiteboard
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                >
                    <PenTool className="size-3.5" />
                    {/* Stable identity on purpose: always "Board", active state via the
                        highlight — the board's NAME lives in the chip on the canvas. */}
                    <span className="hidden lg:inline">Board</span>
                </button>
                <div className="inline-flex items-center rounded-md bg-muted p-0.5">
                    {MODES.map(({ k, label, Icon, kb }) => (
                        <button
                            key={k}
                            type="button"
                            title={`${label} ${kb}`}
                            onClick={() => requestMode(k)}
                            className={cn(
                                'inline-flex h-6 items-center gap-1.5 rounded px-2 text-xs',
                                // Full-bleed board is mode-less; board-split IS Split.
                                mode === k && !boardFull ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
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
                    stream={stream}
                    topics={feed.topics}
                    changeSets={feed.changeSets}
                    entries={entries}
                    draftFolders={draftFolders}
                    presence={presence}
                    unreadPaths={unreadPaths}
                    selection={selection}
                    onSelect={select}
                    onCreateFile={openFile}
                    onCreateBoard={createBoard}
                    onUploadFiles={setUploadFiles}
                    onOpenTrash={() => setTrashOpen(true)}
                    onAddFolder={addFolder}
                    onRemoveFolder={removeFolder}
                    open={railOpen}
                    onTogglePin={toggleRailPin}
                />
                {/* The surfaces. Talk = the stream or an open topic; Read =
                    the document; Split shows both around a draggable divider.
                    The stream is the expensive surface, so it never unmounts
                    while the space is open — a topic, a draft, or read mode
                    HIDE it (keep-alive), and closing them is instant. */}
                {/* Whiteboard: full-bleed beside the rail, or — in Split —
                    docked at the document slot with chat alongside. One
                    wrapper in one tree position both ways (flex `order` moves
                    it right of the chat visually), so toggling full ⇄ split
                    never remounts the live collab session. Keyed by path so
                    switching boards remounts a fresh session. */}
                {boardPath && (
                    <div
                        style={boardSplit ? { width: docWidthEff } : undefined}
                        className={cn('min-w-0 min-h-0 flex order-3', boardSplit ? 'shrink-0' : 'flex-1')}
                    >
                        <Suspense
                            fallback={
                                <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="size-3.5 animate-spin" /> Opening board…
                                </div>
                            }
                        >
                            <WhiteboardPane
                                key={boardPath}
                                org={org}
                                space={space}
                                boardId={boardPath}
                                memberNames={memberNames}
                                active={active}
                                boards={boards.map((b) => b.path)}
                                onSelectBoard={(path) => select({ kind: 'whiteboard', path })}
                                onCreateBoard={createBoard}
                            />
                        </Suspense>
                    </div>
                )}
                <div className={cn('flex-1 min-w-0 min-h-0', effMode === 'read' || boardFull ? 'hidden' : 'flex')}>
                    {chatRootId ? (
                        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
                            <ThreadPane
                                key={chatRootId}
                                org={org}
                                space={space}
                                rootMessageId={chatRootId}
                                rootFromStream={stream.messages.find((m) => m.id === chatRootId)}
                                topicFromStream={selectedTopic ?? stream.topicsByRoot.get(chatRootId)}
                                changeSets={feed.changeSets}
                                entries={entries}
                                presence={presence}
                                members={members}
                                memberNames={memberNames}
                                refreshTick={refreshTick}
                                showBack
                                onBack={() => select({ kind: 'general' })}
                                onOpenFile={openFileFromThread(chatRootId)}
                                onOpenSession={onOpenSession}
                                artifactsRailOpen={artifactsRailOpen}
                                onToggleArtifactsRail={toggleArtifactsRail}
                                onFolding={setFolding}
                                visible={active && effMode !== 'read' && !boardFull}
                            />
                        </section>
                    ) : null}
                    <div className={cn('flex-1 min-w-0 min-h-0', chatRootId ? 'hidden' : 'flex')}>
                        <GeneralStream
                            org={org}
                            space={space}
                            stream={stream}
                            presence={presence}
                            members={members}
                            memberNames={memberNames}
                            entries={entries}
                            onOpenThread={(id) => select({ kind: 'thread', rootMessageId: id })}
                            visible={active && effMode !== 'read' && !boardFull && !chatRootId}
                        />
                    </div>
                </div>
                {effMode === 'split' && (!isWhiteboard || boardSplit) && (
                    <div
                        onMouseDown={startDocResize}
                        className={cn(
                            'relative z-10 w-1.5 shrink-0 cursor-col-resize border-l border-border transition-colors hover:bg-primary/20',
                            // In board-split the board sits at order-3; the divider
                            // slots between chat (order 0) and the board.
                            boardSplit && 'order-2',
                            resizingDoc && 'bg-primary/30',
                        )}
                    />
                )}
                {effMode !== 'talk' && !isWhiteboard && (
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
                                    crumb={selection.kind === 'file' && crumbRootId && crumbLabel ? {
                                        label: crumbLabel,
                                        // Back to the thread means back to the conversation: Talk.
                                        onBack: () => { select({ kind: 'thread', rootMessageId: crumbRootId }); setMode('talk') },
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
