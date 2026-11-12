import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// PostHog in the web app (2026-11-11): events tagged `platform: 'web'`, the
// person identified by the access token's `sub`, and nothing at all without a key.

const posthog = vi.hoisted(() => {
    const state: Record<string, unknown> = {}
    return {
        state,
        init: vi.fn(),
        register: vi.fn(),
        identify: vi.fn((id: string) => { state.distinctId = id; state.userState = 'identified' }),
        capture: vi.fn(),
        reset: vi.fn(() => { state.distinctId = 'anon'; state.userState = 'anonymous' }),
        get_distinct_id: vi.fn(() => state.distinctId),
        get_property: vi.fn((key: string) => (key === '$user_state' ? state.userState : undefined)),
        people: { set: vi.fn(), set_once: vi.fn() },
    }
})
vi.mock('posthog-js', () => ({ default: posthog }))

const SESSION_KEY = 'rowboat.spaces.web.session.v1'
const b64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const signIn = (claims: Record<string, unknown>) =>
    localStorage.setItem(SESSION_KEY, JSON.stringify({ issuer: 'https://issuer.test', clientId: 'c', tokens: { access: `h.${b64url(claims)}.s`, refresh: 'r', expiresAt: Date.now() + 60_000 } }))

async function load(key: string | undefined) {
    vi.resetModules()
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', key ?? '')
    return import('./analytics')
}

describe('web analytics', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        posthog.state.distinctId = 'anon'
        posthog.state.userState = 'anonymous'
    })
    afterEach(() => {
        localStorage.clear()
        vi.unstubAllEnvs()
    })

    it('does nothing without a key', async () => {
        const { startAnalytics, analyticsSignedOut } = await load(undefined)
        startAnalytics({ signedInNow: true })
        analyticsSignedOut()
        expect(posthog.init).not.toHaveBeenCalled()
        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('tags events as web, loads no external script, and identifies by sub', async () => {
        signIn({ sub: 'user-uuid', email: 'a@rowboat.test' })
        const { startAnalytics } = await load('phc_test')
        startAnalytics({ signedInNow: true })
        expect(posthog.init).toHaveBeenCalledWith('phc_test', expect.objectContaining({ disable_external_dependency_loading: true }))
        expect(posthog.register).toHaveBeenCalledWith(expect.objectContaining({ platform: 'web' }))
        // The desktop's person properties are left alone.
        expect(posthog.people.set).not.toHaveBeenCalledWith(expect.objectContaining({ platform: 'web' }))
        expect(posthog.people.set_once).toHaveBeenCalledWith({ has_used_web: true })
        expect(posthog.identify).toHaveBeenCalledWith('user-uuid', { email: 'a@rowboat.test' })
        expect(posthog.capture).toHaveBeenCalledWith('user_signed_in')
    })

    it('does not re-identify or count a sign-in on an ordinary load', async () => {
        signIn({ sub: 'user-uuid' })
        posthog.state.distinctId = 'user-uuid'
        const { startAnalytics } = await load('phc_test')
        startAnalytics({ signedInNow: false })
        expect(posthog.identify).not.toHaveBeenCalled()
        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('forgets the last person when the session ended elsewhere', async () => {
        posthog.state.userState = 'identified'
        const { startAnalytics } = await load('phc_test')
        startAnalytics({ signedInNow: false })
        expect(posthog.reset).toHaveBeenCalled()
    })

    it('says sign-out by beacon, then resets', async () => {
        signIn({ sub: 'user-uuid' })
        const { startAnalytics, analyticsSignedOut } = await load('phc_test')
        startAnalytics({ signedInNow: false })
        analyticsSignedOut()
        expect(posthog.capture).toHaveBeenCalledWith('user_signed_out', {}, { transport: 'sendBeacon' })
        expect(posthog.reset).toHaveBeenCalled()
    })
})
