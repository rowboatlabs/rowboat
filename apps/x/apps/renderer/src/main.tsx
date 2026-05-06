import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { ThemeProvider } from '@/contexts/theme-context'

// Fetch the stable installation ID from main so renderer + main share one
// PostHog distinct_id. Falls back to PostHog's auto-generated anonymous ID
// if the IPC call fails (rare — main is always up before renderer).
async function bootstrap() {
  let installationId: string | undefined
  let apiUrl: string | undefined
  try {
    const result = await window.ipc.invoke('analytics:bootstrap', null)
    installationId = result.installationId
    apiUrl = result.apiUrl
  } catch (err) {
    console.error('[Analytics] Failed to bootstrap from main:', err)
  }

  const options = {
    api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
    defaults: '2025-11-30',
    ...(installationId ? { bootstrap: { distinctID: installationId } } : {}),
  } as const

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={options}>
        <ThemeProvider defaultTheme="system">
          <App />
        </ThemeProvider>
      </PostHogProvider>
    </StrictMode>,
  )

  // Tag the active person record with api_url so anonymous users are also
  // segmentable by environment.
  if (apiUrl) {
    posthog.people.set({ api_url: apiUrl })
  }
}

bootstrap()
