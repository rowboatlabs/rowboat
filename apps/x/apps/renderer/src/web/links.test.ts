import { afterEach, describe, expect, it } from 'vitest'
import { captureOpenLink, inviteOpenPath, takeOpenLink } from './links'

// The web app's door for shared links (2026-10-13): Harbor's page sends a
// browser to /open with the deep link's query, which waits out a sign-in.

describe('shared links in the web app', () => {
    const SPACE = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

    afterEach(() => {
        sessionStorage.clear()
        window.history.replaceState(null, '', '/')
    })

    it('are put aside on /open and the address bar goes back to the root', () => {
        window.history.replaceState(null, '', `/open?type=spaces&spaceId=${SPACE}&org=acme.spaces.test`)
        captureOpenLink()
        expect(window.location.pathname).toBe('/')
        expect(takeOpenLink(true)).toEqual({ orgAddress: 'acme.spaces.test', spaceId: SPACE })
        expect(takeOpenLink(true)).toBeNull()
    })

    it('wait for a sign-in, except an invite, whose card shows first', () => {
        window.history.replaceState(null, '', `/open?type=spaces&spaceId=${SPACE}&org=acme.spaces.test`)
        captureOpenLink()
        expect(takeOpenLink(false)).toBeNull()
        expect(takeOpenLink(true)).toMatchObject({ spaceId: SPACE })

        window.history.replaceState(null, '', inviteOpenPath('acme.spaces.test', 'tok'))
        captureOpenLink()
        expect(takeOpenLink(false)).toEqual({ orgAddress: 'acme.spaces.test', inviteToken: 'tok' })
    })

    it('ignore anything that is not a spaces link', () => {
        window.history.replaceState(null, '', '/open?type=chat&org=acme.spaces.test')
        captureOpenLink()
        expect(window.location.pathname).toBe('/')
        expect(takeOpenLink(true)).toBeNull()
        window.history.replaceState(null, '', `/acme/s/${SPACE}`)
        captureOpenLink()
        expect(window.location.pathname).toBe(`/acme/s/${SPACE}`)
    })
})
