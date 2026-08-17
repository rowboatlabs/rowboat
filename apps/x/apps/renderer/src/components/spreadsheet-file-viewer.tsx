import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'

interface SpreadsheetFileViewerProps {
  path: string
}

type SpreadsheetLoadResult = {
  format: 'xlsx' | 'xls' | 'csv' | 'tsv'
  sheets: Array<{ name: string; rowCount: number; columnCount: number }>
  activeSheet: string
  rows: Array<Array<string | number | boolean | null>>
  display: Array<Array<string | null>>
  firstRow: Array<string | number | boolean | null> | null
  firstRowDisplay: Array<string | null> | null
  offset: number
  totalRows: number
  totalColumns: number
  etag: string
}

type CellAddr = { row: number; col: number }
type Selection = { anchor: CellAddr; focus: CellAddr }

const PAGE_SIZE = 500
const MAX_COLUMNS = 100

// Per-file view state so navigating away and back restores position.
const viewStateByPath = new Map<string, { sheet: string | null; page: number; pinHeader: boolean }>()
const VIEW_STATE_CAP = 50

function rememberViewState(path: string, state: { sheet: string | null; page: number; pinHeader: boolean }) {
  viewStateByPath.delete(path)
  viewStateByPath.set(path, state)
  if (viewStateByPath.size > VIEW_STATE_CAP) {
    const oldest = viewStateByPath.keys().next().value
    if (oldest !== undefined) viewStateByPath.delete(oldest)
  }
}

function columnLetter(index: number): string {
  let label = ''
  let i = index
  while (i >= 0) {
    label = String.fromCharCode(65 + (i % 26)) + label
    i = Math.floor(i / 26) - 1
  }
  return label
}

function formatCell(value: string | number | boolean | null): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

export function SpreadsheetFileViewer({ path }: SpreadsheetFileViewerProps) {
  const [data, setData] = useState<SpreadsheetLoadResult | null>(null)
  const [activeSheet, setActiveSheet] = useState<string | null>(() => viewStateByPath.get(path)?.sheet ?? null)
  const [page, setPage] = useState(() => viewStateByPath.get(path)?.page ?? 0)
  const [pinHeader, setPinHeader] = useState(() => viewStateByPath.get(path)?.pinHeader ?? true)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [copied, setCopied] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findResult, setFindResult] = useState<{ sheet: string; matches: CellAddr[]; total: number } | null>(null)
  const [findIndex, setFindIndex] = useState(0)
  const [gotoValue, setGotoValue] = useState('')
  const requestIdRef = useRef(0)
  const prevPathRef = useRef(path)
  const activeCellRef = useRef<HTMLTableCellElement | null>(null)
  const scrollPendingRef = useRef(false)
  const findInputRef = useRef<HTMLInputElement | null>(null)

  // Body rows exclude the pinned first row, which rides along separately.
  const headerRows = pinHeader ? 1 : 0

  // New file: start over from its remembered position (or the first sheet).
  useEffect(() => {
    if (prevPathRef.current === path) return
    prevPathRef.current = path
    const saved = viewStateByPath.get(path)
    setData(null)
    setActiveSheet(saved?.sheet ?? null)
    setPage(saved?.page ?? 0)
    setPinHeader(saved?.pinHeader ?? true)
    setSelection(null)
    setFindOpen(false)
    setFindQuery('')
    setFindResult(null)
    setError(null)
  }, [path])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const result = await window.ipc.invoke('spreadsheet:load', {
          path,
          sheet: activeSheet ?? undefined,
          offset: headerRows + page * PAGE_SIZE,
          limit: PAGE_SIZE,
        })
        if (cancelled || requestId !== requestIdRef.current) return
        setData(result)
        setError(null)
        // The file shrank below the current page (e.g. rows deleted): snap to
        // the last page that still exists.
        const lastPage = Math.max(0, Math.ceil(Math.max(0, result.totalRows - headerRows) / PAGE_SIZE) - 1)
        if (page > lastPage) setPage(lastPage)
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) return
        if (activeSheet !== null) {
          // The selected sheet may have been removed or renamed; fall back to
          // the first sheet before surfacing an error.
          setActiveSheet(null)
          setPage(0)
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load spreadsheet')
        }
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, activeSheet, page, headerRows, version])

  // Remember where the user is so reopening this file restores the position.
  useEffect(() => {
    if (!data) return
    rememberViewState(path, { sheet: data.activeSheet, page, pinHeader })
  }, [path, data, page, pinHeader])

  const refetch = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      switch (event.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (event.path === path) refetch()
          break
        case 'moved':
          if (event.from === path || event.to === path) refetch()
          break
        case 'bulkChanged':
          if (!event.paths || event.paths.includes(path)) refetch()
          break
      }
    })
    return cleanup
  }, [path, refetch])

  // The workspace watcher only covers allowlisted roots, so assistant edits
  // additionally announce themselves via this window event (see App.tsx).
  useEffect(() => {
    const onTouched = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail
      if (detail?.path === path) refetch()
    }
    window.addEventListener('rowboat:spreadsheet-touched', onTouched)
    return () => window.removeEventListener('rowboat:spreadsheet-touched', onTouched)
  }, [path, refetch])

  const jumpToCell = useCallback((addr: CellAddr) => {
    setSelection({ anchor: addr, focus: addr })
    scrollPendingRef.current = true
    if (pinHeader && addr.row === 0) return
    setPage(pinHeader ? Math.floor((addr.row - 1) / PAGE_SIZE) : Math.floor(addr.row / PAGE_SIZE))
  }, [pinHeader])
  const jumpToCellRef = useRef(jumpToCell)
  useEffect(() => {
    jumpToCellRef.current = jumpToCell
  }, [jumpToCell])

  // Find runs against the whole sheet in the main process; matches carry
  // absolute cell coordinates.
  useEffect(() => {
    if (!findOpen || !data) return
    const query = findQuery.trim()
    if (!query) {
      setFindResult(null)
      return
    }
    const sheet = data.activeSheet
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await window.ipc.invoke('spreadsheet:find', { path, sheet, query })
          if (cancelled) return
          setFindResult({ sheet: res.activeSheet, matches: res.matches, total: res.total })
          setFindIndex(0)
          if (res.matches.length > 0) jumpToCellRef.current(res.matches[0])
        } catch {
          if (!cancelled) setFindResult(null)
        }
      })()
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, findQuery, data?.activeSheet, data?.etag, path])

  const gotoFindIndex = useCallback((next: number) => {
    if (!findResult || findResult.matches.length === 0) return
    const n = findResult.matches.length
    const idx = ((next % n) + n) % n
    setFindIndex(idx)
    jumpToCell(findResult.matches[idx])
  }, [findResult, jumpToCell])

  const matchSet = useMemo(() => {
    if (!findResult || !data || findResult.sheet !== data.activeSheet) return null
    const set = new Set<string>()
    for (const m of findResult.matches) set.add(`${m.row}:${m.col}`)
    return set
  }, [findResult, data])

  const currentMatch = findResult && findResult.sheet === data?.activeSheet
    ? findResult.matches[findIndex] ?? null
    : null

  // Display text for an absolute sheet row, or null when it isn't loaded.
  const displayRowAt = useCallback((row: number): Array<string | null> | null => {
    if (!data) return null
    if (row === 0 && data.firstRowDisplay) return data.firstRowDisplay
    if (row >= data.offset && row < data.offset + data.display.length) return data.display[row - data.offset]
    return null
  }, [data])

  const copySelection = useCallback(async () => {
    if (!selection || !data) return
    const r0 = Math.min(selection.anchor.row, selection.focus.row)
    const r1 = Math.max(selection.anchor.row, selection.focus.row)
    const c0 = Math.min(selection.anchor.col, selection.focus.col)
    const c1 = Math.max(selection.anchor.col, selection.focus.col)
    const lines: string[] = []
    for (let r = r0; r <= r1; r++) {
      const rowDisplay = displayRowAt(r)
      if (!rowDisplay) continue
      const cells: string[] = []
      for (let c = c0; c <= c1; c++) cells.push(rowDisplay[c] ?? '')
      lines.push(cells.join('\t'))
    }
    if (lines.length === 0) return
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard unavailable — nothing to surface
    }
  }, [selection, data, displayRowAt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !inInput) {
        e.preventDefault()
        setFindOpen(true)
        setTimeout(() => findInputRef.current?.focus(), 0)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !inInput && selection) {
        if (window.getSelection()?.toString()) return
        e.preventDefault()
        void copySelection()
      } else if (e.key === 'Escape' && !inInput) {
        if (findOpen) {
          setFindOpen(false)
          setFindResult(null)
        } else if (selection) {
          setSelection(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, findOpen, copySelection])

  // After a find/goto jump lands (possibly on a different page), glide the
  // selected cell into view.
  useEffect(() => {
    if (scrollPendingRef.current && activeCellRef.current) {
      activeCellRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      scrollPendingRef.current = false
    }
  }, [data, selection])

  const handleCellMouseDown = useCallback((addr: CellAddr, e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setSelection((current) => (
      e.shiftKey && current ? { anchor: current.anchor, focus: addr } : { anchor: addr, focus: addr }
    ))
  }, [])

  const fileName = path.split('/').pop() ?? path

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileSpreadsheetIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Cannot open {fileName}</p>
        <p className="max-w-md text-xs">{error}</p>
        <button
          type="button"
          onClick={() => {
            void window.ipc.invoke('shell:openPath', { path })
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ExternalLinkIcon className="size-3.5" />
          Open in system app
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
        <p className="text-sm">Loading spreadsheet…</p>
      </div>
    )
  }

  const shownColumns = Math.min(data.totalColumns, MAX_COLUMNS)
  const totalPages = Math.max(1, Math.ceil(Math.max(0, data.totalRows - headerRows) / PAGE_SIZE))
  const firstRowNum = data.totalRows === 0 ? 0 : data.offset + 1
  const lastRowNum = Math.min(data.offset + data.rows.length, data.totalRows)

  const selR0 = selection ? Math.min(selection.anchor.row, selection.focus.row) : -1
  const selR1 = selection ? Math.max(selection.anchor.row, selection.focus.row) : -1
  const selC0 = selection ? Math.min(selection.anchor.col, selection.focus.col) : -1
  const selC1 = selection ? Math.max(selection.anchor.col, selection.focus.col) : -1
  const selectionLabel = selection
    ? selR0 === selR1 && selC0 === selC1
      ? `${columnLetter(selC0)}${selR0 + 1}`
      : `${columnLetter(selC0)}${selR0 + 1}:${columnLetter(selC1)}${selR1 + 1}`
    : null
  const focusDisplay = selection ? displayRowAt(selection.focus.row)?.[selection.focus.col] ?? '' : ''

  const cellClass = (row: number, col: number, isNumber: boolean): string => {
    const selected = selection && row >= selR0 && row <= selR1 && col >= selC0 && col <= selC1
    const isCurrent = currentMatch && currentMatch.row === row && currentMatch.col === col
    const isMatch = !isCurrent && matchSet?.has(`${row}:${col}`)
    const bg = isCurrent
      ? 'bg-amber-300/70 dark:bg-amber-600/50'
      : isMatch
        ? 'bg-amber-100 dark:bg-amber-900/40'
        : selected
          ? 'bg-primary/10'
          : ''
    const ring = selected && selection && selection.focus.row === row && selection.focus.col === col
      ? 'outline outline-1 -outline-offset-1 outline-primary'
      : ''
    return `${bg} ${ring} ${isNumber ? 'text-right tabular-nums' : ''}`
  }

  const isFocusCell = (row: number, col: number): boolean =>
    !!selection && selection.focus.row === row && selection.focus.col === col

  const renderGridRow = (absRow: number, rowValues: Array<string | number | boolean | null>, rowDisplay: Array<string | null> | undefined, pinned: boolean) => (
    <tr key={pinned ? 'pinned' : absRow}>
      <td
        className={`sticky left-0 border-b border-r border-border bg-muted px-2 py-1 text-right text-xs text-muted-foreground ${pinned ? 'top-7 z-30' : 'z-10'}`}
      >
        {(absRow + 1).toLocaleString()}
      </td>
      {Array.from({ length: shownColumns }, (_, c) => {
        const value = rowValues[c] ?? null
        const display = rowDisplay?.[c] ?? formatCell(value)
        return (
          <td
            key={c}
            ref={isFocusCell(absRow, c) ? (el) => { activeCellRef.current = el } : undefined}
            onMouseDown={(e) => handleCellMouseDown({ row: absRow, col: c }, e)}
            className={`max-w-96 cursor-default truncate whitespace-nowrap border-b border-r border-border px-2 py-1 text-foreground transition-colors duration-100 ${
              pinned ? 'sticky top-7 z-20 bg-muted font-medium' : ''
            } ${cellClass(absRow, c, typeof value === 'number')}`}
            title={display}
          >
            {display}
          </td>
        )
      })}
    </tr>
  )

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <FileSpreadsheetIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium text-foreground">{fileName}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <EyeIcon className="size-3" />
          View only
        </span>
        <div className="flex-1" />
        {findOpen ? (
          <div className="flex animate-in items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 fade-in slide-in-from-right-2 duration-200">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={findInputRef}
              autoFocus
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  gotoFindIndex(e.shiftKey ? findIndex - 1 : findIndex + 1)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setFindOpen(false)
                  setFindResult(null)
                }
              }}
              placeholder="Find in sheet…"
              className="w-36 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {findResult && findQuery.trim()
                ? findResult.matches.length === 0
                  ? '0'
                  : `${findIndex + 1}/${findResult.matches.length}${findResult.total > findResult.matches.length ? '+' : ''}`
                : ''}
            </span>
            <button
              type="button"
              disabled={!findResult || findResult.matches.length === 0}
              onClick={() => gotoFindIndex(findIndex - 1)}
              className="rounded p-0.5 transition-colors hover:bg-accent disabled:opacity-40"
            >
              <ChevronUpIcon className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={!findResult || findResult.matches.length === 0}
              onClick={() => gotoFindIndex(findIndex + 1)}
              className="rounded p-0.5 transition-colors hover:bg-accent disabled:opacity-40"
            >
              <ChevronDownIcon className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setFindOpen(false)
                setFindResult(null)
              }}
              className="rounded p-0.5 transition-colors hover:bg-accent"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            title="Find in sheet (Ctrl+F)"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <SearchIcon className="size-3.5" />
            Find
          </button>
        )}
        <button
          type="button"
          onClick={() => setPinHeader((v) => !v)}
          title={pinHeader ? 'Unpin first row' : 'Pin first row as header'}
          className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent ${
            pinHeader ? 'bg-accent text-foreground' : 'bg-background text-muted-foreground'
          }`}
        >
          {pinHeader ? <PinIcon className="size-3.5" /> : <PinOffIcon className="size-3.5" />}
          Header
        </button>
        <button
          type="button"
          onClick={() => {
            void window.ipc.invoke('shell:openPath', { path })
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ExternalLinkIcon className="size-3.5" />
          Open in system app
        </button>
      </div>

      {selection && (
        <div className="flex animate-in items-start gap-2 border-b border-border px-4 py-1 text-xs fade-in slide-in-from-top-1 duration-200">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">{selectionLabel}</span>
          <span className="max-h-20 min-w-0 flex-1 select-text overflow-y-auto whitespace-pre-wrap break-words py-0.5 text-foreground">
            {focusDisplay}
          </span>
          <button
            type="button"
            onClick={() => void copySelection()}
            title="Copy selection (Ctrl+C)"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied
              ? <CheckIcon className="size-3.5 animate-in text-green-600 zoom-in-50 duration-200" />
              : <CopyIcon className="size-3.5" />}
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto">
        {data.totalRows === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            This sheet is empty
          </div>
        ) : (
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-40 h-7 min-w-12 border-b border-r border-border bg-muted px-2 py-1 text-right text-xs font-normal text-muted-foreground" />
                {Array.from({ length: shownColumns }, (_, c) => (
                  <th
                    key={c}
                    className="sticky top-0 z-30 h-7 min-w-24 border-b border-r border-border bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground"
                  >
                    {columnLetter(c)}
                  </th>
                ))}
              </tr>
              {pinHeader && data.firstRow && renderGridRow(0, data.firstRow, data.firstRowDisplay ?? undefined, true)}
            </thead>
            <tbody
              key={`${data.activeSheet}:${data.offset}`}
              className="animate-in fade-in duration-200"
            >
              {data.rows.map((row, r) => renderGridRow(data.offset + r, row, data.display[r], false))}
            </tbody>
          </table>
        )}
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex animate-in items-center justify-center bg-background/40 fade-in duration-150">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {data.sheets.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto border-t border-border px-2 py-1">
          {data.sheets.map((sheet) => {
            const isActive = sheet.name === data.activeSheet
            return (
              <button
                key={sheet.name}
                type="button"
                onClick={() => {
                  if (!isActive) {
                    setActiveSheet(sheet.name)
                    setPage(0)
                    setSelection(null)
                  }
                }}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
              >
                {sheet.name}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border px-4 py-1.5 text-xs text-muted-foreground">
        <span>
          {data.totalRows === 0
            ? 'No rows'
            : data.rows.length === 0
              ? `${data.totalRows.toLocaleString()} rows`
              : `Rows ${firstRowNum.toLocaleString()}–${lastRowNum.toLocaleString()} of ${data.totalRows.toLocaleString()}`}
        </span>
        {data.totalColumns > MAX_COLUMNS && (
          <span>· Showing first {MAX_COLUMNS} of {data.totalColumns.toLocaleString()} columns</span>
        )}
        <div className="flex-1" />
        {data.totalRows > 0 && (
          <div className="flex items-center gap-1">
            <label htmlFor="spreadsheet-goto-row">Go to row</label>
            <input
              id="spreadsheet-goto-row"
              value={gotoValue}
              onChange={(e) => setGotoValue(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const n = Number.parseInt(gotoValue, 10)
                if (!Number.isFinite(n) || n < 1) return
                jumpToCell({ row: Math.min(n, data.totalRows) - 1, col: 0 })
                setGotoValue('')
              }}
              placeholder="#"
              className="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground outline-none transition-colors focus:border-ring"
            />
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(0)}
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              First
            </button>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Prev
            </button>
            <span className="px-1">
              Page {(page + 1).toLocaleString()} of {totalPages.toLocaleString()}
            </span>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Next
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Last
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
