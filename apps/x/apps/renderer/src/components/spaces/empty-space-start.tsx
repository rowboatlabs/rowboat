import { FilePlus2, Sparkles, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InviteLinkPanel } from '@/components/spaces/invite-link'
import type { spaces } from '@x/shared'

/**
 * A space with no messages yet (2026-11-09, the evening's design pass): the
 * stream's empty copy becomes the space's first-run page — bring people in,
 * bring an agent in, give it a file — with the space's link underneath, so
 * the three things the product is for are one click away from the start.
 * Groups only: a DM has its own one-line copy.
 */
export function EmptySpaceStart({ orgId, space, onAddPeople, onOpenFiles }: {
    orgId: string
    space: spaces.Space
    /** Opens the Add people dialog: your contacts and your own agents, with a seat for an agent. */
    onAddPeople?: () => void
    /** Opens the space's Files tab. */
    onOpenFiles?: () => void
}) {
    const card = (icon: React.ReactNode, tint: string, title: string, hint: string, action: React.ReactNode) => (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-accent/30 p-4">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>{icon}</span>
            <div className="flex flex-1 flex-col gap-1">
                <span className="text-sm font-semibold">{title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
            </div>
            {action}
        </div>
    )
    return (
        <section aria-label="Get this space going" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
            <div className="flex flex-col gap-2">
                <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-xl bg-muted text-2xl font-bold text-muted-foreground">#</span>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">Welcome to #{space.name}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">It's just you here so far. Bring in the people and the agents who should work on this, then say what it's for.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
                {card(<UserPlus className="size-4" />, 'bg-primary/10 text-primary', 'Add people',
                    'Pick from the people you already know, or share this space’s link.',
                    <Button size="sm" onClick={onAddPeople} disabled={!onAddPeople}>Add people</Button>)}
                {card(<Sparkles className="size-4" />, 'bg-violet-500/15 text-violet-400', 'Add an agent',
                    'Your agents can join and take work from this space; you choose who may ask them here.',
                    <Button size="sm" variant="outline" onClick={onAddPeople} disabled={!onAddPeople}>Choose an agent</Button>)}
                {card(<FilePlus2 className="size-4" />, 'bg-emerald-500/15 text-emerald-400', 'Add a file',
                    'Drop a doc, a board or a plan here. Agents read what the space holds.',
                    <Button size="sm" variant="outline" onClick={onOpenFiles} disabled={!onOpenFiles}>Open files</Button>)}
            </div>
            {/* The space's link, minted on the spot: anyone with it is in. */}
            <div className="rounded-xl border border-dashed border-border p-2">
                <InviteLinkPanel orgId={orgId} spaceId={space.id} />
            </div>
        </section>
    )
}
