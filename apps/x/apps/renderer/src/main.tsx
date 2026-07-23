import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PostHogProvider } from 'posthog-js/react'
import type { CaptureResult } from 'posthog-js'
import { ThemeProvider } from '@/contexts/theme-context'
import { configureAnalyticsContext } from './lib/analytics'
import { VideoPopout } from '@/components/video-popout'
import { MeetingDetectedPopup } from '@/components/meeting-detected-popup'

// Fetch the stable installation ID from main so renderer + main share one
// PostHog distinct_id. Falls back to PostHog's auto-generated anonymous ID
// if the IPC call fails (rare — main is always up before renderer).
async function bootstrap() {
  let installationId: string | undefined
  let apiUrl: string | undefined
  let appVersion: string | undefined
  try {
    const result = await window.ipc.invoke('analytics:bootstrap', null)
    installationId = result.installationId
    apiUrl = result.apiUrl
    appVersion = result.appVersion
  } catch (err) {
    console.error('[Analytics] Failed to bootstrap from main:', err)
  }

  configureAnalyticsContext({ apiUrl, appVersion })

  const options = {
    api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
    defaults: '2025-11-30' as const,
    ...(installationId ? { bootstrap: { distinctID: installationId } } : {}),
    before_send: (event: CaptureResult | null) => {
      if (!event) return event
      if (appVersion) {
        event.properties = {
          ...event.properties,
          app_version: appVersion,
        }
      }
      return event
    },
    loaded: () => {
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

// The video-mode popout window loads the same bundle with a hash route and
// renders only the mini-call UI — no analytics or app bootstrap needed.
if (window.location.hash === '#video-popout') {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <VideoPopout />
    </StrictMode>,
  )
} else if (window.location.hash === '#meeting-detected') {
  // "Meeting detected — Take Notes?" popup window; same pattern.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MeetingDetectedPopup />
    </StrictMode>,
  )
} else {
  bootstrap()
}
