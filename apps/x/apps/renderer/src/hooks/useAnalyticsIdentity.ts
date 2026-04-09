import { useEffect } from 'react'
import posthog from 'posthog-js'

/**
 * Identifies the user in PostHog when signed into Rowboat,
 * and sets user properties for connected OAuth providers.
 * Call once at the App level.
 */
export function useAnalyticsIdentity() {
  // On mount: check current OAuth state and identify if signed in
  useEffect(() => {
    async function init() {
      try {
        const result = await window.ipc.invoke('oauth:getState', null)
        const config = result.config || {}

        // Identify if Rowboat account is connected
        const rowboat = config.rowboat
        if (rowboat?.connected && rowboat?.userId) {
          posthog.identify(rowboat.userId)
        }

        // Set provider connection flags
        const providers = ['gmail', 'calendar', 'slack', 'rowboat']
        const props: Record<string, boolean> = { signed_in: !!rowboat?.connected }
        for (const p of providers) {
          props[`${p}_connected`] = !!config[p]?.connected
        }
        posthog.people.set(props)

        // Count notes for total_notes property
        try {
          const entries = await window.ipc.invoke('workspace:readdir', { path: '' })
          let totalNotes = 0
          if (entries) {
            for (const entry of entries) {
              if (entry.kind === 'dir') {
                try {
                  const sub = await window.ipc.invoke('workspace:readdir', { path: `${entry.name}` })
                  totalNotes += sub?.length ?? 0
                } catch {
                  // skip inaccessible dirs
                }
              }
            }
          }
          posthog.people.set({ total_notes: totalNotes })
        } catch {
          // workspace may not be available
        }
      } catch {
        // oauth state unavailable
      }
    }
    init()
  }, [])

  // Listen for OAuth connect/disconnect events to update identity
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (!event.success) return

      // If Rowboat provider connected, identify user
      if (event.provider === 'rowboat' && event.userId) {
        posthog.identify(event.userId)
        posthog.people.set({ signed_in: true })
      }

      posthog.people.set({ [`${event.provider}_connected`]: true })
    })

    return cleanup
  }, [])
}
