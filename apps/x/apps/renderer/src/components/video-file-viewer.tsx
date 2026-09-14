import { useFileViewerSource } from './file-viewer-source'
import { useEffect, useState } from 'react'
import { ExternalLinkIcon, FileVideoIcon } from 'lucide-react'

interface VideoFileViewerProps {
  path: string
}

type State = 'loading' | 'ready' | 'error'

export function VideoFileViewer({ path }: VideoFileViewerProps) {
  const source = useFileViewerSource()
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    setState('loading')
  }, [path])

  const src = source.url(path)

  if (state === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileVideoIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Cannot play this video</p>
        <p className="max-w-md text-xs">
          The codec or container format isn&apos;t supported by Chromium (e.g. WMV, AVI, or some MKV files).
        </p>
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
    <div className="flex h-full w-full items-center justify-center bg-black">
      <video
        key={path}
        src={src}
        controls
        className="max-h-full max-w-full"
        onLoadedMetadata={() => setState('ready')}
        onError={() => setState('error')}
      />
    </div>
  )
}
