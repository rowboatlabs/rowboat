import { afterEach, describe, expect, it } from 'vitest'
import { sessionEmail } from './account'

// Who you are, for the account menu (2026-10-13): the email claim in the
// stored access token, read for display only.

const SESSION_KEY = 'rowboat.spaces.web.session.v1'
const b64url = (value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const store = (access: string) =>
    localStorage.setItem(SESSION_KEY, JSON.stringify({ issuer: 'https://issuer.test', clientId: 'c', tokens: { access, refresh: 'r', expiresAt: Date.now() + 60_000 } }))

describe('the signed-in email', () => {
    afterEach(() => localStorage.clear())

    it('is the access token’s email claim, non-ASCII included', () => {
        store(`h.${b64url({ email: 'zoë@rowboat.test' })}.s`)
        expect(sessionEmail()).toBe('zoë@rowboat.test')
    })

    it('is absent signed out, without the claim, or from a token that isn’t a JWT', () => {
        expect(sessionEmail()).toBeNull()
        store(`h.${b64url({ sub: 'x' })}.s`)
        expect(sessionEmail()).toBeNull()
        store('opaque-token')
        expect(sessionEmail()).toBeNull()
    })
})
