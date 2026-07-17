import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearModelOptionsCache, useModelOptions } from './use-model-options'

// Stub the preload surface: invoke routes by channel through a per-test
// handler map (same pattern as use-turn.test.tsx).
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  invoke: (channel: string, args: unknown) => {
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

function serveCatalog(providers: Array<{ id: string; models: Array<{ id: string; name?: string }> }>): void {
  handlers['models:list'] = async () => ({ providers })
}

function serveConfig(config: Record<string, unknown>): void {
  handlers['workspace:readFile'] = async () => ({ data: JSON.stringify(config) })
}

beforeEach(() => {
  handlers = {}
  clearModelOptionsCache()
})

describe('useModelOptions', () => {
  it('merges the gateway catalog with configured BYOK providers and dedupes', async () => {
    serveCatalog([
      { id: 'rowboat', models: [{ id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash' }] },
      { id: 'openai', models: [{ id: 'gpt-5.4' }] },
    ])
    serveConfig({
      providers: {
        openai: { apiKey: 'sk-x', model: 'gpt-5.4' }, // model dupes the catalog entry
        anthropic: { apiKey: '', baseURL: '' }, // unconfigured — skipped
      },
    })

    const { result } = renderHook(() => useModelOptions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.options).toEqual([
      { provider: 'rowboat', model: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { provider: 'openai', model: 'gpt-5.4', label: 'gpt-5.4' },
    ])
  })

  it('excludes the gateway group when includeGateway is false', async () => {
    serveCatalog([
      { id: 'rowboat', models: [{ id: 'google/gemini-3.5-flash' }] },
    ])
    serveConfig({
      providers: { ollama: { baseURL: 'http://localhost:11434', models: ['llama3'] } },
    })

    const { result } = renderHook(() => useModelOptions({ includeGateway: false }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.options).toEqual([
      { provider: 'ollama', model: 'llama3', label: 'llama3' },
    ])
  })

  it('uses hand-entered provider models when the catalog has none', async () => {
    serveCatalog([])
    serveConfig({
      providers: {
        'openai-compatible': { baseURL: 'http://localhost:1234/v1', model: 'local-a', models: ['local-a', 'local-b'] },
      },
    })

    const { result } = renderHook(() => useModelOptions({ includeGateway: false }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.options.map((o) => o.model)).toEqual(['local-a', 'local-b'])
  })

  it('survives an offline catalog and a missing config file', async () => {
    // No handlers registered at all: both IPC calls reject.
    const { result } = renderHook(() => useModelOptions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.options).toEqual([])
  })

  it('serves cached options instantly on remount (no loading flash)', async () => {
    serveCatalog([{ id: 'rowboat', models: [{ id: 'google/gemini-3.5-flash' }] }])
    serveConfig({})
    const first = renderHook(() => useModelOptions())
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    first.unmount()

    const second = renderHook(() => useModelOptions())
    // Cached options render synchronously; the refresh happens silently.
    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.options.map((o) => o.model)).toEqual(['google/gemini-3.5-flash'])
  })

  it('does not load while disabled', async () => {
    serveCatalog([{ id: 'rowboat', models: [{ id: 'm' }] }])
    serveConfig({})
    const { result } = renderHook(() => useModelOptions({ enabled: false }))
    expect(result.current.loading).toBe(true)
    expect(result.current.options).toEqual([])
  })
})
