import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Copy,
  ExternalLink,
  File as FileIcon,
  FilePlus,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Home,
  Pencil,
  Plus,
  Trash2,
  UploadCloud,
} from 'lucide-react'

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

interface TreeNode {
  path: string
  name: string
  kind: 'file' | 'dir'
  children?: TreeNode[]
}

type WorkspaceActions = {
  remove: (path: string) => Promise<void>
  copyPath: (path: string) => void
  revealInFileManager: (path: string, isDir: boolean) => void
  createNote: (parentPath?: string) => void
  createFolder: (parentPath?: string) => Promise<string>
  onOpenInNewTab?: (path: string) => void
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

export function WorkspaceView({ tree, initialPath, actions, onNavigate, onOpenNote, onCreateWorkspace }: WorkspaceViewProps) {
  const currentPath = initialPath || WORKSPACE_ROOT
  const [addOpen, setAddOpen] = useState(false)
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

  const currentNode = useMemo(() => findNode(tree, currentPath), [tree, currentPath])

  const items = useMemo<TreeNode[]>(() => {
    const children = currentNode?.children ?? []
    const filtered = isRoot ? children.filter((c) => c.kind === 'dir') : children
    return [...filtered].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [currentNode, isRoot])

  const breadcrumbs = useMemo(() => {
    if (isRoot) return [] as { path: string; name: string }[]
    const rel = currentPath.slice(WORKSPACE_ROOT.length + 1)
    const parts = rel.split('/').filter(Boolean)
    let acc = WORKSPACE_ROOT
    return parts.map((seg) => {
      acc = `${acc}/${seg}`
      return { path: acc, name: seg }
    })
  }, [currentPath, isRoot])

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
    const parent = renameTarget.slice(0, renameTarget.lastIndexOf('/'))
    try {
      await window.ipc.invoke('workspace:rename', { from: renameTarget, to: `${parent}/${trimmed}` })
      toast('Renamed', 'success')
    } catch {
      toast('Failed to rename', 'error')
    }
  }, [renameTarget, renameValue, items])

  const handleDelete = useCallback(async (item: TreeNode) => {
    try {
      await actions.remove(item.path)
      toast('Moved to trash', 'success')
    } catch {
      toast('Failed to delete', 'error')
    }
  }, [actions])

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
    } catch (err) {
      console.error('Failed to add files:', err)
      toast('Failed to add', 'error')
    } finally {
      setUploading(false)
    }
  }, [currentPath])

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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex min-w-0 items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => onNavigate(WORKSPACE_ROOT)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors',
              isRoot ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <Home className="size-4" />
            <span className="font-medium">Workspace</span>
          </button>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1
            return (
              <span key={crumb.path} className="flex items-center gap-1">
                <ChevronRight className="size-4 text-muted-foreground/60" />
                {isLast ? (
                  <span className="rounded-md px-2 py-1 font-medium text-foreground truncate">
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigate(crumb.path)}
                    className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground truncate"
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            )
          })}
        </div>
        <div className="grid shrink-0 grid-cols-2 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => actions.revealInFileManager(currentPath, true)}
          >
            <FolderOpen className="size-4" />
            Open in {fileManagerName}
          </Button>
          {isRoot ? (
            <Button size="sm" className="w-full" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add workspace
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="w-full">
                  <Plus className="size-4" />
                  Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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

      <div
        className="relative flex-1 overflow-y-auto px-6 py-6"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <FolderIcon className="size-10 opacity-50" />
            <div className="text-sm">
              {isRoot
                ? 'No workspaces yet. Create one to get started.'
                : 'This folder is empty. Drag files in or use New note / New folder.'}
            </div>
            {isRoot && (
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                Add workspace
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {items.map((item) => {
              const childCount = item.kind === 'dir' ? countChildren(item) : 0
              const Icon = item.kind === 'dir' ? FolderIcon : FileIcon
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
                      <div className="truncate text-xs text-muted-foreground">
                        {item.kind === 'dir'
                          ? `${childCount} ${childCount === 1 ? 'item' : 'items'}`
                          : fileExtensionLabel(item.name)}
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
                    <ContextMenuItem variant="destructive" onClick={() => void handleDelete(item)}>
                      <Trash2 className="mr-2 size-4" />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        )}

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
              Workspaces are top-level folders inside knowledge/Workspace.
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
