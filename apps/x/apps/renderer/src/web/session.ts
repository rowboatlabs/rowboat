import type { SpacesSessionCookie } from '@x/spaces-client'
import { getAccessToken } from './account'
import { APEX_URL, DEV_HARBOR, DEV_MEMBER } from './config'

// This tab's Harbor session (CONTRACT.md: createSession, 2026-10-12). The web
// app calls every face on Harbor's cookie rather than a bearer, so a blob
// loads as a plain <img> and the live socket carries no token in its URL.
// The apex mints the cookie for the whole deployment (a dev Harbor, for
// itself) from the current access token. It's minted again whenever that
// token changes, and when a call is refused.

const SESSION_HOST = DEV_HARBOR ?? APEX_URL

/** The token the cookie holds, as far as this tab knows. Unknown on load, so the first call mints. */
let minted: string | null = null
let inflight: Promise<void> | null = null

async function mint(token: string): Promise<void> {
    const res = await fetch(`${SESSION_HOST}/v1/session`, {
        method: 'POST',
        credentials: 'include',
        headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Could not start your session (${res.status}).`)
    minted = token
}

export const harborSession: SpacesSessionCookie = {
    session: 'cookie',
    async ensure(opts) {
        const token = DEV_HARBOR ? `dev-${DEV_MEMBER}` : await getAccessToken(opts)
        let again = opts?.forceRefresh === true
        while (again || minted !== token) {
            again = false
            if (inflight) {
                await inflight
                continue
            }
            inflight = mint(token).finally(() => { inflight = null })
            await inflight
        }
    },
}
