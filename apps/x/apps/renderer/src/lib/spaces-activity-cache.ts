import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// Kept across mounts (2026-10-21): the view unmounts whenever you open a
// channel, so coming back used to blank to "Loading…" and refetch every time.
// Each org keeps its last page per filter, plus the filter you left on. One
// feed listener per org marks the pages stale when something that could
// change them arrives, so a return paints instantly and only refetches —
// quietly — when it has to.
export type ActivityTab = 'all' | 'mentions' | 'dms' | 'replies' | 'reactions'
type OrgActivity = { pages: Map<string, spaces.SpacesActivityPage>; stale: Set<string>; tab: ActivityTab; unreadOnly: boolean }
const orgActivity = new Map<string, OrgActivity>()
export function activityFor(orgId: string): OrgActivity {
    let entry = orgActivity.get(orgId)
    if (entry) return entry
    const created: OrgActivity = { pages: new Map(), stale: new Set(), tab: 'all', unreadOnly: false }
    entry = created
    orgActivity.set(orgId, created)
    subscribeSpacesFeed((event) => {
        if (event.orgId !== orgId || !('frame' in event)) return
        if (affectsActivity(event.frame)) for (const key of created.pages.keys()) created.stale.add(key)
    })
    return created
}
export function affectsActivity(frame: Extract<spaces.SpacesBusEvent, { frame: unknown }>['frame']): boolean {
    return frame.kind === 'notify' || frame.kind === 'read_mark'
        || (frame.kind === 'event' && (frame.event.type === 'reaction' || frame.event.type === 'message_deleted' || frame.event.type === 'message_edited'))
}
/** Test seam: forget every org's cached pages. */
export function resetActivityCache() { orgActivity.clear() }
