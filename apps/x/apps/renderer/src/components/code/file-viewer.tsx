import { useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { X } from 'lucide-react'
import { useTheme } from '@/contexts/theme-context'
import { Button } from '@/components/ui/button'
import { cmBaseExtensions, cmLanguageFor } from './cm'

// Read-only, syntax-highlighted view of one file in the session directory.
export function CodeFileViewer({
  sessionId,
  path,
  onClose,
}: {
  sessionId: string
  path: string
  onClose: () => void
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const containerRef = useRef<HTMLDivElement>(null)
  const [file, setFile] = useState<{ content: string; isBinary: boolean; tooLarge: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFile(null)
    setError(null)
    window.ipc.invoke('codeSession:readFile', { sessionId, relPath: path })
      .then((res) => { if (!cancelled) setFile(res) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to read file') })
    return () => { cancelled = true }
  }, [sessionId, path])

  useEffect(() => {
    const parent = containerRef.current
    if (!parent || !file || file.isBinary || file.tooLarge) return
    let view: EditorView | null = null
    let cancelled = false
    void cmLanguageFor(path).then((language) => {
      if (cancelled || !containerRef.current) return
      view = new EditorView({
        doc: file.content,
        extensions: [...cmBaseExtensions(isDark), ...(language ? [language] : [])],
        parent,
      })
    })
    return () => {
      cancelled = true
      view?.destroy()
    }
  }, [file, isDark, path])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90" title={path}>{path}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClose} title="Close file">
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="p-4 text-sm text-destructive">{error}</div>}
        {!error && !file && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        {file?.isBinary && <div className="p-4 text-sm text-muted-foreground">Binary file.</div>}
        {file?.tooLarge && <div className="p-4 text-sm text-muted-foreground">File too large to preview.</div>}
        {file && !file.isBinary && !file.tooLarge && <div ref={containerRef} className="h-full [&_.cm-editor]:h-full" />}
      </div>
    </div>
  )
}
