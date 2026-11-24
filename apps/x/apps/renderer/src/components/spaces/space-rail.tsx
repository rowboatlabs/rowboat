import { ServerSwitcher } from './server-switcher'
import type { ReactNode, RefObject } from 'react'
import { SpaceRailSections } from '@/components/spaces/space-rail-sections'
import { SecondaryRailToggle } from '@/components/secondary-rail-toggle'
import { SHORTCUTS } from '@/lib/shortcuts'
import { SecondaryRail, type SecondaryRailPeek } from '@/components/secondary-rail'
import { ServerSpaceNavigation } from '@/components/spaces-sidebar-section'
import { useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

/** Stable space/people navigation. Space contents live in the top strip. */
export function SpaceRail({ org, spaceId, onOpenSpace, onOpenBrowse, onOpenSettings, onOpenThreads, threadsActive = false, onOpenActivity, activityActive = false, onOpenAgents, agentsActive = false, open, onTogglePin, peekRef, edgeless = false, account }: {
    org: OrgWithSpaces
    spaceId: string
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenSettings?: (orgId: string, spaceId: string) => void
    /** Your threads across the org (2026-11-05); absent = no row. */
    onOpenThreads?: (orgId: string) => void
    threadsActive?: boolean
    onOpenBrowse?: (orgId: string) => void
    browseActive?: boolean
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
    return <SecondaryRail floating edgeDot={hasUnread} edgeless={edgeless} open={open} onTogglePin={onTogglePin} peekRef={peekRef} widthStorageKey="spaces:railWidth">
        {({ togglePin }) => <SpaceRailSections>
            <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
                <ServerSwitcher org={org} onOpenSpace={onOpenSpace} onOpenAgents={onOpenAgents} />
                {/* Docked: the close. Peeked: the lock. The lock lives here, in the drawer, because
                    the drawer slides out over the header's own button (2026-11-09, the sidebar beside
                    the content), so that button can preview the rail but not dock it. */}
                <SecondaryRailToggle open={open} onToggle={togglePin} shortcut={SHORTCUTS.toggleSidebar} />
            </div>
            {/* A column, so the navigation can pin its Invite row to the foot. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
                {onOpenBrowse && <button className="spaces-rail-row text-left text-sm" onClick={() => onOpenBrowse(org.id)}>Browse spaces</button>}
                <ServerSpaceNavigation onOpenActivity={onOpenActivity} activityActive={activityActive}
                    onOpenAgents={onOpenAgents} agentsActive={agentsActive} org={org} spaceId={spaceId} onOpenSpace={onOpenSpace} onOpenSettings={onOpenSettings} onOpenThreads={onOpenThreads} threadsActive={threadsActive} showDiscussions={false} />
            </div>
            {account && <div className="shrink-0 border-t border-border px-2 pb-2 pt-1.5">{account}</div>}
        </SpaceRailSections>}
    </SecondaryRail>
}
