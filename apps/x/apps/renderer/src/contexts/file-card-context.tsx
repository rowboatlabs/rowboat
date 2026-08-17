import { createContext, useContext, type ReactNode } from 'react'

interface FileCardContextType {
  onOpenKnowledgeFile: (path: string) => void
  // Opens a workspace-relative file in the in-app file view. Optional: cards
  // fall back to the OS opener when the host surface doesn't provide it.
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
  return (
    <FileCardContext.Provider value={{ onOpenKnowledgeFile, onOpenFile }}>
      {children}
    </FileCardContext.Provider>
  )
}
