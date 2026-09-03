import { FileDiff, FolderTree, Terminal as TerminalIcon } from 'lucide-react'

// The three panels of the workspace drawer beside a code chat. Shared by the
// drawer's segmented switch and the chat header's toggle buttons.
export type CodePanel = 'changes' | 'files' | 'terminal'

export const CODE_PANELS: { id: CodePanel; label: string; icon: typeof FileDiff }[] = [
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'terminal', label: 'Terminal', icon: TerminalIcon },
]
