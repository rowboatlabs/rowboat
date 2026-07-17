import { useCallback, useEffect, useState } from 'react'

// The single loading concern for "which models can the user pick?": the
// gateway catalog (models:list) merged with the BYOK providers configured
// in models.json. Every model-selector surface renders from this hook's
// output — components stay pure renderers (see ModelSelect).

export interface ModelOption {
  provider: string
  model: string
  label: string
  // models.dev "supports reasoning/extended thinking" flag; absent = unknown.
  reasoning?: boolean
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
  release_date?: string
  reasoning?: boolean
}

export interface CatalogProvider {
  id: string
  name: string
  models: CatalogModel[]
}

// Stale-while-revalidate caches: a reopened surface renders the last data
// instantly (no spinner flash) while a background reload picks up any
// config/catalog changes.
const optionsCache = new Map<string, ModelOption[]>()
let catalogCache: CatalogProvider[] | null = null

export function clearModelOptionsCache(): void {
  optionsCache.clear()
  catalogCache = null
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
  const cacheKey = includeGateway ? 'with-gateway' : 'no-gateway'
  const cached = optionsCache.get(cacheKey)
  const [options, setOptions] = useState<ModelOption[]>(cached ?? [])
  const [loading, setLoading] = useState(cached === undefined)
  const [generation, setGeneration] = useState(0)

  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function load() {
      // Only block the UI when there's nothing to show yet; cached options
      // render immediately and this refresh lands silently.
      if (!optionsCache.has(cacheKey)) {
        setLoading(true)
      }
      const collected: ModelOption[] = []
      const seen = new Set<string>()
      const push = (provider: string, model: string, label?: string, reasoning?: boolean) => {
        if (!model) return
        const key = modelKey(provider, model)
        if (seen.has(key)) return
        seen.add(key)
        collected.push({
          provider,
          model,
          label: label || model,
          ...(typeof reasoning === 'boolean' ? { reasoning } : {}),
        })
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
        for (const m of catalog['rowboat'] || []) push('rowboat', m.id, m.name || m.id, m.reasoning)
      }

      let parsed: Record<string, unknown> = {}
      try {
        const configResult = await window.ipc.invoke('workspace:readFile', { path: 'config/models.json' })
        parsed = JSON.parse(configResult.data)
      } catch {
        // No BYOK config yet.
      }

      // The default provider leads the BYOK section so its models surface
      // first (mirrors the chat composer's historical ordering).
      const providersMap = (parsed.providers ?? {}) as Record<string, Record<string, unknown>>
      const defaultFlavor = ((parsed.provider as Record<string, unknown> | undefined)?.flavor ?? '') as string
      const flavors = Object.keys(providersMap)
        .sort((a, b) => (a === defaultFlavor ? -1 : b === defaultFlavor ? 1 : 0))
      for (const flavor of flavors) {
        const entry = providersMap[flavor]
        const hasKey = typeof entry.apiKey === 'string' && (entry.apiKey as string).trim().length > 0
        const hasBaseURL = typeof entry.baseURL === 'string' && (entry.baseURL as string).trim().length > 0
        if (!hasKey && !hasBaseURL) continue
        // The provider's saved default model leads, then the rest of its
        // catalog; local providers with no catalog fall back to the saved
        // models list.
        push(flavor, typeof entry.model === 'string' ? entry.model : '')
        const catalogModels = catalog[flavor] || []
        if (catalogModels.length > 0) {
          for (const m of catalogModels) push(flavor, m.id, m.name || m.id, m.reasoning)
        } else {
          for (const m of Array.isArray(entry.models) ? (entry.models as string[]) : []) push(flavor, m)
        }
      }

      // The user's explicit default selection leads the whole list.
      const sel = parsed.defaultSelection as { provider?: unknown; model?: unknown } | undefined
      if (sel && typeof sel.provider === 'string' && typeof sel.model === 'string') {
        const index = collected.findIndex(
          (o) => o.provider === sel.provider && o.model === sel.model,
        )
        if (index > 0) {
          const [entry] = collected.splice(index, 1)
          collected.unshift(entry)
        }
      }

      optionsCache.set(cacheKey, collected)
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
  }, [enabled, includeGateway, generation, cacheKey])

  return { options, loading, reload }
}

// The raw models.dev/gateway catalog, unfiltered by what the user has
// configured — for surfaces that CONFIGURE providers (onboarding, BYOK
// settings) or pick from the full catalog (app templates), as opposed to
// picking among the user's usable models (useModelOptions).
export function useModelsCatalog({ enabled = true }: { enabled?: boolean } = {}): {
  providers: CatalogProvider[]
  byId: Record<string, CatalogModel[]>
  loading: boolean
} {
  const [providers, setProviders] = useState<CatalogProvider[]>(catalogCache ?? [])
  const [loading, setLoading] = useState(catalogCache === null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    async function load() {
      if (catalogCache === null) {
        setLoading(true)
      }
      let result: CatalogProvider[] = []
      try {
        const listResult = await window.ipc.invoke('models:list', null)
        result = (listResult.providers || []).map((p) => ({
          id: p.id,
          name: p.name,
          models: p.models || [],
        }))
      } catch {
        // Offline — keep whatever we had.
        result = catalogCache ?? []
      }
      catalogCache = result
      if (!cancelled) {
        setProviders(result)
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [enabled])

  const byId: Record<string, CatalogModel[]> = {}
  for (const p of providers) {
    byId[p.id] = p.models
  }
  return { providers, byId, loading }
}
