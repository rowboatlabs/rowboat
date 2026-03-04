import * as React from 'react'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X, Check, ListFilter } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { splitFrontmatter, extractAllFrontmatterValues } from '@/lib/frontmatter'

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
  fields: Record<string, string | string[]>
  mtimeMs: number
}

type SortDir = 'asc' | 'desc'
type ActiveFilter = { category: string; value: string }

const PAGE_SIZE = 25

/** Built-in columns that don't come from frontmatter */
const BUILTIN_COLUMNS = ['name', 'folder', 'mtimeMs'] as const
type BuiltinColumn = (typeof BUILTIN_COLUMNS)[number]

const BUILTIN_LABELS: Record<BuiltinColumn, string> = {
  name: 'Name',
  folder: 'Folder',
  mtimeMs: 'Last Modified',
}

const DEFAULT_COLUMNS: string[] = ['name', 'folder', 'relationship', 'topic', 'status', 'mtimeMs']

/** Convert key to title case: `first_met` → `First Met` */
function toTitleCase(key: string): string {
  if (key in BUILTIN_LABELS) return BUILTIN_LABELS[key as BuiltinColumn]
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

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

/** Get the string values for a column from a note */
function getColumnValues(note: NoteEntry, column: string): string[] {
  if (column === 'name') return [note.name]
  if (column === 'folder') return [note.folder]
  if (column === 'mtimeMs') return []
  const v = note.fields[column]
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

/** Get a single sortable string for a column */
function getSortValue(note: NoteEntry, column: string): string | number {
  if (column === 'name') return note.name
  if (column === 'folder') return note.folder
  if (column === 'mtimeMs') return note.mtimeMs
  const v = note.fields[column]
  if (!v) return ''
  return Array.isArray(v) ? v[0] ?? '' : v
}

const isBuiltin = (col: string): col is BuiltinColumn =>
  (BUILTIN_COLUMNS as readonly string[]).includes(col)

export function BasesView({ tree, onSelectNote }: BasesViewProps) {
  // Build notes instantly from tree
  const notes = useMemo<NoteEntry[]>(() => {
    return collectFiles(tree).map((f) => ({
      path: f.path,
      name: f.name,
      folder: getFolder(f.path),
      fields: {},
      mtimeMs: f.mtimeMs,
    }))
  }, [tree])

  // Frontmatter fields loaded async, keyed by path
  const [fieldsByPath, setFieldsByPath] = useState<Map<string, Record<string, string | string[]>>>(new Map())
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
              return { path: p, fields: extractAllFrontmatterValues(raw) }
            } catch {
              return { path: p, fields: {} as Record<string, string | string[]> }
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

  // Collect all unique frontmatter property keys across all notes
  const allPropertyKeys = useMemo<string[]>(() => {
    const keys = new Set<string>()
    for (const fields of fieldsByPath.values()) {
      for (const k of Object.keys(fields)) keys.add(k)
    }
    return Array.from(keys).sort()
  }, [fieldsByPath])

  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS)
  const [filters, setFilters] = useState<ActiveFilter[]>([])
  const [sortField, setSortField] = useState<string>('mtimeMs')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [filters])

  // Filter
  const filteredNotes = useMemo(() => {
    if (filters.length === 0) return enrichedNotes
    const byCategory = new Map<string, string[]>()
    for (const f of filters) {
      const vals = byCategory.get(f.category) ?? []
      vals.push(f.value)
      byCategory.set(f.category, vals)
    }
    return enrichedNotes.filter((note) => {
      for (const [category, requiredValues] of byCategory) {
        const noteValues = getColumnValues(note, category)
        if (!requiredValues.some((v) => noteValues.includes(v))) return false
      }
      return true
    })
  }, [enrichedNotes, filters])

  // Sort
  const sortedNotes = useMemo(() => {
    return [...filteredNotes].sort((a, b) => {
      const va = getSortValue(a, sortField)
      const vb = getSortValue(b, sortField)
      let cmp: number
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb
      } else {
        cmp = String(va).localeCompare(String(vb))
      }
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

  const toggleFilter = useCallback((category: string, value: string) => {
    setFilters((prev) => {
      const f: ActiveFilter = { category, value }
      if (hasFilter(prev, f)) return prev.filter((x) => !filtersEqual(x, f))
      return [...prev, f]
    })
  }, [])

  const clearFilters = useCallback(() => { setFilters([]) }, [])

  const handleSort = useCallback((field: string) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir(field === 'mtimeMs' ? 'desc' : 'asc')
      return field
    })
  }, [])

  const toggleColumn = useCallback((key: string) => {
    setVisibleColumns((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key],
    )
  }, [])

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ArrowUp className="size-3 inline ml-1" />
      : <ArrowDown className="size-3 inline ml-1" />
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-border px-4 py-2">
        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ListFilter className="size-3.5" />
              Properties
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-0">
            <Command>
              <CommandInput placeholder="Search properties..." />
              <CommandList>
                <CommandEmpty>No properties found.</CommandEmpty>
                <CommandGroup heading="Built-in">
                  {BUILTIN_COLUMNS.map((col) => (
                    <CommandItem key={col} onSelect={() => toggleColumn(col)}>
                      <Check className={cn('size-3.5 mr-2', visibleColumns.includes(col) ? 'opacity-100' : 'opacity-0')} />
                      {BUILTIN_LABELS[col]}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandGroup heading="Frontmatter">
                  {allPropertyKeys.map((key) => (
                    <CommandItem key={key} onSelect={() => toggleColumn(key)}>
                      <Check className={cn('size-3.5 mr-2', visibleColumns.includes(key) ? 'opacity-100' : 'opacity-0')} />
                      {toTitleCase(key)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

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
              {visibleColumns.map((col) => (
                <th
                  key={col}
                  className="text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                  onClick={() => handleSort(col)}
                >
                  {toTitleCase(col)}<SortIcon field={col} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageNotes.map((note) => (
              <tr
                key={note.path}
                className="border-b border-border/50 hover:bg-accent/50 cursor-pointer transition-colors"
                onClick={() => onSelectNote(note.path)}
              >
                {visibleColumns.map((col) => (
                  <td key={col} className="px-4 py-2">
                    <CellRenderer
                      note={note}
                      column={col}
                      filters={filters}
                      toggleFilter={toggleFilter}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {pageNotes.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-8 text-center text-muted-foreground">
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
            : `${clampedPage * PAGE_SIZE + 1}\u2013${Math.min((clampedPage + 1) * PAGE_SIZE, sortedNotes.length)} of ${sortedNotes.length}`}
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

/** Renders a single table cell based on the column type */
function CellRenderer({
  note,
  column,
  filters,
  toggleFilter,
}: {
  note: NoteEntry
  column: string
  filters: ActiveFilter[]
  toggleFilter: (category: string, value: string) => void
}) {
  if (column === 'name') {
    return <span className="font-medium">{note.name}</span>
  }
  if (column === 'folder') {
    return <span className="text-muted-foreground">{note.folder}</span>
  }
  if (column === 'mtimeMs') {
    return <span className="text-muted-foreground whitespace-nowrap">{formatDate(note.mtimeMs)}</span>
  }

  // Frontmatter column
  const value = note.fields[column]
  if (!value) return null

  if (Array.isArray(value)) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {value.map((v) => (
          <CategoryBadge
            key={v}
            category={column}
            value={v}
            active={hasFilter(filters, { category: column, value: v })}
            onClick={toggleFilter}
          />
        ))}
      </div>
    )
  }

  // Single string value — render as badge for filterability
  return (
    <CategoryBadge
      category={column}
      value={value}
      active={hasFilter(filters, { category: column, value })}
      onClick={toggleFilter}
    />
  )
}

function CategoryBadge({
  category,
  value,
  active,
  onClick,
}: {
  category: string
  value: string
  active: boolean
  onClick: (category: string, value: string) => void
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
