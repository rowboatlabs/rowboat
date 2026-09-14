import { useEffect, useState } from 'react'
import { AddOrgDialog } from '@/components/spaces/atoms'
import { refreshSpacesOrgs } from '@/hooks/use-spaces'
import { consumeJoinInvite, subscribeJoinInvite } from '@/lib/spaces-invite'

/**
 * The one join dialog for invites that arrive by link — a deep link from the
 * org's /join landing, or an invite pasted into a message. Mounted once in
 * App so it exists whatever section is showing; it opens the ordinary Add
 * Server dialog on the invite, pre-resolved, one click from Join.
 */
export function InviteJoinDialog({ onJoined }: { onJoined: (orgId: string, spaceId?: string) => void }) {
    const [inviteUrl, setInviteUrl] = useState<string | null>(null)

    useEffect(() => {
        const take = () => {
            const url = consumeJoinInvite()
            if (url) setInviteUrl(url)
        }
        take()
        return subscribeJoinInvite(take)
    }, [])

    if (!inviteUrl) return null
    return (
        <AddOrgDialog
            key={inviteUrl}
            open
            initialAction="join"
            initialInviteUrl={inviteUrl}
            onOpenChange={(open) => {
                if (!open) setInviteUrl(null)
            }}
            onAdded={(orgId, spaceId) => {
                void refreshSpacesOrgs().then(() => onJoined(orgId, spaceId))
            }}
        />
    )
}
