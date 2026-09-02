import { createContext, useContext, type ReactNode } from 'react'

// Lets a coding-run block in the chat ask the Code section to show a changed
// file's diff. Provided only while the chat is bound to a code session with
// the workspace drawer available — elsewhere the file names stay plain text.
const CodeDiffOpenerContext = createContext<((path: string) => void) | null>(null)

export function useCodeDiffOpener(): ((path: string) => void) | null {
  return useContext(CodeDiffOpenerContext)
}

export function CodeDiffOpenerProvider({
  onOpenDiff,
  children,
}: {
  onOpenDiff: ((path: string) => void) | null
  children: ReactNode
}) {
  return (
    <CodeDiffOpenerContext.Provider value={onOpenDiff}>
      {children}
    </CodeDiffOpenerContext.Provider>
  )
}
