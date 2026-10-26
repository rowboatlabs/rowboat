import { useState, type RefObject } from 'react'
import { isGroupChat } from '@/lib/spaces-navigation'
import { SpaceRailSections } from '@/components/spaces/space-rail-sections'
import { SecondaryRailToggle } from '@/components/secondary-rail-toggle'
import { SecondaryRail, type SecondaryRailPeek } from '@/components/secondary-rail'
import { ServerSpaceNavigation } from '@/components/spaces-sidebar-section'
import { useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

/** Stable space/people navigation. Space contents live in the top strip. */
export function SpaceRail({ org, spaceId, onOpenSpace, onOpenActivity, activityActive = false, onOpenBrowse, browseActive = false, onOpenAgents, agentsActive = false, open, onTogglePin, peekRef, edgeless = false }: {
    org: OrgWithSpaces
    spaceId: string
    onOpenSpace: (orgId: string, spaceId: string) => void
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
}) {
    const unread = useSpacesUnreadCounts()
    const hasUnread = [...unread].some(([key, badge]) => key.startsWith(`${org.id}/`) && badge.unread > 0)
    return <SecondaryRail edgeDot={hasUnread} edgeless={edgeless} open={open} onTogglePin={onTogglePin} peekRef={peekRef} widthStorageKey="spaces:railWidth">
        {({ togglePin }) => <SpaceRailSections>
            <div className="flex shrink-0 items-center gap-0.5 px-2 py-1">
                {/* The section below is "Spaces", so the rail's own header names the server (2026-10-21). */}
                <span className="min-w-0 flex-1 truncate px-1 text-[13px] font-semibold text-muted-foreground">{org.name}</span>
                {/* Previewed from the header button, the rail needs no lock of its
                    own: that button docks it (2026-10-22). */}
                {(open || !edgeless) && <SecondaryRailToggle open={open} onToggle={togglePin} />}
            </div>
            {/* A column, so the navigation can pin its Invite row to the foot. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
                <ServerSpaceNavigation onOpenActivity={onOpenActivity} activityActive={activityActive} onOpenBrowse={onOpenBrowse} browseActive={browseActive}
                    onOpenAgents={onOpenAgents} agentsActive={agentsActive} org={org} spaceId={spaceId} onOpenSpace={onOpenSpace} showDiscussions={false} />
            </div>
        </SpaceRailSections>}
    </SecondaryRail>
}

/**
 * The same rail for the org's own pages — Activity, Agents, Browse spaces
 * (2026-10-21) — so it collapses there too. It shares the space view's pin,
 * so docking or tucking it away holds as you move between them.
 */
export function OrgRail(props: Omit<Parameters<typeof SpaceRail>[0], 'open' | 'onTogglePin'>) {
    const key = isGroupChat(props.org) ? 'spaces:chatRailOpen' : 'spaces:railOpen'
    const [open, setOpen] = useState(() => isGroupChat(props.org) ? localStorage.getItem(key) === '1' : localStorage.getItem(key) !== '0')
    const togglePin = () => {
        localStorage.setItem(key, open ? '0' : '1')
        setOpen(!open)
    }
    return <SpaceRail {...props} open={open} onTogglePin={togglePin} />
}
