import { parseSpacesLink, type SpacesLinkTarget } from '@/lib/spaces-navigation'

// The web app's door for shared links (2026-10-13). Harbor's page for a link
// opened in a browser offers "open this link in your browser" as
// <web app>/open?<the deep link's query>, the same query rowboat://open hands
// the desktop, so one parser reads both and spaces-link-open.ts resolves it.
// The link waits in sessionStorage until the tab can open it: a sign-in is a
// full-page trip, and the link has to survive it.

export const OPEN_PATH = '/open'
const PENDING_KEY = 'rowboat.spaces.web.link.v1'

/** On /open: keep the link for later and leave the address bar at the root. */
export function captureOpenLink(): void {
    if (window.location.pathname !== OPEN_PATH) return
    if (parseSpacesLink(`rowboat://open${window.location.search}`)) sessionStorage.setItem(PENDING_KEY, window.location.search)
    window.history.replaceState(null, '', '/')
}

/**
 * The link waiting to be opened, taken once. Signed out, only an invite is
 * taken (its card shows before any sign-in); anything else waits for one.
 */
export function takeOpenLink(signedIn: boolean): SpacesLinkTarget | null {
    const search = sessionStorage.getItem(PENDING_KEY)
    const target = search ? parseSpacesLink(`rowboat://open${search}`) : null
    if (!target || (!signedIn && !target.inviteToken)) return null
    sessionStorage.removeItem(PENDING_KEY)
    return target
}

/** The web app's own address for an invite, which a sign-in started from the join dialog returns to. */
export function inviteOpenPath(orgAddress: string, token: string): string {
    return `${OPEN_PATH}?${new URLSearchParams({ type: 'spaces', org: orgAddress, invite: token })}`
}
