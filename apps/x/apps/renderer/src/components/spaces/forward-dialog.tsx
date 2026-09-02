import { useMemo, useState } from 'react'
import { Forward, Hash, Loader2, MessagesSquare, Search } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { getSpaceFeed, getSpacesOrgs } from '@/hooks/use-spaces'
import { resolveMentions } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'

// Forward (Discord) / share (Slack) a message: pick a destination — a topic
// in this space, or another space's stream — add an optional note, send. The
// forwarded copy is a quoted block with attribution, plain markdown on the
// wire. Blob attachments are space-scoped, so cross-space forwards strip
// them and say so; same-space forwards keep images inline.

interface Destination {
    orgId: string
    spaceId: string
    /** The thread to land in; absent = the space's stream. */
    threadRootId?: string
    label: string
    sub: string
    kind: 'general' | 'topic' | 'space'
}

export function ForwardDialog({ org, space, message, memberNames, onClose }: {
    org: { id: string; name: string }
    space: spaces.Space
    message: spaces.Message
    memberNames: Map<string, string>
    onClose: () => void
}) {
    const [query, setQuery] = useState('')
    const [comment, setComment] = useState('')
    const [picked, setPicked] = useState<Destination | null>(null)
    const [sending, setSending] = useState(false)

    const destinations = useMemo<Destination[]>(() => {
        // Straight off the feed store — every known space's topics are kept
        // loaded there, and a dialog's lifetime doesn't need live updates.
        const topics = getSpaceFeed(org.id, space.id).topics
        const out: Destination[] = [
            { orgId: org.id, spaceId: space.id, label: 'Messages', sub: space.name, kind: 'general' },
        ]
        for (const t of topics) {
            if (t.archived) continue
            out.push({
                orgId: org.id,
                spaceId: space.id,
                threadRootId: t.rootMessageId,
                label: resolveMentions(t.title, memberNames),
                sub: space.name,
                kind: 'topic',
            })
        }
        for (const o of getSpacesOrgs()) {
            for (const s of o.spaces) {
                if (o.id === org.id && s.id === space.id) continue
                out.push({ orgId: o.id, spaceId: s.id, label: s.name, sub: o.name, kind: 'space' })
            }
        }
        return out
    }, [org.id, org.name, space.id, space.name, memberNames])

    const q = query.trim().toLowerCase()
    const shown = q ? destinations.filter((d) => `${d.label} ${d.sub}`.toLowerCase().includes(q)) : destinations

    const send = async () => {
        if (!picked || sending) return
        setSending(true)
        try {
            const cross = picked.orgId !== org.id || picked.spaceId !== space.id
            const authorName = memberNames.get(message.author.memberId) ?? message.author.memberId
            let text = resolveMentions(message.body, memberNames).trim()
            let stripped = false
            if (cross) {
                // Blob links only resolve inside their own space — a forward
                // across the boundary carries the words, not the bytes.
                const next = text
                    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
                    .replace(/\[[^\]]*\]\([^)]*\/b\/[^)]*\)/g, '')
                    .trim()
                stripped = next !== text
                text = next
            }
            const quote = (text || '(attachment)').split('\n').map((l) => `> ${l}`).join('\n')
            const attribution = `> — ${authorName}${cross ? `, in ${space.name}` : ''}${stripped ? ' _(attachments not forwarded)_' : ''}`
            const body = [comment.trim(), `${quote}\n${attribution}`].filter(Boolean).join('\n\n')
            await window.ipc.invoke('spaces:postMessage', {
                orgId: picked.orgId,
                spaceId: picked.spaceId,
                ...(picked.threadRootId ? { threadRoot: picked.threadRootId } : {}),
                body,
            })
            toast(`Forwarded to ${picked.label}`, 'success')
            onClose()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not forward', 'error')
        } finally {
            setSending(false)
        }
    }

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogTitle className="flex items-center gap-2">
                    <Forward className="size-4" /> Forward message
                </DialogTitle>
                <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground focus-within:border-foreground/30">
                    <Search className="size-3" />
                    <input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search topics and spaces…"
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                </label>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border p-1">
                    {shown.map((d) => {
                        const active = picked?.threadRootId === d.threadRootId && picked?.orgId === d.orgId && picked?.spaceId === d.spaceId
                        return (
                            <button
                                key={`${d.orgId}/${d.spaceId}/${d.threadRootId ?? 'stream'}`}
                                type="button"
                                onClick={() => setPicked(d)}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                                    active ? 'bg-accent text-foreground' : 'hover:bg-accent/60',
                                )}
                            >
                                {d.kind === 'topic' ? (
                                    <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                                ) : (
                                    <MessagesSquare className="size-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                                <span className="shrink-0 text-[11px] text-muted-foreground">{d.sub}</span>
                            </button>
                        )
                    })}
                    {shown.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">No destination matches.</div>}
                </div>
                <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a note (optional)"
                    rows={2}
                    className="text-sm"
                />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                    <Button size="sm" disabled={!picked || sending} onClick={() => void send()}>
                        {sending ? <Loader2 className="size-3.5 animate-spin" /> : 'Forward'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
