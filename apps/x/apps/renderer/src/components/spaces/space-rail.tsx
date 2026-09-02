import { useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Bell, BellOff, Bot, Check, FileText, Folder, FolderPlus, MessageSquareOff, MessagesSquare, MoreHorizontal, PanelLeftClose, Pencil, PenTool, Plus, Search, Trash2, Upload } from 'lucide-react'
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
// every surface — Messages + discussions on top, the file tree below. The
// Discussions section lists ONLY deliberate topic annotations (annotation
// model): threads someone gave a goal. Plain reply chains stay behind their
// chips in the stream — the rail holds intentions, not accidents. It is a
// plain sticky 280px sidebar (the shell sidebar contracts to the dock while
// in Spaces, so this is THE sidebar here), collapsible to a 28px edge strip
// via the header button; clicking the strip reopens it. No hover behavior —
// the rail moves only on explicit clicks. The surfaces own everything else.

/** Resizable Files section: never shorter than this (header + a couple of rows). */
const FILES_MIN = 96
/** Dragging the Files divider always leaves this much for Messages + topics. */
const TOPICS_FLOOR = 160

const NOTIFY_CHOICES: { level: NotifyLevel; label: string }[] = [
    { level: 'all', label: 'All messages' },
    { level: 'mentions', label: 'Mentions only' },
    { level: 'mute', label: 'Muted' },
]

export function SpaceRail({
    orgId, spaceId, selfMemberId, stream, topics, changeSets, entries, draftFolders, presence, unreadPaths, notify, onMenuOpenChange, selection, onSelect, onCreateFile, onCreateBoard, onUploadFiles, onOpenTrash, onAddFolder, onRemoveFolder,
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
    /** A row menu is up — the unpinned rail must not slide away underneath it. */
    onMenuOpenChange?: (open: boolean) => void
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    onCreateFile: (path: string) => void
    /** The "+" in Whiteboards: creates the board asset AND opens it (a taken name just opens). */
    onCreateBoard: (path: string) => void
    /** Picked or dropped files headed for the space's file tree (upload dialog opens in the pane). */
    onUploadFiles: (files: File[]) => void
    /** Opens the space's Trash (deleted files, restorable). */
    onOpenTrash: () => void
    onAddFolder: (path: string) => void
    onRemoveFolder: (path: string) => void
    open: boolean
    onTogglePin: () => void
}) {
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all')
    const [creatingFile, setCreatingFile] = useState<{ prefix: string } | null>(null)
    const [creatingFolder, setCreatingFolder] = useState(false)
    const [creatingBoard, setCreatingBoard] = useState(false)
    const uploadInputRef = useRef<HTMLInputElement | null>(null)

    // Resizable Files section: null = natural height (grows with the tree,
    // capped at 40% of the rail) until the divider is dragged; then the
    // chosen height sticks, persisted like the Split doc width.
    const [filesHeight, setFilesHeight] = useState<number | null>(() => {
        const stored = Number(localStorage.getItem('spaces:filesHeight'))
        return Number.isFinite(stored) && stored >= FILES_MIN ? stored : null
    })
    const [resizingFiles, setResizingFiles] = useState(false)
    const filesDrag = useRef<{ y: number; height: number } | null>(null)
    const railBodyRef = useRef<HTMLDivElement | null>(null)
    const filesRef = useRef<HTMLDivElement | null>(null)
    const startFilesResize = (e: React.MouseEvent) => {
        e.preventDefault()
        filesDrag.current = { y: e.clientY, height: filesRef.current?.clientHeight ?? 0 }
        setResizingFiles(true)
        const onMove = (ev: MouseEvent) => {
            if (!filesDrag.current) return
            // Files sit at the bottom: dragging the divider up grows them.
            const next = filesDrag.current.height + (filesDrag.current.y - ev.clientY)
            const railHeight = railBodyRef.current?.clientHeight ?? window.innerHeight
            setFilesHeight(Math.min(Math.max(next, FILES_MIN), Math.max(FILES_MIN, railHeight - TOPICS_FLOOR)))
        }
        const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            filesDrag.current = null
            setResizingFiles(false)
            setFilesHeight((h) => {
                if (h !== null) localStorage.setItem('spaces:filesHeight', String(h))
                return h
            })
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

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
    const q = query.trim().toLowerCase()
    const topicRows = topics
        .filter((t) => (filter === 'archived' ? t.archived : !t.archived))
        .filter((t) => (filter === 'unread' ? isUnread(t) && effectiveLevel(t.rootMessageId) !== 'mute' : true))
        // Titles resolve before the search filter so searching a person's
        // name finds the discussions that mention them.
        .map((t) => ({ topic: t, title: resolveMentions(t.title, memberNames) }))
        .filter((x) => (q ? x.title.toLowerCase().includes(q) : true))
        .sort((a, b) => b.topic.lastActivityAt.localeCompare(a.topic.lastActivityAt))

    const selectedRootId = selection.kind === 'thread' ? selection.rootMessageId : null
    const selectedPath = selection.kind === 'file' ? selection.path : null
    const selectedBoard = selection.kind === 'whiteboard' ? selection.path : null

    // Boards live in the same asset namespace but get their own rail section;
    // the file tree hides them so one thing appears in one place.
    const boards = entries.filter((e) => spaces.isWhiteboardPath(e.path) && !e.state)
    const fileEntries = entries.filter((e) => !spaces.isWhiteboardPath(e.path))
    const createBoard = (name: string) => {
        setCreatingBoard(false)
        const path = spaces.whiteboardPathForName(name)
        if (path) onCreateBoard(path)
    }

    // The stream mutes under its own key, like any thread.
    const generalBadge = effectiveLevel(STREAM_READ_KEY) === 'mute' ? 0 : generalUnread

    // Muted destinations don't badge here either (same posture as the sidebar).
    const unreadTopics =
        topics.filter((t) => !t.archived && isUnread(t) && effectiveLevel(t.rootMessageId) !== 'mute').length + (generalBadge > 0 ? 1 : 0)
    const badge = unreadTopics + unreadPaths.size

    return (
        <aside
            style={{ width: open ? 280 : 28, transition: 'width 200ms cubic-bezier(0.2,0,0,1)' }}
            className={cn(
                'relative z-10 shrink-0 min-h-0 overflow-hidden flex flex-col',
                // A step lighter than the main sidebar so the two rails read as
                // distinct layers; at this subtle a shift the hairline to the
                // canvas earns its place.
                open ? 'border-r border-border bg-[var(--rowboat-panel-soft)]' : 'border-r border-border bg-background',
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
            {!open ? (
                // The collapsed edge strip: click to reopen. Deliberately not
                // hover-triggered — the rail appears only on an explicit act.
                <button
                    type="button"
                    onClick={onTogglePin}
                    title="Show discussions & files"
                    className="flex flex-1 flex-col items-center gap-2.5 py-3.5 hover:bg-accent/50"
                >
                    <MessagesSquare className="size-[15px] text-muted-foreground" />
                    <Folder className="size-[15px] text-muted-foreground" />
                    <div className="w-px flex-1 bg-border/70" />
                    {badge > 0 && (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9.5px] font-semibold text-background tabular-nums">
                            {badge}
                        </span>
                    )}
                </button>
            ) : (
                // Inner content is fixed at the open width so text doesn't reflow mid-slide.
                <div ref={railBodyRef} className="flex h-full w-[280px] flex-col">
                    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">Discussions &amp; files</span>
                        <button
                            type="button"
                            onClick={onTogglePin}
                            title="Collapse — reopen from the edge strip"
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <PanelLeftClose className="size-3.5" />
                        </button>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex flex-col gap-0.5 px-2 pt-2">
                            <button
                                type="button"
                                onClick={() => onSelect({ kind: 'general' })}
                                className={cn(
                                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px]',
                                    selection.kind === 'general' ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 hover:bg-accent/50',
                                )}
                            >
                                <MessagesSquare className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className={cn('flex-1 truncate', generalBadge > 0 && selection.kind !== 'general' && 'font-semibold')}>Messages</span>
                                {generalBadge > 0 && selection.kind !== 'general' && (
                                    <span className="text-[11px] font-semibold tabular-nums">{generalBadge}</span>
                                )}
                                {(presence.typing.get('') ?? []).length > 0 && <span className="size-1.5 rounded-full bg-[var(--rowboat-success)]" title="someone is typing" />}
                            </button>
                        </div>

                        <div className="mt-3 flex items-center gap-2 px-3 pr-2">
                            <span className="text-[13px] text-muted-foreground">Discussions</span>
                            <span className="text-[11px] text-muted-foreground/70">{topicRows.length}</span>
                            <span className="flex-1" />
                            <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-[10.5px]">
                                {(['all', 'unread', 'archived'] as const).map((f) => (
                                    <button
                                        key={f}
                                        type="button"
                                        onClick={() => setFilter(f)}
                                        className={cn('rounded px-1.5 py-0.5 capitalize', filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <label className="mx-2 mt-1 flex h-7 items-center gap-1.5 rounded-md border border-transparent bg-[var(--rowboat-wash)] px-2 text-xs text-muted-foreground focus-within:border-border">
                            <Search className="size-3" />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search discussions"
                                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                            />
                        </label>
                        <div className="mt-1 flex-1 min-h-0 overflow-y-auto px-2 pb-2">
                            <div className="flex flex-col gap-0.5">
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
                                            <div key={topic.id} className="rounded-md px-2 py-1.5">
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
                                                        className={cn(
                                                            'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
                                                            active ? 'bg-accent text-foreground' : 'hover:bg-accent/50',
                                                            (topic.archived || muted) && 'opacity-60',
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={cn('flex-1 truncate text-[13px] leading-snug', unread ? 'font-semibold' : 'font-normal')}>{title}</span>
                                                            {unread && !active && <span className="size-1.5 shrink-0 rounded-full bg-foreground" />}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                                                            <span>{replies} {replies === 1 ? 'reply' : 'replies'}</span>
                                                            <span>· {formatFeedTime(topic.lastActivityAt)}</span>
                                                            {files && files.size > 0 && (
                                                                <span className="inline-flex items-center gap-0.5" title={`Files changed here: ${[...files].join(', ')}`}><FileText className="size-2.5" />{files.size}</span>
                                                            )}
                                                            {working && <Bot className="size-2.5" aria-label="a Rowboat is working here" />}
                                                            {muted && <BellOff className="size-2.5" aria-label="muted" />}
                                                            {topic.archived && <span>· archived</span>}
                                                        </div>
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
                                                        className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground group-hover/topicrow:inline-flex data-[state=open]:inline-flex"
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
                                        {q ? 'No discussions match.' : filter === 'unread' ? 'Nothing unread.' : filter === 'archived' ? 'No archived discussions.' : 'No discussions yet — give a thread a goal to put it here.'}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="shrink-0 border-t border-border">
                        <div className="flex h-8 items-center gap-2 px-3 pr-2 pt-1">
                            <span className="text-[13px] text-muted-foreground">Whiteboards</span>
                            <span className="text-[11px] text-muted-foreground/70">{boards.length}</span>
                            <span className="flex-1" />
                            <button
                                type="button"
                                title="New whiteboard"
                                onClick={() => setCreatingBoard(true)}
                                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <Plus className="size-3.5" />
                            </button>
                        </div>
                        <div className="max-h-36 overflow-y-auto px-2 pb-2">
                            <div className="flex flex-col gap-0.5">
                                {creatingBoard && (
                                    <input
                                        autoFocus
                                        placeholder="Board name…"
                                        className="h-7 rounded-md border border-transparent bg-[var(--rowboat-wash)] px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-border"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') createBoard(e.currentTarget.value)
                                            else if (e.key === 'Escape') setCreatingBoard(false)
                                        }}
                                        onBlur={(e) => (e.currentTarget.value.trim() ? createBoard(e.currentTarget.value) : setCreatingBoard(false))}
                                    />
                                )}
                                {boards.map((b) => (
                                    <button
                                        key={b.path}
                                        type="button"
                                        onClick={() => onSelect({ kind: 'whiteboard', path: b.path })}
                                        className={cn(
                                            'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]',
                                            b.path === selectedBoard ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 hover:bg-accent/50',
                                        )}
                                    >
                                        <PenTool className="size-3.5 shrink-0 text-muted-foreground" />
                                        <span className="flex-1 truncate">{spaces.whiteboardDisplayName(b.path)}</span>
                                    </button>
                                ))}
                                {boards.length === 0 && !creatingBoard && (
                                    <div className="px-2 py-1 text-xs text-muted-foreground">Draw together — boards sync live for everyone here.</div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div
                        ref={filesRef}
                        // maxHeight backstops a persisted height against a shorter window.
                        style={filesHeight !== null ? { height: filesHeight, maxHeight: '75%' } : undefined}
                        className={cn('flex shrink-0 flex-col', filesHeight === null && 'max-h-[40%]')}
                    >
                        <div
                            onMouseDown={startFilesResize}
                            title="Drag to resize the files pane"
                            className={cn(
                                'h-1.5 shrink-0 cursor-row-resize border-t border-border transition-colors hover:bg-primary/20',
                                resizingFiles && 'bg-primary/30',
                            )}
                        />
                        <div className="flex h-8 shrink-0 items-center gap-2 px-3 pr-2 pt-1">
                            <span className="text-[13px] text-muted-foreground">Files</span>
                            <span className="text-[11px] text-muted-foreground/70">{fileEntries.length}</span>
                            <span className="flex-1" />
                            <button
                                type="button"
                                title="Upload files (or drop them here)"
                                onClick={() => uploadInputRef.current?.click()}
                                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <Upload className="size-3.5" />
                            </button>
                            <button
                                type="button"
                                title="New file"
                                onClick={() => setCreatingFile({ prefix: '' })}
                                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <Plus className="size-3.5" />
                            </button>
                            <button
                                type="button"
                                title="New folder (folders are path prefixes — it becomes real when a file lands in it)"
                                onClick={() => setCreatingFolder(true)}
                                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <FolderPlus className="size-3.5" />
                            </button>
                            <button
                                type="button"
                                title="Trash — deleted files, restorable"
                                onClick={onOpenTrash}
                                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </div>
                        <div
                            className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
                            onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }}
                            onDrop={(e) => {
                                if (!Array.from(e.dataTransfer.types).includes('Files')) return
                                e.preventDefault()
                                const files = Array.from(e.dataTransfer.files)
                                if (files.length > 0) onUploadFiles(files)
                            }}
                        >
                            <FileTree
                                orgId={orgId}
                                spaceId={spaceId}
                                entries={fileEntries}
                                draftFolders={draftFolders}
                                selectedPath={selectedPath}
                                unreadPaths={unreadPaths}
                                onOpenFile={(path) => onSelect({ kind: 'file', path })}
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
                        </div>
                    </div>
                </div>
            )}
        </aside>
    )
}
