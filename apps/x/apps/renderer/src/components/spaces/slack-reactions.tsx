import { useState } from 'react'
import type { spaces } from '@x/shared'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { replaceShortcodes } from '@/lib/emoji-data'

export function SlackReactions({ message, onReact }: { message: spaces.Message; onReact?: (message: spaces.Message, emoji: string) => void }) {
    const reactions = message.author.slack?.reactions ?? []
    const [selected, setSelected] = useState<number | null>(null)
    const reaction = selected === null ? undefined : reactions[selected]
    const emoji = reaction ? replaceShortcodes(`:${reaction.name}:`) : ''
    return <>
        <div className="mt-1 flex flex-wrap gap-1">{reactions.map((r, i) => <button key={i} type="button" className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-accent" onClick={() => setSelected(i)} aria-label={`Slack reaction ${r.name}, ${r.count}`}>
            {replaceShortcodes(`:${r.name}:`)} {r.count}<span className="ml-1 text-muted-foreground">Slack</span>
        </button>)}</div>
        <Dialog open={!!reaction} onOpenChange={open => { if (!open) setSelected(null) }}><DialogContent>
            <DialogHeader><DialogTitle>{emoji} · {reaction?.count} Slack reactions</DialogTitle><DialogDescription>Historical reactions from the export. These are separate from Rowboat reactions.</DialogDescription></DialogHeader>
            <ul className="max-h-60 overflow-auto text-sm">{reaction?.users.map(user => <li key={user.id}>{user.name}</li>)}</ul>
            {reaction && reaction.count > reaction.users.length && <p className="text-xs text-muted-foreground">Slack did not include every reacting profile in this export.</p>}
            {onReact && reaction && emoji !== `:${reaction.name}:` && <Button onClick={() => { onReact(message, emoji); setSelected(null) }}>Toggle my {emoji} reaction in Rowboat</Button>}
        </DialogContent></Dialog>
    </>
}
