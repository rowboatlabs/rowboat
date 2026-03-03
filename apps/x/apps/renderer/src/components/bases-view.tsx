import * as React from 'react'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { splitFrontmatter, extractTags } from '@/lib/frontmatter'

interface TreeNode {
  path: string
  name: string
  kind: 'file' | 'dir'
  children?: TreeNode[]
  stat?: { size: number; mtimeMs: number }
}

type NoteEntry = {
  path: string
  name: string
  folder: string
  tags: string[]
  mtimeMs: number
}

type SortField = 'name' | 'folder' | 'mtimeMs'
type SortDir = 'asc' | 'desc'

type BasesViewProps = {
  tree: TreeNode[]
  onSelectNote: (path: string) => void
}

function collectFilePaths(nodes: TreeNode[]): { path: string; name: string; mtimeMs: number }[] {
  return nodes.flatMap((n) =>
    n.kind === 'file' && n.name.endsWith('.md')
      ? [{ path: n.path, name: n.name.replace(/\.md$/i, ''), mtimeMs: n.stat?.mtimeMs ?? 0 }]
      : n.children
        ? collectFilePaths(n.children)
        : [],
  )
}

/** Build a stable fingerprint from the tree's file paths + mtimes so we only reload when files actually change. */
function treeFingerprint(nodes: TreeNode[]): string {
  const files = collectFilePaths(nodes)
  return files.map((f) => `${f.path}:${f.mtimeMs}`).join('\n')
}

function getFolder(path: string): string {
  const parts = path.split('/')
  if (parts.length >= 3) return parts[1]
  return ''
}

function formatDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function BasesView({ tree, onSelectNote }: BasesViewProps) {
  const [notes, setNotes] = useState<NoteEntry[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<SortField>('mtimeMs')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const lastFingerprintRef = useRef<string>('')

  // Stable fingerprint — only changes when actual file paths/mtimes differ
  const fingerprint = useMemo(() => treeFingerprint(tree), [tree])

  // Load notes data when fingerprint changes
  useEffect(() => {
    if (fingerprint === lastFingerprintRef.current) return
    lastFingerprintRef.current = fingerprint

    let cancelled = false
    const files = collectFilePaths(tree)

    async function loadNotes() {
      const entries: NoteEntry[] = []

      for (const file of files) {
        try {
          const result = await window.ipc.invoke('workspace:readFile', {
            path: file.path,
            encoding: 'utf8',
          })
          const { raw } = splitFrontmatter(result.data)
          const tags = extractTags(raw)
          entries.push({
            path: file.path,
            name: file.name,
            folder: getFolder(file.path),
            tags,
            mtimeMs: file.mtimeMs,
          })
        } catch {
          entries.push({
            path: file.path,
            name: file.name,
            folder: getFolder(file.path),
            tags: [],
            mtimeMs: file.mtimeMs,
          })
        }
      }

      if (!cancelled) {
        setNotes(entries)
        setInitialLoading(false)
      }
    }

    loadNotes()
    return () => { cancelled = true }
  }, [fingerprint, tree])

  // Collect all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const note of notes) {
      for (const tag of note.tags) {
        tagSet.add(tag)
      }
    }
    return [...tagSet].sort((a, b) => a.localeCompare(b))
  }, [notes])

  // Filter and sort
  const filteredNotes = useMemo(() => {
    let result = notes
    if (selectedTags.size > 0) {
      const tagsArray = [...selectedTags]
      result = result.filter((note) =>
        tagsArray.every((tag) => note.tags.includes(tag)),
      )
    }
    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortField === 'folder') {
        cmp = a.folder.localeCompare(b.folder)
      } else {
        cmp = a.mtimeMs - b.mtimeMs
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [notes, selectedTags, sortField, sortDir])

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) {
        next.delete(tag)
      } else {
        next.add(tag)
      }
      return next
    })
  }, [])

  const clearFilters = useCallback(() => {
    setSelectedTags(new Set())
  }, [])

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir(field === 'mtimeMs' ? 'desc' : 'asc')
      return field
    })
  }, [])

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDir === 'asc' ? (
      <ArrowUp className="size-3 inline ml-1" />
    ) : (
      <ArrowDown className="size-3 inline ml-1" />
    )
  }

  if (initialLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="space-y-3 w-full max-w-2xl px-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-muted/50 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">
            Showing {filteredNotes.length} of {notes.length} notes
          </span>
          {selectedTags.size > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
            >
              <X className="size-3" />
              Clear filters
            </button>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  selectedTags.has(tag)
                    ? 'bg-primary text-primary-foreground border-transparent'
                    : 'bg-transparent text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b border-border">
            <tr>
              <th
                className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                onClick={() => handleSort('name')}
              >
                Name
                <SortIcon field="name" />
              </th>
              <th
                className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                onClick={() => handleSort('folder')}
              >
                Folder
                <SortIcon field="folder" />
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground select-none">
                Tags
              </th>
              <th
                className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                onClick={() => handleSort('mtimeMs')}
              >
                Last Modified
                <SortIcon field="mtimeMs" />
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredNotes.map((note) => (
              <tr
                key={note.path}
                className="border-b border-border/50 hover:bg-accent/50 cursor-pointer transition-colors"
                onClick={() => onSelectNote(note.path)}
              >
                <td className="px-4 py-2 font-medium">{note.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{note.folder}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {note.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-primary hover:text-primary-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleTag(tag)
                        }}
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                  {formatDate(note.mtimeMs)}
                </td>
              </tr>
            ))}
            {filteredNotes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No notes found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
