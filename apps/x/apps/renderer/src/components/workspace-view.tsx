import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Copy,
  ExternalLink,
  File as FileIcon,
  FilePlus,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  FolderSymlink,
  Link2Off,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import type { z } from 'zod'
import { workspace } from '@x/shared'

import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const WORKSPACE_ROOT = 'knowledge/Workspace'
const LINKED_PREFIX = workspace.LINKED_FOLDER_PREFIX

type LinkedFolder = z.infer<typeof workspace.LinkedFolder>

interface TreeNode {
  path: string
  name: string
  kind: 'file' | 'dir'
  children?: TreeNode[]
}

/** `@folder/<id>/sub/path` → the folder id and the folder-relative remainder. */
function parseLinkedPath(path: string): { id: string; sub: string } | null {
  if (!path.startsWith(`${LINKED_PREFIX}/`)) return null
  const rest = path.slice(LINKED_PREFIX.length + 1)
  if (!rest) return null
  const slash = rest.indexOf('/')
  return slash === -1
    ? { id: rest, sub: '' }
    : { id: rest.slice(0, slash), sub: rest.slice(slash + 1) }
}

type WorkspaceActions = {
  remove: (path: string) => Promise<void>
  copyPath: (path: string) => void
  revealInFileManager: (path: string, isDir: boolean) => void
  createNote: (parentPath?: string) => void
  addGoogleDoc: (parentPath?: string) => void
  createFolder: (parentPath?: string) => Promise<string>
  onOpenInNewTab?: (path: string) => void
}

function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#1FA463" d="M8.52 3.5h6.96l6.95 12.04h-6.96L8.52 3.5Z" />
      <path fill="#FFD04B" d="M1.57 15.54 8.52 3.5l3.48 6.02-3.48 6.02H1.57Z" />
      <path fill="#4688F1" d="M8.52 15.54h13.91L18.95 21H5.05l3.47-5.46Z" />
    </svg>
  )
}

type WorkspaceViewProps = {
  tree: TreeNode[]
  initialPath?: string | null
  actions: WorkspaceActions
  // Folder currently being browsed. Controlled by the app so drill-down
  // participates in the global back/forward history.
  onNavigate: (path: string) => void
  onOpenNote: (path: string) => void
  onCreateWorkspace: (name: string) => Promise<void>
  // A linked folder was added, renamed or unlinked — reload the shared tree.
  onWorkspacesChanged: () => Promise<void> | void
  // Opens a previous chat (run) whose work directory is set to this workspace.
  onOpenRun: (runId: string) => void
}

type WorkspaceChat = {
  id: string
  title?: string
  createdAt: string
  modifiedAt: string
}

function formatChatAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function getFileManagerName(): string {
  if (typeof navigator === 'undefined') return 'File Manager'
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'Finder'
  if (platform.includes('win')) return 'Explorer'
  return 'File Manager'
}

function fileExtensionLabel(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'File'
  return `${name.slice(dot + 1).toUpperCase()} file`
}

function findNode(nodes: TreeNode[] | undefined, path: string): TreeNode | null {
  if (!nodes) return null
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.kind === 'dir' && path.startsWith(`${node.path}/`)) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return null
}

function countChildren(node: TreeNode | null): number {
  if (!node || node.kind !== 'dir' || !node.children) return 0
  return node.children.length
}

async function uniqueChildPath(parent: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let candidate = `${parent}/${name}`
  let i = 1
  while ((await window.ipc.invoke('workspace:exists', { path: candidate })).exists) {
    candidate = `${parent}/${base} (${i})${ext}`
    i += 1
  }
  return candidate
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function WorkspaceView({ tree, initialPath, actions, onNavigate, onOpenNote, onCreateWorkspace, onWorkspacesChanged, onOpenRun }: WorkspaceViewProps) {
  const currentPath = initialPath || WORKSPACE_ROOT
  const [addOpen, setAddOpen] = useState(false)
  const [linkedFolders, setLinkedFolders] = useState<LinkedFolder[]>([])
  // Contents of the linked folder currently being browsed. Linked folders sit
  // outside the workspace watcher, so this is fetched (and refreshed) here
  // rather than read off the shared tree.
  const [linkedEntries, setLinkedEntries] = useState<TreeNode[]>([])
  const [linkedLoading, setLinkedLoading] = useState(false)
  const [linkedError, setLinkedError] = useState<string | null>(null)
  const [chatsOpen, setChatsOpen] = useState(false)
  const [chats, setChats] = useState<WorkspaceChat[]>([])
  const [chatsLoading, setChatsLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dragDepthRef = useRef(0)
  const filesInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const isRoot = currentPath === WORKSPACE_ROOT
  const fileManagerName = getFileManagerName()

  const linkedRef = useMemo(() => parseLinkedPath(currentPath), [currentPath])
  const isLinked = linkedRef !== null
  const linkedById = useMemo(
    () => new Map(linkedFolders.map((f) => [f.id, f])),
    [linkedFolders],
  )
  const currentFolder = linkedRef ? linkedById.get(linkedRef.id) ?? null : null

  const currentNode = useMemo(() => findNode(tree, currentPath), [tree, currentPath])

  const items = useMemo<TreeNode[]>(() => {
    const children = isLinked ? linkedEntries : currentNode?.children ?? []
    let filtered = isRoot ? children.filter((c) => c.kind === 'dir') : children
    if (isRoot) {
      // Linked folders come from this view's own state, not the shared tree —
      // nothing watches the registry, so the tree can lag behind an add/remove.
      filtered = [
        ...filtered.filter((c) => !c.path.startsWith(`${LINKED_PREFIX}/`)),
        ...linkedFolders.map((f) => ({
          name: f.name,
          path: `${LINKED_PREFIX}/${f.id}`,
          kind: 'dir' as const,
        })),
      ]
    }
    return [...filtered].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [currentNode, isRoot, isLinked, linkedEntries, linkedFolders])

  const breadcrumbs = useMemo(() => {
    if (isRoot) return [] as { path: string; name: string }[]
    if (linkedRef) {
      const root = `${LINKED_PREFIX}/${linkedRef.id}`
      let acc = root
      return [
        { path: root, name: currentFolder?.name ?? 'Folder' },
        ...linkedRef.sub.split('/').filter(Boolean).map((seg) => {
          acc = `${acc}/${seg}`
          return { path: acc, name: seg }
        }),
      ]
    }
    const rel = currentPath.slice(WORKSPACE_ROOT.length + 1)
    const parts = rel.split('/').filter(Boolean)
    let acc = WORKSPACE_ROOT
    return parts.map((seg) => {
      acc = `${acc}/${seg}`
      return { path: acc, name: seg }
    })
  }, [currentPath, isRoot, linkedRef, currentFolder])

  const loadLinkedFolders = useCallback(async () => {
    try {
      const { folders } = await window.ipc.invoke('workspace:listFolders', null)
      setLinkedFolders(folders)
    } catch (err) {
      console.error('Failed to load linked folders:', err)
    }
  }, [])

  useEffect(() => {
    void loadLinkedFolders()
  }, [loadLinkedFolders])

  // Read the current linked directory. Nothing watches folders outside
  // WorkDir (a linked repo's node_modules would blow the fd limit), so this
  // re-runs on navigation, on window focus, and after our own mutations.
  const refreshLinkedEntries = useCallback(async () => {
    if (!isLinked) return
    setLinkedLoading(true)
    try {
      const entries = await window.ipc.invoke('workspace:readdir', {
        path: currentPath,
        opts: { includeHidden: false, includeStats: true },
      })
      setLinkedEntries(entries.map((e) => ({ path: e.path, name: e.name, kind: e.kind })))
      setLinkedError(null)
    } catch (err) {
      setLinkedEntries([])
      setLinkedError(err instanceof Error ? err.message : 'Failed to read this folder')
    } finally {
      setLinkedLoading(false)
    }
  }, [currentPath, isLinked])

  useEffect(() => {
    setLinkedEntries([])
    setLinkedError(null)
    void refreshLinkedEntries()
  }, [refreshLinkedEntries])

  useEffect(() => {
    if (!isLinked) return
    const onFocus = () => void refreshLinkedEntries()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isLinked, refreshLinkedEntries])

  // Load the chats whose work directory is this workspace folder (or nested
  // inside it). The work directory is stored as an absolute path per run, so
  // resolve this folder against the workspace root before querying.
  const loadChats = useCallback(async () => {
    if (isRoot) {
      setChats([])
      return
    }
    setChatsLoading(true)
    try {
      const { path: abs } = await window.ipc.invoke('workspace:toAbsolute', { path: currentPath })
      const { runs } = await window.ipc.invoke('runs:listByWorkDir', { dir: abs })
      setChats(runs.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, modifiedAt: r.modifiedAt })))
    } catch (err) {
      console.error('Failed to load workspace chats:', err)
      setChats([])
    } finally {
      setChatsLoading(false)
    }
  }, [currentPath, isRoot])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  const handleItemClick = useCallback(
    (item: TreeNode) => {
      if (renameTarget) return
      if (item.kind === 'dir') {
        onNavigate(item.path)
      } else {
        onOpenNote(item.path)
      }
    },
    [onNavigate, onOpenNote, renameTarget],
  )

  const beginRename = useCallback((item: TreeNode) => {
    setRenameTarget(item.path)
    setRenameValue(item.name)
  }, [])

  const commitRename = useCallback(async () => {
    if (!renameTarget) return
    const node = items.find((i) => i.path === renameTarget)
    const trimmed = renameValue.trim()
    setRenameTarget(null)
    if (!node || !trimmed || trimmed === node.name || trimmed.includes('/')) return
    const linked = parseLinkedPath(renameTarget)
    // Renaming a linked folder renames how Rowboat labels it — the folder on
    // disk keeps its own name.
    if (linked && !linked.sub) {
      try {
        await window.ipc.invoke('workspace:renameFolder', { id: linked.id, name: trimmed })
        await loadLinkedFolders()
        await onWorkspacesChanged()
        toast('Renamed', 'success')
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to rename', 'error')
      }
      return
    }
    const parent = renameTarget.slice(0, renameTarget.lastIndexOf('/'))
    try {
      await window.ipc.invoke('workspace:rename', { from: renameTarget, to: `${parent}/${trimmed}` })
      await refreshLinkedEntries()
      toast('Renamed', 'success')
    } catch {
      toast('Failed to rename', 'error')
    }
  }, [renameTarget, renameValue, items, loadLinkedFolders, onWorkspacesChanged, refreshLinkedEntries])

  const handleDelete = useCallback(async (item: TreeNode) => {
    try {
      await actions.remove(item.path)
      await refreshLinkedEntries()
      toast('Moved to trash', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    }
  }, [actions, refreshLinkedEntries])

  // Unlinking never touches the folder itself — it only stops Rowboat
  // showing it as a workspace.
  const handleUnlink = useCallback(async (folderId: string) => {
    try {
      await window.ipc.invoke('workspace:removeFolder', { id: folderId })
      await loadLinkedFolders()
      await onWorkspacesChanged()
      toast('Folder removed from Rowboat. Nothing on disk was deleted.', 'success')
    } catch {
      toast('Failed to remove folder', 'error')
    }
  }, [loadLinkedFolders, onWorkspacesChanged])

  const handleAddFolder = useCallback(async () => {
    try {
      const { folder } = await window.ipc.invoke('workspace:addFolder', {})
      if (!folder) return
      setAddOpen(false)
      await loadLinkedFolders()
      await onWorkspacesChanged()
      toast(`Added "${folder.name}"`, 'success')
      onNavigate(`${LINKED_PREFIX}/${folder.id}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to add folder', 'error')
    }
  }, [loadLinkedFolders, onWorkspacesChanged, onNavigate])

  const uploadFiles = useCallback(async (files: FileList | File[], preserveStructure = false) => {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(true)
    try {
      for (const file of list) {
        const data = await readFileAsBase64(file)
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
        const target = preserveStructure && rel
          ? `${currentPath}/${rel}`
          : await uniqueChildPath(currentPath, file.name)
        await window.ipc.invoke('workspace:writeFile', {
          path: target,
          data,
          opts: { encoding: 'base64', mkdirp: true },
        })
      }
      toast(list.length === 1 ? 'Added' : `${list.length} items added`, 'success')
      await refreshLinkedEntries()
    } catch (err) {
      console.error('Failed to add files:', err)
      toast('Failed to add', 'error')
    } finally {
      setUploading(false)
    }
  }, [currentPath, refreshLinkedEntries])

  // Drag-and-drop (only inside a workspace folder, not at the root grid).
  // stopPropagation keeps the drop from also reaching the copilot's
  // document-level drop listener when it lands on the workspace area.
  const dropEnabled = !isRoot
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!dropEnabled) return
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    setIsDraggingOver(true)
  }, [dropEnabled])
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!dropEnabled) return
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [dropEnabled])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!dropEnabled) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setIsDraggingOver(false)
    }
  }, [dropEnabled])
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!dropEnabled) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setIsDraggingOver(false)
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files)
  }, [dropEnabled, uploadFiles])

  const resetAddDialog = useCallback(() => {
    setNewName('')
    setError(null)
    setCreating(false)
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    if (trimmed.includes('/')) {
      setError('Name cannot contain "/"')
      return
    }
    setCreating(true)
    setError(null)
    try {
      await onCreateWorkspace(trimmed)
      setAddOpen(false)
      resetAddDialog()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
      setCreating(false)
    }
  }, [newName, onCreateWorkspace, resetAddDialog])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f8f8f9] dark:bg-[#0b0b0d]">
      <div className="mx-auto flex w-full max-w-[1120px] shrink-0 items-center justify-between gap-3 pl-[22px] pr-[30px] pt-[30px] pb-4">
        <div className="flex min-w-0 items-end gap-1 text-sm">
          <button
            type="button"
            onClick={() => onNavigate(WORKSPACE_ROOT)}
            className={cn(
              'inline-flex rounded-md px-2 py-1 transition-colors',
              isRoot ? 'text-[#0d0e11] dark:text-[#f4f5f7]' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <span className="text-[24px] leading-none font-[650] tracking-[-0.02em]">Workspace</span>
          </button>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1
            return (
              <Fragment key={crumb.path}>
                <ChevronRight className="mb-[5px] size-4 shrink-0 text-muted-foreground/60" />
                {isLast ? (
                  <span className="mb-[2px] rounded-md px-2 py-1 leading-none font-medium text-foreground truncate">
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigate(crumb.path)}
                    className="mb-[2px] rounded-md px-2 py-1 leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground truncate"
                  >
                    {crumb.name}
                  </button>
                )}
              </Fragment>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isRoot && (
            <Button
              size="sm"
              variant={chatsOpen ? 'secondary' : 'outline'}
              onClick={() => setChatsOpen((v) => !v)}
            >
              <MessageSquare className="size-4" />
              Chats{chats.length ? ` (${chats.length})` : ''}
            </Button>
          )}
          {isLinked && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refreshLinkedEntries()}
              title="Reload this folder"
            >
              <RefreshCw className={cn('size-4', linkedLoading && 'animate-spin')} />
              Refresh
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => actions.revealInFileManager(currentPath, true)}
          >
            <FolderOpen className="size-4" />
            Open in {fileManagerName}
          </Button>
          {isRoot ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus className="size-4" />
                  Add workspace
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setAddOpen(true)}>
                  <FolderPlus className="mr-2 size-4" />
                  New workspace
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleAddFolder()}>
                  <FolderSymlink className="mr-2 size-4" />
                  Add existing folder…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus className="size-4" />
                  Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => actions.createNote(currentPath)}>
                  <FilePlus className="mr-2 size-4" />
                  New note
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.addGoogleDoc(currentPath)}>
                  <GoogleDriveIcon className="mr-2 size-4" />
                  Add Google Doc
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => filesInputRef.current?.click()}>
                  <FilePlus className="mr-2 size-4" />
                  Add files…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
                  <FolderPlus className="mr-2 size-4" />
                  Add folder…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files, false)
          e.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error non-standard but supported in Chromium/Electron
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files, true)
          e.target.value = ''
        }}
      />

      <div className="flex flex-1 overflow-hidden">
      <div
        className="relative flex-1 overflow-y-auto"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="mx-auto h-full w-full max-w-[1120px] px-[30px] py-6">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            {linkedLoading ? (
              <Loader2 className="size-6 animate-spin opacity-60" />
            ) : (
              <>
                <FolderIcon className="size-10 opacity-50" />
                <div className="text-sm">
                  {linkedError
                    ? linkedError
                    : isRoot
                      ? 'No workspaces yet. Create one, or add a folder you already have.'
                      : 'This folder is empty. Drag files in or use New note / New folder.'}
                </div>
                {isLinked && currentFolder && !linkedError && (
                  <div className="max-w-[520px] truncate font-mono text-xs opacity-70" title={currentFolder.path}>
                    {currentFolder.path}
                  </div>
                )}
                {isRoot && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                      <Plus className="size-4" />
                      New workspace
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void handleAddFolder()}>
                      <FolderSymlink className="size-4" />
                      Add existing folder…
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {items.map((item) => {
              const childCount = item.kind === 'dir' ? countChildren(item) : 0
              // A card for a linked folder's root: it points somewhere outside
              // WorkDir, and its item count is only known once you open it.
              const linkedItem = parseLinkedPath(item.path)
              const linkedRoot = linkedItem && !linkedItem.sub ? linkedById.get(linkedItem.id) ?? null : null
              const Icon = linkedRoot ? FolderSymlink : item.kind === 'dir' ? FolderIcon : FileIcon
              const isRenaming = renameTarget === item.path
              const card = (
                <button
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className="group flex w-full flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:bg-accent"
                >
                  <Icon className="size-6 text-muted-foreground group-hover:text-foreground" />
                  <div className="min-w-0 w-full">
                    {isRenaming ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void commitRename()}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') { e.preventDefault(); void commitRename() }
                          else if (e.key === 'Escape') { e.preventDefault(); setRenameTarget(null) }
                        }}
                        className="h-6 text-sm"
                      />
                    ) : (
                      <div className="truncate text-sm font-medium">{item.name}</div>
                    )}
                    {!isRenaming && (
                      <div className="truncate text-xs text-muted-foreground" title={linkedRoot?.path}>
                        {linkedRoot
                          ? linkedRoot.path
                          : item.kind === 'file'
                            ? fileExtensionLabel(item.name)
                            // Children of a linked folder are loaded one level at
                            // a time, so a subfolder's own count isn't known yet.
                            : isLinked
                              ? 'Folder'
                              : `${childCount} ${childCount === 1 ? 'item' : 'items'}`}
                      </div>
                    )}
                  </div>
                </button>
              )
              const isDir = item.kind === 'dir'
              return (
                <ContextMenu key={item.path}>
                  <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
                  <ContextMenuContent className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
                    {isDir && (
                      <>
                        <ContextMenuItem onClick={() => actions.createNote(item.path)}>
                          <FilePlus className="mr-2 size-4" />
                          New Note
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => void actions.createFolder(item.path)}>
                          <FolderPlus className="mr-2 size-4" />
                          New Folder
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                      </>
                    )}
                    {!isDir && actions.onOpenInNewTab && (
                      <>
                        <ContextMenuItem onClick={() => actions.onOpenInNewTab!(item.path)}>
                          <ExternalLink className="mr-2 size-4" />
                          Open in new tab
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                      </>
                    )}
                    <ContextMenuItem onClick={() => { actions.copyPath(item.path); toast('Path copied', 'success') }}>
                      <Copy className="mr-2 size-4" />
                      Copy Path
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => actions.revealInFileManager(item.path, isDir)}>
                      <FolderOpen className="mr-2 size-4" />
                      Open in {fileManagerName}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => beginRename(item)}>
                      <Pencil className="mr-2 size-4" />
                      Rename
                    </ContextMenuItem>
                    {linkedRoot ? (
                      <ContextMenuItem onClick={() => void handleUnlink(linkedRoot.id)}>
                        <Link2Off className="mr-2 size-4" />
                        Remove from Rowboat
                      </ContextMenuItem>
                    ) : (
                      <ContextMenuItem variant="destructive" onClick={() => void handleDelete(item)}>
                        <Trash2 className="mr-2 size-4" />
                        Delete
                      </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        )}
        </div>

        {dropEnabled && isDraggingOver && (
          <div className="pointer-events-none absolute inset-3 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 text-primary">
            <UploadCloud className="size-8" />
            <span className="text-sm font-medium">Drop files to add to this folder</span>
          </div>
        )}
        {uploading && (
          <div className="pointer-events-none absolute bottom-4 right-4 z-10 rounded-md bg-foreground/80 px-3 py-1.5 text-xs text-background">
            Adding files…
          </div>
        )}
      </div>

      {!isRoot && chatsOpen && (
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="text-sm font-medium text-foreground">Chats</span>
            {chatsLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!chatsLoading && chats.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No chats use this workspace yet. Set a chat's work directory to this folder and it will appear here.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => onOpenRun(chat.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
                  >
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] text-foreground">
                        {chat.title || '(Untitled chat)'}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatChatAt(chat.createdAt)}
                      </span>
                    </div>
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open)
          if (!open) resetAddDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              A new workspace is a folder inside knowledge/Workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor="workspace-name" className="text-sm font-medium">Name</label>
            <Input
              id="workspace-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Alpha"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !creating) {
                  e.preventDefault()
                  void handleCreate()
                }
              }}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <button
            type="button"
            onClick={() => void handleAddFolder()}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-foreground/20 hover:bg-accent"
          >
            <FolderSymlink className="size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Add a folder you already have</span>
              <span className="block text-xs text-muted-foreground">
                Browse it in Rowboat, wherever it lives. Files stay where they are.
              </span>
            </span>
          </button>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddOpen(false)
                resetAddDialog()
              }}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
