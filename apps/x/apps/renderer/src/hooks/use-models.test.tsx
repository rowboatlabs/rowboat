import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetModelsForTests, useModels } from './use-models'

// The hook wires a module-level store to window.ipc, so the tests stub the
// preload surface: `invoke` routes by channel through a per-test handler map
// and counts calls per channel to observe the store's fetch dedupe; `on`
// captures listeners so tests can fire main-process broadcasts.
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}
let invokeCounts: Record<string, number> = {}
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
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

function serveConfig(providers: Record<string, unknown>): void {
  handlers['oauth:getState'] = async () => ({ config: { rowboat: { connected: false } } })
  handlers['llm:getDefaultModel'] = async () => ({ provider: 'openai', model: 'gpt-5.4' })
  handlers['models:list'] = async () => ({
    providers: [
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5.4', reasoning: true }, { id: 'gpt-5.4-mini' }] },
    ],
  })
  handlers['workspace:readFile'] = async () => ({
    data: JSON.stringify({ provider: { flavor: 'openai' }, model: 'gpt-5.4', providers }),
  })
}

beforeEach(() => {
  __resetModelsForTests()
  handlers = {}
  invokeCounts = {}
  ipcListeners = {}
})

describe('useModels', () => {
  it('shares one fetch across concurrently mounted consumers', async () => {
    serveConfig({ openai: { apiKey: 'sk-test', model: 'gpt-5.4' } })

    const first = renderHook(() => useModels())
    const second = renderHook(() => useModels())

    await waitFor(() => expect(first.result.current.groups.length).toBeGreaterThan(0))
    await waitFor(() => expect(second.result.current.groups.length).toBeGreaterThan(0))

    expect(invokeCounts['models:list']).toBe(1)
    expect(invokeCounts['workspace:readFile']).toBe(1)
    expect(first.result.current.groups).toEqual([
      { kind: 'catalog', flavor: 'openai', models: ['gpt-5.4', 'gpt-5.4-mini'] },
    ])
    expect(first.result.current.reasoningByKey).toEqual({ 'openai/gpt-5.4': true })
    expect(first.result.current.defaultModel).toEqual({ provider: 'openai', model: 'gpt-5.4' })
    // Raw catalog is exposed for provider-scoped pickers (unconfigured
    // providers have no group but may have a catalog).
    expect(first.result.current.catalogByProvider).toEqual({ openai: ['gpt-5.4', 'gpt-5.4-mini'] })
    // Both consumers see the same store snapshot, not copies.
    expect(second.result.current.groups).toBe(first.result.current.groups)
  })

  it('serves the cache to late mounts without refetching', async () => {
    serveConfig({ openai: { apiKey: 'sk-test', model: 'gpt-5.4' } })

    const first = renderHook(() => useModels())
    await waitFor(() => expect(first.result.current.groups.length).toBeGreaterThan(0))

    const late = renderHook(() => useModels())
    // Loaded synchronously from the module cache — no loading flash, no IPC.
    expect(late.result.current.groups.length).toBeGreaterThan(0)
    expect(invokeCounts['models:list']).toBe(1)
  })

  it('sign-out via the oauth:didConnect broadcast flips isRowboatConnected and drops the rowboat group', async () => {
    // Signed in: gateway catalog present.
    handlers['oauth:getState'] = async () => ({ config: { rowboat: { connected: true } } })
    handlers['llm:getDefaultModel'] = async () => ({ provider: 'rowboat', model: 'claude-opus-4-8' })
    handlers['models:list'] = async () => ({
      providers: [{ id: 'rowboat', name: 'Rowboat', models: [{ id: 'claude-opus-4-8' }] }],
    })
    handlers['workspace:readFile'] = async () => ({
      data: JSON.stringify({ provider: { flavor: 'openai' }, model: 'gpt-5.4', providers: {} }),
    })

    const { result } = renderHook(() => useModels())
    await waitFor(() => expect(result.current.isRowboatConnected).toBe(true))
    expect(result.current.groups).toEqual([{ kind: 'catalog', flavor: 'rowboat', models: ['claude-opus-4-8'] }])

    // Sign out: main broadcasts oauth:didConnect with success:false
    // (disconnectProvider's emitOAuthEvent) — same channel as connect.
    handlers['oauth:getState'] = async () => ({ config: { rowboat: { connected: false } } })
    handlers['llm:getDefaultModel'] = async () => ({ provider: 'openai', model: 'gpt-5.4' })
    handlers['models:list'] = async () => ({
      providers: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5.4' }] }],
    })
    act(() => {
      for (const listener of ipcListeners['oauth:didConnect'] ?? []) {
        listener({ provider: 'rowboat', success: false })
      }
    })

    await waitFor(() => expect(result.current.isRowboatConnected).toBe(false))
    expect(result.current.groups.some((g) => g.flavor === 'rowboat')).toBe(false)
  })

  it('refetches on models-config-changed and updates every consumer', async () => {
    serveConfig({ openai: { apiKey: 'sk-test', model: 'gpt-5.4' } })

    const { result } = renderHook(() => useModels())
    await waitFor(() => expect(result.current.groups.length).toBe(1))

    serveConfig({
      openai: { apiKey: 'sk-test', model: 'gpt-5.4' },
      ollama: { baseURL: 'http://localhost:11434' },
    })
    // The settings Save path: models:updateConfig lands first, then the
    // event fires — the refetch must see the new default (this is what
    // moves a fresh composer tab's trigger label without a restart).
    handlers['llm:getDefaultModel'] = async () => ({ provider: 'ollama', model: 'llama3' })
    act(() => {
      window.dispatchEvent(new Event('models-config-changed'))
    })

    await waitFor(() => expect(result.current.groups.length).toBe(2))
    expect(result.current.groups[1]).toEqual({
      kind: 'live', flavor: 'ollama', apiKey: '', baseURL: 'http://localhost:11434', savedModel: '',
    })
    expect(result.current.defaultModel).toEqual({ provider: 'ollama', model: 'llama3' })
    expect(invokeCounts['models:list']).toBe(2)
  })
})
