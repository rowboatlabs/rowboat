import { HarnessSettings } from '@x/shared/src/code-mode'
const key = (id: string) => `rowboat:harness:${id}`
export function readHarnessSettings(id?: string): HarnessSettings {
  try {
    if (id) {
      const parsed = HarnessSettings.safeParse(JSON.parse(localStorage.getItem(key(id)) ?? 'null'))
      if (parsed.success) return parsed.data
    }
  } catch { /* Storage unavailable or older settings. */ }
  return { enabled: false, agent: 'claude' }
}
export function saveHarnessSettings(id: string | undefined, value: HarnessSettings) {
  if (id) { try { localStorage.setItem(key(id), JSON.stringify(value)); window.dispatchEvent(new CustomEvent('harness-settings-changed', { detail: id })) } catch { /* Keep in-memory choice. */ } }
}

export function harnessComposition(value?: HarnessSettings): { harness?: Record<string, string | boolean> } {
  if (!value) return {}
  return { harness: { enabled: value.enabled, agent: value.agent,
    ...(value.model ? { model: value.model } : {}),
    ...(value.effort ? { effort: value.effort } : {}),
    ...(value.policy ? { policy: value.policy } : {}),
  } }
}
