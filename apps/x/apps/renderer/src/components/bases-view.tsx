import * as React from 'react'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { splitFrontmatter, extractFrontmatterFields, type FrontmatterFields } from '@/lib/frontmatter'

interface TreeNode {
  path: string
  name: string
  kind: 'file' | 'dir'
  children?: TreeNode[]
  stat?: { size: number; mtimeMs: number }
}

const EMPTY_FIELDS: FrontmatterFields = {
  relationship: null, relationship_sub: [], topic: [], email_type: [], action: [], status: null, source: [],
}

type NoteEntry = {
  path: string
  name: string
  folder: string
  fields: FrontmatterFields
  mtimeMs: number
}

type SortField = 'name' | 'folder' | 'relationship' | 'status' | 'mtimeMs'
type SortDir = 'asc' | 'desc'

type FilterCategory = 'relationship' | 'topic' | 'status'
type ActiveFilter = { category: FilterCategory; value: string }

const PAGE_SIZE = 25

type BasesViewProps = {
  tree: TreeNode[]
  onSelectNote: (path: string) => void
}

function collectFiles(nodes: TreeNode[]): { path: string; name: string; mtimeMs: number }[] {
  return nodes.flatMap((n) =>
    n.kind === 'file' && n.name.endsWith('.md')
      ? [{ path: n.path, name: n.name.replace(/\.md$/i, ''), mtimeMs: n.stat?.mtimeMs ?? 0 }]
      : n.children
        ? collectFiles(n.children)
        : [],
  )
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

function filtersEqual(a: ActiveFilter, b: ActiveFilter): boolean {
  return a.category === b.category && a.value === b.value
}

function hasFilter(filters: ActiveFilter[], f: ActiveFilter): boolean {
  return filters.some((x) => filtersEqual(x, f))
}

function getCategoryValues(fields: FrontmatterFields, category: FilterCategory): string[] {
  if (category === 'relationship') return fields.relationship ? [fields.relationship] : []
  if (category === 'topic') return fields.topic
  if (category === 'status') return fields.status ? [fields.status] : []
  return []
}

export function BasesView({ tree, onSelectNote }: BasesViewProps) {
  // Build notes instantly from tree — no file reads needed for the table shell
  const notes = useMemo<NoteEntry[]>(() => {
    return collectFiles(tree).map((f) => ({
      path: f.path,
      name: f.name,
      folder: getFolder(f.path),
      fields: EMPTY_FIELDS,
      mtimeMs: f.mtimeMs,
    }))
  }, [tree])

  // Frontmatter fields loaded async, keyed by path
  const [fieldsByPath, setFieldsByPath] = useState<Map<string, FrontmatterFields>>(new Map())
  const loadGenRef = useRef(0)

  // Load frontmatter in background batches
  useEffect(() => {
    const gen = ++loadGenRef.current
    let cancelled = false
    const paths = notes.map((n) => n.path)

    async function load() {
      const BATCH = 30
      for (let i = 0; i < paths.length; i += BATCH) {
        if (cancelled) return
        const batch = paths.slice(i, i + BATCH)
        const results = await Promise.all(
          batch.map(async (p) => {
            try {
              const result = await window.ipc.invoke('workspace:readFile', { path: p, encoding: 'utf8' })
              const { raw } = splitFrontmatter(result.data)
              return { path: p, fields: extractFrontmatterFields(raw) }
            } catch {
              return { path: p, fields: EMPTY_FIELDS }
            }
          }),
        )
        if (cancelled || gen !== loadGenRef.current) return
        setFieldsByPath((prev) => {
          const next = new Map(prev)
          for (const r of results) next.set(r.path, r.fields)
          return next
        })
      }
    }

    load()
    return () => { cancelled = true }
  }, [notes])

  // Merge tree-derived notes with async-loaded fields
  const enrichedNotes = useMemo<NoteEntry[]>(() => {
    if (fieldsByPath.size === 0) return notes
    return notes.map((n) => {
      const f = fieldsByPath.get(n.path)
      return f ? { ...n, fields: f } : n
    })
  }, [notes, fieldsByPath])

  const [filters, setFilters] = useState<ActiveFilter[]>([])
  const [sortField, setSortField] = useState<SortField>('mtimeMs')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [filters])

  // Filter
  const filteredNotes = useMemo(() => {
    if (filters.length === 0) return enrichedNotes
    const byCategory = new Map<FilterCategory, string[]>()
    for (const f of filters) {
      const vals = byCategory.get(f.category) ?? []
      vals.push(f.value)
      byCategory.set(f.category, vals)
    }
    return enrichedNotes.filter((note) => {
      for (const [category, requiredValues] of byCategory) {
        const noteValues = getCategoryValues(note.fields, category)
        if (!requiredValues.some((v) => noteValues.includes(v))) return false
      }
      return true
    })
  }, [enrichedNotes, filters])

  // Sort
  const sortedNotes = useMemo(() => {
    return [...filteredNotes].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortField === 'folder') cmp = a.folder.localeCompare(b.folder)
      else if (sortField === 'relationship') cmp = (a.fields.relationship ?? '').localeCompare(b.fields.relationship ?? '')
      else if (sortField === 'status') cmp = (a.fields.status ?? '').localeCompare(b.fields.status ?? '')
      else cmp = a.mtimeMs - b.mtimeMs
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredNotes, sortField, sortDir])

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sortedNotes.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageNotes = useMemo(
    () => sortedNotes.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE),
    [sortedNotes, clampedPage],
  )

  const toggleFilter = useCallback((category: FilterCategory, value: string) => {
    setFilters((prev) => {
      const f: ActiveFilter = { category, value }
      if (hasFilter(prev, f)) return prev.filter((x) => !filtersEqual(x, f))
      return [...prev, f]
    })
  }, [])

  const clearFilters = useCallback(() => { setFilters([]) }, [])

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
    return sortDir === 'asc'
      ? <ArrowUp className="size-3 inline ml-1" />
      : <ArrowDown className="size-3 inline ml-1" />
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter bar */}
      {filters.length > 0 && (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">
              {sortedNotes.length} of {enrichedNotes.length} notes
            </span>
            {filters.map((f) => (
              <button
                key={`${f.category}:${f.value}`}
                onClick={() => toggleFilter(f.category, f.value)}
                className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[11px] font-medium"
              >
                <span className="text-primary-foreground/60">{f.category}:</span>
                {f.value}
                <X className="size-3" />
              </button>
            ))}
            <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground">
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b border-border z-10">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => handleSort('name')}>
                Name<SortIcon field="name" />
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => handleSort('folder')}>
                Folder<SortIcon field="folder" />
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => handleSort('relationship')}>
                Relationship<SortIcon field="relationship" />
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground select-none">
                Topic
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => handleSort('status')}>
                Status<SortIcon field="status" />
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => handleSort('mtimeMs')}>
                Last Modified<SortIcon field="mtimeMs" />
              </th>
            </tr>
          </thead>
          <tbody>
            {pageNotes.map((note) => (
              <tr
                key={note.path}
                className="border-b border-border/50 hover:bg-accent/50 cursor-pointer transition-colors"
                onClick={() => onSelectNote(note.path)}
              >
                <td className="px-4 py-2 font-medium">{note.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{note.folder}</td>
                <td className="px-4 py-2">
                  {note.fields.relationship && (
                    <CategoryBadge category="relationship" value={note.fields.relationship} active={hasFilter(filters, { category: 'relationship', value: note.fields.relationship })} onClick={toggleFilter} />
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {note.fields.topic.map((t) => (
                      <CategoryBadge key={t} category="topic" value={t} active={hasFilter(filters, { category: 'topic', value: t })} onClick={toggleFilter} />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2">
                  {note.fields.status && (
                    <CategoryBadge category="status" value={note.fields.status} active={hasFilter(filters, { category: 'status', value: note.fields.status })} onClick={toggleFilter} />
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                  {formatDate(note.mtimeMs)}
                </td>
              </tr>
            ))}
            {pageNotes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No notes found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 border-t border-border px-4 py-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {sortedNotes.length === 0
            ? '0 notes'
            : `${clampedPage * PAGE_SIZE + 1}–${Math.min((clampedPage + 1) * PAGE_SIZE, sortedNotes.length)} of ${sortedNotes.length}`}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              disabled={clampedPage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-xs text-muted-foreground px-2">
              Page {clampedPage + 1} of {totalPages}
            </span>
            <button
              disabled={clampedPage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryBadge({
  category,
  value,
  active,
  onClick,
}: {
  category: FilterCategory
  value: string
  active: boolean
  onClick: (category: FilterCategory, value: string) => void
}) {
  return (
    <Badge
      variant={active ? 'default' : 'secondary'}
      className={cn(
        'text-[10px] px-1.5 py-0 cursor-pointer',
        !active && 'hover:bg-primary hover:text-primary-foreground',
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick(category, value)
      }}
    >
      {value}
    </Badge>
  )
}
