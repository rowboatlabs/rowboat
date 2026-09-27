import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react'

const LocalFilePreview = lazy(() => import('@/components/local-file-preview').then((m) => ({ default: m.LocalFilePreview })))

interface FileCardContextType {
  onPreviewFile: (path: string) => void
  onOpenKnowledgeFile: (path: string) => void
  // Existing workspace editors remain available; all other files use the
  // same read-only document viewers as Spaces, alongside the conversation.
  onOpenFile?: (path: string) => void
}

const FileCardContext = createContext<FileCardContextType | null>(null)

export function useFileCard() {
  const ctx = useContext(FileCardContext)
  if (!ctx) throw new Error('useFileCard must be used within FileCardProvider')
  return ctx
}

export function FileCardProvider({
  onOpenKnowledgeFile,
  onOpenFile,
  children,
}: {
  onOpenKnowledgeFile: (path: string) => void
  onOpenFile?: (path: string) => void
  children: ReactNode
}) {
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  return (
    <FileCardContext.Provider value={{ onOpenKnowledgeFile, onOpenFile, onPreviewFile: setPreviewPath }}>
      <div className="flex min-h-0 min-w-0 flex-1 @container/file-preview">
        <div className={`min-h-0 min-w-0 flex-1 flex-col ${previewPath ? 'hidden @[800px]/file-preview:flex' : 'flex'}`}>{children}</div>
        {previewPath && <aside className="flex min-h-0 min-w-0 flex-1 border-l border-border">
          <Suspense fallback={<p role="status" className="p-6 text-sm">Loading preview…</p>}>
            <LocalFilePreview key={previewPath} path={previewPath} onClose={() => setPreviewPath(null)} />
          </Suspense>
        </aside>}
      </div>
    </FileCardContext.Provider>
  )
}
