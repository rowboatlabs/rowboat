import '@/styles/spaces.css'
import { ThreadResizeHandle, THREAD_DEFAULT_WIDTH, THREAD_MIN_WIDTH, THREAD_DIVIDER_WIDTH, STREAM_MIN_WIDTH } from '@/components/spaces/thread-resize-handle'
import { getViewerType } from '@/lib/file-types'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clock, Columns2, Copy, FileText, FolderOpen, Hash, Link as LinkIcon, Loader2, MoreHorizontal, PenTool, Plus, Users } from 'lucide-react'
import { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AddOrgDialog, MemberAvatar, MemberProfilePopover, OrgMonogram } from '@/components/spaces/atoms'
import { BookmarksPopover } from '@/components/spaces/bookmarks'
import { FileColumn, TrashDialog, UploadFilesDialog } from '@/components/spaces/files-tab'
import { GeneralStream } from '@/components/spaces/general-stream'
import { ScheduledDialog } from '@/components/spaces/scheduled-dialog'
import { SelectionCopy } from '@/components/spaces/selection-copy'
import { ServerSwitcher } from '@/components/spaces/server-switcher'
import { ServerOptionsMenu } from '@/components/spaces/server-options-menu'
import { ServerSpaceNavigation } from '@/components/spaces-sidebar-section'
import { ActivityView, type ActivityTarget } from '@/components/spaces/activity-view'
import { SpaceRail } from '@/components/spaces/space-rail'
import { SpaceSearch } from '@/components/spaces/space-search'
import { railKey, type RailSelection } from '@/lib/spaces-selection'
import { ThreadPane } from '@/components/spaces/thread-pane'
import { STREAM_READ_KEY, useSpacePresence, useStream } from '@/hooks/use-space-chat'
import { refreshMembers, useSpaceMembers } from '@/hooks/use-space-members'
import { findSpace, useSpaceFeed, useSpaceLive, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { directAvatarId, directLabel, isSelfDirect } from '@/lib/spaces-direct'
import { requestJump } from '@/lib/spaces-jump'
import { chord } from '@/lib/shortcut'
import { SpaceMembersProvider, SpaceProfilesProvider } from '@/components/spaces/member-text'
import { AttachmentColumn, SpaceNavProvider, SpaceRefsProvider } from '@/components/spaces/space-markdown'
import { artifactsForThread, threadLabelOf } from '@/lib/spaces-conventions'
import { isUnreadChange, resolveMentions } from '@/lib/spaces-presentation'
import { getSpaceReadState, markStreamRead, markThreadRead, useStreamReadOffset } from '@/lib/spaces-read-state'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import * as analytics from '@/lib/analytics'

export { AddOrgDialog, OrgMonogram } from '@/components/spaces/atoms'

// Spaces — two columns, derived from what is open. A space lands on the
// chat (the stream, or a thread) full width. Opening a file or board from
// the rail puts it in a second column on the RIGHT; the chat stays on the
// left. Each column closes from its own header, and the other takes the
// width — a lone column has nothing to close into, so the chat shows no
// close then. Below SPLIT_FLOOR there is only ever one column: an open doc
// has the pane to itself, and picking anything in Chat closes it. No modes
// to choose. One edge rail carries the same sidebar on every surface. Data
// stays the v0 contract; general/topic/artifact semantics come from the
// contract with legacy fallbacks in lib/spaces-conventions.ts.

/** Which space is open (org + space) — the app-level selection the sidebar drives. */
export type SpaceSelection = {
    orgId: string
    spaceId: string
    /** An org-level surface instead of a space (spaceId is '' then): Activity, layer 3. */
    view?: 'activity'
} | null

/** Chat never squeezes below this beside a doc; the doc takes the rest. */
const CHAT_FLOOR = 460

/**
 * Two columns need at least this much content width (CHAT_FLOOR of chat +
 * ~466px of document + the 10px rail edge and divider). Below it the pane
 * is single-column, full stop. Kept low on purpose — a non-maximized laptop
 * window must still get two columns; the doc-width clamp handles the
 * squeeze from here up.
 */
const SPLIT_FLOOR = 960

/** Column slide in/out duration (matches the rail's own slides). */
const COLUMN_ANIM_MS = 220
/** The divider between two columns (w-1.5). */
const DIVIDER_W = 6

/**
 * A column in motion: `width` is what it grows to (enter) or shrinks from
 * (exit). An exiting doc keeps rendering its path until the slide is done.
 */
type ColumnAnim = { column: 'chat' | 'doc'; phase: 'enter' | 'exit'; width: number; docPath: string | null }

/**
 * Per-space column memory for this app session: switch to another space and
 * back, and the doc column (and whether the chat sat beside it) is as you
 * left it. Not persisted — a relaunch lands on the chat, clean.
 */
const columnMemory = new Map<string, { docPath: string | null; chatOpen: boolean }>()

// The whiteboard is heavy (the Excalidraw editor); it loads as its own chunk
// the first time a board opens, never inflating the main renderer bundle.
const WhiteboardPane = lazy(() => import('@/components/spaces/whiteboard-pane'))


// ---------------------------------------------------------------------------
// Root view: the selected space (the org/space list lives in the app sidebar)
// ---------------------------------------------------------------------------

export function SpacesView({ selection, onSelect, onSwitchSpace, railSelection, onRailSelect, onOpenSession, onOpenMessage, onOpenActivity, active = true }: {
    selection: SpaceSelection
    onSelect: (selection: SpaceSelection) => void
    /** Navigate to the destination and its rail together, without using the current space's selection. */
    onSwitchSpace: (orgId: string, spaceId: string, selection?: RailSelection) => void
    /** What's selected inside the space (general / a topic / a file) — part of the app's history. */
    railSelection: RailSelection
    onRailSelect: (selection: RailSelection) => void
    onOpenSession?: (sessionId: string) => void
    /** Activity → a message: the host navigates (space or thread, landing on the row). */
    onOpenMessage?: (target: ActivityTarget) => void
    /** The org's Activity surface. */
    onOpenActivity?: (orgId: string) => void
    /**
     * False while the view is kept mounted but hidden (the app shows another
     * section). Gates presence and read marks — a hidden pane must not report
     * "viewing" or mark arriving messages read.
     */
    active?: boolean
}) {
    const { orgs, loading, refresh } = useSpacesOrgs()
    const [addOrgOpen, setAddOrgOpen] = useState(false)
    const [emptyShowArchived, setEmptyShowArchived] = useState(false)

    const selectedOrg = selection ? (orgs.find((o) => o.id === selection.orgId) ?? null) : null
    const selectedSpace = selection && selectedOrg ? (findSpace(selectedOrg, selection.spaceId) ?? null) : null

    // No (valid) selection: land on the first space there is. An org-level
    // surface (Activity) is a valid selection with no space.
    useEffect(() => {
        if (loading) return
        if (selectedOrg && selectedSpace) return
        if (selectedOrg && selection?.view === 'activity') return
        const first = selectedOrg ?? orgs.find((o) => o.spaces.length > 0 || o.directs.length > 0)
        const space = first?.spaces[0] ?? first?.directs[0]
        if (first && space) {
            if (!selection || selection.orgId !== first.id || selection.spaceId !== space.id) onSelect({ orgId: first.id, spaceId: space.id })
        } else if (selection && !selectedOrg) {
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
                onSwitchSpace={onSwitchSpace}
                onOpenSession={onOpenSession}
                onOpenActivity={onOpenActivity}
                active={active}
            />
        )
    }

    if (selectedOrg) {
        return <div className="spaces-surface flex min-h-0 flex-1 flex-col">
            <header className="spaces-header flex shrink-0 items-center gap-2 border-b border-border">
                <ServerSwitcher org={selectedOrg} onOpenSpace={onSwitchSpace} />
            </header>
            <div className="flex min-h-0 flex-1">
            <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-[var(--rowboat-panel-soft)] p-2">
                <div className="flex h-8 items-center">
                    <span className="flex-1 px-1 text-[13px] font-semibold text-muted-foreground">Spaces</span>
                    <ServerOptionsMenu org={selectedOrg} showArchived={emptyShowArchived} onToggleArchived={() => setEmptyShowArchived((value) => !value)} onMenuOpenChange={() => {}} />
                </div>
                <ServerSpaceNavigation org={selectedOrg} spaceId="" onOpenSpace={onSwitchSpace} onOpenActivity={onOpenActivity}
                    activityActive={selection?.view === 'activity'}
                    onOpenDiscussion={() => {}} activeDiscussionCount={0} renderActiveDiscussions={() => null} />
            </aside>
            {selection?.view === 'activity' && onOpenMessage ? (
                <ActivityView org={selectedOrg} active={active} onOpenMessage={onOpenMessage} />
            ) : (
                <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
                    {selectedOrg.error ? 'This server is unreachable. Retry or sign in from the server options.' : 'Create a space to start a conversation.'}
                </div>
            )}
            </div>
        </div>
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
                            <Plus className="size-4 mr-1" /> Add a server
                        </Button>
                    </>
                ) : (
                    <>
                        <h2 className="text-sm font-semibold">No space to open</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {orgs.some((o) => o.error)
                                ? 'A server is unreachable — check it is running and you are signed in.'
                                : 'Create the first space from the server row in the sidebar.'}
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

function SpacePane({ org, space, selection, onSelect, onSwitchSpace, onOpenSession, onOpenActivity, active = true }: {
    org: OrgWithSpaces
    space: spaces.Space
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    /** The quick switcher can land on another space entirely. */
    onSwitchSpace: (orgId: string, spaceId: string, selection?: RailSelection) => void
    onOpenActivity?: (orgId: string) => void
    onOpenSession?: (sessionId: string) => void
    /** False while the Spaces view is kept mounted but hidden. */
    active?: boolean
}) {
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
    const readOffset = useStreamReadOffset(org.id, space.id)
    // The roster comes from the module store (cached, hydrated in render) so
    // names resolve in the same first frame as the stream's cached tail.
    const members = useSpaceMembers(org.id, space.id)
    const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m.displayName])), [members])
    // A direct message is this same pane with a two-person roster: named by
    // the other person, no invites.
    const isDirect = space.kind === 'direct'
    const isSelf = isSelfDirect(space, org.memberId)
    const directOtherId = directAvatarId(space, org.memberId)
    const spaceTitle = isDirect ? directLabel(space, members, org.memberId) : space.name

    // The artifacts rail: open by default when a thread has artifacts, collapsed
    // when it has none; a per-thread pin remembers a manual toggle.
    const [railPins, setRailPins] = useState<ReadonlyMap<string, boolean>>(new Map())

    useEffect(() => {
        let cancelled = false
        // The roster store fetches on its own mount; the tick keeps it fresh
        // on live activity (throttled inside — one refetch per burst).
        refreshMembers(org.id, space.id)
        void window.ipc.invoke('spaces:listAssets', { orgId: org.id, spaceId: space.id })
            .then((assetsRes) => {
                if (cancelled) return
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

    // The scheduled sends/reminders list (⋯ menu).
    const [scheduledOpen, setScheduledOpen] = useState(false)

    const markAllRead = () => {
        // Everything: the stream up to head (or the newest loaded root, if
        // that is further), and every followed thread up to its newest reply.
        const state = getSpaceReadState(org.id, space.id)
        const newest = stream.messages.reduce((max, m) => (!m.pending && !m.failed && m.offset > max ? m.offset : max), 0)
        markStreamRead(org.id, space.id, Math.max(state?.head ?? 0, newest))
        for (const [root, t] of state?.threads ?? []) if (t.following) markThreadRead(org.id, space.id, root, t.lastReplyOffset)
    }

    const unreadPaths = useMemo(
        // Boards are excluded: their saves are throttled snapshots, not reading
        // material — the boards rail is their surface, not the files tree.
        () => new Set(feed.changeSets.filter((c) => isUnreadChange(c, readOffset, org.memberId) && !spaces.isWhiteboardPath(c.assetPath)).map((c) => c.assetPath)),
        [feed.changeSets, readOffset, org.memberId],
    )

    // ------------------------------------------------------------------
    // Columns. The chat (stream or thread) sits on the left; an open file or
    // board on the right. `docPath` = what the right column holds (null =
    // closed); `chatOpen` = whether the left one is showing beside it. What
    // renders is derived below — two columns only when both are open AND
    // the pane is wide enough.
    // ------------------------------------------------------------------
    const memoryKey = `${org.id}/${space.id}`
    const [docPath, setDocPath] = useState<string | null>(() => {
        if (selection.kind === 'file' || selection.kind === 'whiteboard' || selection.kind === 'attachment') return selection.path
        return columnMemory.get(memoryKey)?.docPath ?? null
    })
    const [chatOpen, setChatOpen] = useState(() => selection.kind === 'attachment' || (columnMemory.get(memoryKey)?.chatOpen ?? true))
    useEffect(() => {
        columnMemory.set(memoryKey, { docPath, chatOpen })
    }, [memoryKey, docPath, chatOpen])
    // The chat/files rail: docked by default (persisted), or a sliver at the
    // edge that peeks the rail as a drawer on hover — see SpaceRail. (The
    // shell sidebar contracts to the dock while in Spaces, so this rail is
    // THE sidebar here.)
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

    // ⌘4 toggles the board; stable listener, the handler re-derives per render.
    const toggleWhiteboardRef = useRef<() => void>(() => {})
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((!e.metaKey && !e.ctrlKey) || e.altKey || e.shiftKey) return
            if (e.key === '4') { e.preventDefault(); toggleWhiteboardRef.current() }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    // What renders. Wide: the chat shows when open, or when nothing else is;
    // the doc shows when open; both = two columns. Narrow: one column — the
    // doc if open, else the chat.
    const twoFits = paneWidth >= SPLIT_FLOOR
    const docOpen = docPath !== null
    const showChat = twoFits ? chatOpen || !docOpen : !docOpen
    const showDoc = docOpen
    const split = showChat && showDoc
    const railOpen = railPinned

    // Resizable divider: drag it; the document width persists.
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
    // A persisted width from a wider window must not crush the chat side.
    const docWidthEff = Math.max(420, Math.min(docWidth, paneWidth - CHAT_FLOOR - 34))

    // ------------------------------------------------------------------
    // Column slides. When a column appears or goes, it animates its width
    // (0 ⇄ its size) while the other column stays fluid and takes up the
    // remaining width; content inside is fixed at the final width and anchored to the
    // far edge, so the doc slides in from the right and the chat from the
    // left. Detected during render (the state pattern React documents for
    // deriving from props) so the very first frame is already animating —
    // an effect would flash the settled layout once. A doc change wins over
    // a chat change in the same step: narrow, opening a doc pushes the chat
    // out with it.
    // ------------------------------------------------------------------
    const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
    const columnsRef = useRef<HTMLDivElement | null>(null)
    const [conversationWidth, setConversationWidth] = useState(0)
    const [threadExpanded, setThreadExpanded] = useState(() => localStorage.getItem('spaces:threadExpanded') === 'true')
    const toggleThreadExpanded = () => {
        const next = !threadExpanded
        setThreadExpanded(next)
        localStorage.setItem('spaces:threadExpanded', String(next))
    }
    const [threadWidth, setThreadWidth] = useState(() => {
        const stored = Number(localStorage.getItem('spaces:threadWidth'))
        return Number.isFinite(stored) && stored >= THREAD_MIN_WIDTH ? stored : THREAD_DEFAULT_WIDTH
    })
    const maxThreadWidth = Math.max(THREAD_MIN_WIDTH, conversationWidth - STREAM_MIN_WIDTH - THREAD_DIVIDER_WIDTH)
    const threadWidthEff = Math.min(threadWidth, maxThreadWidth)
    useEffect(() => {
        const el = columnsRef.current
        if (!el) return
        const observer = new ResizeObserver(() => setConversationWidth(el.clientWidth))
        observer.observe(el)
        setConversationWidth(el.clientWidth)
        return () => observer.disconnect()
    }, [])
    const chatRef = useRef<HTMLDivElement | null>(null)
    const docRef = useRef<HTMLElement | null>(null)
    const [layout, setLayout] = useState<{ docOpen: boolean; showChat: boolean; docPath: string | null; anim: ColumnAnim | null }>({ docOpen, showChat, docPath, anim: null })
    if (layout.docOpen !== docOpen || layout.showChat !== showChat) {
        let anim: ColumnAnim | null = null
        if (!reducedMotion) {
            const columnsWidth = columnsRef.current?.clientWidth ?? paneWidth
            if (layout.docOpen !== docOpen) {
                anim = docOpen
                    ? { column: 'doc', phase: 'enter', width: showChat ? docWidthEff : columnsWidth, docPath }
                    // The DOM still shows the old layout mid-render: the live width is the start.
                    : { column: 'doc', phase: 'exit', width: docRef.current?.clientWidth ?? docWidthEff, docPath: layout.docPath }
            } else {
                anim = showChat
                    ? { column: 'chat', phase: 'enter', width: Math.max(0, columnsWidth - docWidthEff - DIVIDER_W), docPath }
                    : { column: 'chat', phase: 'exit', width: chatRef.current?.clientWidth ?? 0, docPath }
            }
        }
        setLayout({ docOpen, showChat, docPath, anim })
    } else if (layout.docPath !== docPath) {
        setLayout((l) => ({ ...l, docPath }))
    }
    const anim = layout.anim
    useEffect(() => {
        if (!anim) return
        const t = setTimeout(() => setLayout((l) => (l.anim === anim ? { ...l, anim: null } : l)), COLUMN_ANIM_MS)
        return () => clearTimeout(t)
    }, [anim])
    const chatAnim = anim?.column === 'chat' ? anim : null
    const docAnim = anim?.column === 'doc' ? anim : null
    // What is in the tree: the logical state, plus whatever is still sliding out
    // (or, narrow, the chat being pushed out by an entering doc).
    const docRender = docPath ?? (docAnim?.phase === 'exit' ? docAnim.docPath : null)
    const chatRender = showChat || chatAnim?.phase === 'exit' || docAnim?.phase === 'enter'
    const columnStyle = (a: ColumnAnim): React.CSSProperties => ({
        ['--rb-col-w' as string]: `${a.width}px`,
        animation: `${a.phase === 'enter' ? 'rb-column-in' : 'rb-column-out'} ${COLUMN_ANIM_MS}ms cubic-bezier(0.2,0,0,1) both`,
    } as React.CSSProperties)

    // Placing a selection into the columns. Files and boards land on the
    // right; anything from Chat reopens the left — and, narrow, closes the
    // doc so the chat actually shows.
    const placeSelection = (next: RailSelection) => {
        if (next.kind === 'file' || next.kind === 'whiteboard' || next.kind === 'attachment') {
            if (next.kind === 'attachment') setChatOpen(true)
            setDocPath(next.path)
        } else {
            setChatOpen(true)
            if (!twoFits) setDocPath(null)
        }
    }

    // ------------------------------------------------------------------
    // Whiteboard: a board is what the right column holds when the path is
    // whiteboards/<name>.excalidraw — reached from the rail, the header
    // button (⌘4, the most recent board; created on its first save when
    // none exists yet), an artifact link, a deep link, or history. It must
    // never render as raw JSON in the document pane.
    // ------------------------------------------------------------------
    const boardPath = docRender && spaces.isWhiteboardPath(docRender) ? docRender : null
    const isWhiteboard = !!docPath && spaces.isWhiteboardPath(docPath)
    const boards = entries.filter((e) => spaces.isWhiteboardPath(e.path) && !e.state)
    const toggleWhiteboard = () => {
        if (isWhiteboard) {
            closeDoc()
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

    /** The rail's lock: docked ⇄ edge sliver (the rail peeks on hover by itself). */
    const toggleRailPin = () => {
        const pin = !railPinned
        localStorage.setItem('spaces:railOpen', pin ? '1' : '0')
        setRailPinned(pin)
    }

    // Selecting places the thing in its column (see placeSelection). The
    // rail stays where it is — it is a sidebar, not a flyout.
    const select = (next: RailSelection) => {
        onSelect(next)
        analytics.spacesTabViewed(next.kind === 'general' ? 'general' : (next.kind === 'file' || next.kind === 'attachment') ? 'files' : next.kind === 'whiteboard' ? 'whiteboard' : 'topics')
        placeSelection(next)
    }
    const openFile = (path: string) => select({ kind: 'file', path })

    /** Search / pinned / saved landings: open the surface, then scroll + flash. */
    const navigateToMessage = (rootMessageId: string, messageId: string) => {
        requestJump({ topicId: rootMessageId, messageId })
        // STREAM_READ_KEY stands for the stream itself; anything else is a thread.
        if (rootMessageId === STREAM_READ_KEY) select({ kind: 'general' })
        else select({ kind: 'thread', rootMessageId })
    }

    // Selection can also change under us (history ‹ ›, deep links): place
    // whatever arrived the same way a click would.
    const selKey = railKey(selection)
    const prevSelKey = useRef(selKey)
    useEffect(() => {
        if (prevSelKey.current === selKey) return
        prevSelKey.current = selKey
        placeSelection(selection)
        // Deliberately keyed on the selection only — placeSelection reads the
        // current width when it runs; a resize must not re-place anything.
    }, [selKey])

    // A discussion's linked file opens beside it (2026-09-11). The org
    // projects the link as the file's CURRENT live path, so whatever lands
    // here exists. Once per visit: closing the column marks the thread as
    // dismissed until the reader leaves it (closeDoc); a different file they
    // open themselves is never fought — this only fires when the selection
    // or the link itself changes, and only where two columns fit (narrow,
    // the chat wins, as everywhere). The stream copy is read first: it is
    // the one a local attach updates before the feed refetches.
    const selectedThreadRoot = selection.kind === 'thread' ? selection.rootMessageId : null
    const linkedDocPath = selectedThreadRoot
        ? (stream.topicsByRoot.get(selectedThreadRoot) ?? feed.topics.find((t) => t.rootMessageId === selectedThreadRoot))?.documentPath ?? null
        : null
    const linkedDocDismissedRef = useRef<string | null>(null)
    useEffect(() => {
        // Leaving the dismissed thread — for the stream or another thread —
        // forgets the dismissal; a file opened from it keeps it.
        if (selection.kind === 'general' || (selectedThreadRoot && linkedDocDismissedRef.current !== selectedThreadRoot)) {
            linkedDocDismissedRef.current = null
        }
    }, [selection.kind, selectedThreadRoot])
    useEffect(() => {
        if (!selectedThreadRoot || !linkedDocPath || !twoFits) return
        if (linkedDocDismissedRef.current === selectedThreadRoot) return
        setDocPath((open) => (open === linkedDocPath ? open : linkedDocPath))
        setChatOpen(true)
        // Keyed on the thread and the link — not on docPath, which the
        // reader moves freely once the column is open.
    }, [selectedThreadRoot, linkedDocPath, twoFits])

    // The last closed file — the header chip reopens it beside the chat.
    const [lastDoc, setLastDoc] = useState<{ path: string; fromThreadRootId?: string } | null>(null)

    // The document in the right column (a board renders through boardPath instead).
    const centerPath = docRender && !spaces.isWhiteboardPath(docRender) ? docRender : null

    /** Open a file from inside a thread — the file view gets a crumb back to it. */
    const openFileFromThread = (rootMessageId: string) => (path: string) => select({ kind: 'file', path, fromThreadRootId: rootMessageId })


    const selfName = memberNames.get(org.memberId) ?? org.memberId

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
    else if ((selection.kind === 'file' || selection.kind === 'attachment') && selection.fromThreadRootId) chatContextRef.current = selection.fromThreadRootId
    const chatRootId = chatContextRef.current

    const threadBesideStream = !!chatRootId && !docOpen && !threadExpanded && conversationWidth >= 840
    const selectedTopic = chatRootId ? feed.topics.find((t) => t.rootMessageId === chatRootId) : undefined
    const selectedGroups = chatRootId ? artifactsForThread(feed.changeSets, chatRootId) : []
    const artifactsRailOpen = chatRootId ? (railPins.get(chatRootId) ?? selectedGroups.length > 0) : false
    const toggleArtifactsRail = () => {
        if (!chatRootId) return
        setRailPins((prev) => new Map(prev).set(chatRootId, !artifactsRailOpen))
    }

    // Closing the right column lands on the conversation that was beside
    // it (or behind it, narrow). A closed file is remembered (lastDoc) so
    // the header chip can bring it back. Closing the left column just hides
    // it; the doc takes the width.
    function closeDoc() {
        if (selection.kind === 'file' && !spaces.isWhiteboardPath(selection.path)) {
            setLastDoc({ path: selection.path, fromThreadRootId: selection.fromThreadRootId })
        }
        // Closing beside a discussion is a choice: its linked file stays
        // closed until the reader leaves and comes back.
        if (chatRootId) linkedDocDismissedRef.current = chatRootId
        setDocPath(null)
        setChatOpen(true)
        if (selection.kind === 'file' || selection.kind === 'whiteboard' || selection.kind === 'attachment') {
            onSelect(chatRootId ? { kind: 'thread', rootMessageId: chatRootId } : { kind: 'general' })
        }
    }
    const closeChat = () => setChatOpen(false)
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
    // upload confirmation. Default to Space files; choosing a folder is optional.
    const [uploadFiles, setUploadFiles] = useState<File[] | null>(null)
    const [trashOpen, setTrashOpen] = useState(false)

    return (
        <SpaceMembersProvider members={memberNames}>
        <SpaceProfilesProvider members={members} here={hereSet} selfId={org.memberId}>
        <SpaceRefsProvider refs={{ orgId: org.id, orgAddress: org.address, spaceId: space.id }}>
        <SpaceNavProvider onOpenFile={openFile} onOpenAttachment={(src, name) => {
            const url = new URL(src)
            url.searchParams.set('name', name)
            select({ kind: 'attachment', path: url.href, ...(chatRootId ? { fromThreadRootId: chatRootId } : {}) })
        }}>
        <div className="spaces-surface relative flex-1 min-h-0 flex flex-col">
            {/* One per pane — covers the stream and thread panes alike. */}
            {active && <SelectionCopy />}
            <header className="spaces-header flex shrink-0 items-center gap-2 border-b border-border">
                <ServerSwitcher org={org} onOpenSpace={onSwitchSpace} />
                <span aria-hidden="true" className="shrink-0 text-muted-foreground/50">/</span>
                {/* The space breadcrumb retains its identity hover card. */}
                <HoverCard openDelay={200} closeDelay={150}>
                    <HoverCardTrigger asChild>
                        <button
                            type="button"
                            className="flex h-9 min-w-0 max-w-[320px] shrink items-center gap-2 rounded-md pl-1 pr-2 hover:bg-accent/60 data-[state=open]:bg-accent/60"
                        >
                            <span className={cn('flex min-w-0 items-center', isDirect ? 'gap-1.5' : 'gap-0.5')}>
                                {isDirect
                                    ? <MemberAvatar id={directOtherId} name={spaceTitle} size="sm" />
                                    : <Hash className="size-4 shrink-0 text-muted-foreground" />}
                                <h1 className="truncate text-[15px] font-semibold">{spaceTitle}</h1>
                            </span>
                        </button>
                    </HoverCardTrigger>
                    <HoverCardContent align="start" sideOffset={4} className="w-80 px-5 pb-5 pt-6">
                        {/* "About this space", in the shape of About This Mac: the
                            org's mark as the hero, the space as the title, then a
                            label/value table — what you're looking at, who it
                            belongs to, and who you are in it. */}
                        <div className="flex flex-col items-center text-center">
                            <OrgMonogram org={org} size="xl" />
                            <div className={cn('mt-3 flex items-center text-lg font-semibold leading-tight', isDirect ? 'gap-1.5' : 'gap-0.5')}>
                                {isDirect
                                    ? <MemberAvatar id={directOtherId} name={spaceTitle} size="sm" />
                                    : <Hash className="size-4 text-muted-foreground" />}
                                <span className="truncate">{spaceTitle}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                                {isSelf
                                    ? `Your notes in ${org.name} — just you and your agent`
                                    : isDirect ? `A direct message in ${org.name} — just the two of you` : `A space in ${org.name}`}
                            </div>
                        </div>
                        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[13px]">
                            <dt className="text-right font-medium">Server</dt>
                            <dd className="truncate text-muted-foreground">{org.name}</dd>
                            <dt className="text-right font-medium">Members</dt>
                            <dd className="truncate text-muted-foreground">
                                {members.length}{here.length > 0 && <span> · {here.length} here</span>}
                            </dd>
                            <dt className="text-right font-medium">You</dt>
                            <dd className="min-w-0">
                                <span className="inline-block max-w-full truncate rounded-[4px] bg-[var(--stream-you-wash)] px-[3px] py-px align-middle font-medium text-[var(--stream-you-ink)]">@{selfName}</span>
                            </dd>
                            <dt className="text-right font-medium">Member id</dt>
                            <dd className="min-w-0"><CopyLine text={org.memberId} title="Copy your member id" className="font-mono text-xs" /></dd>
                        </dl>
                    </HoverCardContent>
                </HoverCard>

                {/* Centre: search gets the room. */}
                <div className="flex min-w-0 flex-1 justify-center px-2">
                    <SpaceSearch orgId={org.id} spaceId={space.id} selfMemberId={org.memberId} onNavigate={select} className="w-full max-w-[480px]" />
                </div>

                {/* Right: members as one pill (a dot when anyone is here — the
                    roster says who), then the tools. */}
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=open]:bg-accent/60 data-[state=open]:text-foreground"
                            title={here.length > 0 ? `${members.length} members · ${here.length} here` : `${members.length} members`}
                        >
                            <span className="relative">
                                <Users className="size-3.5" />
                                {here.length > 0 && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-[var(--rowboat-success)] ring-2 ring-background" />}
                            </span>
                            <span className="tabular-nums">{members.length}</span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 p-1.5">
                        <div className="px-2 pb-1 pt-0.5 text-[13px] text-muted-foreground">
                            Members — {members.length}
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                            {roster.map((m) => {
                                const isHere = hereSet.has(m.id)
                                return (
                                    <MemberProfilePopover key={m.id} id={m.id}>
                                        <button type="button" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60">
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
                                        </button>
                                    </MemberProfilePopover>
                                )
                            })}
                        </div>
                        {/* A DM's membership is fixed — there is nobody to invite. */}
                        {!isDirect && (
                            <div className="mt-1 border-t border-border pt-1">
                                <button
                                    type="button"
                                    onClick={() => void invite()}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                    <LinkIcon className="size-3.5" /> Copy invite link
                                </button>
                            </div>
                        )}
                    </PopoverContent>
                </Popover>
                <BookmarksPopover
                    orgId={org.id}
                    spaceId={space.id}
                    streamKey={STREAM_READ_KEY}
                    topics={feed.topics}
                    onNavigate={navigateToMessage}
                />
                {!docOpen && lastDoc && entries.some((e) => e.path === lastDoc.path) && (
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
                    title={isWhiteboard ? `Close the board ${chord('4')}` : `Whiteboard — draw together, live ${chord('4')}`}
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
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={markAllRead}>
                            <Check className="size-3.5 mr-2" /> Mark all read
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setScheduledOpen(true)}>
                            <Clock className="size-3.5 mr-2" /> Scheduled
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>

            <div ref={paneRef} className="flex-1 min-h-0 flex">
                <SpaceRail
                    onOpenActivity={onOpenActivity}
                    org={org}
                    onOpenSpace={(orgId, spaceId) => {
                        if (orgId === org.id && spaceId === space.id) select({ kind: 'general' })
                        else onSwitchSpace(orgId, spaceId)
                    }}
                    onOpenDiscussion={(spaceId, next) => {
                        if (spaceId === space.id) select(next)
                        else onSwitchSpace(org.id, spaceId, next)
                    }}
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
                {/* The columns. Chat on the left — the stream, or an open
                    thread beside it when there is room. The stream never
                    unmounts while the space is open — a thread, or a doc
                    taking a narrow pane, hides it (keep-alive). The doc column on
                    the right holds a file or a board. Both keep fixed tree
                    positions (the divider slot stays in the array) so going
                    one ⇄ two columns never remounts either surface. */}
                <div ref={columnsRef} className="flex flex-1 min-w-0 min-h-0">
                <div
                    ref={chatRef}
                    style={chatAnim ? columnStyle(chatAnim) : undefined}
                    // Sliding: fixed at the animating width, content anchored to the
                    // right edge so it slides in from the left. Otherwise fluid.
                    className={cn('min-w-0 min-h-0', chatRender ? 'flex' : 'hidden', chatAnim ? 'shrink-0 overflow-hidden justify-end' : 'flex-1')}
                >
                <div style={chatAnim ? { width: chatAnim.width } : undefined} className={cn('flex min-w-0 min-h-0', chatAnim ? 'shrink-0' : 'flex-1')}>
                    <div className={cn('flex-1 min-w-0 min-h-0', chatRootId && !threadBesideStream ? 'hidden' : 'flex')}>
                        <GeneralStream
                            org={org}
                            space={space}
                            stream={stream}
                            presence={presence}
                            members={members}
                            memberNames={memberNames}
                            entries={entries}
                            onOpenThread={(id) => select({ kind: 'thread', rootMessageId: id })}
                            onOpenSession={onOpenSession}
                            onClose={split ? closeChat : undefined}
                            visible={active && showChat && (!chatRootId || threadBesideStream)}
                            composeActive={!chatRootId}
                        />
                    </div>
                    {threadBesideStream && (
                        <ThreadResizeHandle
                            width={threadWidthEff}
                            maxWidth={maxThreadWidth}
                            onResize={setThreadWidth}
                            onCommit={(width) => localStorage.setItem('spaces:threadWidth', String(width))}
                        />
                    )}
                    {chatRootId ? (
                        <section aria-label="Thread" style={threadBesideStream ? { width: threadWidthEff } : undefined} className={cn('spaces-thread-column min-w-0 min-h-0 flex flex-col', threadBesideStream ? 'shrink-0' : 'flex-1')}>
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
                                showBack={!threadBesideStream}
                                expanded={threadExpanded}
                                onToggleExpanded={!docOpen && (conversationWidth >= 840 || threadExpanded) ? toggleThreadExpanded : undefined}
                                onBack={() => select({ kind: 'general' })}
                                onCloseColumn={split ? closeChat : undefined}
                                onOpenFile={openFileFromThread(chatRootId)}
                                onOpenSession={onOpenSession}
                                artifactsRailOpen={artifactsRailOpen}
                                onToggleArtifactsRail={toggleArtifactsRail}
                                onFolding={setFolding}
                                visible={active && showChat}
                            />
                        </section>
                    ) : null}
                </div>
                </div>
                {chatRender && docRender && twoFits ? (
                    <div
                        onMouseDown={startDocResize}
                        className={cn(
                            'relative z-10 w-1.5 shrink-0 cursor-col-resize border-l border-border transition-colors hover:bg-primary/20',
                            resizingDoc && 'bg-primary/30',
                        )}
                    />
                ) : null}
                {docRender ? (
                    <aside
                        ref={docRef}
                        // Sliding: fixed at the animating width, content anchored left
                        // so it slides in from the right. Settled beside the chat: the
                        // dragged width. Alone, or while the CHAT slides: fluid.
                        style={docAnim ? columnStyle(docAnim) : split && !anim ? { width: docWidthEff } : undefined}
                        className={cn('min-w-0 min-h-0 flex', docAnim || (split && !anim) ? 'shrink-0 overflow-hidden' : 'flex-1')}
                    >
                    <div style={docAnim ? { width: docAnim.width } : undefined} className={cn('flex min-w-0 min-h-0', docAnim ? 'shrink-0' : 'flex-1', !split && !boardPath && 'justify-center')}>
                        {docRender.startsWith('app://space-blob/') ? (
                            <AttachmentColumn key={docRender} src={docRender} onDismiss={closeDoc} onSaved={(path) => {
                                setRefreshTick((tick) => tick + 1)
                                select({ kind: 'file', path, ...(chatRootId ? { fromThreadRootId: chatRootId } : {}) })
                            }} />
                        ) : boardPath ? (
                            // Keyed by path so switching boards remounts a fresh collab session.
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
                                    onClose={closeDoc}
                                />
                            </Suspense>
                        ) : centerPath ? (
                            <div className={cn('flex min-w-0 min-h-0 flex-1', !split && !getViewerType(centerPath) && 'mx-auto max-w-[880px]')}>
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
                                    onDeleted={() => { setDocPath(null); select({ kind: 'general' }) }}
                                    crumb={selection.kind === 'file' && crumbRootId && crumbLabel ? {
                                        label: crumbLabel,
                                        // Back to the thread means back to the conversation alone.
                                        onBack: () => { closeDoc(); select({ kind: 'thread', rootMessageId: crumbRootId }) },
                                    } : null}
                                    onDismiss={closeDoc}
                                />
                            </div>
                        ) : null}
                    </div>
                    </aside>
                ) : null}
                </div>
            </div>
            {scheduledOpen && <ScheduledDialog orgId={org.id} spaceId={space.id} onClose={() => setScheduledOpen(false)} />}
            {trashOpen && (
                <TrashDialog org={org} space={space} onClose={() => { setTrashOpen(false); setRefreshTick((t) => t + 1) }} />
            )}
            {uploadFiles && (
                <UploadFilesDialog
                    org={org}
                    space={space}
                    files={uploadFiles}
                    entries={entries}
                    onClose={() => setUploadFiles(null)}
                    onDone={() => setRefreshTick((t) => t + 1)}
                />
            )}
        </div>
        </SpaceNavProvider>
        </SpaceRefsProvider>
        </SpaceProfilesProvider>
        </SpaceMembersProvider>
    )
}

/**
 * A line of text you click to copy. The copy glyph shows on hover; a check
 * takes its place for a beat once the clipboard has it, right where you
 * clicked. A failed write (no focus, no permission) says so.
 */
function CopyLine({ text, title, className }: { text: string; title: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
    const copy = () =>
        navigator.clipboard.writeText(text).then(
            () => {
                setCopied(true)
                if (timer.current) clearTimeout(timer.current)
                timer.current = setTimeout(() => setCopied(false), 1500)
            },
            () => toast('Could not copy', 'error'),
        )
    return (
        <button
            type="button"
            title={title}
            onClick={() => void copy()}
            className="group/copy flex max-w-full items-center gap-1 text-muted-foreground hover:text-foreground"
        >
            <span className={cn('truncate', className)}>{text}</span>
            {copied
                ? <Check className="size-3 shrink-0 text-[var(--rowboat-success)]" />
                : <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />}
        </button>
    )
}
