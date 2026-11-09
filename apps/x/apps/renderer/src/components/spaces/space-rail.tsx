import type { ReactNode, RefObject } from 'react'
import { SpaceRailSections } from '@/components/spaces/space-rail-sections'
import { SecondaryRailToggle } from '@/components/secondary-rail-toggle'
import { SecondaryRail, type SecondaryRailPeek } from '@/components/secondary-rail'
import { ServerSpaceNavigation } from '@/components/spaces-sidebar-section'
import { useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

/** Stable space/people navigation. Space contents live in the top strip. */
export function SpaceRail({ org, spaceId, onOpenSpace, onOpenThreads, threadsActive = false, onOpenActivity, activityActive = false, onOpenAgents, agentsActive = false, open, onTogglePin, peekRef, edgeless = false, account }: {
    org: OrgWithSpaces
    spaceId: string
    onOpenSpace: (orgId: string, spaceId: string) => void
    /** Your threads across the org (2026-11-05); absent = no row. */
    onOpenThreads?: (orgId: string) => void
    threadsActive?: boolean
    onOpenAgents?: (orgId: string) => void
    agentsActive?: boolean
    onOpenActivity?: (orgId: string) => void
    activityActive?: boolean
    open: boolean
    onTogglePin: () => void
    peekRef?: RefObject<SecondaryRailPeek | null>
    /** The header's "Show sidebar" button is the way in; no edge sliver. */
    edgeless?: boolean
    /** Your account row, from the host (its menu rows differ on the web and the desktop); sits at the foot (2026-11-09). */
    account?: ReactNode
}) {
    const unread = useSpacesUnreadCounts()
    const hasUnread = [...unread].some(([key, badge]) => key.startsWith(`${org.id}/`) && badge.unread > 0)
    return <SecondaryRail edgeDot={hasUnread} edgeless={edgeless} open={open} onTogglePin={onTogglePin} peekRef={peekRef} widthStorageKey="spaces:railWidth">
        {({ togglePin }) => <SpaceRailSections>
            <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
                {/* One server (2026-11-09): the rail's header is the product, not a server name. The
                    thin rail that held the logo and the account folded into this one the same evening. */}
                <img src="/logo-only.png" alt="" aria-hidden="true" className="size-5 shrink-0 rounded-md" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">Spaces</span>
                {/* Previewed from the header button, the rail needs no lock of its
                    own: that button docks it (2026-10-22). */}
                {(open || !edgeless) && <SecondaryRailToggle open={open} onToggle={togglePin} />}
            </div>
            {/* A column, so the navigation can pin its Invite row to the foot. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
                <ServerSpaceNavigation onOpenActivity={onOpenActivity} activityActive={activityActive}
                    onOpenAgents={onOpenAgents} agentsActive={agentsActive} org={org} spaceId={spaceId} onOpenSpace={onOpenSpace} onOpenThreads={onOpenThreads} threadsActive={threadsActive} showDiscussions={false} />
            </div>
            {account && <div className="shrink-0 border-t border-border px-2 pb-2 pt-1.5">{account}</div>}
        </SpaceRailSections>}
    </SecondaryRail>
}
