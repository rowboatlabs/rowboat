import { useEffect, useMemo, useState } from 'react'
import { AlertCircleIcon, ExternalLinkIcon, FileTextIcon, Loader2Icon } from 'lucide-react'

const MAX_SIZE_BYTES = 5 * 1024 * 1024

type ViewerState =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'empty' }
  | { kind: 'tooLarge'; sizeMB: number }
  | { kind: 'error'; message: string }

interface HtmlFileViewerProps {
  path: string
}

function toAppWorkspaceUrl(path: string): string {
  const segments = path.split('/').filter(Boolean).map((seg) => encodeURIComponent(seg))
  return `app://workspace/${segments.join('/')}`
}

export function HtmlFileViewer({ path }: HtmlFileViewerProps) {
  const [state, setState] = useState<ViewerState>({ kind: 'loading' })
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const iframeSrc = useMemo(() => toAppWorkspaceUrl(path), [path])

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    setIframeLoaded(false)

    ;(async () => {
      try {
        const stat = await window.ipc.invoke('workspace:stat', { path })
        if (cancelled) return
        if (stat.kind !== 'file') {
          setState({ kind: 'error', message: 'Selected path is not a file.' })
          return
        }
        if (stat.size > MAX_SIZE_BYTES) {
          setState({ kind: 'tooLarge', sizeMB: stat.size / (1024 * 1024) })
          return
        }
        if (stat.size === 0) {
          setState({ kind: 'empty' })
          return
        }
        setState({ kind: 'loaded' })
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

  if (state.kind === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <AlertCircleIcon className="size-6 text-destructive" />
        <p className="text-sm font-medium text-foreground">Could not load preview</p>
        <p className="max-w-md text-xs">{state.message}</p>
        <p className="text-xs opacity-60">{path}</p>
      </div>
    )
  }

  if (state.kind === 'empty') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileTextIcon className="size-6" />
        <p className="text-sm">This file is empty</p>
      </div>
    )
  }

  if (state.kind === 'tooLarge') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileTextIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">File too large to preview</p>
        <p className="text-xs">
          {state.sizeMB.toFixed(1)} MB — preview limit is {(MAX_SIZE_BYTES / (1024 * 1024)).toFixed(0)} MB.
        </p>
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
      </div>
    )
  }

  // Serve via the `app://workspace/<rel-path>` protocol so the iframe has a
  // proper base URL — relative `<link>`, `<img>`, `<script>` references next
  // to the file resolve correctly (the path-traversal guard in
  // resolveWorkspacePath already gates the protocol handler).
  return (
    <div className="relative h-full w-full">
      {state.kind === 'loaded' && (
        <iframe
          key={path}
          src={iframeSrc}
          sandbox="allow-scripts"
          className="h-full w-full border-0 bg-white"
          title="HTML preview"
          onLoad={() => setIframeLoaded(true)}
        />
      )}
      {(state.kind === 'loading' || !iframeLoaded) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm">Rendering preview…</p>
        </div>
      )}
    </div>
  )
}
