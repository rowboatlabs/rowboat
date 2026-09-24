import { useMemo, useState } from 'react'
import { MessagesSquare, Search } from 'lucide-react'
import type { autoRoute } from '@x/shared'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { threadLabelOf } from '@/lib/spaces-conventions'
import { formatFeedTime } from '@/lib/spaces-presentation'

// "Pick a thread" on a held stream verdict (2026-09-23): the same candidates
// Auto sees, newest activity first, for the person to choose from when Jev
// read the message as new and they know better. Picking stages the text in
// that thread; nothing posts here.
export function ThreadPickerDialog({ candidates, onPick, onClose }: {
    candidates: autoRoute.RouteCandidate[]
    onPick: (rootMessageId: string) => void
    onClose: () => void
}) {
    const [query, setQuery] = useState('')
    const rows = useMemo(
        () => candidates.map((c) => ({
            id: c.rootMessageId,
            label: c.title ?? threadLabelOf(c.rootText),
            sub: [
                c.rootAuthor,
                c.replyCount === 0 ? 'no replies yet' : `${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}`,
                formatFeedTime(c.lastActivityAt),
            ].filter(Boolean).join(' · '),
            haystack: `${c.title ?? ''} ${c.rootText} ${c.rootAuthor ?? ''}`.toLowerCase(),
        })),
        [candidates],
    )
    const q = query.trim().toLowerCase()
    const shown = q ? rows.filter((r) => r.haystack.includes(q)) : rows

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogTitle className="flex items-center gap-2">
                    <MessagesSquare className="size-4" />
                    Reply in a thread
                </DialogTitle>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a message or thread" className="pl-8" autoFocus />
                </div>
                <div className="-mx-2 max-h-80 overflow-y-auto">
                    {shown.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches</div>}
                    {shown.map((r) => (
                        <button
                            key={r.id}
                            type="button"
                            onClick={() => onPick(r.id)}
                            className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-accent/60"
                        >
                            <span className="w-full truncate text-sm">{r.label}</span>
                            <span className="text-xs text-muted-foreground">{r.sub}</span>
                        </button>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}
