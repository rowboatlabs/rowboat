import posthog from 'posthog-js'
import { configureAnalyticsContext, identifyUser, resetAnalyticsIdentity } from '@/lib/analytics'
import { sessionEmail, sessionSubject } from './account'
import { SERVER_URL } from './config'

// PostHog in the Spaces web app (2026-11-11; ANALYTICS.md, "Spaces web app").
// The Spaces components already call the typed wrappers in lib/analytics.ts;
// on the web they were no-ops because nothing initialized posthog-js. This
// initializes it with the desktop's build-time key, tags every event
// `platform: 'web'`, and identifies the person by their account id.
//
// The page's Content Security Policy allows no foreign script (vercel.json),
// so posthog-js loads none: no session recording, surveys, toolbar or
// remote-config scripts. Pageviews come from the History API, since the
// address bar is the navigation (routes.ts).

const env = import.meta.env as Record<string, string | undefined>
const KEY = env.VITE_PUBLIC_POSTHOG_KEY
const HOST = env.VITE_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

let started = false

/**
 * Start analytics for this page load. `signedInNow`: this load is the
 * sign-in callback, so the sign-in itself is an event. Without a key (local
 * dev, a build that was given none) every call stays a no-op.
 */
export function startAnalytics(opts: { signedInNow: boolean }): void {
    if (!KEY || started) return
    started = true
    posthog.init(KEY, {
        api_host: HOST,
        defaults: '2025-11-30',
        capture_pageview: 'history_change',
        respect_dnt: true,
        disable_session_recording: true,
        disable_surveys: true,
        disable_external_dependency_loading: true,
    })
    configureAnalyticsContext({ platform: 'web' })
    posthog.register({ spaces_server_url: SERVER_URL })

    const subject = sessionSubject()
    if (!subject) {
        // Signed out without the menu (the session ended at the sign-in
        // server): don't keep counting this browser as the last person.
        if (posthog.get_property('$user_state') === 'identified') resetAnalyticsIdentity()
        return
    }
    if (posthog.get_distinct_id() !== subject) {
        const email = sessionEmail()
        identifyUser(subject, email ? { email } : undefined)
    }
    if (opts.signedInNow) posthog.capture('user_signed_in')
}

/** Signing out: say so, then forget who this browser was. Call before the session is cleared. */
export function analyticsSignedOut(): void {
    if (!started) return
    // The page reloads straight after (app.tsx), so the event leaves by beacon.
    posthog.capture('user_signed_out', {}, { transport: 'sendBeacon' })
    resetAnalyticsIdentity()
}
