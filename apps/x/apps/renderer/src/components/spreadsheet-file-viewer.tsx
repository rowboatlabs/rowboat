import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLinkIcon, EyeIcon, FileSpreadsheetIcon, Loader2Icon } from 'lucide-react'

interface SpreadsheetFileViewerProps {
  path: string
}

type SpreadsheetLoadResult = {
  format: 'xlsx' | 'xls' | 'csv' | 'tsv'
  sheets: Array<{ name: string; rowCount: number; columnCount: number }>
  activeSheet: string
  rows: Array<Array<string | number | boolean | null>>
  offset: number
  totalRows: number
  totalColumns: number
  etag: string
}

const PAGE_SIZE = 500
const MAX_COLUMNS = 100

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
  const [activeSheet, setActiveSheet] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  // New file: start over on the first sheet.
  useEffect(() => {
    setData(null)
    setActiveSheet(null)
    setPage(0)
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
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        })
        if (cancelled || requestId !== requestIdRef.current) return
        setData(result)
        setError(null)
        // The file shrank below the current page (e.g. rows deleted): snap to
        // the last page that still exists.
        const lastPage = Math.max(0, Math.ceil(result.totalRows / PAGE_SIZE) - 1)
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
  }, [path, activeSheet, page, version])

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
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
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
  const totalPages = Math.max(1, Math.ceil(data.totalRows / PAGE_SIZE))
  const firstRow = data.totalRows === 0 ? 0 : data.offset + 1
  const lastRow = Math.min(data.offset + data.rows.length, data.totalRows)

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
        <button
          type="button"
          onClick={() => {
            void window.ipc.invoke('shell:openPath', { path })
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
        >
          <ExternalLinkIcon className="size-3.5" />
          Open in system app
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {data.totalRows === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            This sheet is empty
          </div>
        ) : (
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-12 border-b border-r border-border bg-muted px-2 py-1 text-right text-xs font-normal text-muted-foreground" />
                {Array.from({ length: shownColumns }, (_, c) => (
                  <th
                    key={c}
                    className="sticky top-0 z-20 min-w-24 border-b border-r border-border bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground"
                  >
                    {columnLetter(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, r) => (
                <tr key={data.offset + r}>
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-muted px-2 py-1 text-right text-xs text-muted-foreground">
                    {(data.offset + r + 1).toLocaleString()}
                  </td>
                  {Array.from({ length: shownColumns }, (_, c) => {
                    const value = row[c] ?? null
                    return (
                      <td
                        key={c}
                        className={`max-w-96 truncate whitespace-nowrap border-b border-r border-border px-2 py-1 text-foreground ${typeof value === 'number' ? 'text-right tabular-nums' : ''}`}
                        title={formatCell(value)}
                      >
                        {formatCell(value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
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
                  }
                }}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${
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
            : `Rows ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${data.totalRows.toLocaleString()}`}
        </span>
        {data.totalColumns > MAX_COLUMNS && (
          <span>· Showing first {MAX_COLUMNS} of {data.totalColumns.toLocaleString()} columns</span>
        )}
        <div className="flex-1" />
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(0)}
              className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              First
            </button>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
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
              className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Next
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Last
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
