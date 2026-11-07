import { openServerDialog } from '@/lib/server-dialog'

/**
 * Who a new space belongs to, said where it is made (2026-11-07). A space is
 * the org's: leaving the org, or being removed from it, takes the space away.
 * People invited into a company's channel reached for "New space" to start
 * something of their own, so the dialog names the owner and offers the
 * separate group chat, its name carried over.
 */
export function SpaceOwnerNote({ orgName, name, onLeave }: {
    orgName: string
    /** What they typed so far, carried into the group chat. */
    name: string
    /** Close the dialog this sits in before the other one opens. */
    onLeave: () => void
}) {
    const startGroupChat = () => {
        onLeave()
        openServerDialog({ kind: 'create', ...(name.trim() ? { name: name.trim() } : {}) })
    }
    return (
        <p className="text-xs leading-relaxed text-muted-foreground">
            This belongs to {orgName}. If you leave {orgName}, you lose it.{' '}
            Something of your own?{' '}
            {/* mousedown keeps focus where it is: the dock's inline field closes on blur. */}
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={startGroupChat} className="font-medium text-foreground underline-offset-2 hover:underline">
                Start a group chat instead
            </button>
        </p>
    )
}
