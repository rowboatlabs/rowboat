import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Copy,
  ExternalLink,
  File as FileIcon,
  FilePlus,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Network,
  Pencil,
  SearchIcon,
  Table2,
  Trash2,
} from 'lucide-react'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { VoiceNoteButton } from '@/components/sidebar-content'
import { formatRelativeTime } from '@/lib/relative-time'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface TreeNode {
  path: string
  name: string
  kind: 'file' | 'dir'
  children?: TreeNode[]
  stat?: { size: number; mtimeMs: number }
}

export type KnowledgeViewActions = {
  createNote: (parentPath?: string) => void
  createFolder: (parentPath?: string) => Promise<string>
  rename: (path: string, newName: string, isDir: boolean) => Promise<void>
  remove: (path: string) => Promise<void>
  copyPath: (path: string) => void
  revealInFileManager: (path: string, isDir: boolean) => void
  onOpenInNewTab?: (path: string) => void
}

type KnowledgeViewProps = {
  tree: TreeNode[]
  actions: KnowledgeViewActions
  onOpenNote: (path: string) => void
  onOpenGraph: () => void
  onOpenSearch: () => void
  onOpenBases: () => void
  onVoiceNoteCreated?: (path: string) => void
}

type FlatRow = {
  node: TreeNode
  depth: number
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function flatten(
  nodes: TreeNode[],
  expanded: Set<string>,
  depth: number,
  out: FlatRow[],
): void {
  for (const node of sortNodes(nodes)) {
    out.push({ node, depth })
    if (node.kind === 'dir' && expanded.has(node.path) && node.children?.length) {
      flatten(node.children, expanded, depth + 1, out)
    }
  }
}

function formatModified(mtimeMs?: number): string {
  if (!mtimeMs) return ''
  return formatRelativeTime(new Date(mtimeMs).toISOString())
}

function getFileManagerName(): string {
  if (typeof navigator === 'undefined') return 'File Manager'
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'Finder'
  if (platform.includes('win')) return 'Explorer'
  return 'File Manager'
}

function displayName(node: TreeNode): string {
  if (node.kind === 'file' && node.name.toLowerCase().endsWith('.md')) {
    return node.name.slice(0, -3)
  }
  return node.name
}

const INDENT_PX = 16
const ROW_PADDING_PX = 12

export function KnowledgeView({
  tree,
  actions,
  onOpenNote,
  onOpenGraph,
  onOpenSearch,
  onOpenBases,
  onVoiceNoteCreated,
}: KnowledgeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [renameTarget, setRenameTarget] = useState<string | null>(null)

  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = []
    flatten(tree, expanded, 0, out)
    return out
  }, [tree, expanded])

  const handleRowClick = useCallback(
    (node: TreeNode) => {
      if (node.kind === 'dir') {
        setExpanded((prev) => {
          const next = new Set(prev)
          if (next.has(node.path)) next.delete(node.path)
          else next.add(node.path)
          return next
        })
      } else {
        onOpenNote(node.path)
      }
    },
    [onOpenNote],
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Knowledge</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => actions.createNote()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <FilePlus className="size-4" />
            <span>New note</span>
          </button>
          <button
            type="button"
            onClick={() => void actions.createFolder()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <FolderPlus className="size-4" />
            <span>New folder</span>
          </button>
          <VoiceNoteButton onNoteCreated={onVoiceNoteCreated} />
          <button
            type="button"
            onClick={onOpenSearch}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <SearchIcon className="size-4" />
            <span>Search</span>
          </button>
          <button
            type="button"
            onClick={onOpenBases}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Table2 className="size-4" />
            <span>Bases</span>
          </button>
          <button
            type="button"
            onClick={onOpenGraph}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Network className="size-4" />
            <span>Graph view</span>
          </button>
          <button
            type="button"
            onClick={() => actions.revealInFileManager('knowledge', true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <FolderOpen className="size-4" />
            <span>Open in {getFileManagerName()}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="min-w-[480px]">
          <div className="sticky top-0 z-10 flex items-center border-b border-border bg-background px-6 py-2 text-xs font-medium text-muted-foreground">
            <div className="flex-1">Page name</div>
            <div className="w-32 shrink-0">Modified</div>
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-8 text-sm text-muted-foreground">No pages yet.</div>
          ) : (
            rows.map(({ node, depth }) => (
              <KnowledgeRow
                key={node.path}
                node={node}
                depth={depth}
                isExpanded={expanded.has(node.path)}
                actions={actions}
                renameActive={renameTarget === node.path}
                onRequestRename={(p) => setRenameTarget(p)}
                onClearRename={() => setRenameTarget(null)}
                onClick={handleRowClick}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function KnowledgeRow({
  node,
  depth,
  isExpanded,
  actions,
  renameActive,
  onRequestRename,
  onClearRename,
  onClick,
}: {
  node: TreeNode
  depth: number
  isExpanded: boolean
  actions: KnowledgeViewActions
  renameActive: boolean
  onRequestRename: (path: string) => void
  onClearRename: () => void
  onClick: (node: TreeNode) => void
}) {
  const isDir = node.kind === 'dir'
  const Icon = isDir ? FolderIcon : FileIcon
  const paddingLeft = ROW_PADDING_PX + depth * INDENT_PX
  const baseName = displayName(node)

  const [newName, setNewName] = useState(baseName)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isSubmittingRef = useRef(false)

  useEffect(() => {
    if (renameActive) {
      setNewName(baseName)
      isSubmittingRef.current = false
      // focus on next tick after mount
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [renameActive, baseName])

  const handleRenameSubmit = useCallback(async () => {
    if (isSubmittingRef.current) return
    isSubmittingRef.current = true
    const trimmed = newName.trim()
    if (trimmed && trimmed !== baseName) {
      try {
        await actions.rename(node.path, trimmed, isDir)
        toast('Renamed successfully', 'success')
      } catch {
        toast('Failed to rename', 'error')
      }
    }
    onClearRename()
    setTimeout(() => {
      isSubmittingRef.current = false
    }, 100)
  }, [actions, baseName, isDir, newName, node.path, onClearRename])

  const cancelRename = useCallback(() => {
    isSubmittingRef.current = true
    setNewName(baseName)
    onClearRename()
    setTimeout(() => {
      isSubmittingRef.current = false
    }, 100)
  }, [baseName, onClearRename])

  const handleDelete = useCallback(async () => {
    try {
      await actions.remove(node.path)
      toast('Moved to trash', 'success')
    } catch {
      toast('Failed to delete', 'error')
    }
  }, [actions, node.path])

  const handleCopyPath = useCallback(() => {
    actions.copyPath(node.path)
    toast('Path copied', 'success')
  }, [actions, node.path])

  const row = (
    <button
      type="button"
      onClick={() => onClick(node)}
      className="group flex w-full items-center border-b border-border/60 px-6 py-1.5 text-left text-sm transition-colors hover:bg-accent"
    >
      <div className="flex flex-1 items-center gap-1.5 min-w-0" style={{ paddingLeft }}>
        <span className="inline-flex w-4 shrink-0 items-center justify-center text-muted-foreground">
          {isDir ? (
            <ChevronRight
              className={cn(
                'size-3.5 transition-transform',
                isExpanded && 'rotate-90',
              )}
            />
          ) : null}
        </span>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {renameActive ? (
          <Input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleRenameSubmit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelRename()
              }
            }}
            onBlur={() => {
              if (!isSubmittingRef.current) void handleRenameSubmit()
            }}
            className="h-6 text-sm flex-1"
          />
        ) : (
          <span className="min-w-0 truncate">{baseName}</span>
        )}
      </div>
      <div className="w-32 shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatModified(node.stat?.mtimeMs)}
      </div>
    </button>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {isDir && (
          <>
            <ContextMenuItem onClick={() => actions.createNote(node.path)}>
              <FilePlus className="mr-2 size-4" />
              New Note
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void actions.createFolder(node.path)}>
              <FolderPlus className="mr-2 size-4" />
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {!isDir && actions.onOpenInNewTab && (
          <>
            <ContextMenuItem onClick={() => actions.onOpenInNewTab!(node.path)}>
              <ExternalLink className="mr-2 size-4" />
              Open in new tab
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={handleCopyPath}>
          <Copy className="mr-2 size-4" />
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.revealInFileManager(node.path, isDir)}>
          <FolderOpen className="mr-2 size-4" />
          Open in {getFileManagerName()}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onRequestRename(node.path)}>
          <Pencil className="mr-2 size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={handleDelete}>
          <Trash2 className="mr-2 size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
