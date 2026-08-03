import { useEffect, useState } from 'react'
import { ExternalLinkIcon, FileTextIcon, Loader2Icon } from 'lucide-react'

interface PdfFileViewerProps {
  path: string
}

type State = 'loading' | 'ready' | 'error'

// Workspace-relative paths stream through the app://workspace protocol.
// Absolute / ~ paths (e.g. a PDF the agent saved to the Desktop) are outside
// the protocol's boundary guard, so they load through shell:readFileBase64
// into a blob URL instead — capped at 10MB by that IPC, with the error state's
// "Open in system" button as the fallback for anything bigger.
const isOutsideWorkspace = (path: string): boolean =>
  path.startsWith('/') || path.startsWith('~')

export function PdfFileViewer({ path }: PdfFileViewerProps) {
  const [state, setState] = useState<State>('loading')
  const [blobSrc, setBlobSrc] = useState<string | null>(null)
  const external = isOutsideWorkspace(path)

  useEffect(() => {
    setState('loading')
    setBlobSrc(null)
    if (!external) return
    let cancelled = false
    let url: string | null = null
    window.ipc.invoke('shell:readFileBase64', { path })
      .then(({ data }) => {
        if (cancelled) return
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setBlobSrc(url)
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path, external])

  const src = external
    ? blobSrc
    : `app://workspace/${path.split('/').map(encodeURIComponent).join('/')}`

  if (state === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileTextIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Cannot preview this PDF</p>
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

  return (
    <div className="relative h-full w-full">
      {src && (
        <iframe
          key={path}
          src={src}
          className="h-full w-full border-0 bg-white"
          title="PDF preview"
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
      )}
      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm">Loading PDF…</p>
        </div>
      )}
    </div>
  )
}
