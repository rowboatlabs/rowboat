import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus,
  FileText,
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
  // Folder currently being browsed (null = root overview). Controlled by the
  // app so drill-down participates in the global back/forward history.
  folderPath: string | null
  onNavigateFolder: (path: string | null) => void
  onOpenNote: (path: string) => void
  onOpenGraph: () => void
  onOpenSearch: () => void
  onOpenBases: () => void
  onVoiceNoteCreated?: (path: string) => void
}

// Folders that have their own dedicated destinations elsewhere in the app.
const HIDDEN_PATHS = new Set(['knowledge/Meetings', 'knowledge/Workspace'])

// Theme-aware accent palette for folder avatars — colored letter on a faint
// tint of the same hue. Mirrors the design's six-colour rotation.
const AVATAR_PALETTE = [
  'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  'bg-sky-500/10 text-sky-600 dark:text-sky-400',
] as const

function avatarClass(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

function isMarkdown(node: TreeNode): boolean {
  return node.kind === 'file' && node.name.toLowerCase().endsWith('.md')
}

// All markdown notes within a node (recurses into subfolders).
function collectNotes(node: TreeNode): TreeNode[] {
  if (node.kind === 'file') return isMarkdown(node) ? [node] : []
  const out: TreeNode[] = []
  for (const child of node.children ?? []) out.push(...collectNotes(child))
  return out
}

function recentNotes(node: TreeNode, limit: number): TreeNode[] {
  return collectNotes(node)
    .sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))
    .slice(0, limit)
}

function latestMtime(node: TreeNode): number {
  let max = node.stat?.mtimeMs ?? 0
  for (const child of node.children ?? []) max = Math.max(max, latestMtime(child))
  return max
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return null
}

function formatModified(mtimeMs?: number): string {
  if (!mtimeMs) return ''
  const rel = formatRelativeTime(new Date(mtimeMs).toISOString())
  if (!rel || rel === 'just now') return rel
  return `${rel} ago`
}

function getFileManagerName(): string {
  if (typeof navigator === 'undefined') return 'File Manager'
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'Finder'
  if (platform.includes('win')) return 'Explorer'
  return 'File Manager'
}

function displayName(node: TreeNode): string {
  if (isMarkdown(node)) return node.name.slice(0, -3)
  return node.name
}

export function KnowledgeView({
  tree,
  actions,
  folderPath,
  onNavigateFolder,
  onOpenNote,
  onOpenGraph,
  onOpenSearch,
  onOpenBases,
  onVoiceNoteCreated,
}: KnowledgeViewProps) {
  const [renameTarget, setRenameTarget] = useState<string | null>(null)

  const topLevel = useMemo(
    () => tree.filter((n) => !HIDDEN_PATHS.has(n.path)),
    [tree],
  )

  const folders = useMemo(
    () => sortNodes(topLevel.filter((n) => n.kind === 'dir')),
    [topLevel],
  )
  const looseNotes = useMemo(
    () => sortNodes(topLevel.filter((n) => isMarkdown(n))),
    [topLevel],
  )

  const totalNotes = useMemo(
    () => topLevel.reduce((sum, n) => sum + collectNotes(n).length, 0),
    [topLevel],
  )

  const openFolder = useCallback((path: string) => onNavigateFolder(path), [onNavigateFolder])

  // When the open folder no longer exists (deleted/renamed externally), fall
  // back to the root overview rather than holding a dangling drill-down.
  const currentFolder = folderPath ? findNode(tree, folderPath) : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 flex items-start justify-between gap-4 border-b border-border px-8 py-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Notes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalNotes} {totalNotes === 1 ? 'note' : 'notes'} across {folders.length}{' '}
            {folders.length === 1 ? 'folder' : 'folders'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <VoiceNoteButton onNoteCreated={onVoiceNoteCreated} />
          <SecondaryButton icon={SearchIcon} label="Search" onClick={onOpenSearch} />
          <SecondaryButton icon={Network} label="Graph" onClick={onOpenGraph} />
          <button
            type="button"
            onClick={() => actions.createNote(currentFolder?.path)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <FilePlus className="size-4" />
            <span>New note</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-6">
          {currentFolder ? (
            <FolderDetail
              folder={currentFolder}
              actions={actions}
              renameTarget={renameTarget}
              onRequestRename={setRenameTarget}
              onClearRename={() => setRenameTarget(null)}
              onNavigate={onNavigateFolder}
              onOpenFolder={openFolder}
              onOpenNote={onOpenNote}
            />
          ) : (
            <>
              <SectionHeader label={`Folders · ${folders.length}`} aside="Sorted by name" />
              {folders.length === 0 ? (
                <EmptyState text="No folders yet." />
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  {folders.map((node, i) => (
                    <div key={node.path} className={cn(i > 0 && 'border-t border-border/60')}>
                      <FolderCard
                        node={node}
                        actions={actions}
                        renameTarget={renameTarget}
                        onRequestRename={setRenameTarget}
                        onClearRename={() => setRenameTarget(null)}
                        onOpenFolder={openFolder}
                        onOpenNote={onOpenNote}
                      />
                    </div>
                  ))}
                </div>
              )}

              {looseNotes.length > 0 && (
                <div className="mt-8">
                  <SectionHeader label={`Loose notes · ${looseNotes.length}`} />
                  <div className="overflow-hidden rounded-xl border border-border">
                    {looseNotes.map((node, i) => (
                      <div key={node.path} className={cn(i > 0 && 'border-t border-border/60')}>
                        <ItemRow
                          node={node}
                          actions={actions}
                          renameTarget={renameTarget}
                          onRequestRename={setRenameTarget}
                          onClearRename={() => setRenameTarget(null)}
                          onOpenFolder={openFolder}
                          onOpenNote={onOpenNote}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <QuickActions
            actions={actions}
            currentFolder={currentFolder}
            onOpenBases={onOpenBases}
            onFolderCreated={setRenameTarget}
          />
        </div>
      </div>
    </div>
  )
}

function QuickActions({
  actions,
  currentFolder,
  onOpenBases,
  onFolderCreated,
}: {
  actions: KnowledgeViewActions
  currentFolder: TreeNode | null
  onOpenBases: () => void
  onFolderCreated: (path: string) => void
}) {
  // Inside a folder these target that folder; at the root they target knowledge/.
  const parent = currentFolder?.path
  return (
    <div className="mt-8">
      <SectionHeader label="Quick actions" />
      <div className="flex flex-wrap gap-2">
        <QuickAction icon={FilePlus} label="New note" onClick={() => actions.createNote(parent)} />
        <QuickAction
          icon={FolderPlus}
          label="New folder"
          onClick={async () => {
            try {
              const path = await actions.createFolder(parent)
              onFolderCreated(path)
            } catch { /* ignore */ }
          }}
        />
        <QuickAction icon={Table2} label="Open as base" onClick={onOpenBases} />
        <QuickAction
          icon={FolderOpen}
          label={`Reveal in ${getFileManagerName()}`}
          onClick={() => actions.revealInFileManager(parent ?? 'knowledge', true)}
        />
      </div>
    </div>
  )
}

function SecondaryButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof SearchIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </button>
  )
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FilePlus
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
    >
      <Icon className="size-4 text-muted-foreground" />
      <span>{label}</span>
    </button>
  )
}

function SectionHeader({ label, aside }: { label: string; aside?: string }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function FolderAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md text-[13px] font-bold',
        avatarClass(name),
        className,
      )}
    >
      {name.charAt(0).toUpperCase() || '?'}
    </div>
  )
}

function FolderCard({
  node,
  actions,
  renameTarget,
  onRequestRename,
  onClearRename,
  onOpenFolder,
  onOpenNote,
}: {
  node: TreeNode
  actions: KnowledgeViewActions
  renameTarget: string | null
  onRequestRename: (path: string) => void
  onClearRename: () => void
  onOpenFolder: (path: string) => void
  onOpenNote: (path: string) => void
}) {
  const count = useMemo(() => collectNotes(node).length, [node])
  const peek = useMemo(() => recentNotes(node, 3), [node])
  const modified = formatModified(latestMtime(node))
  const renameActive = renameTarget === node.path

  const card = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenFolder(node.path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenFolder(node.path)
        }
      }}
      className="group flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
    >
      <FolderAvatar name={node.name} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {renameActive ? (
          <RenameField
            initial={node.name}
            isDir
            path={node.path}
            actions={actions}
            onDone={onClearRename}
          />
        ) : (
          <span className="block truncate text-sm font-semibold text-foreground">
            {node.name}
          </span>
        )}
        <div className="mt-0.5 text-xs text-muted-foreground">
          {count} {count === 1 ? 'note' : 'notes'}
        </div>
        {peek.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {peek.map((n) => (
              <button
                key={n.path}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenNote(n.path)
                }}
                className="max-w-[200px] truncate rounded-full border border-border/60 bg-muted px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {displayName(n)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1">
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {modified}
        </span>
        <ChevronRight className="size-4 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  )

  return (
    <RowContextMenu node={node} actions={actions} onRequestRename={onRequestRename}>
      {card}
    </RowContextMenu>
  )
}

function FolderDetail({
  folder,
  actions,
  renameTarget,
  onRequestRename,
  onClearRename,
  onNavigate,
  onOpenFolder,
  onOpenNote,
}: {
  folder: TreeNode
  actions: KnowledgeViewActions
  renameTarget: string | null
  onRequestRename: (path: string) => void
  onClearRename: () => void
  onNavigate: (path: string | null) => void
  onOpenFolder: (path: string) => void
  onOpenNote: (path: string) => void
}) {
  const items = useMemo(() => sortNodes(folder.children ?? []), [folder])

  // Breadcrumb segments from "knowledge/A/B" → [{ name: 'A', path }, ...].
  const crumbs = useMemo(() => {
    const rel = folder.path.startsWith('knowledge/')
      ? folder.path.slice('knowledge/'.length)
      : folder.path
    const parts = rel.split('/').filter(Boolean)
    const out: { name: string; path: string }[] = []
    let acc = 'knowledge'
    for (const part of parts) {
      acc = `${acc}/${part}`
      out.push({ name: part, path: acc })
    }
    return out
  }, [folder.path])

  return (
    <>
      <div className="mb-4 flex min-w-0 items-center gap-1.5 text-sm">
        <button
          type="button"
          onClick={() => {
            const parent = crumbs.length >= 2 ? crumbs[crumbs.length - 2].path : null
            onNavigate(parent)
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onNavigate(null)}
          className="rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Notes
        </button>
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            {i === crumbs.length - 1 ? (
              <span className="truncate font-medium text-foreground">{c.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(c.path)}
                className="truncate rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {c.name}
              </button>
            )}
          </span>
        ))}
      </div>

      <SectionHeader label={`${items.length} ${items.length === 1 ? 'item' : 'items'}`} />
      {items.length === 0 ? (
        <EmptyState text="This folder is empty." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {items.map((node, i) => (
            <div key={node.path} className={cn(i > 0 && 'border-t border-border/60')}>
              <ItemRow
                node={node}
                actions={actions}
                renameTarget={renameTarget}
                onRequestRename={onRequestRename}
                onClearRename={onClearRename}
                onOpenFolder={onOpenFolder}
                onOpenNote={onOpenNote}
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function ItemRow({
  node,
  actions,
  renameTarget,
  onRequestRename,
  onClearRename,
  onOpenFolder,
  onOpenNote,
}: {
  node: TreeNode
  actions: KnowledgeViewActions
  renameTarget: string | null
  onRequestRename: (path: string) => void
  onClearRename: () => void
  onOpenFolder: (path: string) => void
  onOpenNote: (path: string) => void
}) {
  const isDir = node.kind === 'dir'
  const renameActive = renameTarget === node.path
  const modified = formatModified(isDir ? latestMtime(node) : node.stat?.mtimeMs)
  const count = useMemo(() => (isDir ? collectNotes(node).length : 0), [isDir, node])

  const handleOpen = useCallback(() => {
    if (isDir) onOpenFolder(node.path)
    else onOpenNote(node.path)
  }, [isDir, node.path, onOpenFolder, onOpenNote])

  const row = (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleOpen()
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
    >
      {isDir ? (
        <FolderAvatar name={node.name} />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FileText className="size-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {renameActive ? (
          <RenameField
            initial={displayName(node)}
            isDir={isDir}
            path={node.path}
            actions={actions}
            onDone={onClearRename}
          />
        ) : (
          <span className="block truncate text-sm text-foreground">{displayName(node)}</span>
        )}
        {isDir && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {count} {count === 1 ? 'note' : 'notes'}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {modified}
        </span>
        {isDir && (
          <ChevronRight className="size-4 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
    </div>
  )

  return (
    <RowContextMenu node={node} actions={actions} onRequestRename={onRequestRename}>
      {row}
    </RowContextMenu>
  )
}

function RenameField({
  initial,
  isDir,
  path,
  actions,
  onDone,
}: {
  initial: string
  isDir: boolean
  path: string
  actions: KnowledgeViewActions
  onDone: () => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isSubmittingRef = useRef(false)

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const submit = useCallback(async () => {
    if (isSubmittingRef.current) return
    isSubmittingRef.current = true
    const trimmed = value.trim()
    if (trimmed && trimmed !== initial) {
      try {
        await actions.rename(path, trimmed, isDir)
        toast('Renamed successfully', 'success')
      } catch {
        toast('Failed to rename', 'error')
      }
    }
    onDone()
  }, [actions, initial, isDir, onDone, path, value])

  const cancel = useCallback(() => {
    isSubmittingRef.current = true
    onDone()
  }, [onDone])

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          void submit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onBlur={() => {
        if (!isSubmittingRef.current) void submit()
      }}
      className="h-7 text-sm"
    />
  )
}

function RowContextMenu({
  node,
  actions,
  onRequestRename,
  children,
}: {
  node: TreeNode
  actions: KnowledgeViewActions
  onRequestRename: (path: string) => void
  children: React.ReactNode
}) {
  const isDir = node.kind === 'dir'

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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
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
