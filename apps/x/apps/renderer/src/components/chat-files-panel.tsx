import { X } from 'lucide-react'
import { FilePathCard } from '@/components/ai-elements/file-path-card'
import type { SessionFileEntry } from '@/lib/session-files'
import { cn } from '@/lib/utils'

/**
 * Right-hand panel listing every file the agent created or modified in the
 * current chat (derived via `collectSessionFiles`). Each row is a
 * `FilePathCard`, so knowledge files open in the editor and system files open
 * with the OS — same behavior as the inline cards in the conversation.
 * Must render inside `FileCardProvider`.
 */
export function ChatFilesPanel({
    files,
    onClose,
    className,
}: {
    files: SessionFileEntry[]
    onClose: () => void
    /** Override the default fixed-width right-panel layout (e.g. w-full overlay in the side-pane chat). */
    className?: string
}) {
    return (
        <div className={cn('flex w-[320px] shrink-0 flex-col border-l border-border bg-background', className)}>
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-medium text-foreground">
                    Files
                    {files.length > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{files.length}</span>
                    )}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Close files panel"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
                {files.length === 0 ? (
                    <p className="px-2 py-10 text-center text-xs leading-relaxed text-muted-foreground">
                        No files in this chat yet. Documents and files the agent creates will show up here.
                    </p>
                ) : (
                    files.map(file => <FilePathCard key={file.path} filePath={file.path} />)
                )}
            </div>
        </div>
    )
}
