import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetRowboatConfigForTests, fetchRowboatConfig, useRowboatConfig } from './use-rowboat-config'

// Same preload stub pattern as use-models.test.tsx: invoke routes by channel
// through a per-test handler map, with per-channel call counts to observe the
// store's fetch dedupe.
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}
let invokeCounts: Record<string, number> = {}

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  invoke: (channel: string, args: unknown) => {
    invokeCounts[channel] = (invokeCounts[channel] ?? 0) + 1
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

const CONFIG = {
  appUrl: 'https://app.example.com',
  websocketApiUrl: 'https://ws.example.com',
  supabaseUrl: 'https://supabase.example.com',
  billing: { plans: [] },
  modelRecommendations: { openai: 'gpt-5.4' },
}

beforeEach(() => {
  __resetRowboatConfigForTests()
  handlers = {}
  invokeCounts = {}
})

describe('useRowboatConfig', () => {
  it('serves every consumer from one shared fetch', async () => {
    handlers['rowboat:getConfig'] = async () => CONFIG

    const first = renderHook(() => useRowboatConfig())
    const second = renderHook(() => useRowboatConfig())

    await waitFor(() => expect(first.result.current?.appUrl).toBe('https://app.example.com'))
    await waitFor(() => expect(second.result.current?.modelRecommendations).toEqual({ openai: 'gpt-5.4' }))
    expect(invokeCounts['rowboat:getConfig']).toBe(1)

    // Imperative reads share the same cache — no extra IPC.
    await expect(fetchRowboatConfig()).resolves.toEqual(CONFIG)
    expect(invokeCounts['rowboat:getConfig']).toBe(1)
  })

  it('retries after an unreachable API instead of caching null forever', async () => {
    handlers['rowboat:getConfig'] = async () => null

    await expect(fetchRowboatConfig()).resolves.toBeNull()
    handlers['rowboat:getConfig'] = async () => CONFIG
    await expect(fetchRowboatConfig()).resolves.toEqual(CONFIG)
    expect(invokeCounts['rowboat:getConfig']).toBe(2)
  })

  it('returns null while loading and to consumers when the fetch rejects', async () => {
    handlers['rowboat:getConfig'] = async () => {
      throw new Error('ipc down')
    }
    const { result } = renderHook(() => useRowboatConfig())
    expect(result.current).toBeNull()
    await expect(fetchRowboatConfig()).resolves.toBeNull()
    expect(result.current).toBeNull()
  })
})
