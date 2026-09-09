import { useFileViewerSource } from './file-viewer-source'
import { useEffect, useState } from 'react'
import { ExternalLinkIcon, FileImageIcon, Loader2Icon } from 'lucide-react'

interface ImageFileViewerProps {
  path: string
}

type State = 'loading' | 'loaded' | 'error'

export function ImageFileViewer({ path }: ImageFileViewerProps) {
  const source = useFileViewerSource()
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    setState('loading')
  }, [path])

  const src = source.url(path)

  if (state === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileImageIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Cannot preview this image</p>
        <p className="max-w-md text-xs">The format may be unsupported (e.g. HEIC on Windows).</p>
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
    <div className="relative flex h-full w-full items-center justify-center bg-muted/30">
      <img
        key={path}
        src={src}
        alt={path}
        className="max-h-full max-w-full object-contain"
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
        style={state === 'loading' ? { opacity: 0 } : undefined}
      />
      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm">Loading image…</p>
        </div>
      )}
    </div>
  )
}
