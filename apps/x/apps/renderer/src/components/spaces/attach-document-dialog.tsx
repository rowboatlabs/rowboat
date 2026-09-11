import { useMemo, useState } from 'react'
import { FileText, PenTool, Search } from 'lucide-react'
import type { spaces } from '@x/shared'
import { spaces as spacesLib } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { filterAttachable } from '@/lib/spaces-documents'
import { cn } from '@/lib/utils'

// The one-file link on a discussion (2026-09-11): pick a live space file and
// the org points the topic row at it (manageTopic attach_document). The list
// is the space's live entries (lib/spaces-documents), the currently linked
// file floating to the top.

export function AttachDocumentDialog({ entries, current, onPick, onClose }: {
    entries: spaces.SpacesAssetEntry[]
    /** The file linked today, if any — shown first and marked. */
    current?: string
    onPick: (path: string) => void
    onClose: () => void
}) {
    const [query, setQuery] = useState('')
    const shown = useMemo(() => filterAttachable(entries, query, current), [entries, query, current])

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogTitle className="flex items-center gap-2">
                    <FileText className="size-4" /> {current ? 'Change the linked file' : 'Link a file'}
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                    The linked file opens beside this discussion whenever it is opened.
                </p>
                <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground focus-within:border-foreground/30">
                    <Search className="size-3" />
                    <input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search files…"
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                </label>
                <div className="max-h-64 overflow-y-auto rounded-md border border-border p-1">
                    {shown.map((e) => {
                        const linked = e.path === current
                        return (
                            <button
                                key={e.path}
                                type="button"
                                onClick={() => onPick(e.path)}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                                    linked ? 'bg-accent text-foreground' : 'hover:bg-accent/60',
                                )}
                            >
                                {spacesLib.isWhiteboardPath(e.path) ? (
                                    <PenTool className="size-3.5 shrink-0 text-muted-foreground" />
                                ) : (
                                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.path}</span>
                                {linked && <span className="shrink-0 text-[11px] text-muted-foreground">linked</span>}
                            </button>
                        )
                    })}
                    {shown.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground">
                            {entries.some((e) => e.state !== 'deleted') ? 'No file matches.' : 'This space has no files yet.'}
                        </div>
                    )}
                </div>
                <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
