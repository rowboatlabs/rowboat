import { useMemo, useRef, useState, type ReactNode } from 'react'
import { FileListContextMenu } from '@/components/file-list-context-menu'
import { Archive, ArchiveRestore, Bot, CornerDownRight, FileText, FolderPlus, MessageSquareOff, MessagesSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, PenTool, Plus, Trash2, Upload } from 'lucide-react'
import { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/lib/toast'
import { SecondaryRail, type SecondaryRailContext } from '@/components/secondary-rail'
import { FileTree } from '@/components/spaces/files-tab'
import { ServerOptionsMenu } from '@/components/spaces/server-options-menu'
import { ServerSpaceNavigation } from '@/components/spaces-sidebar-section'
import { refreshSpaceFeed, type OrgWithSpaces } from '@/hooks/use-spaces'
import type { SpacePresence, StreamState } from '@/hooks/use-space-chat'
import { prefetchThread } from '@/hooks/use-space-chat'
import { useMemberNames } from '@/components/spaces/member-text'
import { threadRefOf } from '@/lib/spaces-conventions'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import { getStreamReadOffset, isThreadUnread, threadBadge, useReadStateVersion } from '@/lib/spaces-read-state'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import type { RailSelection } from '@/lib/spaces-selection'

// Server spaces and their nested discussions, then DMs, share the upper
// scrolling pane. The selected space's files retain their resizable lower
// pane. SecondaryRail owns docking, resizing, and the hover drawer.

type RailSection = 'files'
/** Collapsed sections persist like the rail's own pin. */
const COLLAPSED_KEY = 'spaces:railCollapsed'
/** A dragged Files height persists too (null = the 60/40 default). */
const FILES_HEIGHT_KEY = 'spaces:filesHeight'
/** Resizing never leaves Files shorter than this (divider + label + a couple of rows). */
const FILES_MIN = 96
/** ...or Chat shorter than this (label + Messages + a discussion). */
const CHAT_MIN = 120

export function SpaceRail({
    org, onOpenSpace, onOpenDiscussion, orgId, spaceId, selfMemberId, stream, topics, changeSets, entries, draftFolders, presence, unreadPaths, selection, onSelect, onCreateFile, onCreateBoard, onUploadFiles, onOpenTrash, onAddFolder, onRemoveFolder,
    open, onTogglePin,
}: {
    org: OrgWithSpaces
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenDiscussion: (spaceId: string, selection: RailSelection) => void
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
    // Archived discussions can be included alongside live discussions.
    const archivedKey = `spaces:showArchived:${orgId}`
    const [showArchived, setShowArchived] = useState(() => sessionStorage.getItem(archivedKey) === 'true')
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

    // Read state is org-owned (spaces-read-state); its version re-runs these.
    const readVersion = useReadStateVersion()
    const generalUnread = useMemo(() => {
        if (!stream.ready) return 0
        const mark = getStreamReadOffset(orgId, spaceId)
        return stream.messages.filter((m) => !m.pending && !m.failed && !m.deletedAt && m.offset > mark && m.author.memberId !== selfMemberId).length
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stream, orgId, spaceId, selfMemberId, readVersion])

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

    // Followed threads only: a discussion you are not in never bolds.
    const isUnread = (t: spaces.TopicListing) => isThreadUnread(orgId, spaceId, t.rootMessageId)

    const memberNames = useMemberNames()
    const byActivity = (a: { topic: spaces.TopicListing }, b: { topic: spaces.TopicListing }) => b.topic.lastActivityAt.localeCompare(a.topic.lastActivityAt)
    const titled = topics.map((t) => ({ topic: t, title: resolveMentions(t.title, memberNames) }))
    const liveRows = titled.filter((x) => !x.topic.archived).sort(byActivity)
    const topicRows = showArchived ? titled.sort(byActivity) : liveRows

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

    const generalBadge = generalUnread
    const unreadTopics = topics.filter((t) => !t.archived && isUnread(t)).length + (generalBadge > 0 ? 1 : 0)
    const badge = unreadTopics + unreadPaths.size

    const filesCollapsed = collapsed.has('files')
    const bothOpen = !filesCollapsed
    // A collapsed pane is just its label; the other takes everything left.
    // With both open, a dragged Files height wins over the 60/40 default.
    const chatStyle: React.CSSProperties = !bothOpen || filesHeight !== null ? { flex: '1 1 0%' } : { flex: '60 1 0%' }
    const filesStyle: React.CSSProperties = filesCollapsed
        ? { flex: '0 0 auto' }
        : !bothOpen
            ? { flex: '1 1 0%' }
            : filesHeight !== null
                ? { flex: `0 0 ${filesHeight}px`, maxHeight: `calc(100% - ${CHAT_MIN}px)` }
                : { flex: '40 1 0%' }

    // The rail's content — the shell renders it docked or inside the peek
    // drawer at the fixed open width.
    const renderBody = ({ togglePin, onMenuOpenChange }: SecondaryRailContext) => (
        <div ref={bodyRef} className={cn('spaces-navigation flex h-full min-h-0 flex-col', resizing && 'select-none')}>
            <section style={chatStyle} className="group/section flex min-h-0 flex-col">
                <div className="flex shrink-0 items-center gap-0.5 px-2 py-1">
                    <span className="min-w-0 flex-1 px-1 text-[13px] font-semibold text-muted-foreground">Spaces</span>
                    <ServerOptionsMenu org={org} showArchived={showArchived} onToggleArchived={() => setShowArchived((value) => { sessionStorage.setItem(archivedKey, String(!value)); return !value })} onMenuOpenChange={onMenuOpenChange} />
                    {/* Docked: close. Peeked: the lock — dock it. Same spot, flipped glyph. */}
                    <button
                        type="button"
                        onClick={togglePin}
                        title={open ? 'Close sidebar' : 'Lock sidebar open'}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        {open ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
                    </button>
                </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
                        <ServerSpaceNavigation org={org} spaceId={spaceId} onOpenSpace={onOpenSpace}
                            onOpenDiscussion={onOpenDiscussion} activeDiscussionCount={topicRows.length} showArchived={showArchived}
                            renderActiveDiscussions={(limit) => <>
                        {topicRows.slice(0, limit).map(({ topic, title }) => {
                            const active = topic.rootMessageId === selectedRootId
                            const unread = isUnread(topic)
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
                                        {/* Both triggers are slots on the one button: tooltip outside so the
                                            context menu's right-click reaches the element unchanged. */}
                                        <Tooltip delayDuration={400}>
                                            <TooltipTrigger asChild>
                                                <ContextMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        onClick={() => onSelect({ kind: 'thread', rootMessageId: topic.rootMessageId })}
                                                        // Hover = intent: warm the replies so the click paints instantly.
                                                        onMouseEnter={() => prefetchThread(orgId, spaceId, topic.rootMessageId)}
                                                        // The row shows only what changes what you do next: unread,
                                                        // a Rowboat at work. The full title, replies, recency
                                                        // and touched files ride the tooltip — the list is already
                                                        // sorted by activity.
                                                        className={cn(
                                                            // One tree step (12px) in from Messages: these nest under it.
                                                            // pr-7 keeps the title and indicators clear of the ⋯ slot.
                                                            'flex h-8 w-full items-center gap-2 rounded pl-5 pr-7 text-left',
                                                            active ? 'bg-[var(--stream-mention-wash)] text-[var(--stream-link)]' : 'hover:bg-accent/50',
                                                            topic.archived && 'opacity-60',
                                                        )}
                                                    >
                                                        {/* In the Messages icon column: a discussion branches off the stream. */}
                                                        <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                                                        <span className={cn('min-w-0 flex-1 truncate text-[13px]', unread ? 'font-semibold' : 'font-normal')}>{title}</span>
                                                        {working && <Bot className="size-3 shrink-0 text-muted-foreground" aria-label="a Rowboat is working here" />}
                                                        {!active && <UnreadBadge badge={threadBadge(orgId, spaceId, topic.rootMessageId, false)} />}
                                                    </button>
                                                </ContextMenuTrigger>
                                            </TooltipTrigger>
                                            <TooltipContent side="right" align="start" sideOffset={6} className="max-w-[320px] text-left text-wrap break-words">
                                                <div className="font-medium">{title}</div>
                                                <div className="opacity-70">
                                                    {replies} {replies === 1 ? 'reply' : 'replies'} · {formatFeedTime(topic.lastActivityAt)}
                                                    {files && files.size > 0 && ` · ${files.size} ${files.size === 1 ? 'file' : 'files'} changed: ${[...files].join(', ')}`}
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                        <ContextMenuContent>
                                            <ContextMenuItem onSelect={() => onSelect({ kind: 'thread', rootMessageId: topic.rootMessageId })}>
                                                <MessagesSquare className="size-3.5 mr-2" /> Open
                                            </ContextMenuItem>
                                            <ContextMenuItem onSelect={() => setRenaming({ topicId: topic.id, value: title })}>
                                                <Pencil className="size-3.5 mr-2" /> Rename
                                            </ContextMenuItem>
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

                            </>}
                        />
                    </div>
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
                            <DropdownMenuItem onClick={() => uploadInputRef.current?.click()}>
                                <Upload className="size-3.5 mr-2" /> Upload files…
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCreatingBoard(false); setCreatingFile({ prefix: '' }) }}>
                                <FileText className="size-3.5 mr-2" /> New file
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCreatingBoard(false); setCreatingFolder(true) }}>
                                <FolderPlus className="size-3.5 mr-2" /> New folder
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCreatingFile(null); setCreatingFolder(false); setCreatingBoard(true) }}>
                                <PenTool className="size-3.5 mr-2" /> New board
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
                    <FileListContextMenu onOpenChange={onMenuOpenChange} actions={[
                        { label: 'New file', onSelect: () => { setCreatingBoard(false); setCreatingFile({ prefix: '' }) } },
                        { label: 'New folder', onSelect: () => { setCreatingBoard(false); setCreatingFolder(true) } },
                        { label: 'New board', onSelect: () => { setCreatingFile(null); setCreatingFolder(false); setCreatingBoard(true) } },
                        { label: 'Upload files…', onSelect: () => uploadInputRef.current?.click() },
                    ]}>
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
                    </FileListContextMenu>
                )}
            </section>
        </div>
    )

    return (
        <SecondaryRail
            open={open}
            onTogglePin={onTogglePin}
            widthStorageKey="spaces:railWidth"
            edgeDot={badge > 0}
            persistent={
                // Always mounted: an input unmounted mid-pick (the rail toggled
                // closed while the OS file dialog is up) never delivers its
                // change event.
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
            }
        >
            {renderBody}
        </SecondaryRail>
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
                aria-expanded={!collapsed}
                title={collapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-semibold text-muted-foreground hover:text-foreground"
            >
                <span className="truncate">{label}</span>
                {collapsed && count > 0 && <span className="font-normal tabular-nums">{count}</span>}
            </button>
            {children}
        </div>
    )
}
