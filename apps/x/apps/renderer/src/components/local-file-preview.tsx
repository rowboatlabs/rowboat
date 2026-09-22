import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Loader2, X } from 'lucide-react'
import { DocumentFileViewer } from './document-file-viewer'
import { FileViewerSourceContext } from './file-viewer-source'
import { createLocalFileSource, type LocalFilePreview as Preview } from '@/lib/local-file-source'
import { getViewerType } from '@/lib/file-types'
import { toast } from 'sonner'

/** Same document column and format viewers as Spaces attachments. */
export function LocalFilePreview({ path, onClose }: { path: string; onClose: () => void }) {
  const [file, setFile] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    const release = (url: string) => { void window.ipc.invoke('shell:releaseFilePreview', { url }).catch(() => {}) }
    void window.ipc.invoke('shell:previewFile', { path }).then((file) => {
      if (cancelled) { release(file.url); return }
      url = file.url
      setFile(file)
    }).catch((error) => { if (!cancelled) setError(error instanceof Error ? error.message : 'Could not open file') })
    return () => { cancelled = true; if (url) release(url) }
  }, [path])
  const source = useMemo(() => file ? createLocalFileSource(file) : null, [file])
  return <section aria-label="File preview" className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate font-mono text-foreground/80" title={path}>{file?.name ?? path.split(/[\\/]/).pop()}</span>
      <button type="button" aria-label="Open in Finder" className="rounded p-1 hover:bg-accent" onClick={() => { void window.ipc.invoke('shell:showItemInFolder', { path }).catch((e) => toast.error(String(e))) }}><FolderOpen className="size-3.5" /></button>
      <button type="button" aria-label="Close file preview" className="rounded p-1 hover:bg-accent" onClick={onClose}><X className="size-3.5" /></button>
    </div>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
      {error ? <p role="alert" className="p-6 text-sm text-muted-foreground">{error}</p> : source && file ?
        <FileViewerSourceContext.Provider value={source}>{getViewerType(file.name)
          ? <DocumentFileViewer path={file.name} />
          : <LocalTextPreview file={file} />}</FileViewerSourceContext.Provider>
        : <div role="status" className="flex items-center gap-2 p-6 text-sm"><Loader2 className="size-4 animate-spin" />Loading preview…</div>}
    </div>
  </section>
}
function LocalTextPreview({ file }: { file: Preview }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const supported = /\.(md|txt|json|ya?ml|xml|log|[cm]?[jt]sx?|py|sh|css|sql|toml|ini|rs|go|java|c|h|cpp)$/i.test(file.name)
  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    void fetch(file.url, { signal: controller.signal, headers: { Range: 'bytes=0-999999' } }).then(async (r) => {
      if (!r.ok) throw new Error('Could not load preview')
      const blob = await r.blob()
      const text = await blob.slice(0, 1_000_000).text()
      if (!controller.signal.aborted) setText(text)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [file.url, supported])
  if (!supported) return <p className="p-6 text-sm text-muted-foreground">Preview isn’t available for this file type. Use Open in Finder to locate the file.</p>
  if (error) return <p role="alert" className="p-6 text-sm">Could not load this preview.</p>
  if (text === null) return <p role="status" className="p-6 text-sm">Loading preview…</p>
  return <div>{file.size > 1_000_000 && <p className="px-4 text-xs text-muted-foreground">Showing the first 1 MB.</p>}<pre className="whitespace-pre-wrap break-words p-4 text-xs">{text}</pre></div>
}
