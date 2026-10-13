import { useCallback, useEffect, useMemo, useState } from 'react'
import { SpacesView, type SpaceSelection } from '@/components/spaces-view'
import { ServerDialogs } from '@/components/spaces/server-dialogs'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { STREAM_READ_KEY } from '@/hooks/use-space-chat'
import { getSpacesOrgs, useSpacesOrgs } from '@/hooks/use-spaces'
import type { ActivityTarget } from '@/lib/spaces-activity'
import { requestJump } from '@/lib/spaces-jump'
import { serverLandingSpaceId } from '@/lib/spaces-navigation'
import { railForOpening, rememberRail } from '@/lib/spaces-rail-memory'
import { readRailSelection, type RailSelection } from '@/lib/spaces-selection'
import { noteSpaceVisit } from '@/lib/spaces-visits'
import { onSessionChange } from './account'
import { orgKey } from './orgs'
import { parseRoute, routePath } from './routes'

// The web app's shell (2026-10-09): the desktop's Spaces section alone, with
// the address bar as its navigation. The desktop keeps the selection in
// App.tsx state and its own history; here the path is the selection, and
// pushState is the history. SpacesView and everything under it are the
// desktop's components, unchanged.

interface Location {
    path: string
    /** A previewed attachment's rail, which has no path of its own. */
    rail?: RailSelection
}

function current(): Location {
    const state = window.history.state as { rail?: unknown } | null
    return { path: window.location.pathname, ...(state?.rail ? { rail: readRailSelection(state.rail) } : {}) }
}

export function WebApp() {
    const [location, setLocation] = useState<Location>(current)
    const { orgs } = useSpacesOrgs()

    useEffect(() => {
        const onPop = () => setLocation(current())
        window.addEventListener('popstate', onPop)
        // A sign-in or sign-out in another tab changes everything this one shows.
        const offSession = onSessionChange(() => window.location.reload())
        // A tab left in the background, or a dropped network, leaves sockets half-open.
        const bounce = () => void window.ipc.invoke('spaces:bounceLive', null).catch(() => {})
        const onVisible = () => { if (document.visibilityState === 'visible') bounce() }
        window.addEventListener('online', bounce)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            window.removeEventListener('popstate', onPop)
            offSession()
            window.removeEventListener('online', bounce)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [])

    const route = useMemo(() => parseRoute(location.path), [location.path])
    const org = route.orgKey ? orgs.find((o) => orgKey(o) === route.orgKey) : undefined
    const selection: SpaceSelection = org
        ? { orgId: org.id, spaceId: route.spaceId ?? '', ...(route.view ? { view: route.view } : {}) }
        : null
    const rail = route.rail.kind === 'general' && location.rail?.kind === 'attachment' ? location.rail : route.rail

    const go = useCallback((orgId: string, target: { spaceId?: string; view?: 'activity' | 'browse'; rail?: RailSelection }, replace = false) => {
        const found = getSpacesOrgs().find((o) => o.id === orgId)
        if (!found) return
        const path = routePath(orgKey(found), target)
        const state = target.rail?.kind === 'attachment' ? { rail: target.rail } : null
        if (replace) window.history.replaceState(state, '', path)
        else window.history.pushState(state, '', path)
        setLocation(current())
    }, [])

    // A navigation is the visit the rail's working set remembers, and the
    // place the space is left in (App.tsx does the same on the desktop).
    const orgId = selection?.orgId
    const spaceId = selection?.spaceId
    useEffect(() => {
        if (!orgId || !spaceId) return
        noteSpaceVisit(orgId, spaceId)
        rememberRail(orgId, spaceId, rail)
    }, [orgId, spaceId, rail])

    const onSelect = useCallback((next: SpaceSelection) => {
        // The view correcting its own selection: not a navigation.
        if (!next) {
            window.history.replaceState(null, '', '/')
            setLocation(current())
            return
        }
        go(next.orgId, { spaceId: next.spaceId, ...(next.view ? { view: next.view } : {}) }, true)
    }, [go])

    const onOpenMessage = useCallback((target: ActivityTarget) => {
        go(target.orgId, { spaceId: target.spaceId, rail: target.rail })
        requestJump({
            topicId: target.rail.kind === 'thread' ? target.rail.rootMessageId : STREAM_READ_KEY,
            messageId: target.messageId,
        })
    }, [go])

    return (
        <TooltipProvider delayDuration={0}>
            {/* The space rail's rows are sidebar menu items; the desktop's shell provides this. */}
            <SidebarProvider className="rowboat-shell h-svh overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <SpacesView
                        selection={selection}
                        onSelect={onSelect}
                        onSwitchSpace={(id, space, named) => go(id, { spaceId: space, rail: railForOpening(id, space, named) })}
                        railSelection={rail}
                        onRailSelect={(next) => { if (selection?.spaceId) go(selection.orgId, { spaceId: selection.spaceId, rail: next }) }}
                        onOpenMessage={onOpenMessage}
                        onOpenActivity={(id) => go(id, { view: 'activity' })}
                        onOpenBrowse={(id) => go(id, { view: 'browse' })}
                    />
                </div>
            </SidebarProvider>
            <Toaster />
            <ServerDialogs
                onDone={(id, space) => {
                    const found = getSpacesOrgs().find((o) => o.id === id)
                    const landing = space ?? (found ? serverLandingSpaceId(found) : '')
                    go(id, landing ? { spaceId: landing } : {})
                }}
            />
        </TooltipProvider>
    )
}
