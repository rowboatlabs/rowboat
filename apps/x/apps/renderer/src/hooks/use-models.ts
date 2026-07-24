import { useMemo, useSyncExternalStore } from 'react'

export interface ModelRef {
  provider: string
  model: string
}

// One picker group per connected provider, straight from the unified model
// catalog (models:list → core/models/catalog.ts). Every provider — Rowboat
// gateway, ChatGPT subscription (codex), BYOK keys, local endpoints — comes
// through the same pipeline with a resolved list and a status; there is no
// renderer-side fetching or per-flavor special casing.
export interface ModelPickerGroup {
  /** Provider instance id — what ModelRef.provider joins on. */
  id: string
  /** Provider type ("openai", "ollama", "rowboat", …) — display naming. */
  flavor: string
  models: string[]
  /** 'error' = provider is connected but its model list failed to load. */
  status: 'ok' | 'error'
  error?: string
}

export interface ModelsSnapshot {
  groups: ModelPickerGroup[]
  // Per-model reasoning capability ("provider/model" → flag) from the
  // catalog. Ids without metadata miss → treated as non-reasoning.
  reasoningByKey: Record<string, boolean>
  // The effective runtime default (what a run actually uses when the user
  // hasn't picked a model) — shown in pickers instead of guessing from list
  // order, which can disagree with the real default.
  defaultModel: ModelRef | null
  isRowboatConnected: boolean
  // Raw catalog model ids per provider id, unpinned — for provider-scoped
  // pickers that need a provider's list without group ordering applied.
  catalogByProvider: Record<string, string[]>
}

export interface UseModelsResult extends ModelsSnapshot {
  /**
   * Force a refetch now (e.g. a composer tab becoming active). With a
   * provider id, that provider's cached list is dropped and refetched
   * (the error-row Retry).
   */
  refresh: (providerId?: string) => void
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

async function buildSnapshot(refreshProvider?: string): Promise<ModelsSnapshot> {
  const catalog = await window.ipc.invoke(
    'models:list',
    refreshProvider ? { refreshProvider } : null,
  )

  const defaultModel: ModelRef | null = catalog.defaultModel
  const reasoningByKey: Record<string, boolean> = {}
  const catalogByProvider: Record<string, string[]> = {}
  const groups: ModelPickerGroup[] = []

  for (const p of catalog.providers) {
    const ids = p.models.map((m) => m.id)
    catalogByProvider[p.id] = ids
    for (const m of p.models) {
      if (typeof m.reasoning === 'boolean') {
        reasoningByKey[`${p.id}/${m.id}`] = m.reasoning
      }
    }
    groups.push({
      id: p.id,
      flavor: p.flavor,
      models: ids,
      status: p.status,
      ...(p.error ? { error: p.error } : {}),
    })
  }

  // The effective default leads the picker: its group first and, within the
  // group, the model itself first.
  if (defaultModel) {
    const index = groups.findIndex((g) => g.id === defaultModel.provider)
    if (index >= 0) {
      const [group] = groups.splice(index, 1)
      groups.unshift(group)
      const mi = group.models.indexOf(defaultModel.model)
      if (mi > 0) {
        group.models.splice(mi, 1)
        group.models.unshift(defaultModel.model)
      }
    }
  }

  return {
    groups,
    reasoningByKey,
    defaultModel,
    isRowboatConnected: catalog.providers.some((p) => p.id === 'rowboat'),
    catalogByProvider,
  }
}

function startFetch(refreshProvider?: string): void {
  // Concurrent fetches race (an event can fire while one is in flight) —
  // only the newest run may write the snapshot, else a slow stale run can
  // clobber the fresh list.
  const seq = ++fetchSeq
  fetching = true
  void buildSnapshot(refreshProvider)
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

function refreshModels(providerId?: string): void {
  startFetch(typeof providerId === 'string' ? providerId : undefined)
}

function ensureLoaded(): void {
  if (!loaded && !fetching) startFetch()
}

function wireGlobalEvents(): void {
  if (wired) return
  wired = true
  // Event payloads must not leak into startFetch's refreshProvider arg.
  const refetch = () => startFetch()
  // Config edits anywhere in the app (settings dialog, composer pick,
  // onboarding) announce themselves on this window event.
  window.addEventListener('models-config-changed', refetch)
  wiredCleanups = [
    () => window.removeEventListener('models-config-changed', refetch),
    // Rowboat sign-in/out swaps the provider set. Despite the name, main
    // broadcasts this channel on every OAuth state change — including
    // disconnect (disconnectProvider emits { provider, success: false }).
    window.ipc.on('oauth:didConnect', refetch),
    // ChatGPT subscription models appear/disappear with the ChatGPT session.
    window.ipc.on('chatgpt:statusChanged', refetch),
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
