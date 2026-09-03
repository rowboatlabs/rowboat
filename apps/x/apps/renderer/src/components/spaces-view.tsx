import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, Check, Clock, Columns2, Copy, FileText, FolderOpen, Hash, Link as LinkIcon, Loader2, MoreHorizontal, PenTool, Plus, Users } from 'lucide-react'
import { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AddOrgDialog, MemberAvatar, MemberProfilePopover, OrgMonogram } from '@/components/spaces/atoms'
import { BookmarksPopover } from '@/components/spaces/bookmarks'
import { FileColumn, TrashDialog, UploadFilesDialog } from '@/components/spaces/files-tab'
import { GeneralStream } from '@/components/spaces/general-stream'
import { ScheduledDialog } from '@/components/spaces/scheduled-dialog'
import { SelectionCopy } from '@/components/spaces/selection-copy'
import { SpaceRail } from '@/components/spaces/space-rail'
import { SpaceSearch } from '@/components/spaces/space-search'
import { railKey, type RailSelection } from '@/lib/spaces-selection'
import { ThreadPane } from '@/components/spaces/thread-pane'
import { STREAM_READ_KEY, useSpacePresence, useStream } from '@/hooks/use-space-chat'
import { useSpaceFeed, useSpaceLastReadAt, useSpaceLive, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { useSpaceNotifyPrefs, type NotifyLevel } from '@/hooks/use-spaces-notify'
import { requestJump } from '@/lib/spaces-jump'
import { chord } from '@/lib/shortcut'
import { SpaceMembersProvider, SpaceProfilesProvider } from '@/components/spaces/member-text'
import { SpaceNavProvider, SpaceRefsProvider } from '@/components/spaces/space-markdown'
import { artifactsForThread, threadLabelOf } from '@/lib/spaces-conventions'
import { isUnreadChange, resolveMentions } from '@/lib/spaces-presentation'
import { markRead, markTopicRead } from '@/lib/spaces-read-state'
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
export type SpaceSelection = { orgId: string; spaceId: string } | null

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
                onSwitchSpace={(orgId, spaceId) => {
                    onSelect({ orgId, spaceId })
                    // The old space's rail selection means nothing over there.
                    onRailSelect({ kind: 'general' })
                }}
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
    /** The quick switcher can land on another space entirely. */
    onSwitchSpace: (orgId: string, spaceId: string) => void
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

    // Space-wide notification level ('mentions' is the default; topics
    // override per-row from the rail's menus).
    const notify = useSpaceNotifyPrefs(org.id, space.id)
    const notifyChoices: { level: NotifyLevel; label: string }[] = [
        { level: 'all', label: 'All messages' },
        { level: 'mentions', label: 'Mentions only' },
        { level: 'mute', label: 'Muted' },
    ]

    // Do-not-disturb — one global until-instant; the mention watcher (main)
    // drops everything while it holds. The bell shows the state.
    const [dndUntil, setDndUntilState] = useState<string | null>(null)
    useEffect(() => {
        void window.ipc.invoke('spaces:getDnd', null).then((r) => setDndUntilState(r.until)).catch(() => {})
    }, [])
    // A clock the render may read: ticks every 30s so the bell clears itself
    // when the DND instant passes (Date.now() in render is impure and never
    // re-runs on its own).
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(t)
    }, [])
    const dndActive = !!dndUntil && new Date(dndUntil).getTime() > now
    const setDnd = (minutes: number | null) => {
        const until = minutes === null ? null : new Date(Date.now() + minutes * 60_000).toISOString()
        setDndUntilState(until)
        void window.ipc.invoke('spaces:setDnd', { until }).catch(() => {})
    }
    const setDndUntilTomorrow = () => {
        const t = new Date()
        t.setDate(t.getDate() + 1)
        t.setHours(9, 0, 0, 0)
        setDndUntilState(t.toISOString())
        void window.ipc.invoke('spaces:setDnd', { until: t.toISOString() }).catch(() => {})
    }

    // The scheduled sends/reminders list (⋯ menu).
    const [scheduledOpen, setScheduledOpen] = useState(false)

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
    // Columns. The chat (stream or thread) sits on the left; an open file or
    // board on the right. `docPath` = what the right column holds (null =
    // closed); `chatOpen` = whether the left one is showing beside it. What
    // renders is derived below — two columns only when both are open AND
    // the pane is wide enough.
    // ------------------------------------------------------------------
    const memoryKey = `${org.id}/${space.id}`
    const [docPath, setDocPath] = useState<string | null>(() => {
        if (selection.kind === 'file' || selection.kind === 'whiteboard') return selection.path
        return columnMemory.get(memoryKey)?.docPath ?? null
    })
    const [chatOpen, setChatOpen] = useState(() => columnMemory.get(memoryKey)?.chatOpen ?? true)
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
    // slack; content inside is fixed at the final width and anchored to the
    // far edge, so the doc slides in from the right and the chat from the
    // left. Detected during render (the state pattern React documents for
    // deriving from props) so the very first frame is already animating —
    // an effect would flash the settled layout once. A doc change wins over
    // a chat change in the same step: narrow, opening a doc pushes the chat
    // out with it.
    // ------------------------------------------------------------------
    const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
    const columnsRef = useRef<HTMLDivElement | null>(null)
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
        if (next.kind === 'file' || next.kind === 'whiteboard') {
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
        analytics.spacesTabViewed(next.kind === 'general' ? 'general' : next.kind === 'file' ? 'files' : next.kind === 'whiteboard' ? 'whiteboard' : 'topics')
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

    // The last closed file — the header chip reopens it beside the chat.
    const [lastDoc, setLastDoc] = useState<{ path: string; fromThreadRootId?: string } | null>(null)

    // The document in the right column (a board renders through boardPath instead).
    const centerPath = docRender && !spaces.isWhiteboardPath(docRender) ? docRender : null

    /** Open a file from inside a thread — the file view gets a crumb back to it. */
    const openFileFromThread = (rootMessageId: string) => (path: string) => select({ kind: 'file', path, fromThreadRootId: rootMessageId })


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

    // Closing the right column lands on the conversation that was beside
    // it (or behind it, narrow). A closed file is remembered (lastDoc) so
    // the header chip can bring it back. Closing the left column just hides
    // it; the doc takes the width.
    function closeDoc() {
        if (selection.kind === 'file' && !spaces.isWhiteboardPath(selection.path)) {
            setLastDoc({ path: selection.path, fromThreadRootId: selection.fromThreadRootId })
        }
        setDocPath(null)
        setChatOpen(true)
        if (selection.kind === 'file' || selection.kind === 'whiteboard') {
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
    // destination-folder dialog. Prefill the open file's folder when there is one.
    const [uploadFiles, setUploadFiles] = useState<File[] | null>(null)
    const [trashOpen, setTrashOpen] = useState(false)
    const uploadDefaultFolder = centerPath?.includes('/') ? centerPath.slice(0, centerPath.lastIndexOf('/')) : ''

    return (
        <SpaceMembersProvider members={memberNames}>
        <SpaceProfilesProvider members={members} here={hereSet} selfId={org.memberId}>
        <SpaceRefsProvider refs={{ orgId: org.id, orgAddress: org.address, spaceId: space.id }}>
        <SpaceNavProvider onOpenFile={openFile}>
        <div className="relative flex-1 min-h-0 flex flex-col">
            {/* One per pane — covers the stream and thread panes alike. */}
            {active && <SelectionCopy />}
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
                {/* Left: the org's mark, then # the space. Hover it for what the
                    old identity card said — org name, address, who you are.
                    Inviting lives with the members; nothing here repeats it. */}
                <HoverCard openDelay={200} closeDelay={150}>
                    <HoverCardTrigger asChild>
                        <button
                            type="button"
                            className="flex h-9 max-w-[320px] shrink-0 items-center gap-2 rounded-md pl-1 pr-2 hover:bg-accent/60 data-[state=open]:bg-accent/60"
                        >
                            <OrgMonogram org={org} />
                            <span className="flex min-w-0 items-center gap-0.5">
                                <Hash className="size-4 shrink-0 text-muted-foreground" />
                                <h1 className="truncate text-[15px] font-semibold">{space.name}</h1>
                            </span>
                        </button>
                    </HoverCardTrigger>
                    <HoverCardContent align="start" sideOffset={4} className="w-72 p-3">
                        <div className="flex items-center gap-2.5">
                            <OrgMonogram org={org} />
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{org.name}</div>
                                <div className="truncate text-xs text-muted-foreground">{org.address}</div>
                            </div>
                        </div>
                        <div className="mt-2 truncate text-xs text-muted-foreground">
                            #{space.name} · you are <span className="font-mono">{org.memberId}</span>
                        </div>
                        <div className="mt-2 border-t border-border pt-2">
                            <button
                                type="button"
                                onClick={() => void navigator.clipboard.writeText(org.address).then(() => toast('Address copied', 'success'))}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <Copy className="size-3.5" /> Copy address
                            </button>
                        </div>
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
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            title={dndActive
                                ? `Do not disturb until ${new Date(dndUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                                : `Notifications — ${notifyChoices.find((c) => c.level === (notify.spaceLevel ?? 'mentions'))?.label ?? 'Mentions only'}`}
                            className={cn(
                                'inline-flex size-7 items-center justify-center rounded-md hover:bg-accent',
                                dndActive ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {dndActive || notify.spaceLevel === 'mute' ? <BellOff className="size-4" /> : <Bell className="size-4" />}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {/* The space's level — what reaches you from here. */}
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">This space</DropdownMenuLabel>
                        {notifyChoices.map((c) => (
                            <DropdownMenuItem key={c.level} onClick={() => notify.setSpaceLevel(c.level)}>
                                <Check className={cn('size-3.5 mr-2', (notify.spaceLevel ?? 'mentions') !== c.level && 'opacity-0')} /> {c.label}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        {/* Do not disturb — everything, for a while. */}
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            {dndActive ? `Do not disturb until ${new Date(dndUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Do not disturb'}
                        </DropdownMenuLabel>
                        {dndActive && (
                            <DropdownMenuItem onClick={() => setDnd(null)}>
                                <Bell className="size-3.5 mr-2" /> Turn off
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setDnd(30)}>For 30 minutes</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDnd(60)}>For 1 hour</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDnd(120)}>For 2 hours</DropdownMenuItem>
                        <DropdownMenuItem onClick={setDndUntilTomorrow}>Until tomorrow 9:00</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
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
                    notify={notify}

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
                    thread. The stream is the expensive surface, so it never
                    unmounts while the space is open — a thread, or a doc
                    taking the pane, HIDES it (keep-alive). The doc column on
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
                            onClose={split ? closeChat : undefined}
                            visible={active && showChat && !chatRootId}
                        />
                    </div>
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
                        {boardPath ? (
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
                            <div className={cn('flex min-w-0 min-h-0 flex-1', !split && 'mx-auto max-w-[880px]')}>
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
                    defaultFolder={uploadDefaultFolder}
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
