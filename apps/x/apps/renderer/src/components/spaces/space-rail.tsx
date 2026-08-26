import { useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Bot, FileText, Folder, FolderPlus, MessagesSquare, MoreHorizontal, PanelLeftClose, Pencil, Pin, Plus, Search, Trash2, Upload } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { toast } from '@/lib/toast'
import { FileTree } from '@/components/spaces/files-tab'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import type { GeneralState, SpacePresence, ThreadIndex } from '@/hooks/use-space-chat'
import { useMemberNames } from '@/components/spaces/member-text'
import { explicitTitle, isGeneralSeedMessage, stripThreadMarker, threadRefOf } from '@/lib/spaces-conventions'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import { getTopicLastReadAt } from '@/lib/spaces-read-state'
import type { RailSelection } from '@/lib/spaces-selection'

// The space's edge rail: one collapsible strip carrying the same sidebar on
// every surface — Messages + topics on top, the file tree below. Two modes:
// PINNED (default) it is a plain 280px sidebar; unpinned it is a 28px edge
// that opens on hover and lingers a few seconds after the cursor leaves
// (instant close was too twitchy). The header button flips the mode; a click
// on the closed edge pins it back open. The surfaces own everything else.

/** Resizable Files section: never shorter than this (header + a couple of rows). */
const FILES_MIN = 96
/** Dragging the Files divider always leaves this much for Messages + topics. */
const TOPICS_FLOOR = 160

export function SpaceRail({
    orgId, spaceId, selfMemberId, general, topics, threads, changeSets, entries, draftFolders, presence, unreadPaths, selection, onSelect, onCreateFile, onUploadFiles, onOpenTrash, onAddFolder, onRemoveFolder,
    open, pinned, onHoverChange, onTogglePin,
}: {
    orgId: string
    spaceId: string
    selfMemberId: string
    general: GeneralState
    topics: spaces.Topic[]
    threads: ThreadIndex
    changeSets: spaces.ChangeSet[]
    entries: spaces.SpacesAssetEntry[]
    /** Local-only empty folders — see SpacePane. */
    draftFolders: readonly string[]
    presence: SpacePresence
    unreadPaths: ReadonlySet<string>
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    onCreateFile: (path: string) => void
    /** Picked or dropped files headed for the space's file tree (upload dialog opens in the pane). */
    onUploadFiles: (files: File[]) => void
    /** Opens the space's Trash (deleted files, restorable). */
    onOpenTrash: () => void
    onAddFolder: (path: string) => void
    onRemoveFolder: (path: string) => void
    open: boolean
    pinned: boolean
    onHoverChange: (hovering: boolean) => void
    onTogglePin: () => void
}) {
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all')
    const [creatingFile, setCreatingFile] = useState<{ prefix: string } | null>(null)
    const [creatingFolder, setCreatingFolder] = useState(false)
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

    // Row-level topic actions. Rename edits inline in the row; the topic event
    // the server emits updates every other client, the refresh updates this one.
    const [renaming, setRenaming] = useState<{ topicId: string; value: string } | null>(null)
    const manageTopic = async (topicId: string, action: spaces.SpacesManageTopicAction) => {
        try {
            await window.ipc.invoke('spaces:manageTopic', { orgId, spaceId, topicId, action })
            await refreshSpaceFeed(orgId, spaceId)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not update the topic', 'error')
        }
    }
    const commitRename = async (topicId: string, title: string) => {
        setRenaming(null)
        await manageTopic(topicId, { action: 'retitle', title })
    }

    const generalId = general.topic?.id ?? null

    const generalUnread = useMemo(() => {
        const g = general.topic
        if (!g || !general.ready) return 0
        const mark = getTopicLastReadAt(orgId, spaceId, g.id)
        return general.messages.filter((m, i) => !isGeneralSeedMessage(g, m, i) && (!mark || m.postedAt > mark) && m.author.memberId !== selfMemberId).length
    }, [general, orgId, spaceId, selfMemberId])

    const artifactFiles = useMemo(() => {
        const counts = new Map<string, Set<string>>()
        for (const cs of changeSets) {
            const ref = cs.topicId ?? threadRefOf(cs.reason)
            if (!ref) continue
            const set = counts.get(ref) ?? new Set<string>()
            set.add(cs.assetPath)
            counts.set(ref, set)
        }
        return counts
    }, [changeSets])

    const isUnread = (t: spaces.Topic) => {
        const mark = getTopicLastReadAt(orgId, spaceId, t.id)
        if (mark && t.lastActivityAt <= mark) return false
        return t.messageCount > 1 || t.createdBy.memberId !== selfMemberId
    }

    const memberNames = useMemberNames()
    const q = query.trim().toLowerCase()
    const topicRows = topics
        .filter((t) => t.id !== generalId)
        .filter((t) => (filter === 'archived' ? t.archived : !t.archived))
        .filter((t) => (filter === 'unread' ? isUnread(t) : true))
        .map((t) => {
            const info = threads.byTopic.get(t.id)
            // A renamed topic shows its name; an auto-titled thread keeps
            // showing its seed text (its derived title is a noisy quote).
            // Without the seed prefetch the PARENT message (already loaded in
            // general) stands in — the seed's first line is the parent's.
            const parentBody = info?.parentMessageId ? general.messages.find((m) => m.id === info.parentMessageId)?.body : undefined
            const seedBody = info?.firstMessage ? stripThreadMarker(info.firstMessage.body) : parentBody
            const named = explicitTitle(t, seedBody)
            const raw = named ?? (info?.parentMessageId && seedBody ? seedBody.split('\n')[0] ?? t.title : t.title)
            // Titles resolve before the search filter so searching a person's
            // name finds the topics that mention them.
            return { topic: t, title: resolveMentions(raw, memberNames) }
        })
        .filter((x) => (q ? x.title.toLowerCase().includes(q) : true))
        .sort((a, b) => b.topic.lastActivityAt.localeCompare(a.topic.lastActivityAt))

    const selectedTopicId = selection.kind === 'topic' ? selection.topicId : null
    const selectedPath = selection.kind === 'file' ? selection.path : null

    const unreadTopics = topics.filter((t) => t.id !== generalId && !t.archived && isUnread(t)).length + (generalUnread > 0 ? 1 : 0)
    const badge = unreadTopics + unreadPaths.size

    return (
        <aside
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
            style={{ width: open ? 280 : 28, transition: 'width 200ms cubic-bezier(0.2,0,0,1)' }}
            className={cn(
                'relative z-10 shrink-0 min-h-0 overflow-hidden border-r border-border flex flex-col',
                open ? 'bg-muted/20' : 'bg-background',
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
                // The closed edge: hovering opens the rail; a click pins it
                // (the strong signal — and the only path on touch screens).
                <button
                    type="button"
                    onClick={onTogglePin}
                    title="Show topics & files"
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
                        <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Topics &amp; files</span>
                        <button
                            type="button"
                            onClick={onTogglePin}
                            title={pinned ? 'Auto-hide — opens on hover, slides away a moment after the cursor leaves' : 'Keep open'}
                            className={cn(
                                'flex size-6 shrink-0 items-center justify-center rounded-md',
                                pinned
                                    ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                    : 'border border-border bg-background text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {pinned ? <PanelLeftClose className="size-3.5" /> : <Pin className="size-3" />}
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
                                <span className={cn('flex-1 truncate', generalUnread > 0 && selection.kind !== 'general' && 'font-semibold')}>Messages</span>
                                {generalUnread > 0 && selection.kind !== 'general' && (
                                    <span className="text-[11px] font-semibold tabular-nums">{generalUnread}</span>
                                )}
                                {(presence.typing.get(generalId ?? '') ?? []).length > 0 && <span className="size-1.5 rounded-full bg-emerald-500" title="someone is typing" />}
                            </button>
                        </div>

                        <div className="mt-3 flex items-center gap-2 px-3 pr-2">
                            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Topics</span>
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
                        <label className="mx-2 mt-1 flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground focus-within:border-foreground/30">
                            <Search className="size-3" />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search topics"
                                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                            />
                        </label>
                        <div className="mt-1 flex-1 min-h-0 overflow-y-auto px-2 pb-2">
                            <div className="flex flex-col gap-0.5">
                                {topicRows.map(({ topic, title }) => {
                                    const active = topic.id === selectedTopicId
                                    const unread = isUnread(topic)
                                    const replies = Math.max(0, topic.messageCount - 1)
                                    const files = artifactFiles.get(topic.id)
                                    const working = (presence.working.get(topic.id) ?? []).length > 0
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
                                                    placeholder="Topic name"
                                                />
                                            </div>
                                        )
                                    }
                                    return (
                                        <div key={topic.id} className="group/topicrow relative">
                                            <ContextMenu>
                                                <ContextMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        onClick={() => onSelect({ kind: 'topic', topicId: topic.id })}
                                                        className={cn(
                                                            'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
                                                            active ? 'bg-accent text-foreground' : 'hover:bg-accent/50',
                                                            topic.archived && 'opacity-60',
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
                                                            {topic.archived && <span>· archived</span>}
                                                        </div>
                                                    </button>
                                                </ContextMenuTrigger>
                                                <ContextMenuContent>
                                                    <ContextMenuItem onSelect={() => onSelect({ kind: 'topic', topicId: topic.id })}>
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
                                                </ContextMenuContent>
                                            </ContextMenu>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        aria-label="Topic actions"
                                                        className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground group-hover/topicrow:inline-flex data-[state=open]:inline-flex"
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
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    )
                                })}
                                {topicRows.length === 0 && (
                                    <div className="px-2 py-2 text-xs text-muted-foreground">
                                        {q ? 'No topics match.' : filter === 'unread' ? 'Nothing unread.' : filter === 'archived' ? 'No archived topics.' : 'No topics yet — reply to a message to start one.'}
                                    </div>
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
                            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Files</span>
                            <span className="text-[11px] text-muted-foreground/70">{entries.length}</span>
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
                                entries={entries}
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
