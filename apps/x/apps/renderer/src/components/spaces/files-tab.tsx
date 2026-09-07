import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Clock, Download, Eye, FileText, Folder, FolderOpen, History, Image as ImageIcon, Loader2, MoreHorizontal, Pencil, PenTool, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RichMarkdownViewer } from '@/components/rich-markdown-viewer'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { MemberText } from '@/components/spaces/member-text'
import {
    attributionLabel, blobAppUrl, buildFileTree, formatBytes, formatFeedTime, isImageMime,
    parseAssetWireUrl, parseBlobAppUrl, resolveSpaceLink, rewriteBlobLinks, rewriteRelativeImages, toggleTaskAt,
    type FileTreeNode,
} from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'
import { ClippedText, MemberAvatar } from '@/components/spaces/atoms'
import { uploadInputFor } from '@/lib/spaces-upload'

// Files: the tree (README first) and the file column — rendered file
// with one-tap checkboxes, Edit → draft→apply (merged / conflict handled),
// History with diffs. Binary files (uploads, spec §6) render a preview or a
// download card instead of the editor; Replace is the binary "edit" (a new
// upload proposed at the same path against the current version).

// ---------------------------------------------------------------------------
// Files rail — the space's tree, README first, unread dots on moved files
// ---------------------------------------------------------------------------

/** Internal drag type for moving a file between folders (never set by OS file drags). */
const ASSET_DRAG_MIME = 'application/x-rowboat-asset-path'

/** The space's file tree (README first, folders collapsible) — rendered inside the space rail. */
export function FileTree({ orgId, spaceId, entries, draftFolders = [], selectedPath, unreadPaths, onOpenFile, creating, onCreateFile, onCancelCreate, onStartCreate, creatingFolder = false, onCreateFolder, onCancelCreateFolder, onRemoveFolder }: {
    orgId: string
    spaceId: string
    entries: spaces.SpacesAssetEntry[]
    /** Local-only empty folders (they become real when their first file lands). */
    draftFolders?: readonly string[]
    selectedPath: string | null
    /** Files with a change by someone else (or an agent) since the read mark. */
    unreadPaths: ReadonlySet<string>
    onOpenFile: (path: string) => void
    /** When set, shows the new-file input (prefilled with the prefix) at the bottom of the tree. */
    creating: { prefix: string } | null
    onCreateFile: (path: string) => void
    onCancelCreate: () => void
    /** A folder row's "New file" — asks the owner to open the create input with this prefix. */
    onStartCreate?: (prefix: string) => void
    /** When true, shows the new-folder input at the bottom of the tree. */
    creatingFolder?: boolean
    onCreateFolder?: (path: string) => void
    onCancelCreateFolder?: () => void
    /** Remove an empty (draft) folder. */
    onRemoveFolder?: (path: string) => void
}) {
    const tree = useMemo(() => buildFileTree(entries, draftFolders), [entries, draftFolders])
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [newPath, setNewPath] = useState('')
    const [newFolder, setNewFolder] = useState('')
    // Prefill the create input whenever a new create request arrives.
    const [lastCreating, setLastCreating] = useState<{ prefix: string } | null>(null)
    if (creating !== lastCreating) {
        setLastCreating(creating)
        if (creating) setNewPath(creating.prefix)
    }

    // Drag a file onto a folder (or the tree's root) to move it there.
    const [dropTarget, setDropTarget] = useState<string | null>(null)
    const entryByPath = useMemo(() => new Map(entries.map((e) => [e.path, e])), [entries])
    const dragHasAsset = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(ASSET_DRAG_MIME)
    const dropInto = (e: React.DragEvent, dir: string) => {
        e.preventDefault()
        e.stopPropagation()
        setDropTarget(null)
        const fromPath = e.dataTransfer.getData(ASSET_DRAG_MIME)
        const entry = fromPath ? entryByPath.get(fromPath) : undefined
        if (!entry) return
        const name = fromPath.split('/').pop()!
        const toPath = dir ? `${dir}/${name}` : name
        if (toPath !== fromPath) void commitMove(entry, toPath)
    }
    const dirDragProps = (dir: string) => ({
        onDragOver: (e: React.DragEvent) => {
            if (!dragHasAsset(e)) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(dir)
        },
        onDragLeave: () => setDropTarget((t) => (t === dir ? null : t)),
        onDrop: (e: React.DragEvent) => { if (dragHasAsset(e)) dropInto(e, dir) },
    })

    // Row actions. Rename/move edits the FULL path inline (folders are key
    // prefixes — typing a new prefix moves the file); the server's change
    // event refreshes every pane. Delete asks for an optional reason.
    const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
    const [deleting, setDeleting] = useState<spaces.SpacesAssetEntry | null>(null)
    const commitMove = async (entry: spaces.SpacesAssetEntry, toPath: string) => {
        setRenaming(null)
        if (!toPath || toPath === entry.path) return
        try {
            const res = await window.ipc.invoke('spaces:moveAsset', {
                orgId, spaceId, fromPath: entry.path, toPath, baseVersion: entry.version,
            })
            if (res.outcome === 'conflict') toast(`${entry.path} changed meanwhile — try again`, 'error')
            else toast(`Moved to ${toPath}`, 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not move', 'error')
        }
    }

    const toggle = (path: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
        })

    const renderNode = (node: FileTreeNode, depth: number): ReactNode => {
        const pad = { paddingLeft: `${8 + depth * 12}px` }
        if (node.kind === 'dir') {
            const open = !collapsed.has(node.path)
            const empty = node.children.length === 0
            return (
                <div key={node.path}>
                    <div className="group/dirrow relative" {...dirDragProps(node.path)}>
                        <ContextMenu>
                            <ContextMenuTrigger asChild>
                                <button
                                    type="button"
                                    style={pad}
                                    onClick={() => toggle(node.path)}
                                    className={cn(
                                        'flex h-7 w-full items-center gap-1.5 rounded-md pr-7 text-[13px] text-foreground/90 hover:bg-accent/50',
                                        dropTarget === node.path && 'bg-accent ring-1 ring-inset ring-foreground/40',
                                    )}
                                >
                                    {open
                                        ? <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
                                        : <Folder className="size-3 shrink-0 text-muted-foreground" />}
                                    <ClippedText text={node.name} />
                                </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                                <ContextMenuItem onSelect={() => onStartCreate?.(`${node.path}/`)}>
                                    <Plus className="size-3.5 mr-2" /> New file
                                </ContextMenuItem>
                                {empty && onRemoveFolder && (
                                    <>
                                        <ContextMenuSeparator />
                                        <ContextMenuItem onSelect={() => onRemoveFolder(node.path)}>
                                            <Trash2 className="size-3.5 mr-2" /> Remove folder
                                        </ContextMenuItem>
                                    </>
                                )}
                            </ContextMenuContent>
                        </ContextMenu>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Folder actions"
                                    className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/dirrow:opacity-100 data-[state=open]:opacity-100"
                                >
                                    <MoreHorizontal className="size-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onStartCreate?.(`${node.path}/`)}>
                                    <Plus className="size-3.5 mr-2" /> New file
                                </DropdownMenuItem>
                                {empty && onRemoveFolder && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => onRemoveFolder(node.path)}>
                                            <Trash2 className="size-3.5 mr-2" /> Remove folder
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    {open && (
                        <div className="relative">
                            {/* Indent guide: a faint dotted line under the folder's icon
                                column, spanning its children — nesting reads without carets. */}
                            <span aria-hidden className="pointer-events-none absolute bottom-1 top-0 border-l border-dotted border-foreground/25" style={{ left: `${8 + depth * 12 + 6}px` }} />
                            {node.children.map((child) => renderNode(child, depth + 1))}
                            {empty && (
                                <div style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }} className="py-0.5 pr-2 text-[11px] italic text-muted-foreground/70">
                                    empty — files added here keep it
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )
        }
        const active = node.path === selectedPath
        const unread = unreadPaths.has(node.path)
        const blob = node.entry?.blob
        // A board is a file at whiteboards/<name>.excalidraw — same tree,
        // pen icon, extension dropped from the label.
        const board = spaces.isWhiteboardPath(node.path)
        if (renaming?.path === node.path && node.entry) {
            const entry = node.entry
            return (
                <div key={node.path} style={pad} className="py-0.5 pr-2">
                    <input
                        autoFocus
                        value={renaming.value}
                        onChange={(e) => setRenaming({ path: node.path, value: e.target.value })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitMove(entry, renaming.value.trim())
                            if (e.key === 'Escape') setRenaming(null)
                        }}
                        onBlur={() => setRenaming(null)}
                        placeholder="path/to/file.md"
                        className="w-full rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 font-mono text-xs outline-none"
                    />
                </div>
            )
        }
        return (
            <div key={node.path} className="group/filerow relative">
                <ContextMenu>
                    <ContextMenuTrigger asChild>
                        <button
                            type="button"
                            style={pad}
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData(ASSET_DRAG_MIME, node.path)
                                e.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragEnd={() => setDropTarget(null)}
                            onClick={() => onOpenFile(node.path)}
                            className={cn(
                                'flex h-7 w-full items-center gap-1.5 rounded-md pr-7 text-[13px] text-left',
                                active ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 hover:bg-accent/50',
                            )}
                        >
                            <span className="w-3 shrink-0" />
                            {board && <PenTool className="size-3 shrink-0 text-muted-foreground" />}
                            {!board && blob && (isImageMime(blob.mime)
                                ? <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
                                : <FileText className="size-3 shrink-0 text-muted-foreground" />)}
                            <ClippedText
                                text={board ? spaces.whiteboardDisplayName(node.name) : node.name}
                                detail={blob ? `${blob.mime} · ${formatBytes(blob.size)}` : null}
                                className="flex-1"
                            />
                            {unread && !active && <span className="size-1.5 rounded-full bg-foreground shrink-0" aria-label="updated since you last read" />}
                        </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onOpenFile(node.path)}>
                            <Eye className="size-3.5 mr-2" /> Open
                        </ContextMenuItem>
                        {node.entry && (
                            <>
                                <ContextMenuItem onSelect={() => setRenaming({ path: node.path, value: node.path })}>
                                    <Pencil className="size-3.5 mr-2" /> Rename / move
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem onSelect={() => setDeleting(node.entry!)}>
                                    <Trash2 className="size-3.5 mr-2" /> Delete…
                                </ContextMenuItem>
                            </>
                        )}
                    </ContextMenuContent>
                </ContextMenu>
                {node.entry && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="File actions"
                                className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/filerow:opacity-100 data-[state=open]:opacity-100"
                            >
                                <MoreHorizontal className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setRenaming({ path: node.path, value: node.path })}>
                                <Pencil className="size-3.5 mr-2" /> Rename / move
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDeleting(node.entry!)}>
                                <Trash2 className="size-3.5 mr-2" /> Delete…
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        )
    }

    return (
        <div
            className={cn('flex flex-col rounded-md', dropTarget === '' && 'ring-1 ring-inset ring-foreground/40 bg-accent/40')}
            {...dirDragProps('')}
        >
            {deleting && (
                <DeleteAssetDialog
                    orgId={orgId}
                    spaceId={spaceId}
                    entry={deleting}
                    onClose={() => setDeleting(null)}
                />
            )}
            {tree.map((node) => renderNode(node, 0))}
            {tree.length === 0 && !creating && !creatingFolder && <div className="px-2 py-1 text-xs text-muted-foreground">No files yet.</div>}
            {creating && (
                <div className="flex items-center gap-1 px-1 pt-1">
                    <Input
                        autoFocus
                        value={newPath}
                        placeholder="path/to/file.md"
                        className="h-7 text-xs"
                        onChange={(e) => setNewPath(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && newPath.trim()) {
                                onCreateFile(newPath.trim())
                                setNewPath('')
                            }
                            if (e.key === 'Escape') onCancelCreate()
                        }}
                    />
                    <Button size="icon" variant="ghost" className="size-7" onClick={onCancelCreate}>
                        <X className="size-3.5" />
                    </Button>
                </div>
            )}
            {creatingFolder && (
                <div className="flex items-center gap-1 px-1 pt-1">
                    <Input
                        autoFocus
                        value={newFolder}
                        placeholder="folder or folder/subfolder"
                        className="h-7 text-xs"
                        onChange={(e) => setNewFolder(e.target.value)}
                        onKeyDown={(e) => {
                            const cleaned = newFolder.trim().replace(/^\/+|\/+$/g, '')
                            if (e.key === 'Enter' && cleaned) {
                                onCreateFolder?.(cleaned)
                                setNewFolder('')
                            }
                            if (e.key === 'Escape') onCancelCreateFolder?.()
                        }}
                    />
                    <Button size="icon" variant="ghost" className="size-7" onClick={onCancelCreateFolder}>
                        <X className="size-3.5" />
                    </Button>
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// File column: meta line + rendered file; Edit → draft→apply (the novel
// interaction): a draft is explicit, applying is deliberate, a stale base that
// merges shows a notice, a conflict blocks nothing and loses nothing.
// ---------------------------------------------------------------------------

interface DraftState {
    baseVersion: number
    text: string
    reason: string
    conflict: Extract<spaces.ProposeChangeResult, { outcome: 'conflict' }> | null
}

export function FileColumn({ org, space, path, entries = [], memberNames, refreshTick, onChanged, crumb, onDismiss, onRenamed, onDeleted, onRedirect, onOpenFile }: {
    org: OrgWithSpaces
    space: spaces.Space
    path: string
    /** The space's file list — resolves relative image links to their blobs. */
    entries?: spaces.SpacesAssetEntry[]
    memberNames: Map<string, string>
    refreshTick: number
    onChanged: () => void
    /** Where the reader came from (a topic) — renders "← <label>" and makes Esc go back there. */
    crumb?: { label: string; onBack: () => void } | null
    /** Split only: renders an × that closes the document and returns to Talk. */
    onDismiss?: (() => void) | null
    /** The file moved (a rename here, or a followed redirect) — re-point the selection. */
    onRenamed?: (path: string) => void
    onDeleted?: () => void
    /** An old link resolved to the file's current path (server redirect signal). */
    onRedirect?: (path: string) => void
    /** A relative link in the document was clicked — open that file. */
    onOpenFile?: (path: string) => void
}) {
    const [asset, setAsset] = useState<spaces.ReadAssetResult | null>(null)
    const [missing, setMissing] = useState(false)
    const [draft, setDraft] = useState<DraftState | null>(null)
    const [applying, setApplying] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [diffView, setDiffView] = useState<{ title: string; unified: string } | null>(null)

    const load = useCallback(async () => {
        try {
            const res = await window.ipc.invoke('spaces:readAsset', { orgId: org.id, spaceId: space.id, path })
            if (res.path !== path) {
                // The server followed a redirect: this file lives elsewhere now.
                onRedirect?.(res.path)
                return
            }
            setAsset(res)
            setMissing(false)
        } catch {
            setAsset(null)
            setMissing(true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [org.id, space.id, path])

    useEffect(() => {
        void load()
    }, [load, refreshTick])

    // Esc returns to the topic this file was opened from (only when not editing).
    const crumbBack = crumb?.onBack
    const editing = draft !== null
    useEffect(() => {
        if (!crumbBack || editing) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
            e.preventDefault()
            crumbBack()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [crumbBack, editing])

    const beginEdit = () => {
        setDraft({ baseVersion: asset?.version ?? 0, text: asset?.content ?? '', reason: '', conflict: null })
    }

    const apply = async () => {
        if (!draft) return
        setApplying(true)
        try {
            const result = await window.ipc.invoke('spaces:proposeChange', {
                orgId: org.id,
                spaceId: space.id,
                input: {
                    assetPath: path,
                    baseVersion: draft.baseVersion,
                    newContent: draft.text,
                    ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
                },
            })
            if (result.outcome === 'applied') {
                toast(`Applied — now v${result.version}`, 'success')
                setDraft(null)
                await load()
                onChanged()
            } else if (result.outcome === 'merged') {
                // The base moved while drafting but the merge was clean: what
                // now exists is mergedContent, not the draft (contract rule).
                toast(`Applied with concurrent changes folded in — now v${result.version}`, 'success')
                setDraft(null)
                await load()
                onChanged()
            } else {
                setDraft({ ...draft, conflict: result })
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not apply', 'error')
        } finally {
            setApplying(false)
        }
    }

    const showDiff = async (from: number, to: number) => {
        try {
            const res = await window.ipc.invoke('spaces:diff', { orgId: org.id, spaceId: space.id, path, from, to })
            setDiffView({ title: `${path} · v${from} → v${to}`, unified: res.unified })
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not load the diff', 'error')
        }
    }

    // One-tap micro change-set: checkbox ticks in view mode apply directly.
    // The viewer reports the task's index in document order; toggleTaskAt maps
    // it back to the source line (skipping fenced code) and flips it.
    const toggleTask = async (index: number) => {
        if (!asset) return
        const next = toggleTaskAt(asset.content, index)
        if (next === null) return
        try {
            const result = await window.ipc.invoke('spaces:proposeChange', {
                orgId: org.id,
                spaceId: space.id,
                input: { assetPath: path, baseVersion: asset.version, newContent: next },
            })
            if (result.outcome === 'conflict') toast('Someone changed this line at the same time — refresh and retry', 'error')
            else {
                await load()
                onChanged()
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not apply', 'error')
        }
    }

    const last = asset?.recentHistory[0]
    const fileName = path.split('/').pop() ?? path
    const blob = asset?.blob ?? null
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

    // What the viewer renders: the org's canonical blob links become app://
    // (images show inline), and relative image references resolve against this
    // file's folder to the blob they name. Task lines are untouched, so task
    // indices in the rendered doc match the source (toggleTask relies on it).
    const entryByPath = useMemo(() => new Map(entries.map((e) => [e.path, e])), [entries])
    const wireRefs = useMemo(
        () => ({ orgId: org.id, orgAddress: org.address, spaceId: space.id }),
        [org.id, org.address, space.id],
    )
    const renderedContent = useMemo(() => {
        if (!asset || asset.blob) return ''
        const withBlobs = rewriteBlobLinks(asset.content, wireRefs)
        return rewriteRelativeImages(withBlobs, dir, (p) => {
            const target = entryByPath.get(p)
            return target?.blob && isImageMime(target.blob.mime)
                ? blobAppUrl({ orgId: org.id, spaceId: space.id }, target.blob.hash)
                : null
        })
    }, [asset, wireRefs, dir, entryByPath, org.id, space.id])

    // Link clicks inside the document: relative links (and the contract's
    // canonical asset URLs) open the file in-app, GitHub-README style; blob
    // links download; everything else keeps the default open-in-browser.
    const openLink = (href: string): boolean => {
        const blobRef = parseBlobAppUrl(href)
        if (blobRef) {
            const name = (() => {
                try {
                    return new URL(href).searchParams.get('name') ?? undefined
                } catch {
                    return undefined
                }
            })()
            void window.ipc
                .invoke('spaces:saveBlob', { ...blobRef, ...(name ? { suggestedName: name } : {}) })
                .then((res) => { if (res.saved) toast('Saved', 'success') })
                .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Could not download', 'error'))
            return true
        }
        const target = resolveSpaceLink(href, dir) ?? parseAssetWireUrl(href, wireRefs)
        if (target && onOpenFile) {
            onOpenFile(target)
            return true
        }
        return false
    }

    // Binary "edit": upload a replacement at this path against the current
    // version. A stale base is conflict-or-replace on binaries (contract) —
    // surfaced as a plain toast; retrying after a reload IS the replace.
    const replaceInputRef = useRef<HTMLInputElement | null>(null)
    const [replacing, setReplacing] = useState(false)
    const replaceWith = async (file: File) => {
        if (!asset) return
        setReplacing(true)
        try {
            const uploaded = await window.ipc.invoke('spaces:uploadBlob', {
                orgId: org.id,
                spaceId: space.id,
                ...(await uploadInputFor(file)),
                name: file.name,
                ...(file.type ? { mime: file.type } : {}),
            })
            const result = await window.ipc.invoke('spaces:proposeChange', {
                orgId: org.id,
                spaceId: space.id,
                input: { assetPath: path, baseVersion: asset.version, blob: uploaded.blob.hash, reason: `replace with ${file.name}` },
            })
            if (result.outcome === 'conflict') {
                toast(`Someone changed this file meanwhile (now v${result.currentVersion}) — it reloaded; replace again to overwrite`, 'error')
            } else {
                toast(`Replaced — now v${result.outcome === 'applied' ? result.version : asset.version}`, 'success')
            }
            await load()
            onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not replace', 'error')
        } finally {
            setReplacing(false)
        }
    }

    const download = async () => {
        if (!blob) return
        try {
            const res = await window.ipc.invoke('spaces:saveBlob', {
                orgId: org.id,
                spaceId: space.id,
                hash: blob.hash,
                suggestedName: fileName,
            })
            if (res.saved) toast('Saved', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not download', 'error')
        }
    }

    // Rename/move edits the full path inline where the filename sits.
    const [editingPath, setEditingPath] = useState<string | null>(null)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const commitMove = async () => {
        const toPath = editingPath?.trim()
        setEditingPath(null)
        if (!asset || !toPath || toPath === path) return
        try {
            const res = await window.ipc.invoke('spaces:moveAsset', {
                orgId: org.id, spaceId: space.id, fromPath: path, toPath, baseVersion: asset.version,
            })
            if (res.outcome === 'conflict') {
                toast('The file changed meanwhile — it reloaded, try again', 'error')
                await load()
            } else {
                toast(`Moved to ${toPath}`, 'success')
                onChanged()
                onRenamed?.(toPath)
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not move', 'error')
        }
    }

    if (missing && !draft) {
        return (
            <section className="flex-1 min-w-0 flex flex-col">
                <div className="p-8 text-sm text-muted-foreground">
                    <p className="mb-3"><code className="font-mono text-xs">{path}</code> doesn&apos;t exist yet.</p>
                    <Button size="sm" onClick={beginEdit}><Plus className="size-3.5 mr-1" /> Create it</Button>
                </div>
            </section>
        )
    }

    return (
        <section className="flex-1 min-w-0 min-h-0 flex flex-col border-r border-border">
            <div className="flex items-center gap-2 px-5 h-9 shrink-0 text-xs text-muted-foreground">
                {crumb && (
                    <button
                        type="button"
                        onClick={crumb.onBack}
                        title="Back to the topic (Esc)"
                        className="inline-flex max-w-[16rem] shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-foreground/80 hover:bg-accent hover:text-foreground"
                    >
                        <ArrowLeft className="size-3 shrink-0" /> <span className="truncate">{crumb.label}</span>
                    </button>
                )}
                {editingPath !== null ? (
                    <input
                        autoFocus
                        value={editingPath}
                        onChange={(e) => setEditingPath(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitMove()
                            if (e.key === 'Escape') setEditingPath(null)
                        }}
                        onBlur={() => setEditingPath(null)}
                        placeholder="path/to/file.md"
                        className="w-72 rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 font-mono text-[11.5px] outline-none"
                    />
                ) : (
                    <code className="font-mono text-[11.5px] text-foreground/80 truncate" title={path}>{fileName}</code>
                )}
                {blob && <span className="shrink-0">· {blob.mime} · {formatBytes(blob.size)}</span>}
                {!draft && last && (
                    <span className="truncate">
                        · updated {formatFeedTime(last.committedAt)} by {attributionLabel(last.attribution, memberNames)}
                    </span>
                )}
                {!draft && asset && !last && <span>· v{asset.version}</span>}
                <div className="flex-1" />
                {!draft && asset && (
                    <>
                        {blob ? (
                            <>
                                <input
                                    ref={replaceInputRef}
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0]
                                        if (file) void replaceWith(file)
                                        e.target.value = ''
                                    }}
                                />
                                <button type="button" className="hover:text-foreground flex items-center gap-1" onClick={() => void download()}>
                                    <Download className="size-3" /> Download
                                </button>
                                <button
                                    type="button"
                                    className="hover:text-foreground flex items-center gap-1"
                                    disabled={replacing}
                                    onClick={() => replaceInputRef.current?.click()}
                                >
                                    {replacing ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} Replace
                                </button>
                            </>
                        ) : (
                            <button type="button" className="hover:text-foreground flex items-center gap-1" onClick={beginEdit}>
                                <Pencil className="size-3" /> Edit
                            </button>
                        )}
                        <button
                            type="button"
                            className={cn('hover:text-foreground flex items-center gap-1', historyOpen && 'text-foreground')}
                            onClick={() => setHistoryOpen((v) => !v)}
                        >
                            <History className="size-3" /> History
                        </button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button type="button" aria-label="File actions" className="hover:text-foreground flex items-center">
                                    <MoreHorizontal className="size-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setEditingPath(path)}>
                                    <Pencil className="size-3.5 mr-2" /> Rename / move
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setDeleteOpen(true)}>
                                    <Trash2 className="size-3.5 mr-2" /> Delete…
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </>
                )}
                {deleteOpen && asset && (
                    <DeleteAssetDialog
                        orgId={org.id}
                        spaceId={space.id}
                        entry={{ path, version: asset.version, updatedAt: '' }}
                        onClose={() => setDeleteOpen(false)}
                        onDeleted={() => {
                            onChanged()
                            onDeleted?.()
                        }}
                    />
                )}
                {draft && (
                    <>
                        <Input
                            value={draft.reason}
                            placeholder="Why? (optional — shows in history forever)"
                            className="h-6 text-xs w-72"
                            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                        />
                        <Button size="sm" className="h-6 text-xs" disabled={applying} onClick={() => void apply()}>
                            {applying ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Check className="size-3 mr-1" />}
                            Apply{draft.conflict ? ` against v${draft.conflict.currentVersion}` : ''}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setDraft(null)}>
                            <X className="size-3 mr-1" /> Discard
                        </Button>
                    </>
                )}
                {onDismiss && !draft && (
                    <button
                        type="button"
                        title="Close the file — the chat takes the width"
                        onClick={onDismiss}
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent hover:text-foreground"
                    >
                        <X className="size-3.5" />
                    </button>
                )}
            </div>
            <div className="mx-5 border-t border-border" />
            {draft?.conflict && (
                <ConflictNotice
                    conflict={draft.conflict}
                    memberNames={memberNames}
                    onUseCurrent={() => {
                        setDraft({
                            baseVersion: draft.conflict!.currentVersion,
                            text: draft.conflict!.currentContent,
                            reason: draft.reason,
                            conflict: null,
                        })
                    }}
                    onRebase={() => setDraft({ ...draft, baseVersion: draft.conflict!.currentVersion })}
                />
            )}
            <div className="flex-1 min-h-0 flex">
                <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
                    {draft ? (
                        <Textarea
                            value={draft.text}
                            spellCheck={false}
                            className="w-full h-full min-h-full rounded-none border-0 font-mono text-sm resize-none focus-visible:ring-0 px-5 py-4"
                            onChange={(e) => setDraft({ ...draft, text: e.target.value, conflict: null })}
                        />
                    ) : blob ? (
                        <div className="p-5">
                            {isImageMime(blob.mime) ? (
                                <img
                                    src={blobAppUrl({ orgId: org.id, spaceId: space.id }, blob.hash)}
                                    alt={fileName}
                                    // Dimensions (upload-time sniff) reserve the exact box
                                    // before the bytes arrive — no layout shift on open.
                                    style={blob.width && blob.height
                                        ? { aspectRatio: `${blob.width} / ${blob.height}`, width: blob.width }
                                        : undefined}
                                    className={cn('max-w-full rounded-lg border border-border', blob.width && blob.height && 'bg-muted')}
                                />
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => void download()}
                                    className="flex w-full max-w-sm items-center gap-3 rounded-xl border border-border bg-background p-4 text-left hover:border-foreground/30"
                                >
                                    <FileText className="size-8 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium">{fileName}</span>
                                        <span className="block text-xs text-muted-foreground">{blob.mime} · {formatBytes(blob.size)} · click to download</span>
                                    </span>
                                </button>
                            )}
                        </div>
                    ) : asset ? (
                        <div className="px-5 py-4 max-w-3xl">
                            <RichMarkdownViewer
                                content={renderedContent}
                                onToggleTask={(i) => void toggleTask(i)}
                                onOpenLink={openLink}
                            />
                        </div>
                    ) : (
                        <div className="p-5 text-sm text-muted-foreground">Loading…</div>
                    )}
                </div>
                {historyOpen && asset && !draft && (
                    <HistoryPanel
                        org={org}
                        space={space}
                        path={path}
                        memberNames={memberNames}
                        refreshTick={refreshTick}
                        onClose={() => setHistoryOpen(false)}
                        onShowDiff={(from, to) => void showDiff(from, to)}
                    />
                )}
            </div>
            <Dialog open={diffView !== null} onOpenChange={(open) => !open && setDiffView(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-sm">{diffView?.title}</DialogTitle>
                    </DialogHeader>
                    <pre className="max-h-[60vh] overflow-auto text-xs bg-muted/50 rounded p-3 whitespace-pre-wrap">
                        {diffView?.unified}
                    </pre>
                </DialogContent>
            </Dialog>
        </section>
    )
}

function ConflictNotice({ conflict, memberNames, onUseCurrent, onRebase }: {
    conflict: Extract<spaces.ProposeChangeResult, { outcome: 'conflict' }>
    memberNames: Map<string, string>
    onUseCurrent: () => void
    onRebase: () => void
}) {
    const lastWriter = conflict.recentHistory[0]
    return (
        <div className="border-b border-border bg-muted/40 px-5 py-2 text-xs space-y-1">
            <div className="font-medium">
                Nothing was saved — {lastWriter ? attributionLabel(lastWriter.attribution, memberNames) : 'someone'} changed
                {' '}the same {conflict.regions.length === 1 ? 'region' : `${conflict.regions.length} regions`} while you were drafting (now v{conflict.currentVersion}).
            </div>
            {conflict.regions.map((region, i) => (
                <div key={i} className="pl-2 border-l-2 border-border">
                    <span className="text-muted-foreground">
                        lines {region.baseStart > region.baseEnd ? `at ${region.baseEnd}+` : `${region.baseStart}–${region.baseEnd}`}:
                    </span>
                    <span className="text-muted-foreground"> theirs </span>
                    <code>{region.current.join(' ⏎ ') || '(deleted)'}</code>
                    <span className="text-muted-foreground"> · yours </span>
                    <code>{region.proposed.join(' ⏎ ') || '(deleted)'}</code>
                </div>
            ))}
            <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onRebase}>
                    Keep my draft, I&apos;ve folded theirs in
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onUseCurrent}>
                    Start over from v{conflict.currentVersion}
                </Button>
            </div>
        </div>
    )
}

function HistoryPanel({ org, space, path, memberNames, refreshTick, onClose, onShowDiff }: {
    org: OrgWithSpaces
    space: spaces.Space
    path: string
    memberNames: Map<string, string>
    refreshTick: number
    onClose: () => void
    onShowDiff: (from: number, to: number) => void
}) {
    const [changeSets, setChangeSets] = useState<spaces.ChangeSet[]>([])

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:assetHistory', { orgId: org.id, spaceId: space.id, path, limit: 100 })
            .then((res) => {
                if (!cancelled) setChangeSets(res.changeSets)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, path, refreshTick])

    return (
        <aside className="w-72 shrink-0 border-l border-border flex flex-col min-h-0">
            <div className="flex items-center justify-between pl-3 pr-1.5 h-9 shrink-0">
                <span className="text-[13px] text-muted-foreground flex items-center gap-1">
                    History
                </span>
                <Button variant="ghost" size="icon" className="size-6" onClick={onClose}><X className="size-3.5" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {changeSets.map((cs) => (
                    <button
                        key={cs.id}
                        className="w-full text-left px-3 py-2 border-b border-border/50 hover:bg-accent/40"
                        onClick={() => onShowDiff(cs.baseVersion, cs.resultVersion)}
                    >
                        <div className="flex items-center gap-2">
                            <MemberAvatar id={cs.attribution.memberId} name={memberNames.get(cs.attribution.memberId) ?? cs.attribution.memberId} size="sm" />
                            <div className="text-xs font-medium truncate">{attributionLabel(cs.attribution, memberNames)}</div>
                        </div>
                        {cs.op && (
                            <div className="mt-1 pl-7 text-[12px] text-muted-foreground">
                                {cs.op === 'move' ? `moved from ${cs.movedFrom ?? '…'}` : cs.op === 'delete' ? 'deleted' : 'restored'}
                            </div>
                        )}
                        {cs.reason && <div className="text-xs text-muted-foreground mt-1 pl-7">&ldquo;<MemberText text={cs.reason} />&rdquo;</div>}
                        <div className="text-[10.5px] text-muted-foreground mt-1 pl-7 flex items-center gap-1">
                            <Clock className="size-2.5" /> {formatFeedTime(cs.committedAt)} · v{cs.resultVersion}
                        </div>
                    </button>
                ))}
                {changeSets.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No history yet.</div>}
            </div>
        </aside>
    )
}

// ---------------------------------------------------------------------------
// Delete → trash. Nothing is destroyed: the file freezes with its history and
// shows up in Trash, restorable while its path stays free.
// ---------------------------------------------------------------------------

export function DeleteAssetDialog({ orgId, spaceId, entry, onClose, onDeleted }: {
    orgId: string
    spaceId: string
    entry: spaces.SpacesAssetEntry
    onClose: () => void
    onDeleted?: () => void
}) {
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const confirm = async () => {
        setBusy(true)
        try {
            const res = await window.ipc.invoke('spaces:deleteAsset', {
                orgId, spaceId, path: entry.path, baseVersion: entry.version,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
            })
            if (res.outcome === 'conflict') {
                toast(`${entry.path} changed meanwhile — review and try again`, 'error')
            } else {
                toast(`Moved to Trash — restorable any time`, 'success')
                onDeleted?.()
            }
            onClose()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete', 'error')
        } finally {
            setBusy(false)
        }
    }
    return (
        <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-sm">Delete <code className="font-mono text-[12px]">{entry.path}</code>?</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                        It moves to Trash — history stays, and anyone can restore it. The feed will show who deleted it and why.
                    </p>
                    <Input
                        value={reason}
                        placeholder="Why? (optional — shows in the feed and history)"
                        className="h-7 text-xs"
                        disabled={busy}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void confirm() }}
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={onClose}>Cancel</Button>
                        <Button variant="destructive" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void confirm()}>
                            {busy ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />} Delete
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// Trash — deleted files, restorable in place while their path is free.
// ---------------------------------------------------------------------------

export function TrashDialog({ org, space, onClose }: {
    org: OrgWithSpaces
    space: spaces.Space
    onClose: () => void
}) {
    const [entries, setEntries] = useState<spaces.SpacesAssetEntry[] | null>(null)
    const [restoring, setRestoring] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            const res = await window.ipc.invoke('spaces:listAssets', { orgId: org.id, spaceId: space.id, includeDeleted: true })
            setEntries(res.entries.filter((e) => e.state === 'deleted'))
        } catch {
            setEntries([])
        }
    }, [org.id, space.id])

    useEffect(() => {
        void load()
    }, [load])

    const restore = async (path: string) => {
        setRestoring(path)
        try {
            await window.ipc.invoke('spaces:restoreAsset', { orgId: org.id, spaceId: space.id, path })
            toast(`Restored ${path}`, 'success')
            await load()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not restore', 'error')
        } finally {
            setRestoring(null)
        }
    }

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-sm flex items-center gap-1.5"><Trash2 className="size-3.5" /> Trash</DialogTitle>
                </DialogHeader>
                <div className="max-h-72 space-y-1 overflow-y-auto">
                    {entries === null && <div className="py-2 text-xs text-muted-foreground">Loading…</div>}
                    {entries?.length === 0 && <div className="py-2 text-xs text-muted-foreground">Nothing here — deleted files land in this list, restorable any time.</div>}
                    {entries?.map((e) => (
                        <div key={e.path} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                            {e.blob && isImageMime(e.blob.mime)
                                ? <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono">{e.path}</span>
                                <span className="block text-[10.5px] text-muted-foreground">deleted {formatFeedTime(e.updatedAt)}{e.blob ? ` · ${formatBytes(e.blob.size)}` : ''}</span>
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-6 shrink-0 text-xs"
                                disabled={restoring !== null}
                                onClick={() => void restore(e.path)}
                            >
                                {restoring === e.path ? <Loader2 className="size-3 mr-1 animate-spin" /> : <RotateCcw className="size-3 mr-1" />}
                                Restore
                            </Button>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// Upload to space files: phase-1 upload each picked file, then a binary
// propose per file at <folder>/<filename>. Folders are keys, not objects —
// typing "design/screens" is what creates the "folder".
// ---------------------------------------------------------------------------

interface UploadRow {
    file: File
    name: string
    status: 'pending' | 'uploading' | 'done' | 'error'
    error?: string
}

export function UploadFilesDialog({ org, space, files, entries, defaultFolder, onClose, onDone }: {
    org: OrgWithSpaces
    space: spaces.Space
    files: File[]
    entries: spaces.SpacesAssetEntry[]
    /** Prefill, e.g. the folder of the currently open file. */
    defaultFolder?: string
    onClose: () => void
    onDone: () => void
}) {
    const [folder, setFolder] = useState(defaultFolder ?? '')
    const [rows, setRows] = useState<UploadRow[]>(files.map((file) => ({ file, name: file.name, status: 'pending' })))
    const [running, setRunning] = useState(false)

    const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, '')
    const destFor = (name: string) => (cleanFolder ? `${cleanFolder}/${name}` : name)
    const existing = useMemo(() => new Map(entries.map((e) => [e.path, e.version])), [entries])

    const upload = async () => {
        setRunning(true)
        let failed = 0
        for (const [i, row] of rows.entries()) {
            if (row.status === 'done') continue
            setRows((prev) => prev.map((r, j) => (j === i ? { ...r, status: 'uploading' } : r)))
            try {
                const uploaded = await window.ipc.invoke('spaces:uploadBlob', {
                    orgId: org.id,
                    spaceId: space.id,
                    ...(await uploadInputFor(row.file)),
                    name: row.name,
                    ...(row.file.type ? { mime: row.file.type } : {}),
                })
                const dest = destFor(row.name)
                const result = await window.ipc.invoke('spaces:proposeChange', {
                    orgId: org.id,
                    spaceId: space.id,
                    input: {
                        assetPath: dest,
                        // Existing path = replace against its current head; new = create.
                        baseVersion: existing.get(dest) ?? 0,
                        blob: uploaded.blob.hash,
                        reason: `upload ${row.name}`,
                    },
                })
                if (result.outcome === 'conflict') {
                    throw new Error(`someone changed ${dest} meanwhile — try again`)
                }
                setRows((prev) => prev.map((r, j) => (j === i ? { ...r, status: 'done' } : r)))
            } catch (err) {
                failed += 1
                const message = err instanceof Error ? err.message : 'upload failed'
                setRows((prev) => prev.map((r, j) => (j === i ? { ...r, status: 'error', error: message } : r)))
            }
        }
        setRunning(false)
        if (failed === 0) {
            toast(rows.length === 1 ? `Uploaded ${destFor(rows[0]!.name)}` : `Uploaded ${rows.length} files`, 'success')
            onDone()
            onClose()
        }
    }

    return (
        <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-sm">Upload to {space.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <label className="block text-xs text-muted-foreground">
                        Folder <span className="text-muted-foreground/70">(optional — e.g. design/screens; created by the upload)</span>
                        <Input
                            value={folder}
                            placeholder="(space root)"
                            className="mt-1 h-7 text-xs font-mono"
                            disabled={running}
                            onChange={(e) => setFolder(e.target.value)}
                        />
                    </label>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                        {rows.map((row, i) => (
                            <div key={i} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                                {row.status === 'uploading' ? (
                                    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                                ) : row.status === 'done' ? (
                                    <Check className="size-3.5 shrink-0 text-[var(--rowboat-success)]" />
                                ) : row.status === 'error' ? (
                                    <X className="size-3.5 shrink-0 text-red-500" />
                                ) : (
                                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-mono">{destFor(row.name)}</span>
                                    {row.error && <span className="block truncate text-red-500">{row.error}</span>}
                                </span>
                                <span className="shrink-0 text-muted-foreground">{formatBytes(row.file.size)}</span>
                                {existing.has(destFor(row.name)) && row.status === 'pending' && (
                                    <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-400">replaces v{existing.get(destFor(row.name))}</span>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={running} onClick={onClose}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs" disabled={running || rows.length === 0} onClick={() => void upload()}>
                            {running ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Upload className="size-3 mr-1" />}
                            Upload {rows.length === 1 ? '' : `${rows.length} files`}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}


