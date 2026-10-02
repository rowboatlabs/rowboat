import { SpaceRailSections } from '@/components/spaces/space-rail-sections'
import type { ActivityTarget } from '@/components/spaces/activity-view'
import { SecondaryRailToggle } from '@/components/secondary-rail-toggle'
import { SecondaryRail } from '@/components/secondary-rail'
import { ServerSpaceNavigation } from '@/components/spaces-sidebar-section'
import { useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

/** Stable space/people navigation. Space contents live in the top strip. */
export function SpaceRail({ org, spaceId, onOpenSpace, onOpenActivity, onOpenMessage, active = true, open, onTogglePin }: {
    org: OrgWithSpaces
    spaceId: string
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenActivity?: (orgId: string) => void
    onOpenMessage?: (target: ActivityTarget) => void
    active?: boolean
    open: boolean
    onTogglePin: () => void
}) {
    const unread = useSpacesUnreadCounts()
    const hasUnread = [...unread].some(([key, badge]) => key.startsWith(`${org.id}/`) && badge.unread > 0)
    return <SecondaryRail edgeDot={hasUnread} open={open} onTogglePin={onTogglePin} widthStorageKey="spaces:railWidth">
        {({ togglePin }) => <SpaceRailSections orgId={org.id} active={active} onOpenMessage={onOpenMessage} onOpenActivity={onOpenActivity}>
            <div className="flex shrink-0 items-center gap-0.5 px-2 py-1">
                <span className="min-w-0 flex-1 px-1 text-[13px] font-semibold text-muted-foreground">Spaces</span>
                <SecondaryRailToggle open={open} onToggle={togglePin} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <ServerSpaceNavigation org={org} spaceId={spaceId} onOpenSpace={onOpenSpace}
                    showDiscussions={false} />
            </div>
        </SpaceRailSections>}
    </SecondaryRail>
}
