import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, File as FileIcon, Folder as FolderIcon, Home, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const WORKSPACE_ROOT = 'knowledge/Workspace'

interface TreeNode {
  path: string
  name: string
  kind: 'file' | 'dir'
  children?: TreeNode[]
}

type WorkspaceViewProps = {
  tree: TreeNode[]
  initialPath?: string | null
  onOpenNote: (path: string) => void
  onCreateWorkspace: (name: string) => Promise<void>
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

export function WorkspaceView({ tree, initialPath, onOpenNote, onCreateWorkspace }: WorkspaceViewProps) {
  const [currentPath, setCurrentPath] = useState<string>(initialPath || WORKSPACE_ROOT)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialPath) setCurrentPath(initialPath)
  }, [initialPath])

  const isRoot = currentPath === WORKSPACE_ROOT

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
      if (item.kind === 'dir') {
        setCurrentPath(item.path)
      } else {
        onOpenNote(item.path)
      }
    },
    [onOpenNote],
  )

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
            onClick={() => setCurrentPath(WORKSPACE_ROOT)}
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
                    onClick={() => setCurrentPath(crumb.path)}
                    className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground truncate"
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            )
          })}
        </div>
        {isRoot && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add workspace
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <FolderIcon className="size-10 opacity-50" />
            <div className="text-sm">
              {isRoot
                ? 'No workspaces yet. Create one to get started.'
                : 'This folder is empty.'}
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
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className="group flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:bg-accent"
                >
                  <Icon className="size-6 text-muted-foreground group-hover:text-foreground" />
                  <div className="min-w-0 w-full">
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    {item.kind === 'dir' && (
                      <div className="text-xs text-muted-foreground">
                        {childCount} {childCount === 1 ? 'item' : 'items'}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
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
