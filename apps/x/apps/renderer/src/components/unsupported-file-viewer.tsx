import { useEffect, useState } from 'react'
import { ExternalLinkIcon, FileIcon, FileTextIcon, Loader2Icon } from 'lucide-react'

const TEXT_FALLBACK_MAX_BYTES = 1 * 1024 * 1024 // 1 MB

interface UnsupportedFileViewerProps {
  path: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; sizeBytes: number; canShowAsText: boolean }
  | { kind: 'error'; message: string }

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

function extensionLabel(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'No extension'
  return name.slice(dot + 1).toUpperCase()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UnsupportedFileViewer({ path }: UnsupportedFileViewerProps) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [textContent, setTextContent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    setTextContent(null)

    ;(async () => {
      try {
        const stat = await window.ipc.invoke('workspace:stat', { path })
        if (cancelled) return
        if (stat.kind !== 'file') {
          setState({ kind: 'error', message: 'Selected path is not a file.' })
          return
        }
        setState({
          kind: 'ready',
          sizeBytes: stat.size,
          canShowAsText: stat.size <= TEXT_FALLBACK_MAX_BYTES,
        })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setState({ kind: 'error', message })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [path])

  async function loadAsText() {
    try {
      const result = await window.ipc.invoke('workspace:readFile', { path })
      setTextContent(result.data)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setTextContent(`Failed to read as text: ${message}`)
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <FileIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Could not open</p>
        <p className="max-w-md text-xs">{state.message}</p>
      </div>
    )
  }

  if (textContent !== null) {
    return (
      <div className="flex h-full w-full flex-col">
        <div className="rowboat-header flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-4 text-xs text-muted-foreground">
          <span className="truncate">{basename(path)} · plain text view</span>
          <button
            type="button"
            onClick={() => setTextContent(null)}
            className="text-foreground hover:underline"
          >
            Hide
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm font-mono text-foreground whitespace-pre-wrap">{textContent}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      <FileIcon className="size-10 text-muted-foreground" />
      <p className="max-w-md truncate text-sm font-medium text-foreground" title={path}>
        {basename(path)}
      </p>
      <p className="text-xs">
        {extensionLabel(path)} · {formatSize(state.sizeBytes)}
      </p>
      <p className="max-w-md text-xs">No in-app preview for this file type.</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void window.ipc.invoke('shell:openPath', { path })
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          <ExternalLinkIcon className="size-3.5" />
          Open in system
        </button>
        {state.canShowAsText && (
          <button
            type="button"
            onClick={() => void loadAsText()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <FileTextIcon className="size-3.5" />
            Show as plain text
          </button>
        )}
      </div>
    </div>
  )
}
