import { useFileViewerSource } from './file-viewer-source'
import { useState } from 'react'
import { ExternalLinkIcon, FileTextIcon, Loader2Icon } from 'lucide-react'

interface PdfFileViewerProps {
  path: string
}

type State = 'loading' | 'ready' | 'error'

export function PdfFileViewer({ path }: PdfFileViewerProps) {
  const source = useFileViewerSource()
  // Kept with the path it belongs to, so a new path starts loading without an
  // effect that could run after the iframe's load and undo it (2026-10-07, PR #1167 CI).
  const [status, setStatus] = useState<{ path: string; state: State }>({ path, state: 'loading' })
  const state = status.path === path ? status.state : 'loading'

  const src = source.url(path)

  if (state === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileTextIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Cannot preview this PDF</p>
        <button
          type="button"
          onClick={() => {
            void source.open({ path })
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
      <iframe
        key={path}
        src={src}
        className="h-full w-full border-0 bg-white"
        title="PDF preview"
        onLoad={() => setStatus({ path, state: 'ready' })}
        onError={() => setStatus({ path, state: 'error' })}
      />
      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm">Loading PDF…</p>
        </div>
      )}
    </div>
  )
}
