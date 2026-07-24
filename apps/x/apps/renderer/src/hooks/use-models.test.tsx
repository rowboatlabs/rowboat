import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetModelsForTests, useModels } from './use-models'

// The hook wires a module-level store to window.ipc, so the tests stub the
// preload surface: `invoke` routes by channel through a per-test handler map
// and counts calls per channel to observe the store's fetch dedupe; `on`
// captures listeners so tests can fire main-process broadcasts.
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}
let invokeCounts: Record<string, number> = {}
let invokeArgs: Record<string, unknown[]> = {}
let ipcListeners: Record<string, Array<(payload: unknown) => void>> = {}

;(window as unknown as { ipc: unknown }).ipc = {
  on: (channel: string, handler: (payload: unknown) => void) => {
    ;(ipcListeners[channel] ??= []).push(handler)
    return () => {
      ipcListeners[channel] = (ipcListeners[channel] ?? []).filter((h) => h !== handler)
    }
  },
  invoke: (channel: string, args: unknown) => {
    invokeCounts[channel] = (invokeCounts[channel] ?? 0) + 1
    ;(invokeArgs[channel] ??= []).push(args)
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

// One catalog response serves the whole snapshot — the unified pipeline's
// single IPC call.
function serveCatalog(catalog: {
  providers: Array<{
    id: string
    flavor?: string
    status?: 'ok' | 'error'
    error?: string
    models: Array<{ id: string; reasoning?: boolean }>
  }>
  defaultModel: { provider: string; model: string } | null
}): void {
  handlers['models:list'] = async () => ({
    providers: catalog.providers.map((p) => ({
      flavor: p.id, // one instance per flavor today: id === flavor key
      status: 'ok' as const,
      ...p,
    })),
    defaultModel: catalog.defaultModel,
  })
}

beforeEach(() => {
  __resetModelsForTests()
  handlers = {}
  invokeCounts = {}
  invokeArgs = {}
  ipcListeners = {}
})

describe('useModels', () => {
  it('shares one fetch across concurrently mounted consumers', async () => {
    serveCatalog({
      providers: [
        { id: 'openai', models: [{ id: 'gpt-5.4', reasoning: true }, { id: 'gpt-5.4-mini' }] },
      ],
      defaultModel: { provider: 'openai', model: 'gpt-5.4' },
    })

    const first = renderHook(() => useModels())
    const second = renderHook(() => useModels())

    await waitFor(() => expect(first.result.current.groups.length).toBeGreaterThan(0))
    await waitFor(() => expect(second.result.current.groups.length).toBeGreaterThan(0))

    expect(invokeCounts['models:list']).toBe(1)
    expect(first.result.current.groups).toEqual([
      { id: 'openai', flavor: 'openai', models: ['gpt-5.4', 'gpt-5.4-mini'], status: 'ok' },
    ])
    expect(first.result.current.reasoningByKey).toEqual({ 'openai/gpt-5.4': true })
    expect(first.result.current.defaultModel).toEqual({ provider: 'openai', model: 'gpt-5.4' })
    // Raw catalog is exposed for provider-scoped pickers.
    expect(first.result.current.catalogByProvider).toEqual({ openai: ['gpt-5.4', 'gpt-5.4-mini'] })
    // Both consumers see the same store snapshot, not copies.
    expect(second.result.current.groups).toBe(first.result.current.groups)
  })

  it('serves the cache to late mounts without refetching', async () => {
    serveCatalog({
      providers: [{ id: 'openai', models: [{ id: 'gpt-5.4' }] }],
      defaultModel: { provider: 'openai', model: 'gpt-5.4' },
    })

    const first = renderHook(() => useModels())
    await waitFor(() => expect(first.result.current.groups.length).toBeGreaterThan(0))

    const late = renderHook(() => useModels())
    // Loaded synchronously from the module cache — no loading flash, no IPC.
    expect(late.result.current.groups.length).toBeGreaterThan(0)
    expect(invokeCounts['models:list']).toBe(1)
  })

  it('orders the default group and model first and passes error status through', async () => {
    serveCatalog({
      providers: [
        { id: 'ollama', status: 'error', error: 'connection refused', models: [] },
        { id: 'openai', models: [{ id: 'gpt-4.1' }, { id: 'gpt-5.4' }] },
      ],
      defaultModel: { provider: 'openai', model: 'gpt-5.4' },
    })

    const { result } = renderHook(() => useModels())
    await waitFor(() => expect(result.current.groups.length).toBe(2))

    // The default's group leads (despite arriving second) and the default
    // model leads within it.
    expect(result.current.groups[0]).toEqual({
      id: 'openai', flavor: 'openai', models: ['gpt-5.4', 'gpt-4.1'], status: 'ok',
    })
    // A failed provider keeps its group, with the error travelling along
    // (ModelSelector renders it as an inline error row + Retry).
    expect(result.current.groups[1]).toEqual({
      id: 'ollama', flavor: 'ollama', models: [], status: 'error', error: 'connection refused',
    })
  })

  it('sign-out via the oauth:didConnect broadcast flips isRowboatConnected and drops the rowboat group', async () => {
    serveCatalog({
      providers: [{ id: 'rowboat', models: [{ id: 'claude-opus-4-8' }] }],
      defaultModel: { provider: 'rowboat', model: 'claude-opus-4-8' },
    })

    const { result } = renderHook(() => useModels())
    await waitFor(() => expect(result.current.isRowboatConnected).toBe(true))
    expect(result.current.groups).toEqual([
      { id: 'rowboat', flavor: 'rowboat', models: ['claude-opus-4-8'], status: 'ok' },
    ])

    // Sign out: main broadcasts oauth:didConnect with success:false
    // (disconnectProvider's emitOAuthEvent) — same channel as connect.
    serveCatalog({
      providers: [{ id: 'openai', models: [{ id: 'gpt-5.4' }] }],
      defaultModel: { provider: 'openai', model: 'gpt-5.4' },
    })
    act(() => {
      for (const listener of ipcListeners['oauth:didConnect'] ?? []) {
        listener({ provider: 'rowboat', success: false })
      }
    })

    await waitFor(() => expect(result.current.isRowboatConnected).toBe(false))
    expect(result.current.groups.some((g) => g.id === 'rowboat')).toBe(false)
  })

  it('refetches on models-config-changed and updates every consumer', async () => {
    serveCatalog({
      providers: [{ id: 'openai', models: [{ id: 'gpt-5.4' }] }],
      defaultModel: { provider: 'openai', model: 'gpt-5.4' },
    })

    const { result } = renderHook(() => useModels())
    await waitFor(() => expect(result.current.groups.length).toBe(1))

    // The settings Save path: the config write lands first, then the event
    // fires — the refetch must see the new provider set and default (this is
    // what moves a fresh composer tab's trigger label without a restart).
    serveCatalog({
      providers: [
        { id: 'openai', models: [{ id: 'gpt-5.4' }] },
        { id: 'ollama', models: [{ id: 'llama3' }] },
      ],
      defaultModel: { provider: 'ollama', model: 'llama3' },
    })
    act(() => {
      window.dispatchEvent(new Event('models-config-changed'))
    })

    await waitFor(() => expect(result.current.groups.length).toBe(2))
    expect(result.current.defaultModel).toEqual({ provider: 'ollama', model: 'llama3' })
    expect(invokeCounts['models:list']).toBe(2)
    // Event-driven refetches are plain rebuilds, not forced provider
    // refreshes — the Event object must never leak in as a provider id.
    expect(invokeArgs['models:list']).toEqual([null, null])
  })

  it('refresh(providerId) asks main to drop that provider\'s cached list', async () => {
    serveCatalog({
      providers: [{ id: 'ollama', status: 'error', error: 'down', models: [] }],
      defaultModel: null,
    })

    const { result } = renderHook(() => useModels())
    await waitFor(() => expect(result.current.groups.length).toBe(1))

    act(() => result.current.refresh('ollama'))
    await waitFor(() => expect(invokeCounts['models:list']).toBe(2))
    expect(invokeArgs['models:list'][1]).toEqual({ refreshProvider: 'ollama' })
  })
})
