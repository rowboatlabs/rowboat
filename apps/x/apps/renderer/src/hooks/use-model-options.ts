import { useCallback, useEffect, useState } from 'react'

// The single loading concern for "which models can the user pick?": the
// gateway catalog (models:list) merged with the BYOK providers configured
// in models.json. Every model-selector surface renders from this hook's
// output — components stay pure renderers (see ModelSelect).

export interface ModelOption {
  provider: string
  model: string
  label: string
}

export const MODEL_KEY_SEP = '::'

export const modelKey = (provider: string, model: string) =>
  `${provider}${MODEL_KEY_SEP}${model}`

export function parseModelKey(key: string): { provider: string; model: string } | null {
  const index = key.indexOf(MODEL_KEY_SEP)
  if (index <= 0) return null
  return { provider: key.slice(0, index), model: key.slice(index + MODEL_KEY_SEP.length) }
}

interface CatalogModel {
  id: string
  name?: string
}

export interface UseModelOptionsResult {
  options: ModelOption[]
  loading: boolean
  reload: () => void
}

export function useModelOptions({
  enabled = true,
  includeGateway = true,
}: {
  enabled?: boolean
  // The "rowboat" gateway group needs sign-in to be usable; signed-out
  // surfaces exclude it.
  includeGateway?: boolean
} = {}): UseModelOptionsResult {
  const [options, setOptions] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [generation, setGeneration] = useState(0)

  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const collected: ModelOption[] = []
      const seen = new Set<string>()
      const push = (provider: string, model: string, label?: string) => {
        if (!model) return
        const key = modelKey(provider, model)
        if (seen.has(key)) return
        seen.add(key)
        collected.push({ provider, model, label: label || model })
      }

      const catalog: Record<string, CatalogModel[]> = {}
      try {
        const listResult = await window.ipc.invoke('models:list', null)
        for (const p of listResult.providers || []) {
          catalog[p.id] = p.models || []
        }
      } catch {
        // Offline — configured BYOK entries below still load.
      }
      if (includeGateway) {
        for (const m of catalog['rowboat'] || []) push('rowboat', m.id, m.name || m.id)
      }

      let parsed: Record<string, unknown> = {}
      try {
        const configResult = await window.ipc.invoke('workspace:readFile', { path: 'config/models.json' })
        parsed = JSON.parse(configResult.data)
      } catch {
        // No BYOK config yet.
      }

      const providersMap = (parsed.providers ?? {}) as Record<string, Record<string, unknown>>
      for (const [flavor, entry] of Object.entries(providersMap)) {
        const hasKey = typeof entry.apiKey === 'string' && (entry.apiKey as string).trim().length > 0
        const hasBaseURL = typeof entry.baseURL === 'string' && (entry.baseURL as string).trim().length > 0
        if (!hasKey && !hasBaseURL) continue
        push(flavor, typeof entry.model === 'string' ? entry.model : '')
        const catalogModels = catalog[flavor] || []
        if (catalogModels.length > 0) {
          for (const m of catalogModels) push(flavor, m.id, m.name || m.id)
        } else {
          for (const m of Array.isArray(entry.models) ? (entry.models as string[]) : []) push(flavor, m)
        }
      }

      if (!cancelled) {
        setOptions(collected)
        setLoading(false)
      }
    }

    load()
    // Any surface saving model config dispatches this; all selectors refresh.
    const onChanged = () => load()
    window.addEventListener('models-config-changed', onChanged)
    return () => {
      cancelled = true
      window.removeEventListener('models-config-changed', onChanged)
    }
  }, [enabled, includeGateway, generation])

  return { options, loading, reload }
}
