import { parseInviteLink } from '@x/spaces-client'
import { parseSpacesLink, type SpacesLinkTarget } from '@/lib/spaces-navigation'

// The web app's door for shared links (2026-10-13). Harbor's page for a link
// opened in a browser offers "open this link in your browser" as
// <web app>/open?<the deep link's query>, the same query rowboat://open hands
// the desktop, so one parser reads both and spaces-link-open.ts resolves it.
// The link waits in sessionStorage until the tab can open it: a sign-in is a
// full-page trip, and the link has to survive it.

export const OPEN_PATH = '/open'
const PENDING_KEY = 'rowboat.spaces.web.link.v1'
const JOIN_KEY = 'rowboat.spaces.web.join.v1'

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

// Join, clicked while signed out, signs in first (2026-10-15). The click is
// kept for the trip, so the join finishes when the page comes back instead
// of asking again. Only this tab's own click sets it, never a link's query:
// a link that joined on its own would put anyone signed in into whatever
// space it named.
const inviteKey = (inviteUrl: string): string | null => {
    const parsed = parseInviteLink(inviteUrl)
    return parsed ? `${new URL(parsed.baseUrl).host} ${parsed.token}` : null
}

export function rememberJoinClick(inviteUrl: string): void {
    const key = inviteKey(inviteUrl)
    if (key) sessionStorage.setItem(JOIN_KEY, key)
}

/** A sign-in that failed takes its Join click with it. */
export function forgetJoinClick(): void {
    sessionStorage.removeItem(JOIN_KEY)
}

/** Whether Join was clicked on this invite before the sign-in; asked once. */
export function takeJoinClick(inviteUrl: string): boolean {
    const clicked = sessionStorage.getItem(JOIN_KEY)
    sessionStorage.removeItem(JOIN_KEY)
    return clicked !== null && clicked === inviteKey(inviteUrl)
}
