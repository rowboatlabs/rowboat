import { useMemo, useSyncExternalStore } from 'react'
import type { ProviderModelsFlavor } from './use-provider-models'

export interface ModelRef {
  provider: string
  model: string
}

// One picker group per connected provider. Catalog groups carry a resolved
// model list (models:list / saved config); live groups carry credentials and
// fetch their list from the provider inside the dropdown via
// useProviderModels (models:listForProvider).
export type ModelPickerGroup =
  | { kind: 'catalog'; flavor: string; models: string[] }
  | { kind: 'live'; flavor: ProviderModelsFlavor; apiKey: string; baseURL: string; savedModel: string }

const LIVE_PICKER_FLAVORS = new Set<string>(['openrouter', 'aigateway', 'ollama', 'openai-compatible'])
// Catalog-preferred flavors that degrade to a live fetch when models:list has
// no catalog for them (signed-in mode returns only the rowboat provider, or
// the models.dev cache is empty).
const LIVE_FALLBACK_FLAVORS = new Set<string>(['openai', 'anthropic', 'google'])

export interface ModelsSnapshot {
  groups: ModelPickerGroup[]
  // Per-model reasoning capability ("provider/model" → flag) from models:list.
  // Live-fetched ids carry no reasoning metadata, so lookups miss → treated
  // as non-reasoning.
  reasoningByKey: Record<string, boolean>
  // The effective runtime default (what a run actually uses when the user
  // hasn't picked a model) — shown in pickers instead of guessing from list
  // order, which can disagree with the real default.
  defaultModel: ModelRef | null
  isRowboatConnected: boolean
  // Raw models:list catalog per provider id. Groups only cover providers
  // configured in models.json; provider-scoped pickers fall back to this so
  // a provider mid-setup (key typed, not saved) still lists its catalog.
  catalogByProvider: Record<string, string[]>
}

export interface UseModelsResult extends ModelsSnapshot {
  /** Force a refetch now (e.g. a composer tab becoming active). */
  refresh: () => void
}

const EMPTY_SNAPSHOT: ModelsSnapshot = {
  groups: [],
  reasoningByKey: {},
  defaultModel: null,
  isRowboatConnected: false,
  catalogByProvider: {},
}

// Module-level store: every mounted consumer shares one snapshot and one
// in-flight fetch, so N pickers on screen never fan out into N identical
// IPC round-trips.
let snapshot: ModelsSnapshot = EMPTY_SNAPSHOT
let loaded = false
let fetching = false
let fetchSeq = 0
let wired = false
let wiredCleanups: Array<() => void> = []
const subscribers = new Set<() => void>()

// Hybrid mode: signed-in users get the gateway list AND every BYOK provider
// configured in models.json (selecting a BYOK model routes that message
// through the user's own key / local server). Signed-out users get BYOK only.
async function buildSnapshot(): Promise<ModelsSnapshot> {
  let isRowboatConnected = false
  try {
    const state = await window.ipc.invoke('oauth:getState', null)
    isRowboatConnected = state.config?.rowboat?.connected ?? false
  } catch { /* treat as signed out */ }

  let defaultModel: ModelRef | null = null
  try {
    const def = await window.ipc.invoke('llm:getDefaultModel', null)
    defaultModel = { provider: def.provider, model: def.model }
  } catch { /* no default resolvable */ }

  const groups: ModelPickerGroup[] = []
  const reasoningByKey: Record<string, boolean> = {}

  // Full catalog per provider (gateway + models.dev cloud providers).
  const catalog: Record<string, string[]> = {}
  try {
    const listResult = await window.ipc.invoke('models:list', null)
    for (const p of listResult.providers || []) {
      catalog[p.id] = (p.models || []).map((m: { id: string }) => m.id)
      for (const m of p.models || []) {
        if (typeof m.reasoning === 'boolean') {
          reasoningByKey[`${p.id}/${m.id}`] = m.reasoning
        }
      }
    }
  } catch { /* offline / no catalog — groups fall back to saved config below */ }

  if (isRowboatConnected && (catalog['rowboat'] || []).length > 0) {
    groups.push({ kind: 'catalog', flavor: 'rowboat', models: catalog['rowboat'] })
  }

  // ChatGPT subscription (codex): models:list only carries this catalog
  // while signed in with ChatGPT, so presence is the gate.
  if ((catalog['codex'] || []).length > 0) {
    groups.push({ kind: 'catalog', flavor: 'codex', models: catalog['codex'] })
  }

  try {
    const result = await window.ipc.invoke('workspace:readFile', { path: 'config/models.json' })
    const parsed = JSON.parse(result.data)

    // List the default provider's group first.
    const defaultFlavor = typeof parsed?.provider?.flavor === 'string' ? parsed.provider.flavor : ''
    const flavors = Object.keys(parsed?.providers || {})
      .sort((a, b) => (a === defaultFlavor ? -1 : b === defaultFlavor ? 1 : 0))

    for (const flavor of flavors) {
      const e = (parsed.providers[flavor] || {}) as Record<string, unknown>
      const apiKey = typeof e.apiKey === 'string' ? e.apiKey.trim() : ''
      const baseURL = typeof e.baseURL === 'string' ? e.baseURL.trim() : ''
      if (!apiKey && !baseURL) continue // provider not configured
      const savedModel = typeof e.model === 'string' ? e.model : ''

      // Live flavors fetch their list from the provider inside the
      // dropdown, with the credentials saved in config. Catalog flavors
      // degrade to the same live fetch when models:list carried no
      // catalog for them (signed in, or empty models.dev cache).
      const catalogModels = catalog[flavor] || []
      if (LIVE_PICKER_FLAVORS.has(flavor) || (catalogModels.length === 0 && LIVE_FALLBACK_FLAVORS.has(flavor))) {
        groups.push({ kind: 'live', flavor: flavor as ProviderModelsFlavor, apiKey, baseURL, savedModel })
        continue
      }

      // Catalog group: the saved default model leads, then the catalog.
      // Saved models[] survives as the fallback for unknown flavors the
      // live fetch doesn't support.
      const models: string[] = []
      const push = (model: string) => {
        if (model && !models.includes(model)) models.push(model)
      }
      push(savedModel)
      if (catalogModels.length > 0) {
        for (const m of catalogModels) push(m)
      } else {
        const saved = Array.isArray(e.models) ? e.models as string[] : []
        for (const m of saved) push(m)
      }
      groups.push({ kind: 'catalog', flavor, models })
    }

    // The user's explicit default selection leads the picker: its group
    // first and, within a catalog group, the model itself first. (Live
    // groups pin the default at the top themselves.)
    const sel = parsed?.defaultSelection
    if (sel && typeof sel.provider === 'string' && typeof sel.model === 'string') {
      const index = groups.findIndex((g) => g.flavor === sel.provider)
      if (index >= 0) {
        const [group] = groups.splice(index, 1)
        groups.unshift(group)
        if (group.kind === 'catalog') {
          const mi = group.models.indexOf(sel.model)
          if (mi > 0) {
            group.models.splice(mi, 1)
            group.models.unshift(sel.model)
          }
        }
      }
    }
  } catch { /* no BYOK config yet */ }

  return { groups, reasoningByKey, defaultModel, isRowboatConnected, catalogByProvider: catalog }
}

function startFetch(): void {
  // Concurrent fetches race (an event can fire while one is in flight) —
  // only the newest run may write the snapshot, else a slow stale run can
  // clobber the fresh list.
  const seq = ++fetchSeq
  fetching = true
  void buildSnapshot()
    .then((next) => {
      if (seq !== fetchSeq) return
      snapshot = next
      loaded = true
      for (const notify of subscribers) notify()
    })
    .catch((err) => {
      // No config yet — but surface unexpected failures for diagnosis.
      console.error('[use-models] failed to load model list', err)
    })
    .finally(() => {
      if (seq === fetchSeq) fetching = false
    })
}

function refreshModels(): void {
  startFetch()
}

function ensureLoaded(): void {
  if (!loaded && !fetching) startFetch()
}

function wireGlobalEvents(): void {
  if (wired) return
  wired = true
  // Config edits anywhere in the app (settings dialog, composer pick,
  // onboarding) announce themselves on this window event.
  window.addEventListener('models-config-changed', refreshModels)
  wiredCleanups = [
    () => window.removeEventListener('models-config-changed', refreshModels),
    // Rowboat sign-in/out swaps the whole hybrid list. Despite the name,
    // main broadcasts this channel on every OAuth state change — including
    // disconnect (disconnectProvider emits { provider, success: false }).
    window.ipc.on('oauth:didConnect', refreshModels),
    // ChatGPT subscription models appear/disappear with the ChatGPT session.
    window.ipc.on('chatgpt:statusChanged', refreshModels),
  ]
}

function subscribe(onStoreChange: () => void): () => void {
  wireGlobalEvents()
  subscribers.add(onStoreChange)
  ensureLoaded()
  return () => {
    subscribers.delete(onStoreChange)
  }
}

function getSnapshot(): ModelsSnapshot {
  return snapshot
}

export function useModels(): UseModelsResult {
  const data = useSyncExternalStore(subscribe, getSnapshot)
  return useMemo(() => ({ ...data, refresh: refreshModels }), [data])
}

// Test-only: drop the shared cache and event wiring so each test starts from
// a cold store (the seq bump also invalidates any in-flight fetch).
export function __resetModelsForTests(): void {
  snapshot = EMPTY_SNAPSHOT
  loaded = false
  fetching = false
  fetchSeq++
  subscribers.clear()
  for (const cleanup of wiredCleanups) cleanup()
  wiredCleanups = []
  wired = false
}
