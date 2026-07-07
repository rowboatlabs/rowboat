import { useEffect, useRef, useState } from 'react'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import { Columns2, FoldVertical, Rows2, UnfoldVertical, X } from 'lucide-react'
import { useTheme } from '@/contexts/theme-context'
import { Button } from '@/components/ui/button'
import { cmBaseExtensions, cmLanguageFor } from './cm'

// Read-only diff of one file's working-tree changes vs HEAD, side-by-side or
// unified. Content comes from codeSession:fileDiff (old = git show HEAD:path,
// new = disk).
export function DiffViewer({
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
  const [mode, setMode] = useState<'split' | 'unified'>('split')
  // GitHub-style: unchanged regions fold into "⋯ N lines" bars (each clickable
  // to reveal); "Expand all" rebuilds the view with nothing collapsed.
  const [collapseUnchanged, setCollapseUnchanged] = useState(true)
  const [diff, setDiff] = useState<{ oldText: string; newText: string; isBinary: boolean; tooLarge: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDiff(null)
    setError(null)
    window.ipc.invoke('codeSession:fileDiff', { sessionId, path })
      .then((res) => { if (!cancelled) setDiff(res) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load diff') })
    return () => { cancelled = true }
  }, [sessionId, path])

  useEffect(() => {
    const parent = containerRef.current
    if (!parent || !diff || diff.isBinary || diff.tooLarge) return
    let view: MergeView | EditorView | null = null
    let cancelled = false

    void cmLanguageFor(path).then((language) => {
      if (cancelled || !containerRef.current) return
      const extensions = [...cmBaseExtensions(isDark), ...(language ? [language] : [])]
      // Same context margins GitHub uses: keep a few lines around each hunk,
      // only fold stretches long enough to be worth hiding.
      const collapse = collapseUnchanged ? { margin: 3, minSize: 6 } : undefined
      if (mode === 'split') {
        view = new MergeView({
          a: { doc: diff.oldText, extensions },
          b: { doc: diff.newText, extensions },
          parent,
          gutter: true,
          ...(collapse ? { collapseUnchanged: collapse } : {}),
        })
      } else {
        view = new EditorView({
          doc: diff.newText,
          extensions: [
            ...extensions,
            unifiedMergeView({
              original: diff.oldText,
              mergeControls: false,
              ...(collapse ? { collapseUnchanged: collapse } : {}),
            }),
          ],
          parent,
        })
      }
    })

    return () => {
      cancelled = true
      view?.destroy()
    }
  }, [diff, mode, isDark, path, collapseUnchanged])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90" title={path}>{path}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setCollapseUnchanged((c) => !c)}
          title={collapseUnchanged ? 'Show the whole file' : 'Collapse unchanged regions'}
        >
          {collapseUnchanged ? <UnfoldVertical className="size-3.5" /> : <FoldVertical className="size-3.5" />}
          {collapseUnchanged ? 'Expand all' : 'Collapse'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setMode((m) => (m === 'split' ? 'unified' : 'split'))}
          title={mode === 'split' ? 'Switch to unified view' : 'Switch to side-by-side view'}
        >
          {mode === 'split' ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClose} title="Close diff">
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="p-4 text-sm text-destructive">{error}</div>}
        {!error && !diff && <div className="p-4 text-sm text-muted-foreground">Loading diff…</div>}
        {diff?.isBinary && <div className="p-4 text-sm text-muted-foreground">Binary file — no text diff.</div>}
        {diff?.tooLarge && <div className="p-4 text-sm text-muted-foreground">File too large to diff here.</div>}
        {diff && !diff.isBinary && !diff.tooLarge && (
          <div ref={containerRef} className="h-full [&_.cm-mergeView]:h-full [&_.cm-editor]:h-full" />
        )}
      </div>
    </div>
  )
}
