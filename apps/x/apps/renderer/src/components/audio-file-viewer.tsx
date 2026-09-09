import { useFileViewerSource } from './file-viewer-source'
import { useEffect, useState } from 'react'
import { ExternalLinkIcon, FileAudioIcon } from 'lucide-react'

interface AudioFileViewerProps {
  path: string
}

type State = 'loading' | 'ready' | 'error'

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

export function AudioFileViewer({ path }: AudioFileViewerProps) {
  const source = useFileViewerSource()
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    setState('loading')
  }, [path])

  const src = source.url(path)

  if (state === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileAudioIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Cannot play this audio file</p>
        <p className="max-w-md text-xs">The codec or container format isn&apos;t supported.</p>
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
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-muted/30 px-6">
      <FileAudioIcon className="size-10 text-muted-foreground" />
      <p className="max-w-md truncate text-sm font-medium text-foreground" title={path}>
        {basename(path)}
      </p>
      <audio
        key={path}
        src={src}
        controls
        className="w-full max-w-lg"
        onLoadedMetadata={() => setState('ready')}
        onError={() => setState('error')}
      />
    </div>
  )
}
