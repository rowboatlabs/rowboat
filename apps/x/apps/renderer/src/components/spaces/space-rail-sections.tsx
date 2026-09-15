import { useId, type ReactNode } from 'react'
import { ArrowUpRight, Bell, ChevronDown, ChevronUp } from 'lucide-react'
import { SecondaryRailDivider } from '@/components/secondary-rail-section'
import { RecentActivity } from '@/components/spaces/recent-activity'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { useSecondaryRailSections } from '@/hooks/use-secondary-rail-sections'
import { useSpacesUnreadCounts } from '@/hooks/use-space-chat'
import type { ActivityTarget } from '@/lib/spaces-activity'
import { cn } from '@/lib/utils'

/** Navigation and Activity share the rail, each with its own scroll area. */
export function SpaceRailSections({ orgId, active = true, activityActive = false, onOpenMessage, onOpenActivity, children }: {
    orgId: string
    active?: boolean
    activityActive?: boolean
    onOpenMessage?: (target: ActivityTarget) => void
    onOpenActivity?: (orgId: string) => void
    children: ReactNode
}) {
    const { bodyRef, bottomRef, topStyle, bottomStyle, bottomCollapsed, toggleBottom, dividerProps } = useSecondaryRailSections({
        collapsedKey: 'spaces:activityRailCollapsed', heightKey: 'spaces:activityHeight', bottomKey: 'activity',
    })
    const contentId = useId()
    const unread = useSpacesUnreadCounts()
    let forYou = 0
    for (const [key, badge] of unread) if (key.startsWith(`${orgId}/`)) forYou += badge.forYou
    return <div ref={bodyRef} className="spaces-navigation flex h-full min-h-0 flex-col">
        <div style={onOpenMessage ? topStyle : { flex: '1 1 0%' }} className="flex min-h-0 flex-col">
            {children}
        </div>
        {onOpenMessage && <section ref={bottomRef} style={bottomStyle} aria-label="Activity panel"
            className={cn('flex min-h-0 flex-col', bottomCollapsed && 'border-t border-border py-2')}>
            {!bottomCollapsed && <SecondaryRailDivider {...dividerProps} />}
            <div className={cn('flex shrink-0 items-center gap-1 px-2', bottomCollapsed ? 'h-6' : 'h-8')}>
                <button type="button" onClick={toggleBottom} aria-expanded={!bottomCollapsed} aria-controls={contentId}
                    title={bottomCollapsed ? 'Expand Activity' : 'Collapse Activity'}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 px-1 text-left text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                    <Bell className="size-3.5 shrink-0" />
                    <span className="flex-1">Activity</span>
                    {!activityActive && <UnreadBadge badge={{ unread: forYou, forYou }} />}
                    {bottomCollapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
                {onOpenActivity && <button type="button" onClick={() => onOpenActivity(orgId)} aria-label="Open Activity"
                    title="Open Activity" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <ArrowUpRight className="size-3.5" />
                </button>}
            </div>
            <div id={contentId} hidden={bottomCollapsed} className={cn('min-h-0 flex-1 overflow-y-auto px-2 pb-2', bottomCollapsed && 'hidden')}>
                <RecentActivity orgId={orgId} active={active && !bottomCollapsed} onOpenMessage={onOpenMessage} onOpenActivity={onOpenActivity} />
            </div>
        </section>}
    </div>
}
