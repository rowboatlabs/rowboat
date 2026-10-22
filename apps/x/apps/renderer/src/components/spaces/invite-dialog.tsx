import { useMemo, useState } from 'react'
import { Hash, Lock } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { InviteLinkPanel } from '@/components/spaces/invite-link'
import { listNames } from '@/lib/spaces-invites'
import { useSpaceDirectory } from '@/hooks/use-space-directory'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

/**
 * Invite people to the org (harbor, 2026-10-19): an invite is to the org,
 * and may list spaces the inviter is in. Everyone it admits also joins the
 * org's default spaces, so those are named up front and not offered as a
 * choice. The link is minted on Create, never on every tick of a box: a new
 * choice puts the button back.
 */
export function InviteDialog({ org, open, onOpenChange }: {
    org: OrgWithSpaces
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const directory = useSpaceDirectory(org.id, open)
    // Defaults the inviter is not in still count: the directory lists every open space.
    const defaults = useMemo(() => {
        const byId = new Map<string, string>()
        for (const space of org.spaces) if (space.isDefault && !space.archived) byId.set(space.id, space.name)
        for (const { space } of directory.entries) if (space.isDefault && !space.archived) byId.set(space.id, space.name)
        return byId
    }, [org.spaces, directory.entries])
    const listable = org.spaces.filter((space) => space.kind !== 'direct' && !space.archived && !defaults.has(space.id))
    const [chosen, setChosen] = useState<string[]>([])
    const [minted, setMinted] = useState<number | null>(null)

    const toggle = (spaceId: string) => {
        setMinted(null)
        setChosen((prev) => prev.includes(spaceId) ? prev.filter((id) => id !== spaceId) : [...prev, spaceId])
    }
    const close = (next: boolean) => {
        onOpenChange(next)
        if (!next) {
            setChosen([])
            setMinted(null)
        }
    }

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Invite people to {org.name}</DialogTitle>
                    <DialogDescription>
                        {defaults.size > 0
                            ? `Everyone you invite joins ${listNames([...defaults.values()].map((name) => `#${name}`))}.`
                            : 'Everyone you invite joins the server and can browse its open spaces.'}
                        {listable.length > 0 && ' Add spaces to bring them straight there.'}
                    </DialogDescription>
                </DialogHeader>
                {listable.length > 0 && (
                    <fieldset className="flex max-h-60 flex-col gap-0.5 overflow-auto">
                        <legend className="sr-only">Spaces to add</legend>
                        {listable.map((space) => (
                            <label key={space.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                                <input type="checkbox" checked={chosen.includes(space.id)} onChange={() => toggle(space.id)} />
                                {space.visibility === 'open'
                                    ? <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                                    : <Lock aria-label="Private space" className="size-3.5 shrink-0 text-muted-foreground" />}
                                <span className="min-w-0 flex-1 truncate">{space.name}</span>
                            </label>
                        ))}
                    </fieldset>
                )}
                {minted === null ? (
                    <div className="flex justify-end">
                        <Button onClick={() => setMinted(Date.now())}>Create invite link</Button>
                    </div>
                ) : (
                    <InviteLinkPanel key={minted} orgId={org.id} spaceIds={chosen} />
                )}
            </DialogContent>
        </Dialog>
    )
}
