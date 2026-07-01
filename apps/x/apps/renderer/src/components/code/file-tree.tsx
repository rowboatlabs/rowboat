import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TreeEntry {
  name: string
  kind: 'file' | 'dir'
}

// Lazy file tree over codeSession:readdir — one directory level per request,
// so big folders (node_modules) cost nothing until expanded.
export function CodeFileTree({
  sessionId,
  selectedPath,
  onSelectFile,
}: {
  sessionId: string
  selectedPath: string | null
  onSelectFile: (relPath: string) => void
}) {
  const [childrenByDir, setChildrenByDir] = useState<Record<string, TreeEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const loadDir = useCallback(async (relPath: string) => {
    try {
      const res = await window.ipc.invoke('codeSession:readdir', { sessionId, relPath })
      setChildrenByDir((prev) => ({ ...prev, [relPath]: res.entries }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read directory')
    }
  }, [sessionId])

  useEffect(() => {
    setChildrenByDir({})
    setExpanded(new Set())
    setError(null)
    void loadDir('.')
  }, [loadDir])

  const toggleDir = (relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) {
        next.delete(relPath)
      } else {
        next.add(relPath)
        if (!childrenByDir[relPath]) void loadDir(relPath)
      }
      return next
    })
  }

  const renderDir = (relPath: string, depth: number) => {
    const entries = childrenByDir[relPath]
    if (!entries) {
      return <div className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 12 + 8 }}>Loading…</div>
    }
    return entries.map((entry) => {
      const childPath = relPath === '.' ? entry.name : `${relPath}/${entry.name}`
      if (entry.kind === 'dir') {
        const isOpen = expanded.has(childPath)
        return (
          <div key={childPath}>
            <button
              type="button"
              onClick={() => toggleDir(childPath)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted"
              style={{ paddingLeft: depth * 12 + 8 }}
            >
              {isOpen ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{entry.name}</span>
            </button>
            {isOpen && renderDir(childPath, depth + 1)}
          </div>
        )
      }
      return (
        <button
          key={childPath}
          type="button"
          onClick={() => onSelectFile(childPath)}
          className={cn(
            'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted',
            selectedPath === childPath && 'bg-muted font-medium',
          )}
          style={{ paddingLeft: depth * 12 + 22 }}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{entry.name}</span>
        </button>
      )
    })
  }

  if (error) {
    return <div className="p-3 text-xs text-destructive">{error}</div>
  }
  return <div className="overflow-auto py-1">{renderDir('.', 0)}</div>
}
