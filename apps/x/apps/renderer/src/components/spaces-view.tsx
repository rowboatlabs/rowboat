import '@/styles/spaces.css'
import { ThreadResizeHandle, THREAD_DEFAULT_WIDTH, THREAD_MIN_WIDTH, THREAD_DIVIDER_WIDTH, STREAM_MIN_WIDTH } from '@/components/spaces/thread-resize-handle'
import { getViewerType } from '@/lib/file-types'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clock, Columns2, Copy, FileText, FolderOpen, Hash, Link as LinkIcon, Loader2, MoreHorizontal, PenTool, Plus, UserPlus, Users } from 'lucide-react'
import { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MemberAvatar, MemberProfilePopover, OrgMonogram } from '@/components/spaces/atoms'
import { openServerDialog } from '@/lib/server-dialog'
import { BookmarksPopover } from '@/components/spaces/bookmarks'
import { FileColumn, TrashDialog, UploadFilesDialog } from '@/components/spaces/files-tab'
import { GeneralStream } from '@/components/spaces/general-stream'
import { ScheduledDialog } from '@/components/spaces/scheduled-dialog'
import { SelectionCopy } from '@/components/spaces/selection-copy'
import { ServerSwitcher } from '@/components/spaces/server-switcher'
import { ServerSpaceNavigation } from '@/components/spaces-sidebar-section'
import { ActivityView, type ActivityTarget } from '@/components/spaces/activity-view'
import { SpaceRailSections } from '@/components/spaces/space-rail-sections'
import { SpaceRail } from '@/components/spaces/space-rail'
import { SpaceContentTabs } from '@/components/spaces/space-content-tabs'
import { SpaceDiscussionsView } from '@/components/spaces/space-discussions-view'
import { SpaceFilesView } from '@/components/spaces/space-files-view'
import { SpaceSearch } from '@/components/spaces/space-search'
import { railKey, type RailSelection } from '@/lib/spaces-selection'
import { ThreadPane } from '@/components/spaces/thread-pane'
import { STREAM_READ_KEY, useSpacePresence, useStream } from '@/hooks/use-space-chat'
import { refreshMembers, useOrgRoster, useSpaceMembers } from '@/hooks/use-space-members'
import { findSpace, refreshSpacesAccountState, refreshSpacesOrgs, useSpaceFeed, useSpaceLive, useSpaceNames, useSpacesAccountState, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { noteListingFromEntries } from '@/hooks/use-space-boards'
import { directAvatarId, directLabel, isSelfDirect } from '@/lib/spaces-direct'
import { requestJump } from '@/lib/spaces-jump'
import { chord } from '@/lib/shortcut'
import { SpaceMembersProvider, SpaceProfilesProvider } from '@/components/spaces/member-text'
import { AttachmentColumn, SpaceAssetsProvider, SpaceNavProvider, SpaceRefsProvider } from '@/components/spaces/space-markdown'
import { artifactsForThread, threadLabelOf } from '@/lib/spaces-conventions'
import { isUnreadChange, resolveMentions } from '@/lib/spaces-presentation'
import { getSpaceReadState, markStreamRead, markThreadRead, useStreamReadOffset } from '@/lib/spaces-read-state'
import { toast } from '@/lib/toast'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { cn } from '@/lib/utils'
import * as analytics from '@/lib/analytics'

export { OrgMonogram } from '@/components/spaces/atoms'

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
 * What the right column holds: a file or board by ASSET ID, or a message
 * attachment by its blob URL (app://space-blob/…). Null = closed.
 */
type DocKey = string | null

/**
 * A column in motion: `width` is what it grows to (enter) or shrinks from
 * (exit). An exiting doc keeps rendering its key until the slide is done.
 */
type ColumnAnim = { column: 'chat' | 'doc'; phase: 'enter' | 'exit'; width: number; docKey: DocKey }

/**
 * Per-space column memory for this app session: switch to another space and
 * back, and the doc column (and whether the chat sat beside it) is as you
 * left it. Not persisted — a relaunch lands on the chat, clean.
 */
const columnMemory = new Map<string, { docKey: DocKey; docIsBoard: boolean; chatOpen: boolean }>()

const isAttachmentKey = (key: string) => key.startsWith('app://space-blob/')

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
    const { orgs, loading } = useSpacesOrgs()
    // No Rowboat session → the empty state offers the sign-in first (one
    // session, two uses): one browser trip lists every managed org.
    const account = useSpacesAccountState()
    const [signingIn, setSigningIn] = useState(false)
    const signInRowboat = async () => {
        setSigningIn(true)
        try {
            const { orgs: signedIn } = await window.ipc.invoke('spaces:signInRowboat', null)
            refreshSpacesAccountState()
            await refreshSpacesOrgs()
            if (signedIn.length === 0) toast('Signed in — no servers yet. Create one or join with an invite link.', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Sign-in failed', 'error')
        } finally {
            setSigningIn(false)
        }
    }

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
                onOpenMessage={onOpenMessage}
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
            <aside className="w-64 shrink-0 border-r border-border bg-[var(--rowboat-panel-soft)]">
                <SpaceRailSections orgId={selectedOrg.id} active={active} activityActive={selection?.view === 'activity'}
                    onOpenMessage={onOpenMessage} onOpenActivity={onOpenActivity}>
                <div className="flex h-8 shrink-0 items-center px-2">
                    <span className="flex-1 px-1 text-[13px] font-semibold text-muted-foreground">Spaces</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    <ServerSpaceNavigation org={selectedOrg} spaceId="" onOpenSpace={onSwitchSpace} showDiscussions={false} />
                </div>
                </SpaceRailSections>
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
                        {account && !account.hasSession ? (
                            <div className="mt-4 flex flex-col items-center gap-2">
                                <Button size="sm" onClick={() => void signInRowboat()} disabled={signingIn}>
                                    {signingIn ? <Loader2 className="size-4 mr-1 animate-spin" /> : null} Sign in with Rowboat
                                </Button>
                                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => openServerDialog({ kind: 'join' })}>
                                    Have an invite link or a server address?
                                </button>
                            </div>
                        ) : (
                            <Button size="sm" className="mt-4" onClick={() => openServerDialog({ kind: 'create' })}>
                                <Plus className="size-4 mr-1" /> Add a server
                            </Button>
                        )}
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
        </div>
    )
}

// ---------------------------------------------------------------------------
// One space: header across the top, then the space rail | the selected thing
// ---------------------------------------------------------------------------

function SpacePane({ org, space, selection, onSelect, onSwitchSpace, onOpenSession, onOpenActivity, onOpenMessage, active = true }: {
    org: OrgWithSpaces
    space: spaces.Space
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    /** The quick switcher can land on another space entirely. */
    onSwitchSpace: (orgId: string, spaceId: string, selection?: RailSelection) => void
    onOpenActivity?: (orgId: string) => void
    onOpenMessage?: (target: ActivityTarget) => void
    onOpenSession?: (sessionId: string) => void
    /** False while the Spaces view is kept mounted but hidden. */
    active?: boolean
}) {
    const [entries, setEntries] = useState<spaces.SpacesAssetEntry[]>([])
    const [filesLoaded, setFilesLoaded] = useState(false)
    const [filesError, setFilesError] = useState<string | null>(null)
    const collectionOpen = selection.kind === 'discussions' || selection.kind === 'files'
    const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])
    // The org listing (module store): resolves a canonical link's org address
    // + space to an org this install is in.
    const { orgs } = useSpacesOrgs()
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
    // `members` is THIS space's roster — membership: header avatars, invites,
    // presence. Names and profiles reach past it to the whole org (this
    // roster winning on identity), so a chip for someone mentioned from
    // another space still reads as a person here.
    const members = useSpaceMembers(org.id, space.id)
    const orgSpaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const orgRoster = useOrgRoster(org.id, orgSpaceIds)
    const profiles = useMemo(() => {
        const byId = new Map(orgRoster.map((m) => [m.id, m]))
        for (const m of members) byId.set(m.id, m)
        return [...byId.values()]
    }, [orgRoster, members])
    const memberNames = useMemo(() => new Map(profiles.map((m) => [m.id, m.displayName])), [profiles])
    const spaceNames = useSpaceNames(org.id)
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
                setFilesLoaded(true)
                setFilesError(null)
                // The listing store (the @ menus, open-board context) reads this listing too.
                noteListingFromEntries(org.id, space.id, assetsRes.entries)
            })
            .catch((error) => {
                if (cancelled) return
                setFilesLoaded(true)
                setFilesError(error instanceof Error ? error.message : 'Could not load files')
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
            analytics.spacesInviteLinkCopied()
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

    // Files (by id) changed by someone else since the read mark. Boards are
    // excluded: their saves are throttled snapshots, not reading material —
    // the boards rail is their surface, not the files tree.
    const unreadAssetIds = useMemo(
        () => new Set(feed.changeSets.filter((c) => isUnreadChange(c, readOffset, org.memberId) && !spaces.isWhiteboardPath(c.assetPath)).map((c) => c.assetId)),
        [feed.changeSets, readOffset, org.memberId],
    )

    // ------------------------------------------------------------------
    // Columns. The chat (stream or thread) sits on the left; an open file or
    // board on the right. `docKey` = what the right column holds (null =
    // closed); `chatOpen` = whether the left one is showing beside it. What
    // renders is derived below — two columns only when both are open AND
    // the pane is wide enough.
    // ------------------------------------------------------------------
    const memoryKey = `${org.id}/${space.id}`
    const [docKey, setDocKey] = useState<DocKey>(() => {
        if (selection.kind === 'file' || selection.kind === 'whiteboard') return selection.assetId
        if (selection.kind === 'attachment') return selection.src
        return columnMemory.get(memoryKey)?.docKey ?? null
    })
    // Whether the remembered key is a board — known synchronously, so a
    // remembered board never mounts as a file column while the listing loads.
    const [docIsBoard, setDocIsBoard] = useState<boolean>(() => selection.kind === 'whiteboard' || (columnMemory.get(memoryKey)?.docIsBoard ?? false))
    const [chatOpen, setChatOpen] = useState(() => selection.kind === 'attachment' || (columnMemory.get(memoryKey)?.chatOpen ?? true))
    useEffect(() => {
        columnMemory.set(memoryKey, { docKey, docIsBoard, chatOpen })
    }, [memoryKey, docKey, chatOpen])
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
    const docOpen = docKey !== null
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
    const [layout, setLayout] = useState<{ docOpen: boolean; showChat: boolean; docKey: DocKey; anim: ColumnAnim | null }>({ docOpen, showChat, docKey, anim: null })
    if (layout.docOpen !== docOpen || layout.showChat !== showChat) {
        let anim: ColumnAnim | null = null
        if (!reducedMotion) {
            const columnsWidth = columnsRef.current?.clientWidth ?? paneWidth
            if (layout.docOpen !== docOpen) {
                anim = docOpen
                    ? { column: 'doc', phase: 'enter', width: showChat ? docWidthEff : columnsWidth, docKey }
                    // The DOM still shows the old layout mid-render: the live width is the start.
                    : { column: 'doc', phase: 'exit', width: docRef.current?.clientWidth ?? docWidthEff, docKey: layout.docKey }
            } else {
                anim = showChat
                    ? { column: 'chat', phase: 'enter', width: Math.max(0, columnsWidth - docWidthEff - DIVIDER_W), docKey }
                    : { column: 'chat', phase: 'exit', width: chatRef.current?.clientWidth ?? 0, docKey }
            }
        }
        setLayout({ docOpen, showChat, docKey, anim })
    } else if (layout.docKey !== docKey) {
        setLayout((l) => ({ ...l, docKey }))
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
    const docRender = docKey ?? (docAnim?.phase === 'exit' ? docAnim.docKey : null)
    const chatRender = showChat || chatAnim?.phase === 'exit' || docAnim?.phase === 'enter'
    const columnStyle = (a: ColumnAnim): React.CSSProperties => ({
        ['--rb-col-w' as string]: `${a.width}px`,
        animation: `${a.phase === 'enter' ? 'rb-column-in' : 'rb-column-out'} ${COLUMN_ANIM_MS}ms cubic-bezier(0.2,0,0,1) both`,
    } as React.CSSProperties)

    // Placing a selection into the columns. Files and boards land on the
    // right; anything from Chat reopens the left — and, narrow, closes the
    // doc so the chat actually shows.
    const placeSelection = (next: RailSelection) => {
        if (next.kind === 'discussions' || next.kind === 'files') return
        if (next.kind === 'file' || next.kind === 'whiteboard') {
            setDocKey(next.assetId)
            setDocIsBoard(next.kind === 'whiteboard' || spaces.isWhiteboardPath(entryById.get(next.assetId)?.path ?? ''))
        } else if (next.kind === 'attachment') {
            setChatOpen(true)
            setDocKey(next.src)
        } else {
            setChatOpen(true)
            if (!twoFits) setDocKey(null)
        }
    }

    /**
     * A brand-new file (born here, or the tree's "+ New file"): the org hands
     * back the record, the listing learns it before the refetch, the listing
     * store follows, and the caller opens it by id.
     */
    const createFile = async (input: spaces.SpacesCreateInput): Promise<spaces.SpacesAssetEntry> => {
        const { asset } = await window.ipc.invoke('spaces:createAsset', { orgId: org.id, spaceId: space.id, input })
        setEntries((prev) => {
            const next = [...prev.filter((e) => e.id !== asset.id), asset]
            noteListingFromEntries(org.id, space.id, next)
            return next
        })
        return asset
    }

    // ------------------------------------------------------------------
    // Whiteboard: a board is what the right column holds when the open asset's
    // path is whiteboards/<name>.excalidraw — reached from the rail, the
    // header button (⌘4, the most recent board; the default board is created
    // when none exists yet), an artifact link, a deep link, or history. It
    // must never render as raw JSON in the document pane.
    // ------------------------------------------------------------------
    const spaceRefs = useMemo(() => ({ orgId: org.id, orgAddress: org.address, spaceId: space.id }), [org.id, org.address, space.id])
    const isBoardKey = (key: string | null): key is string => {
        if (!key || isAttachmentKey(key)) return false
        const entry = entryById.get(key)
        // A just-created or remembered board can beat the listing: the
        // selection, or the column memory, says what it is.
        return entry ? spaces.isWhiteboardPath(entry.path) : (selection.kind === 'whiteboard' && selection.assetId === key) || (key === docKey && docIsBoard)
    }
    const boardId = isBoardKey(docRender) ? docRender : null
    const isWhiteboard = isBoardKey(docKey)
    const boards = entries.filter((e) => spaces.isWhiteboardPath(e.path) && !e.state)
    const toggleWhiteboard = () => {
        if (isWhiteboard) {
            closeDoc()
            return
        }
        analytics.spacesTabViewed('whiteboard')
        const recent = [...boards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        if (recent) {
            onSelect({ kind: 'whiteboard', assetId: recent.id })
            return
        }
        // No board yet: the default one is born now, then opens.
        createFile({ path: spaces.DEFAULT_WHITEBOARD_PATH, newContent: spaces.EMPTY_WHITEBOARD_CONTENT, reason: 'new whiteboard' })
            .then((asset) => select({ kind: 'whiteboard', assetId: asset.id }))
            .catch((err) => toast(err instanceof Error ? err.message : 'Could not create the board', 'error'))
    }
    toggleWhiteboardRef.current = toggleWhiteboard
    /**
     * The rail's "+": an explicitly named board exists from the moment it is
     * created — an empty snapshot files the asset right away, so the rail
     * lists it (highlighted) before the first stroke and an untouched board
     * still survives navigating away. A taken name just opens that board.
     */
    const createBoard = (path: string) => {
        const existing = entries.find((e) => e.path === path && !e.state)
        if (existing) {
            select({ kind: 'whiteboard', assetId: existing.id })
            return
        }
        createFile({ path, newContent: spaces.EMPTY_WHITEBOARD_CONTENT, reason: 'new whiteboard' })
            .then((asset) => select({ kind: 'whiteboard', assetId: asset.id }))
            .catch((err) => toast(err instanceof Error ? err.message : 'Could not create the board', 'error'))
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
        analytics.spacesTabViewed(next.kind === 'general' ? 'general' : (next.kind === 'file' || next.kind === 'files' || next.kind === 'attachment') ? 'files' : next.kind === 'whiteboard' ? 'whiteboard' : 'topics')
        placeSelection(next)
    }
    const openFile = (assetId: string) => select({ kind: 'file', assetId })
    /**
     * The tree's "+ New file": the file is born empty at the typed path (the
     * org refuses an occupied one, so a name already in use just opens that
     * file) and opens by id, ready to edit.
     */
    const createNamedFile = (path: string) => {
        const existing = entries.find((e) => e.path === path && !e.state)
        if (existing) {
            openFile(existing.id)
            return
        }
        createFile({ path, newContent: '', reason: 'new file' })
            .then((asset) => openFile(asset.id))
            .catch((err) => toast(err instanceof Error ? err.message : 'Could not create the file', 'error'))
    }
    /** A canonical link into another space the reader is in: the org address names the org, App does the navigation. */
    const resolveSpace = (orgAddress: string, spaceId: string): string | null => {
        const target = orgs.find((o) => o.address === orgAddress)
        return target && findSpace(target, spaceId) ? target.id : null
    }
    const openSpaceFile = (orgId: string, spaceId: string, assetId: string) => {
        if (orgId === org.id && spaceId === space.id) openFile(assetId)
        else onSwitchSpace(orgId, spaceId, { kind: 'file', assetId })
    }
    const resolveOrg = (orgAddress: string): string | null => orgs.find((o) => o.address === orgAddress)?.id ?? null
    /** A person link or the popover's Message action: the org creates the DM on first use, the listing learns it, then it opens. */
    const openDirect = (orgId: string, memberId: string) => {
        void window.ipc.invoke('spaces:openDirect', { orgId, memberId })
            .then(async ({ space: dm }) => {
                await refreshSpacesOrgs()
                if (dm.id !== space.id) onSwitchSpace(orgId, dm.id)
            })
            .catch((err) => toast(err instanceof Error ? err.message : 'Could not open the conversation', 'error'))
    }
    /** A message link: read the message to learn its thread, then land on it — here, or in the space it lives in. */
    const openMessage = (orgId: string, spaceId: string, messageId: string) => {
        void window.ipc.invoke('spaces:getMessage', { orgId, spaceId, messageId })
            .then(({ message }) => {
                const rootId = message.threadRoot ?? STREAM_READ_KEY
                if (orgId === org.id && spaceId === space.id) {
                    navigateToMessage(rootId, messageId, message.offset)
                    return
                }
                requestJump({ topicId: rootId, messageId, offset: message.offset })
                onSwitchSpace(orgId, spaceId, rootId === STREAM_READ_KEY ? { kind: 'general' } : { kind: 'thread', rootMessageId: rootId })
            })
            .catch((err) => toast(err instanceof Error ? err.message : 'Could not open the message', 'error'))
    }
    /** A space chip: this space's lands on its stream; another's opens there. */
    const openSpace = (orgId: string, spaceId: string) => {
        if (orgId === org.id && spaceId === space.id) select({ kind: 'general' })
        else onSwitchSpace(orgId, spaceId)
    }

    /** Search / pinned / saved landings: open the surface, then scroll + flash (the offset, when held, spares the pane a lookup). */
    const navigateToMessage = (rootMessageId: string, messageId: string, offset?: number) => {
        requestJump({ topicId: rootMessageId, messageId, ...(offset !== undefined ? { offset } : {}) })
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
    // projects the link as an asset id (even while the file is in Trash —
    // then the listing does not have it, and nothing opens). Once per visit:
    // closing the column marks the thread as dismissed until the reader
    // leaves it (closeDoc); a different file they open themselves is never
    // fought — this only fires when the selection or the link itself
    // changes, and only where two columns fit (narrow, the chat wins, as
    // everywhere). The stream copy is read first: it is the one a local
    // attach updates before the feed refetches.
    const selectedThreadRoot = selection.kind === 'thread' ? selection.rootMessageId : null
    const linkedAssetId = selectedThreadRoot
        ? (stream.topicsByRoot.get(selectedThreadRoot) ?? feed.topics.find((t) => t.rootMessageId === selectedThreadRoot))?.documentAssetId ?? null
        : null
    const linkedDocId = linkedAssetId && entryById.get(linkedAssetId)?.state !== 'deleted' && entryById.has(linkedAssetId) ? linkedAssetId : null
    const linkedDocDismissedRef = useRef<string | null>(null)
    useEffect(() => {
        // Leaving the dismissed thread — for the stream or another thread —
        // forgets the dismissal; a file opened from it keeps it.
        if (selection.kind === 'general' || (selectedThreadRoot && linkedDocDismissedRef.current !== selectedThreadRoot)) {
            linkedDocDismissedRef.current = null
        }
    }, [selection.kind, selectedThreadRoot])
    useEffect(() => {
        if (!selectedThreadRoot || !linkedDocId || !twoFits) return
        if (linkedDocDismissedRef.current === selectedThreadRoot) return
        setDocKey((open) => (open === linkedDocId ? open : linkedDocId))
        setChatOpen(true)
        // Keyed on the thread and the link — not on docKey, which the
        // reader moves freely once the column is open.
    }, [selectedThreadRoot, linkedDocId, twoFits])

    // The last closed file — the header chip reopens it beside the chat.
    const [lastDoc, setLastDoc] = useState<{ assetId: string; fromThreadRootId?: string } | null>(null)
    const lastDocEntry = lastDoc ? entryById.get(lastDoc.assetId) : undefined

    // The document in the right column (a board renders through boardId, an attachment through its URL).
    const centerAssetId = docRender && !isAttachmentKey(docRender) && !boardId ? docRender : null

    /** Open a file from inside a thread — the file view gets a crumb back to it. */
    const openFileFromThread = (rootMessageId: string) => (assetId: string) => select({ kind: 'file', assetId, fromThreadRootId: rootMessageId })


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
        // A board reached as a file (an artifact link) is still a board: no "Reopen" chip.
        if (selection.kind === 'file' && !isBoardKey(selection.assetId)) {
            setLastDoc({ assetId: selection.assetId, fromThreadRootId: selection.fromThreadRootId })
        }
        // Closing beside a discussion is a choice: its linked file stays
        // closed until the reader leaves and comes back.
        if (chatRootId) linkedDocDismissedRef.current = chatRootId
        setDocKey(null)
        setChatOpen(true)
        if (selection.kind === 'file' || selection.kind === 'whiteboard' || selection.kind === 'attachment') {
            onSelect(chatRootId ? { kind: 'thread', rootMessageId: chatRootId } : { kind: 'general' })
        }
    }
    const closeChat = () => setChatOpen(false)
    const reopenDoc = () => {
        if (lastDoc) select({ kind: 'file', assetId: lastDoc.assetId, fromThreadRootId: lastDoc.fromThreadRootId })
    }

    // Crumb for a file opened from a thread: the discussion's goal, else the
    // root's first line, else a generic label.
    const crumbRootId = selection.kind === 'file' ? selection.fromThreadRootId ?? null : null
    const crumbTopic = crumbRootId ? feed.topics.find((t) => t.rootMessageId === crumbRootId) : undefined
    const crumbRoot = crumbRootId ? stream.messages.find((m) => m.id === crumbRootId) : undefined
    const crumbLabelRaw = crumbTopic?.title ?? (crumbRoot ? threadLabelOf(crumbRoot.body) : crumbRootId ? 'Back to thread' : null)
    const crumbLabel = crumbLabelRaw === null ? null : resolveMentions(crumbLabelRaw, memberNames, spaceNames)

    // Files picked (rail Upload button) or dropped on the tree, awaiting the
    // upload confirmation. Default to Space files; choosing a folder is optional.
    const [uploadFiles, setUploadFiles] = useState<File[] | null>(null)
    const [trashOpen, setTrashOpen] = useState(false)

    return (
        <SpaceMembersProvider members={memberNames} spaceNames={spaceNames}>
        <SpaceProfilesProvider members={profiles} here={hereSet} selfId={org.memberId}>
        <SpaceRefsProvider refs={spaceRefs}>
        <SpaceAssetsProvider entries={entries}>
        <SpaceNavProvider onOpenFile={openFile} onOpenSpaceFile={openSpaceFile} onOpenSpace={openSpace} onOpenMessage={openMessage} onOpenDirect={openDirect} resolveOrg={resolveOrg} resolveSpace={resolveSpace} onOpenAttachment={(src, name) => {
            const url = new URL(src)
            url.searchParams.set('name', name)
            select({ kind: 'attachment', src: url.href, ...(chatRootId ? { fromThreadRootId: chatRootId } : {}) })
        }}>
        <div className="spaces-surface relative flex-1 min-h-0 flex flex-col">
            {/* One per pane — covers the stream and thread panes alike. */}
            {active && <SelectionCopy />}
            <header className="spaces-header flex shrink-0 items-center gap-2 border-b border-border">
                <ServerSwitcher org={org} onOpenSpace={onSwitchSpace} />
                <span aria-hidden="true" className="shrink-0 text-muted-foreground/50">/</span>
                {/* Click to keep the identity card and its copy actions open. */}
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label={isDirect ? 'Conversation details' : 'Space details'}
                            className="flex h-9 min-w-0 max-w-[320px] shrink items-center gap-2 rounded-md pl-1 pr-2 hover:bg-accent/60 data-[state=open]:bg-accent/60"
                        >
                            <span className={cn('flex min-w-0 items-center', isDirect ? 'gap-1.5' : 'gap-0.5')}>
                                {isDirect
                                    ? <MemberAvatar id={directOtherId} name={spaceTitle} size="sm" />
                                    : <Hash className="size-4 shrink-0 text-muted-foreground" />}
                                <h1 className="truncate text-[15px] font-semibold">{spaceTitle}</h1>
                            </span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" sideOffset={4} className="w-80 px-5 pb-5 pt-6">
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
                        <div className="mt-4 flex flex-col gap-1 border-t border-border pt-3">
                            <Button variant="ghost" size="sm" className="justify-start" onClick={() => void copySpacesLink(spaces.spaceUrl(org.address, space.id))}>
                                <LinkIcon className="size-3.5" /> {isDirect ? 'Copy conversation link' : 'Copy space link'}
                            </Button>
                            {isDirect && (
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => void copySpacesLink(spaces.memberUrl(org.address, directOtherId))}>
                                    <LinkIcon className="size-3.5" /> Copy member link
                                </Button>
                            )}
                            <Button variant="ghost" size="sm" className="justify-start" onClick={() => void copySpacesLink(spaces.orgUrl(org.address))}>
                                <LinkIcon className="size-3.5" /> Copy server link
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>

                {/* Centre: search gets the room. */}
                <div className="flex min-w-0 flex-1 justify-center px-2">
                    <SpaceSearch orgId={org.id} spaceId={space.id} selfMemberId={org.memberId} onNavigate={select} className="w-full max-w-[480px]" />
                </div>

                {/* Right: Invite (a DM's membership is fixed — nobody to
                    invite), members as one pill (a dot when anyone is here —
                    the roster says who), then the tools. */}
                {!isDirect && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                title={`Invite someone to #${space.name}`}
                                className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=open]:bg-accent/60 data-[state=open]:text-foreground"
                            >
                                <UserPlus className="size-3.5" />
                                <span>Invite</span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-96 p-3">
                            <InviteLinkPanel orgId={org.id} spaceId={space.id} spaceName={space.name} />
                        </PopoverContent>
                    </Popover>
                )}
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
                {!docOpen && lastDocEntry && !lastDocEntry.state && (
                    <button
                        type="button"
                        onClick={reopenDoc}
                        title={`Reopen ${lastDocEntry.path} beside the conversation`}
                        className="inline-flex h-6 max-w-[14rem] items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    >
                        <FileText className="size-3 shrink-0" />
                        <span className="truncate font-mono text-[11px]">{lastDocEntry.path.split('/').pop()}</span>
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
                    onOpenMessage={onOpenMessage}
                    active={active}
                    onOpenActivity={onOpenActivity}
                    org={org}
                    onOpenSpace={(orgId, spaceId) => {
                        if (orgId === org.id && spaceId === space.id) select({ kind: 'general' })
                        else onSwitchSpace(orgId, spaceId)
                    }}
                    spaceId={space.id}
                    open={railOpen}
                    onTogglePin={toggleRailPin}
                />
                <div className="flex min-w-0 min-h-0 flex-1 flex-col">
                    <SpaceContentTabs orgId={org.id} orgAddress={org.address} spaceId={space.id} direct={isDirect} topics={feed.topics}
                        entries={entries} unreadAssetIds={unreadAssetIds} selection={selection} memberNames={memberNames}
                        spaceNames={spaceNames} onSelect={select} topicsLoaded={feed.loaded} filesLoaded={filesLoaded} filesError={filesError} />
                    {selection.kind === 'discussions' && <SpaceDiscussionsView orgId={org.id} orgAddress={org.address} spaceId={space.id}
                        topics={feed.topics} direct={isDirect} loaded={feed.loaded} memberNames={memberNames} spaceNames={spaceNames}
                        presence={presence} onOpen={(rootMessageId) => select({ kind: 'thread', rootMessageId })} />}
                    {selection.kind === 'files' && <>
                        {filesError && <div role="alert" className="flex items-center gap-3 px-5 py-2 text-xs text-destructive">
                            Could not refresh files. <button type="button" className="underline" onClick={() => setRefreshTick((tick) => tick + 1)}>Retry</button>
                        </div>}
                        {!filesLoaded && <p className="px-5 py-2 text-xs text-muted-foreground">Loading files…</p>}
                        <SpaceFilesView orgId={org.id} orgAddress={org.address} spaceId={space.id} entries={entries} draftFolders={draftFolders}
                            unreadAssetIds={unreadAssetIds} selection={selection} onSelect={select} onCreateFile={createNamedFile}
                            onCreateBoard={createBoard} onUploadFiles={setUploadFiles} onOpenTrash={() => setTrashOpen(true)}
                            onAddFolder={addFolder} onRemoveFolder={removeFolder} />
                    </>}
                {/* The columns. Chat on the left — the stream, or an open
                    thread beside it when there is room. The stream never
                    unmounts while the space is open — a thread, or a doc
                    taking a narrow pane, hides it (keep-alive). The doc column on
                    the right holds a file or a board. Both keep fixed tree
                    positions (the divider slot stays in the array) so going
                    one ⇄ two columns never remounts either surface. */}
                <div ref={columnsRef} className={cn('flex-1 min-w-0 min-h-0', collectionOpen ? 'hidden' : 'flex')}>
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
                            memberNames={memberNames}
                            onOpenThread={(id) => select({ kind: 'thread', rootMessageId: id })}
                            onOpenSession={onOpenSession}
                            onClose={split ? closeChat : undefined}
                            visible={active && !collectionOpen && showChat && (!chatRootId || threadBesideStream)}
                            composeActive={!chatRootId}
                            showHeader={threadBesideStream || split || !!stream.error}
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
                                visible={active && !collectionOpen && showChat}
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
                    <div style={docAnim ? { width: docAnim.width } : undefined} className={cn('flex min-w-0 min-h-0', docAnim ? 'shrink-0' : 'flex-1', !split && !boardId && 'justify-center')}>
                        {isAttachmentKey(docRender) ? (
                            <AttachmentColumn key={docRender} src={docRender} onDismiss={closeDoc} onSaved={(saved) => {
                                setRefreshTick((tick) => tick + 1)
                                select({ kind: 'file', assetId: saved.assetId, ...(chatRootId ? { fromThreadRootId: chatRootId } : {}) })
                            }} />
                        ) : boardId ? (
                            // Keyed by id so switching boards remounts a fresh collab session (a rename does not).
                            <Suspense
                                fallback={
                                    <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="size-3.5 animate-spin" /> Opening board…
                                    </div>
                                }
                            >
                                <WhiteboardPane
                                    key={boardId}
                                    org={org}
                                    space={space}
                                    boardId={boardId}
                                    memberNames={memberNames}
                                    active={active && !collectionOpen}
                                    boards={boards.map((b) => ({ id: b.id, path: b.path }))}
                                    onSelectBoard={(assetId) => select({ kind: 'whiteboard', assetId })}
                                    onCreateBoard={createBoard}
                                    onClose={closeDoc}
                                />
                            </Suspense>
                        ) : centerAssetId ? (
                            <div
                                className={cn('flex min-w-0 min-h-0 flex-1', !split && !getViewerType(entryById.get(centerAssetId)?.path ?? '') && 'mx-auto max-w-[880px]')}
                                // Beside the stream the markdown editor steps its headings
                                // down to the compact scale (see editor.css).
                                data-split-pane={split ? '' : undefined}
                            >
                                <FileColumn
                                    key={centerAssetId}
                                    org={org}
                                    space={space}
                                    assetId={centerAssetId}
                                    entries={entries}
                                    memberNames={memberNames}
                                    refreshTick={refreshTick}
                                    onChanged={() => setRefreshTick((t) => t + 1)}
                                    onOpenFile={openFile}
                                    onOpenSpaceFile={(orgAddress, spaceId, assetId) => {
                                        const orgId = resolveSpace(orgAddress, spaceId)
                                        if (orgId) openSpaceFile(orgId, spaceId, assetId)
                                        else toast('That file is in a space you are not in', 'error')
                                    }}
                                    onDeleted={() => { setDocKey(null); select({ kind: 'general' }) }}
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
        </SpaceAssetsProvider>
        </SpaceRefsProvider>
        </SpaceProfilesProvider>
        </SpaceMembersProvider>
    )
}

type InviteLinkState =
    | { kind: 'loading' }
    | { kind: 'ready'; link: string }
    | { kind: 'error'; message: string }

/** How much of the link's end stays visible when it is too long: enough of the token to recognise. */
const INVITE_LINK_TAIL = 10

/**
 * The link as plain monospace text, no box — a box says "type here". Too
 * long for the line, it truncates in the MIDDLE: the head gives way (an
 * ellipsis at its end) while the last characters stay put, so the token's
 * end is always there to recognise. The DOM holds the whole URL, so a click,
 * a drag or a copy carries all of it, not just what happens to be visible.
 */
function InviteLinkText({ link }: { link: string }) {
    const head = link.slice(0, -INVITE_LINK_TAIL)
    const tail = link.slice(-INVITE_LINK_TAIL)
    const selectAll = (el: HTMLElement) => {
        const selection = window.getSelection()
        if (!selection) return
        const range = document.createRange()
        range.selectNodeContents(el)
        selection.removeAllRanges()
        selection.addRange(range)
    }
    return (
        <span
            title={link}
            onClick={(e) => selectAll(e.currentTarget)}
            className="block w-full cursor-text select-text whitespace-nowrap font-mono text-xs leading-6"
        >
            {/* The head is an inline block (not a flex item) on purpose: block-level
                pieces would put a line break between them in copied text. Its
                width comes from spaces.css (.spaces-invite-link-head). */}
            <span
                className="spaces-invite-link-head inline-block overflow-hidden text-ellipsis align-bottom"
                style={{ '--tail': `${INVITE_LINK_TAIL}ch` } as React.CSSProperties}
            >{head}</span><span>{tail}</span>
        </span>
    )
}

/**
 * The header's Invite popover: the link as selectable text, a Copy button
 * that says "Copied" for a beat, and one line on who the link admits. A link
 * is minted each time the popover opens (its content mounts fresh), so there
 * is nothing stale to hand out.
 */
function InviteLinkPanel({ orgId, spaceId, spaceName }: { orgId: string; spaceId: string; spaceName: string }) {
    const [state, setState] = useState<InviteLinkState>({ kind: 'loading' })
    const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

    useEffect(() => {
        let cancelled = false
        window.ipc.invoke('spaces:createInvite', { orgId, spaceId }).then(
            (result) => { if (!cancelled) setState({ kind: 'ready', link: result.link }) },
            (err: unknown) => {
                if (cancelled) return
                setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not create an invite' })
            },
        )
        return () => { cancelled = true }
    }, [orgId, spaceId])

    const copyLink = (link: string) =>
        navigator.clipboard.writeText(link).then(
            () => {
                analytics.spacesInviteLinkCopied()
                setCopy('copied')
                if (timer.current) clearTimeout(timer.current)
                timer.current = setTimeout(() => setCopy('idle'), 1000)
            },
            () => setCopy('failed'),
        )

    const link = state.kind === 'ready' ? state.link : ''
    return (
        <div className="flex flex-col gap-2">
            {state.kind === 'ready'
                ? <InviteLinkText link={state.link} />
                : <span className="block font-mono text-xs leading-6 text-muted-foreground">{state.kind === 'loading' ? 'Creating link…' : 'No link'}</span>}
            <div className="flex items-center justify-between gap-3">
                {state.kind === 'error'
                    ? <p className="text-xs text-destructive">{state.message}</p>
                    : copy === 'failed'
                        ? <p className="text-xs text-destructive">Could not copy. Select the link above and copy it instead.</p>
                        : <p className="text-xs text-muted-foreground">Anyone with it can join #{spaceName} on Rowboat.</p>}
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={state.kind !== 'ready'}
                    onClick={() => void copyLink(link)}
                    className="min-w-24 rounded-md"
                >
                    {copy === 'copied'
                        ? <><Check className="size-3.5 text-[var(--rowboat-success)]" /> Copied</>
                        : 'Copy link'}
                </Button>
            </div>
        </div>
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
