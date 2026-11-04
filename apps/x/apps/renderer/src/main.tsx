import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PostHogProvider } from 'posthog-js/react'
import posthog, { type CaptureResult, type PostHog } from 'posthog-js'
import { ThemeProvider } from '@/contexts/theme-context'
import { configureAnalyticsContext } from './lib/analytics'
import { MeetingDetectedPopup } from '@/components/meeting-detected-popup'
import { QuickAskBar } from '@/components/quick-ask-bar'
import { ScreenPointerOverlay } from '@/components/screen-pointer-overlay'

// React's development build records a performance.measure entry (with a
// serialized `detail`) for every component render — its DevTools
// "Components ⚛" track — and never clears them. Chromium keeps user-timing
// entries until told otherwise, ~1 KB each, so a dev window left open for
// hours accumulates millions of entries until Blink's allocator gives up and
// the renderer dies (blank window, `render-process-gone` exitCode=5). Clear
// the buffer periodically: the Performance panel still shows React's tracks,
// since those are emitted as trace events at call time, not read back from
// this buffer. Production React has no performance tracks, so this is dev-only.
if (import.meta.env.DEV) {
  setInterval(() => {
    performance.clearMeasures()
    performance.clearMarks()
  }, 10_000)
}

// Fetch the stable installation ID from main so renderer + main share one
// PostHog distinct_id. Falls back to PostHog's auto-generated anonymous ID
// if the IPC call fails (rare — main is always up before renderer).
async function bootstrap() {
  let installationId: string | undefined
  let apiUrl: string | undefined
  let appVersion: string | undefined
  let analyticsEnabled = false
  try {
    const result = await window.ipc.invoke('analytics:bootstrap', null)
    installationId = result.installationId
    apiUrl = result.apiUrl
    appVersion = result.appVersion
    analyticsEnabled = result.analyticsEnabled !== false && !result.telemetryOptOut
  } catch (err) {
    console.error('[Analytics] Failed to bootstrap from main:', err)
  }

  configureAnalyticsContext({ apiUrl, appVersion })

  const options = {
    api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
    defaults: '2025-11-30' as const,
    // The user's Settings → Advanced choice; honoured before any event fires.
    opt_out_capturing_by_default: !analyticsEnabled,
    ...(installationId ? { bootstrap: { distinctID: installationId } } : {}),
    before_send: (event: CaptureResult | null) => {
      // 2026-10-16 (#1202): live SDK consent allows opt-in without a restart.
      if (posthog.has_opted_out_capturing()) return null
      if (!event) return event
      if (appVersion) {
        event.properties = {
          ...event.properties,
          app_version: appVersion,
        }
      }
      return event
    },
    loaded: (client: Pick<PostHog, 'opt_in_capturing' | 'opt_out_capturing'>) => {
      // 2026-10-15 (#415): the shared setting overrides stale SDK consent.
      if (analyticsEnabled) client.opt_in_capturing({ captureEventName: false })
      else client.opt_out_capturing()
      configureAnalyticsContext({ apiUrl, appVersion })
    },
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={options}>
        <ThemeProvider defaultTheme="system">
          <App />
        </ThemeProvider>
      </PostHogProvider>
    </StrictMode>,
  )

  // The loaded callback applies api_url/app_version once PostHog has initialized.
}

// Utility windows load the same bundle with a hash route and render only
// their own UI — no analytics or app bootstrap needed.
if (window.location.hash === '#meeting-detected') {
  // "Meeting detected — Take Notes?" popup window; same pattern.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MeetingDetectedPopup />
    </StrictMode>,
  )
} else if (window.location.hash === '#quick-ask') {
  // The hover companion (global ⌥⇧Space); same pattern.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QuickAskBar />
    </StrictMode>,
  )
} else if (window.location.hash === '#screen-pointer') {
  // Assistant's pointer over the shared screen; same pattern.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ScreenPointerOverlay />
    </StrictMode>,
  )
} else {
  bootstrap()
}
