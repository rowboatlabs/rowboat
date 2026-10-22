import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { SpacesView, type SpaceSelection } from '@/components/spaces-view'
import { ServerDialogs } from '@/components/spaces/server-dialogs'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { STREAM_READ_KEY } from '@/hooks/use-space-chat'
import { getSpacesOrgs, useSpacesOrgs } from '@/hooks/use-spaces'
import type { ActivityTarget } from '@/lib/spaces-activity'
import { openServerDialog } from '@/lib/server-dialog'
import { requestJump } from '@/lib/spaces-jump'
import { resolveSpacesLink, type SpacesPlace } from '@/lib/spaces-link-open'
import { serverLandingSpaceId, type OrgView } from '@/lib/spaces-navigation'
import { railForOpening, rememberRail } from '@/lib/spaces-rail-memory'
import { readRailSelection, type RailSelection } from '@/lib/spaces-selection'
import { noteSpaceVisit } from '@/lib/spaces-visits'
import { hasSession, onSessionChange } from './account'
import { WebRail } from './account-menu'
import { takeJoinClick, takeOpenLink } from './links'
import { startNotifications } from './notifications'
import { NotificationsPrompt } from './notifications-prompt'
import { orgKey } from './orgs'
import { parseRoute, routePath } from './routes'
import { SignedOut } from './signed-out'
import { useTabBadge } from './tab-badge'

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

/** `signInError`: why the sign-in this load returned from failed, said once the toaster is up. */
export function WebApp({ signInError }: { signInError: string | null }) {
    const [location, setLocation] = useState<Location>(current)
    const { orgs } = useSpacesOrgs()

    useEffect(() => {
        if (signInError) toast.error(signInError, { id: 'sign-in' })
    }, [signInError])

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

    const go = useCallback((orgId: string, target: { spaceId?: string; view?: OrgView; rail?: RailSelection }, replace = false) => {
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

    /** Open a place, landing on its message when it names one. */
    const land = useCallback((place: SpacesPlace, replace: boolean) => {
        go(place.orgId, place, replace)
        if (!place.messageId) return
        requestJump({
            topicId: place.rail?.kind === 'thread' ? place.rail.rootMessageId : STREAM_READ_KEY,
            messageId: place.messageId,
            ...(place.messageOffset !== undefined ? { offset: place.messageOffset } : {}),
        })
    }, [go])

    // A shared link opened in this tab (links.ts): resolved as the desktop
    // resolves its deep links, and opened in place of the root it arrived on.
    useEffect(() => {
        const target = takeOpenLink(hasSession())
        if (!target) return
        void resolveSpacesLink(target).then((outcome) => {
            switch (outcome.kind) {
                case 'invite':
                    // Back from the sign-in Join started: the card joins without a second click.
                    openServerDialog({ kind: 'join', inviteUrl: outcome.inviteUrl, ...(takeJoinClick(outcome.inviteUrl) ? { autoJoin: true } : {}) })
                    return
                case 'unknown-org':
                    toast.error(`This link is for ${outcome.orgAddress}, which isn't one of your servers.`)
                    return
                case 'refused':
                    toast.error(outcome.message)
                    if (outcome.place) land(outcome.place, true)
                    return
                case 'place':
                    land(outcome.place, true)
            }
        })
    }, [land])

    // The org's notifications while the tab isn't focused (notifications.ts);
    // a click opens the message in its thread.
    useEffect(() => startNotifications((orgId, frame) => land({
        orgId,
        spaceId: frame.spaceId,
        rail: frame.threadRootId ? { kind: 'thread', rootMessageId: frame.threadRootId } : { kind: 'general' },
        messageId: frame.messageId,
    }, false)), [land])
    useTabBadge()

    return (
        <TooltipProvider delayDuration={0}>
            {/* The space rail's rows are sidebar menu items; the desktop's shell provides this. */}
            <SidebarProvider className="rowboat-shell h-svh overflow-hidden">
                {/* Signed out, a sign-in page; a session ending reloads the tab (above). */}
                {hasSession() ? (
                    <>
                        <WebRail />
                        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                            <NotificationsPrompt />
                            <SpacesView
                                selection={selection}
                                onSelect={onSelect}
                                onSwitchSpace={(id, space, named) => go(id, { spaceId: space, rail: railForOpening(id, space, named) })}
                                railSelection={rail}
                                onRailSelect={(next) => { if (selection?.spaceId) go(selection.orgId, { spaceId: selection.spaceId, rail: next }) }}
                                onOpenMessage={onOpenMessage}
                                onOpenActivity={(id) => go(id, { view: 'activity' })}
                                onOpenBrowse={(id) => go(id, { view: 'browse' })}
                                onOpenAgents={(id) => go(id, { view: 'agents' })}
                            />
                        </div>
                    </>
                ) : (
                    <SignedOut />
                )}
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
