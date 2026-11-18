import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InviteLinkPanel } from '@/components/spaces/invite-link'

/**
 * Your personal link (harbor spec §4 Invites, 2026-11-09): an invite whose
 * target is a DM with you. The address book is who you share a space with;
 * this link is how someone outside it reaches you — shared on WhatsApp, a
 * mail, wherever you already talk. Minted fresh each time the dialog opens.
 */
export function PersonalLinkDialog({ orgId, open, onOpenChange }: {
    orgId: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Your link</DialogTitle>
                    <DialogDescription>
                        Share it with anyone you want to talk to. Opening it starts a direct message with you.
                    </DialogDescription>
                </DialogHeader>
                {open && <InviteLinkPanel orgId={orgId} direct />}
            </DialogContent>
        </Dialog>
    )
}
