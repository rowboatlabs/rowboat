import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Bell, BellOff, Bot, Check, CornerDownRight, FileText, FolderPlus, MessageSquare, MessageSquareOff, MessagesSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, PenTool, Plus, Trash2, Upload } from 'lucide-react'
import { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
    DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub,
    ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { toast } from '@/lib/toast'
import { FileTree } from '@/components/spaces/files-tab'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import type { NotifyLevel, SpaceNotifyHandle } from '@/hooks/use-spaces-notify'
import type { SpacePresence, StreamState } from '@/hooks/use-space-chat'
import { STREAM_READ_KEY } from '@/hooks/use-space-chat'
import { useMemberNames } from '@/components/spaces/member-text'
import { threadRefOf } from '@/lib/spaces-conventions'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import { getTopicLastReadAt } from '@/lib/spaces-read-state'
import type { RailSelection } from '@/lib/spaces-selection'

// The space's edge rail: one collapsible strip carrying the same sidebar on
// every surface. Two stacked panes, each with its own scroll — Chat
// (Messages, then the discussions) on top and Files (the tree; boards are
// files at whiteboards/<name>.excalidraw and live there with a pen icon)
// pinned to the bottom. They split the height 60/40 until the divider is
// dragged (then the Files height sticks, persisted); collapsing either
// (click its label) hands the whole height to the other. No counts, no
// filter chips, no search box — ⌘K searches, bold + dot mark unread, and
// archived discussions get their own view (Chat's ⋯ menu → back row).
// Each pane's actions sit on its label and appear on hover anywhere in the
// pane. The Discussions section lists ONLY
// deliberate topic annotations (annotation model): threads someone gave a
// goal. Plain reply chains stay behind their chips in the stream — the rail
// holds intentions, not accidents.
//
// Open/close follows Notion. Docked: a 280px sidebar in the flow (the shell
// sidebar contracts to the dock while in Spaces, so this is THE sidebar
// here); its header button closes it to a sliver at the edge. Collapsed:
// hovering the sliver slides the whole rail out as a drawer OVER the
// surfaces — nothing shifts — and it slides back once the cursor leaves
// (an open row menu holds it). The drawer's header button is the lock:
// clicking it docks the rail, the only act that moves the content.

const NOTIFY_CHOICES: { level: NotifyLevel; label: string }[] = [
    { level: 'all', label: 'All messages' },
    { level: 'mentions', label: 'Mentions only' },
    { level: 'mute', label: 'Muted' },
]

type RailSection = 'chat' | 'files'
/** Collapsed sections persist like the rail's own pin. */
const COLLAPSED_KEY = 'spaces:railCollapsed'
/** A dragged Files height persists too (null = the 60/40 default). */
const FILES_HEIGHT_KEY = 'spaces:filesHeight'
/** Resizing never leaves Files shorter than this (divider + label + a couple of rows). */
const FILES_MIN = 96
/** ...or Chat shorter than this (label + Messages + a discussion). */
const CHAT_MIN = 120
/** The collapsed rail: a sliver you hover, not a strip you read. */
const EDGE_W = 10

export function SpaceRail({
    orgId, spaceId, selfMemberId, stream, topics, changeSets, entries, draftFolders, presence, unreadPaths, notify, selection, onSelect, onCreateFile, onCreateBoard, onUploadFiles, onOpenTrash, onAddFolder, onRemoveFolder,
    open, onTogglePin,
}: {
    orgId: string
    spaceId: string
    selfMemberId: string
    stream: StreamState
    topics: spaces.TopicListing[]
    changeSets: spaces.ChangeSet[]
    entries: spaces.SpacesAssetEntry[]
    /** Local-only empty folders — see SpacePane. */
    draftFolders: readonly string[]
    presence: SpacePresence
    unreadPaths: ReadonlySet<string>
    /** The pane's notification-prefs state — shared so the header's space-level changes reflect here live. */
    notify: SpaceNotifyHandle
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    onCreateFile: (path: string) => void
    /** "New board" in the Files menu: creates the board asset AND opens it (a taken name just opens). */
    onCreateBoard: (path: string) => void
    /** Picked or dropped files headed for the space's file tree (upload dialog opens in the pane). */
    onUploadFiles: (files: File[]) => void
    /** Opens the space's Trash (deleted files, restorable). */
    onOpenTrash: () => void
    onAddFolder: (path: string) => void
    onRemoveFolder: (path: string) => void
    /** Docked (in the flow, pushing the surfaces). False = the edge sliver + hover drawer. */
    open: boolean
    /** The lock: docks a peeked rail, closes a docked one. */
    onTogglePin: () => void
}) {
    const [creatingFile, setCreatingFile] = useState<{ prefix: string } | null>(null)
    const [creatingFolder, setCreatingFolder] = useState(false)
    const [creatingBoard, setCreatingBoard] = useState(false)
    // Chat shows the live discussions, or — via its ⋯ menu — the archived
    // ones as a view of their own with a back row.
    const [chatView, setChatView] = useState<'live' | 'archived'>('live')
    const uploadInputRef = useRef<HTMLInputElement | null>(null)

    // Resizable panes: null = the 60/40 default until the divider is dragged;
    // then the Files height sticks. Dragging up grows Files.
    const [filesHeight, setFilesHeight] = useState<number | null>(() => {
        const stored = Number(localStorage.getItem(FILES_HEIGHT_KEY))
        return Number.isFinite(stored) && stored >= FILES_MIN ? stored : null
    })
    const [resizing, setResizing] = useState(false)
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const filesRef = useRef<HTMLElement | null>(null)
    const startResize = (e: React.MouseEvent) => {
        e.preventDefault()
        const start = { y: e.clientY, height: filesRef.current?.clientHeight ?? 0 }
        setResizing(true)
        const onMove = (ev: MouseEvent) => {
            const bodyHeight = bodyRef.current?.clientHeight ?? window.innerHeight
            const next = start.height + (start.y - ev.clientY)
            setFilesHeight(Math.min(Math.max(next, FILES_MIN), Math.max(FILES_MIN, bodyHeight - CHAT_MIN)))
        }
        const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            setResizing(false)
            setFilesHeight((h) => {
                if (h !== null) localStorage.setItem(FILES_HEIGHT_KEY, String(h))
                return h
            })
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    const [collapsed, setCollapsed] = useState<ReadonlySet<RailSection>>(() => {
        try {
            const raw = localStorage.getItem(COLLAPSED_KEY)
            return new Set(raw ? (JSON.parse(raw) as RailSection[]) : [])
        } catch {
            return new Set()
        }
    })
    const toggleSection = (section: RailSection) =>
        setCollapsed((prev) => {
            const next = new Set(prev)
            if (next.has(section)) next.delete(section)
            else next.add(section)
            localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
            return next
        })

    // Row-level lifecycle actions. Rename edits inline in the row; the topic
    // event the server emits updates every other client, the refresh updates
    // this one. Every action is a one-row op — none can touch a message.
    const [renaming, setRenaming] = useState<{ topicId: string; value: string } | null>(null)
    const manageTopic = async (topicId: string, action: spaces.SpacesManageTopicAction) => {
        try {
            await window.ipc.invoke('spaces:manageTopic', { orgId, spaceId, topicId, action })
            await refreshSpaceFeed(orgId, spaceId)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not update the discussion', 'error')
        }
    }
    const commitRename = async (topicId: string, title: string) => {
        setRenaming(null)
        await manageTopic(topicId, { action: 'retitle', title })
    }

    // Per-thread notification levels (the context/⋯ menus set them; the
    // main-side watcher reads them), keyed by the thread's root message id.
    // 'mute' also earns the row a glyph.
    const effectiveLevel = (dest: string): NotifyLevel => notify.topics[dest] ?? notify.spaceLevel ?? 'mentions'

    const generalUnread = useMemo(() => {
        if (!stream.ready) return 0
        const mark = getTopicLastReadAt(orgId, spaceId, STREAM_READ_KEY)
        return stream.messages.filter((m) => !m.pending && !m.failed && !m.deletedAt && (!mark || m.postedAt > mark) && m.author.memberId !== selfMemberId).length
    }, [stream, orgId, spaceId, selfMemberId])

    const artifactFiles = useMemo(() => {
        const counts = new Map<string, Set<string>>()
        for (const cs of changeSets) {
            const ref = cs.threadRootId ?? threadRefOf(cs.reason)
            if (!ref) continue
            const set = counts.get(ref) ?? new Set<string>()
            set.add(cs.assetPath)
            counts.set(ref, set)
        }
        return counts
    }, [changeSets])

    const isUnread = (t: spaces.TopicListing) => {
        const mark = getTopicLastReadAt(orgId, spaceId, t.rootMessageId)
        return !mark || t.lastActivityAt > mark
    }

    const memberNames = useMemberNames()
    const byActivity = (a: { topic: spaces.TopicListing }, b: { topic: spaces.TopicListing }) => b.topic.lastActivityAt.localeCompare(a.topic.lastActivityAt)
    const titled = topics.map((t) => ({ topic: t, title: resolveMentions(t.title, memberNames) }))
    const liveRows = titled.filter((x) => !x.topic.archived).sort(byActivity)
    const archivedRows = titled.filter((x) => x.topic.archived).sort(byActivity)
    const archivedView = chatView === 'archived'
    const topicRows = archivedView ? archivedRows : liveRows

    const selectedRootId = selection.kind === 'thread' ? selection.rootMessageId : null
    // A board is a file in the same tree, so either selection kind highlights its row.
    const selectedPath = selection.kind === 'file' || selection.kind === 'whiteboard' ? selection.path : null
    const openEntry = (path: string) => onSelect(spaces.isWhiteboardPath(path) ? { kind: 'whiteboard', path } : { kind: 'file', path })
    const createBoard = (name: string) => {
        setCreatingBoard(false)
        const path = spaces.whiteboardPathForName(name)
        if (path) onCreateBoard(path)
    }
    const liveFiles = entries.filter((e) => !e.state).length

    // The stream mutes under its own key, like any thread.
    const generalBadge = effectiveLevel(STREAM_READ_KEY) === 'mute' ? 0 : generalUnread

    // Muted destinations don't badge here either (same posture as the sidebar).
    const unreadTopics =
        topics.filter((t) => !t.archived && isUnread(t) && effectiveLevel(t.rootMessageId) !== 'mute').length + (generalBadge > 0 ? 1 : 0)
    const badge = unreadTopics + unreadPaths.size

    // Peek: with the rail collapsed, hovering the edge slides the drawer out;
    // leaving slides it back after a beat, unless a row menu is holding it
    // (menus portal outside the rail, so the cursor "leaves" while using one).
    const [peek, setPeek] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const asideRef = useRef<HTMLElement | null>(null)
    const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clearPeekTimer = () => {
        if (peekTimer.current) clearTimeout(peekTimer.current)
        peekTimer.current = null
    }
    const scheduleClose = () => {
        clearPeekTimer()
        peekTimer.current = setTimeout(() => setPeek(false), 220)
    }
    const onEdgeEnter = () => {
        if (open) return
        clearPeekTimer()
        peekTimer.current = setTimeout(() => setPeek(true), 120)
    }
    const onEdgeLeave = () => {
        if (menuOpen) clearPeekTimer()
        else scheduleClose()
    }
    const onMenuOpenChange = (isOpen: boolean) => {
        setMenuOpen(isOpen)
        // The menu closed with the cursor already gone: slide back now.
        if (!isOpen && !open && !asideRef.current?.matches(':hover')) scheduleClose()
    }
    useEffect(() => {
        if (open) setPeek(false)
    }, [open])
    useEffect(() => clearPeekTimer, [])

    const chatCollapsed = collapsed.has('chat')
    const filesCollapsed = collapsed.has('files')
    const bothOpen = !chatCollapsed && !filesCollapsed
    // A collapsed pane is just its label; the other takes everything left.
    // With both open, a dragged Files height wins over the 60/40 default.
    const chatStyle: React.CSSProperties = chatCollapsed ? { flex: '0 0 auto' } : !bothOpen || filesHeight !== null ? { flex: '1 1 0%' } : { flex: '60 1 0%' }
    const filesStyle: React.CSSProperties = filesCollapsed
        ? { flex: '0 0 auto' }
        : !bothOpen
            ? { flex: '1 1 0%' }
            : filesHeight !== null
                ? { flex: `0 0 ${filesHeight}px`, maxHeight: `calc(100% - ${CHAT_MIN}px)` }
                : { flex: '40 1 0%' }

    // The rail's content, rendered docked or inside the peek drawer. Fixed at
    // the open width so text doesn't reflow mid-slide.
    const body = (
        <div ref={bodyRef} className={cn('flex h-full min-h-0 w-[280px] flex-col', resizing && 'select-none')}>
            <section style={chatStyle} className="group/section flex min-h-0 flex-col">
                <SectionHeader label="Chat" collapsed={chatCollapsed} count={liveRows.length} onToggle={() => toggleSection('chat')}>
                    <DropdownMenu onOpenChange={onMenuOpenChange}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Chat options"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/section:opacity-100 data-[state=open]:opacity-100"
                            >
                                <MoreHorizontal className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {archivedView ? (
                                <DropdownMenuItem onClick={() => setChatView('live')}>
                                    <ArrowLeft className="size-3.5 mr-2" /> Back to chat
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem onClick={() => setChatView('archived')}>
                                    <Archive className="size-3.5 mr-2" /> View archived{archivedRows.length > 0 ? ` (${archivedRows.length})` : ''}
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    {/* Docked: close. Peeked: the lock — dock it. Same spot, flipped glyph. */}
                    <button
                        type="button"
                        onClick={() => { setPeek(false); onTogglePin() }}
                        title={open ? 'Close sidebar' : 'Lock sidebar open'}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        {open ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
                    </button>
                </SectionHeader>
                {!chatCollapsed && (
                    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
                        {archivedView ? (
                            <button
                                type="button"
                                onClick={() => setChatView('live')}
                                title="Back to chat"
                                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-foreground/90 hover:bg-accent/50"
                            >
                                <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="flex-1 truncate font-medium">Archived</span>
                                {archivedRows.length > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{archivedRows.length}</span>}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onSelect({ kind: 'general' })}
                                className={cn(
                                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px]',
                                    selection.kind === 'general' ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 hover:bg-accent/50',
                                )}
                            >
                                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className={cn('flex-1 truncate', generalBadge > 0 && selection.kind !== 'general' && 'font-semibold')}>Messages</span>
                                {generalBadge > 0 && selection.kind !== 'general' && (
                                    <span className="text-[11px] font-semibold tabular-nums">{generalBadge}</span>
                                )}
                                {(presence.typing.get('') ?? []).length > 0 && <span className="size-1.5 rounded-full bg-[var(--rowboat-success)]" title="someone is typing" />}
                            </button>
                        )}

                        {topicRows.map(({ topic, title }) => {
                            const active = topic.rootMessageId === selectedRootId
                            const muted = effectiveLevel(topic.rootMessageId) === 'mute'
                            // Muted topics don't clamor: no bold, no dot,
                            // greyed like archived (Slack's treatment).
                            const unread = isUnread(topic) && !muted
                            const replies = topic.rootMessage?.replyCount ?? 0
                            const files = artifactFiles.get(topic.rootMessageId)
                            const working = (presence.working.get(topic.rootMessageId) ?? []).length > 0
                            if (renaming?.topicId === topic.id) {
                                return (
                                    <div key={topic.id} className="flex h-7 items-center rounded-md pl-5 pr-2">
                                        <input
                                            autoFocus
                                            value={renaming.value}
                                            onChange={(e) => setRenaming({ topicId: topic.id, value: e.target.value })}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && renaming.value.trim()) void commitRename(topic.id, renaming.value.trim())
                                                if (e.key === 'Escape') setRenaming(null)
                                            }}
                                            onBlur={() => setRenaming(null)}
                                            className="w-full rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-[13px] leading-snug outline-none"
                                            placeholder="Discussion goal"
                                        />
                                    </div>
                                )
                            }
                            return (
                                <div key={topic.id} className="group/topicrow relative">
                                    <ContextMenu onOpenChange={onMenuOpenChange}>
                                        <ContextMenuTrigger asChild>
                                            <button
                                                type="button"
                                                onClick={() => onSelect({ kind: 'thread', rootMessageId: topic.rootMessageId })}
                                                // The row shows only what changes what you do next: unread,
                                                // a Rowboat at work, muted. Replies, recency and touched files
                                                // ride the tooltip — the list is already sorted by activity.
                                                title={[
                                                    `${replies} ${replies === 1 ? 'reply' : 'replies'}`,
                                                    formatFeedTime(topic.lastActivityAt),
                                                    files && files.size > 0 ? `${files.size} ${files.size === 1 ? 'file' : 'files'} changed: ${[...files].join(', ')}` : null,
                                                ].filter(Boolean).join(' · ')}
                                                className={cn(
                                                    // One tree step (12px) in from Messages: these nest under it.
                                                    // pr-7 keeps the title and indicators clear of the ⋯ slot.
                                                    'flex h-7 w-full items-center gap-2 rounded-md pl-5 pr-7 text-left',
                                                    active ? 'bg-accent text-foreground' : 'hover:bg-accent/50',
                                                    (topic.archived || muted) && 'opacity-60',
                                                )}
                                            >
                                                {/* In the Messages icon column: a discussion branches off the stream. */}
                                                <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                                                <span className={cn('min-w-0 flex-1 truncate text-[13px]', unread ? 'font-semibold' : 'font-normal')}>{title}</span>
                                                {working && <Bot className="size-3 shrink-0 text-muted-foreground" aria-label="a Rowboat is working here" />}
                                                {muted && <BellOff className="size-3 shrink-0 text-muted-foreground" aria-label="muted" />}
                                                {unread && !active && <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-label="unread" />}
                                            </button>
                                        </ContextMenuTrigger>
                                        <ContextMenuContent>
                                            <ContextMenuItem onSelect={() => onSelect({ kind: 'thread', rootMessageId: topic.rootMessageId })}>
                                                <MessagesSquare className="size-3.5 mr-2" /> Open
                                            </ContextMenuItem>
                                            <ContextMenuItem onSelect={() => setRenaming({ topicId: topic.id, value: title })}>
                                                <Pencil className="size-3.5 mr-2" /> Rename
                                            </ContextMenuItem>
                                            <ContextMenuSub>
                                                <ContextMenuSubTrigger>
                                                    <Bell className="size-3.5 mr-2" /> Notifications
                                                </ContextMenuSubTrigger>
                                            {/* Overrides key on the thread's ROOT message id, never topic.id: the
                                                watcher (main) and the unread badge both resolve a message to
                                                `threadRoot ?? id` and look the level up by that. */}
                                                <ContextMenuSubContent>
                                                    {NOTIFY_CHOICES.map((c) => (
                                                        <ContextMenuItem key={c.level} onSelect={() => notify.setTopicLevel(topic.rootMessageId, c.level)}>
                                                            <Check className={cn('size-3.5 mr-2', notify.topics[topic.rootMessageId] !== c.level && 'opacity-0')} /> {c.label}
                                                        </ContextMenuItem>
                                                    ))}
                                                    <ContextMenuSeparator />
                                                    <ContextMenuItem onSelect={() => notify.setTopicLevel(topic.rootMessageId, null)}>
                                                        <Check className={cn('size-3.5 mr-2', notify.topics[topic.rootMessageId] && 'opacity-0')} /> Space default
                                                    </ContextMenuItem>
                                                </ContextMenuSubContent>
                                            </ContextMenuSub>
                                            <ContextMenuSeparator />
                                            {topic.archived ? (
                                                <ContextMenuItem onSelect={() => void manageTopic(topic.id, { action: 'unarchive' })}>
                                                    <ArchiveRestore className="size-3.5 mr-2" /> Unarchive
                                                </ContextMenuItem>
                                            ) : (
                                                <ContextMenuItem onSelect={() => void manageTopic(topic.id, { action: 'archive' })}>
                                                    <Archive className="size-3.5 mr-2" /> Archive
                                                </ContextMenuItem>
                                            )}
                                            <ContextMenuItem onSelect={() => void manageTopic(topic.id, { action: 'remove' })}>
                                                <MessageSquareOff className="size-3.5 mr-2" /> Convert back to thread
                                            </ContextMenuItem>
                                        </ContextMenuContent>
                                    </ContextMenu>
                                    <DropdownMenu onOpenChange={onMenuOpenChange}>
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                type="button"
                                                aria-label="Discussion actions"
                                                className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/topicrow:opacity-100 data-[state=open]:opacity-100"
                                            >
                                                <MoreHorizontal className="size-3.5" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => setRenaming({ topicId: topic.id, value: title })}>
                                                <Pencil className="size-3.5 mr-2" /> Rename
                                            </DropdownMenuItem>
                                            <DropdownMenuSub>
                                                <DropdownMenuSubTrigger>
                                                    <Bell className="size-3.5 mr-2" /> Notifications
                                                </DropdownMenuSubTrigger>
                                                <DropdownMenuSubContent>
                                                    {NOTIFY_CHOICES.map((c) => (
                                                        <DropdownMenuItem key={c.level} onClick={() => notify.setTopicLevel(topic.rootMessageId, c.level)}>
                                                            <Check className={cn('size-3.5 mr-2', notify.topics[topic.rootMessageId] !== c.level && 'opacity-0')} /> {c.label}
                                                        </DropdownMenuItem>
                                                    ))}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onClick={() => notify.setTopicLevel(topic.rootMessageId, null)}>
                                                        <Check className={cn('size-3.5 mr-2', notify.topics[topic.rootMessageId] && 'opacity-0')} /> Space default
                                                    </DropdownMenuItem>
                                                </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                            {topic.archived ? (
                                                <DropdownMenuItem onClick={() => void manageTopic(topic.id, { action: 'unarchive' })}>
                                                    <ArchiveRestore className="size-3.5 mr-2" /> Unarchive
                                                </DropdownMenuItem>
                                            ) : (
                                                <DropdownMenuItem onClick={() => void manageTopic(topic.id, { action: 'archive' })}>
                                                    <Archive className="size-3.5 mr-2" /> Archive
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onClick={() => void manageTopic(topic.id, { action: 'remove' })}>
                                                <MessageSquareOff className="size-3.5 mr-2" /> Convert back to thread
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            )
                        })}
                        {topicRows.length === 0 && (
                            <div className="px-2 py-2 text-xs text-muted-foreground">
                                {archivedView ? 'Nothing archived.' : 'No discussions yet — give a thread a goal to put it here.'}
                            </div>
                        )}
                    </div>
                )}
            </section>

            <section
                ref={filesRef}
                style={filesStyle}
                className="group/section flex min-h-0 flex-col"
                onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }}
                onDrop={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes('Files')) return
                    e.preventDefault()
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length > 0) onUploadFiles(files)
                }}
            >
                {/* The divider: a hairline always, a drag handle while both panes are open. */}
                <div
                    onMouseDown={bothOpen ? startResize : undefined}
                    title={bothOpen ? 'Drag to resize' : undefined}
                    className={cn(
                        'h-1.5 shrink-0 border-t border-border transition-colors',
                        bothOpen && 'cursor-row-resize hover:bg-primary/20',
                        resizing && 'bg-primary/30',
                    )}
                />
                <SectionHeader label="Files" collapsed={filesCollapsed} count={liveFiles} onToggle={() => toggleSection('files')}>
                    <DropdownMenu onOpenChange={onMenuOpenChange}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Add to files"
                                title="New file, folder, board, or upload"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/section:opacity-100 data-[state=open]:opacity-100"
                            >
                                <Plus className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setCreatingBoard(false); setCreatingFile({ prefix: '' }) }}>
                                <FileText className="size-3.5 mr-2" /> New file
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCreatingBoard(false); setCreatingFolder(true) }}>
                                <FolderPlus className="size-3.5 mr-2" /> New folder
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCreatingFile(null); setCreatingFolder(false); setCreatingBoard(true) }}>
                                <PenTool className="size-3.5 mr-2" /> New board
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => uploadInputRef.current?.click()}>
                                <Upload className="size-3.5 mr-2" /> Upload files…
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu onOpenChange={onMenuOpenChange}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Files options"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/section:opacity-100 data-[state=open]:opacity-100"
                            >
                                <MoreHorizontal className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={onOpenTrash}>
                                <Trash2 className="size-3.5 mr-2" /> Trash
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </SectionHeader>
                {!filesCollapsed && (
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                        <FileTree
                            orgId={orgId}
                            spaceId={spaceId}
                            entries={entries}
                            draftFolders={draftFolders}
                            selectedPath={selectedPath}
                            unreadPaths={unreadPaths}
                            onOpenFile={openEntry}
                            creating={creatingFile}
                            onCreateFile={(path) => {
                                setCreatingFile(null)
                                onCreateFile(path)
                            }}
                            onCancelCreate={() => setCreatingFile(null)}
                            onStartCreate={(prefix) => setCreatingFile({ prefix })}
                            creatingFolder={creatingFolder}
                            onCreateFolder={(path) => {
                                setCreatingFolder(false)
                                onAddFolder(path)
                            }}
                            onCancelCreateFolder={() => setCreatingFolder(false)}
                            onRemoveFolder={onRemoveFolder}
                        />
                        {creatingBoard && (
                            <div className="flex items-center gap-1.5 px-1 pt-1">
                                <PenTool className="size-3 shrink-0 text-muted-foreground" />
                                <input
                                    autoFocus
                                    placeholder="Board name…"
                                    className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-[var(--rowboat-wash)] px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-border"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') createBoard(e.currentTarget.value)
                                        else if (e.key === 'Escape') setCreatingBoard(false)
                                    }}
                                    onBlur={(e) => (e.currentTarget.value.trim() ? createBoard(e.currentTarget.value) : setCreatingBoard(false))}
                                />
                            </div>
                        )}
                    </div>
                )}
            </section>
        </div>
    )

    return (
        <aside
            ref={asideRef}
            onMouseEnter={onEdgeEnter}
            onMouseLeave={onEdgeLeave}
            style={{ width: open ? 280 : EDGE_W, transition: 'width 200ms cubic-bezier(0.2,0,0,1)' }}
            className={cn(
                'relative flex min-h-0 shrink-0 flex-col border-r border-border',
                // A step lighter than the main sidebar so the two rails read as
                // distinct layers; at this subtle a shift the hairline to the
                // canvas earns its place.
                open ? 'z-10 overflow-hidden bg-[var(--rowboat-panel-soft)]' : 'overflow-visible bg-background',
                // The drawer rides over the surfaces' own sticky layers (z-20).
                !open && (peek ? 'z-30' : 'z-10'),
            )}
        >
            {/* Always mounted: an input unmounted mid-pick (the rail toggled
                closed while the OS file dialog is up) never delivers its
                change event. */}
            <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length > 0) onUploadFiles(files)
                    e.target.value = ''
                }}
            />
            {open ? body : (
                <>
                    {/* The edge sliver: hover slides the drawer out. It says one
                        thing at rest — a dot when something here is unread. */}
                    <div aria-hidden className={cn('relative flex-1 transition-colors', peek ? 'bg-accent/60' : 'hover:bg-accent/60')}>
                        {badge > 0 && <span className="absolute left-1/2 top-3 size-1 -translate-x-1/2 rounded-full bg-foreground" />}
                    </div>
                    {/* The drawer: the same rail, sliding out over the surfaces from
                        the edge — nothing underneath moves. The outer box clips on
                        the left so the slide never shows over the shell dock, and is
                        wide enough to leave the shadow alone. Inert while hidden so
                        its rows never catch focus. */}
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-[330px] overflow-hidden">
                        <div
                            inert={!peek}
                            className={cn(
                                'absolute bottom-1.5 left-0 top-1.5 w-[280px] overflow-hidden rounded-r-xl border border-border bg-[var(--rowboat-panel-soft)] shadow-2xl transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
                                peek ? 'pointer-events-auto translate-x-0' : '-translate-x-full',
                            )}
                        >
                            {body}
                        </div>
                    </div>
                </>
            )}
        </aside>
    )
}

/**
 * A pane's label: click collapses the pane. The count shows only while
 * collapsed — that is the one moment a number says something the rows
 * can't. `children` are the pane's actions, right-aligned (hover-revealed
 * ones key off group/section, which the PANE carries — hovering anywhere in
 * it shows them).
 */
function SectionHeader({ label, collapsed, count, onToggle, children }: {
    label: string
    collapsed: boolean
    count: number
    onToggle: () => void
    children?: ReactNode
}) {
    return (
        <div className="flex h-8 shrink-0 items-center gap-1 pl-3 pr-1.5">
            <button
                type="button"
                onClick={onToggle}
                title={collapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground"
            >
                <span className="truncate">{label}</span>
                {collapsed && count > 0 && <span className="font-normal tabular-nums">{count}</span>}
            </button>
            {children}
        </div>
    )
}
