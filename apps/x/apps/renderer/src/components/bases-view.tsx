import * as React from 'react'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X, Check, ListFilter, Search, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { splitFrontmatter, extractAllFrontmatterValues } from '@/lib/frontmatter'
import { useDebounce } from '@/hooks/use-debounce'

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

export type BaseConfig = {
  name: string
  visibleColumns: string[]
  columnWidths: Record<string, number>
  sort: { field: string; dir: SortDir }
  filters: ActiveFilter[]
}

export const DEFAULT_BASE_CONFIG: BaseConfig = {
  name: 'All Notes',
  visibleColumns: ['name', 'folder', 'relationship', 'topic', 'status', 'mtimeMs'],
  columnWidths: {},
  sort: { field: 'mtimeMs', dir: 'desc' },
  filters: [],
}

const PAGE_SIZE = 25

/** Built-in columns that don't come from frontmatter */
const BUILTIN_COLUMNS = ['name', 'folder', 'mtimeMs'] as const
type BuiltinColumn = (typeof BUILTIN_COLUMNS)[number]

const BUILTIN_LABELS: Record<BuiltinColumn, string> = {
  name: 'Name',
  folder: 'Folder',
  mtimeMs: 'Last Modified',
}

/** Default pixel widths for columns */
const DEFAULT_WIDTHS: Record<string, number> = {
  name: 200,
  folder: 140,
  mtimeMs: 140,
}
const DEFAULT_FRONTMATTER_WIDTH = 150

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
  config: BaseConfig
  onConfigChange: (config: BaseConfig) => void
  isDefaultBase: boolean
  onSave: (name: string | null) => void
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

export function BasesView({ tree, onSelectNote, config, onConfigChange, isDefaultBase, onSave }: BasesViewProps) {
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

  const visibleColumns = config.visibleColumns
  const columnWidths = config.columnWidths
  const filters = config.filters
  const sortField = config.sort.field
  const sortDir = config.sort.dir
  const [page, setPage] = useState(0)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const saveInputRef = useRef<HTMLInputElement>(null)

  const handleSaveClick = useCallback(() => {
    if (isDefaultBase) {
      setSaveName('')
      setSaveDialogOpen(true)
    } else {
      onSave(null)
    }
  }, [isDefaultBase, onSave])

  const handleSaveConfirm = useCallback(() => {
    const name = saveName.trim()
    if (!name) return
    setSaveDialogOpen(false)
    onSave(name)
  }, [saveName, onSave])

  const getColWidth = useCallback((col: string) => {
    return columnWidths[col] ?? DEFAULT_WIDTHS[col] ?? DEFAULT_FRONTMATTER_WIDTH
  }, [columnWidths])

  // Column resize via drag
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null)

  const configRef = useRef(config)
  configRef.current = config

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = configRef.current.columnWidths[col] ?? DEFAULT_WIDTHS[col] ?? DEFAULT_FRONTMATTER_WIDTH
    resizingRef.current = { col, startX, startW }

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = ev.clientX - resizingRef.current.startX
      const newW = Math.max(60, resizingRef.current.startW + delta)
      const c = configRef.current
      const updated = { ...c, columnWidths: { ...c.columnWidths, [resizingRef.current!.col]: newW } }
      onConfigChange(updated)
    }

    const onMouseUp = () => {
      resizingRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [onConfigChange])

  // Search
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 250)
  const [searchMatchPaths, setSearchMatchPaths] = useState<Set<string> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setSearchMatchPaths(null)
      return
    }
    let cancelled = false
    window.ipc.invoke('search:query', { query: debouncedSearch, limit: 200, types: ['knowledge'] })
      .then((res: { results: { path: string }[] }) => {
        if (!cancelled) {
          setSearchMatchPaths(new Set(res.results.map((r) => r.path)))
        }
      })
      .catch(() => {
        if (!cancelled) setSearchMatchPaths(new Set())
      })
    return () => { cancelled = true }
  }, [debouncedSearch])

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        setSearchQuery('')
        setSearchMatchPaths(null)
      }
      return !prev
    })
  }, [])

  // Focus input when search opens
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // Reset page when filters or search change
  useEffect(() => { setPage(0) }, [filters, searchMatchPaths])

  // Filter (search + badge filters)
  const filteredNotes = useMemo(() => {
    let result = enrichedNotes
    // Apply search filter
    if (searchMatchPaths) {
      result = result.filter((note) => searchMatchPaths.has(note.path))
    }
    // Apply badge filters
    if (filters.length > 0) {
      const byCategory = new Map<string, string[]>()
      for (const f of filters) {
        const vals = byCategory.get(f.category) ?? []
        vals.push(f.value)
        byCategory.set(f.category, vals)
      }
      result = result.filter((note) => {
        for (const [category, requiredValues] of byCategory) {
          const noteValues = getColumnValues(note, category)
          if (!requiredValues.some((v) => noteValues.includes(v))) return false
        }
        return true
      })
    }
    return result
  }, [enrichedNotes, filters, searchMatchPaths])

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
    const c = configRef.current
    const f: ActiveFilter = { category, value }
    const next = hasFilter(c.filters, f)
      ? c.filters.filter((x) => !filtersEqual(x, f))
      : [...c.filters, f]
    onConfigChange({ ...c, filters: next })
  }, [onConfigChange])

  const clearFilters = useCallback(() => {
    onConfigChange({ ...configRef.current, filters: [] })
  }, [onConfigChange])

  const handleSort = useCallback((field: string) => {
    const c = configRef.current
    if (field === c.sort.field) {
      onConfigChange({ ...c, sort: { field, dir: c.sort.dir === 'asc' ? 'desc' : 'asc' } })
    } else {
      onConfigChange({ ...c, sort: { field, dir: field === 'mtimeMs' ? 'desc' : 'asc' } })
    }
  }, [onConfigChange])

  const toggleColumn = useCallback((key: string) => {
    const c = configRef.current
    const next = c.visibleColumns.includes(key)
      ? c.visibleColumns.filter((col) => col !== key)
      : [...c.visibleColumns, key]
    onConfigChange({ ...c, visibleColumns: next })
  }, [onConfigChange])

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ArrowUp className="size-3 inline ml-1" />
      : <ArrowDown className="size-3 inline ml-1" />
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-border px-4 py-2 flex items-center gap-3">
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

        <button
          onClick={toggleSearch}
          className={cn(
            'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground',
            searchOpen && 'text-foreground',
          )}
        >
          <Search className="size-3.5" />
          Search
        </button>

        <div className="flex-1" />

        <button
          onClick={handleSaveClick}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Save className="size-3.5" />
          {isDefaultBase ? 'Save As' : 'Save'}
        </button>

        {searchOpen && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
            {searchQuery && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {searchMatchPaths ? `${searchMatchPaths.size} matches` : '...'}
              </span>
            )}
            <button
              onClick={toggleSearch}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
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
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {visibleColumns.map((col) => (
              <col key={col} style={{ width: getColWidth(col) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 bg-background border-b border-border z-10">
            <tr>
              {visibleColumns.map((col) => (
                <th
                  key={col}
                  className="relative text-left px-4 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none group"
                  onClick={() => handleSort(col)}
                >
                  <span className="truncate block">{toTitleCase(col)}<SortIcon field={col} /></span>
                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 hover:!opacity-100 bg-border/60"
                    onMouseDown={(e) => onResizeStart(col, e)}
                    onClick={(e) => e.stopPropagation()}
                  />
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
                  <td key={col} className="px-4 py-2 overflow-hidden">
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

      {/* Save As dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Save Base</DialogTitle>
            <DialogDescription>Choose a name for this base view.</DialogDescription>
          </DialogHeader>
          <input
            ref={saveInputRef}
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveConfirm() }}
            placeholder="e.g. Contacts, Projects..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <DialogFooter>
            <button
              onClick={() => setSaveDialogOpen(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveConfirm}
              disabled={!saveName.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    return <span className="font-medium truncate block">{note.name}</span>
  }
  if (column === 'folder') {
    return <span className="text-muted-foreground truncate block">{note.folder}</span>
  }
  if (column === 'mtimeMs') {
    return <span className="text-muted-foreground whitespace-nowrap truncate block">{formatDate(note.mtimeMs)}</span>
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
