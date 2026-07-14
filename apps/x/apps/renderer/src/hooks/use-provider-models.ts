import { useCallback, useEffect, useRef, useState } from "react"

// Flavors the live model-list fetch (models:listForProvider) supports.
// "rowboat" (the signed-in gateway) is deliberately absent — its catalog
// comes from models:list, and core throws on the flavor.
export type ProviderModelsFlavor =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "aigateway"
  | "ollama"
  | "openai-compatible"

export type ProviderModelsStatus = "idle" | "loading" | "loaded" | "error"

export interface UseProviderModelsResult {
  /** idle = credentials are insufficient to attempt a fetch. */
  status: ProviderModelsStatus
  models: string[]
  error: string | null
  /** Bypass the cache and fetch now (key-field blur / Retry). No-op while idle. */
  refetch: () => void
}

const AIGATEWAY_DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1"
// The automatic fetch fires only once the credential inputs stop changing —
// never per keystroke, which would spray partial API keys at the provider.
const FETCH_DEBOUNCE_MS = 600

// Module-level so provider switches and dialog reopens don't refetch.
// Successful results only, keyed on `${flavor}|${apiKey}|${baseURL}`.
const listCache = new Map<string, string[]>()
// De-dupes concurrent requests for the same key (debounce firing + field blur).
const inFlight = new Map<string, Promise<string[]>>()

function credentialsSufficient(flavor: ProviderModelsFlavor, apiKey: string, baseURL: string): boolean {
  if (flavor === "ollama" || flavor === "openai-compatible") return baseURL.length > 0
  return apiKey.length > 0
}

function fetchProviderModels(
  cacheKey: string,
  provider: { flavor: ProviderModelsFlavor; apiKey?: string; baseURL?: string },
): Promise<string[]> {
  const pending = inFlight.get(cacheKey)
  if (pending) return pending
  const request = window.ipc
    .invoke("models:listForProvider", { provider })
    .then((result) => {
      if (!result.success) throw new Error(result.error || "Failed to list models")
      const models = result.models ?? []
      listCache.set(cacheKey, models)
      return models
    })
    .finally(() => {
      inFlight.delete(cacheKey)
    })
  inFlight.set(cacheKey, request)
  return request
}

export function useProviderModels(input: {
  flavor: ProviderModelsFlavor
  apiKey: string
  baseURL: string
}): UseProviderModelsResult {
  const { flavor } = input
  const apiKey = input.apiKey.trim()
  const baseURL = input.baseURL.trim() || (flavor === "aigateway" ? AIGATEWAY_DEFAULT_BASE_URL : "")
  const cacheKey = `${flavor}|${apiKey}|${baseURL}`
  const sufficient = credentialsSufficient(flavor, apiKey, baseURL)

  const [state, setState] = useState<{
    key: string
    status: ProviderModelsStatus
    models: string[]
    error: string | null
  }>({ key: "", status: "idle", models: [], error: null })
  // Bumped whenever the inputs change (and on unmount) so completions of
  // superseded fetches never write state.
  const epochRef = useRef(0)

  const startFetch = useCallback(() => {
    const epoch = ++epochRef.current
    setState({ key: cacheKey, status: "loading", models: [], error: null })
    fetchProviderModels(cacheKey, {
      flavor,
      apiKey: apiKey || undefined,
      baseURL: baseURL || undefined,
    })
      .then((models) => {
        if (epochRef.current !== epoch) return
        setState({ key: cacheKey, status: "loaded", models, error: null })
      })
      .catch((err: unknown) => {
        if (epochRef.current !== epoch) return
        const message = err instanceof Error ? err.message : "Failed to list models"
        setState({ key: cacheKey, status: "error", models: [], error: message })
      })
  }, [cacheKey, flavor, apiKey, baseURL])

  useEffect(() => {
    epochRef.current++
    if (!sufficient) {
      setState({ key: cacheKey, status: "idle", models: [], error: null })
      return
    }
    const cached = listCache.get(cacheKey)
    if (cached) {
      setState({ key: cacheKey, status: "loaded", models: cached, error: null })
      return
    }
    setState({ key: cacheKey, status: "loading", models: [], error: null })
    const timer = setTimeout(() => {
      // A blur-triggered refetch may have already filled the cache while the
      // debounce was pending — don't fetch the same key twice.
      const nowCached = listCache.get(cacheKey)
      if (nowCached) {
        setState({ key: cacheKey, status: "loaded", models: nowCached, error: null })
        return
      }
      startFetch()
    }, FETCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [cacheKey, sufficient, startFetch])

  useEffect(() => () => {
    epochRef.current++
  }, [])

  const refetch = useCallback(() => {
    if (!sufficient) return
    listCache.delete(cacheKey)
    startFetch()
  }, [sufficient, cacheKey, startFetch])

  // State lags the inputs by one render (the effect above reconciles), so
  // derive the answer for the *current* inputs — a provider switch must never
  // flash the previous provider's list.
  if (state.key !== cacheKey) {
    const cached = sufficient ? listCache.get(cacheKey) : undefined
    if (cached) return { status: "loaded", models: cached, error: null, refetch }
    return { status: sufficient ? "loading" : "idle", models: [], error: null, refetch }
  }
  return { status: state.status, models: state.models, error: state.error, refetch }
}
