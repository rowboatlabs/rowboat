import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { suggestedSpaceName, useCompletionSpace } from './completion-space'

vi.mock('@/lib/analytics', () => ({ spacesServerCreated: vi.fn() }))
vi.mock('@/hooks/use-spaces', () => ({ refreshSpacesOrgs: vi.fn(async () => {}) }))
const invoke = vi.fn()
const token = (claims: object) => `header.${btoa(JSON.stringify(claims))}.signature`

beforeEach(() => {
  invoke.mockReset()
  Object.assign(window, { ipc: { invoke } })
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'spaces:listOrgs') return { orgs: [] }
    if (channel === 'account:getRowboat') return { signedIn: true, accessToken: token({ name: 'Arjun Kumar' }) }
    if (channel === 'spaces:createOrg') return { org: { id: 'new' } }
    throw new Error(`Unexpected channel ${channel}`)
  })
})

describe('completion spaces', () => {
  it('suggests a personal name, then email, with a fallback for opaque tokens', () => {
    expect(suggestedSpaceName(token({ name: 'Arjun Kumar', email: 'other@example.com' }))).toBe("Arjun's space")
    expect(suggestedSpaceName(token({ email: 'arjun.kumar@example.com' }))).toBe("Arjun's space")
    expect(suggestedSpaceName('opaque')).toBe('My space')
  })

  it('creates the edited space once before finishing and guards double clicks', async () => {
    const done = vi.fn()
    const { result } = renderHook(() => useCompletionSpace(true))
    await waitFor(() => expect(result.current.needed).toBe(true))
    act(() => result.current.setName(' Team space '))
    await act(async () => {
      await Promise.all([result.current.complete(done), result.current.complete(done)])
    })
    expect(invoke).toHaveBeenCalledWith('spaces:createOrg', { name: 'Team space' })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:createOrg')).toHaveLength(1)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('does not create a space for existing members or BYOK', async () => {
    invoke.mockImplementation(async (channel: string) => channel === 'spaces:listOrgs'
      ? { orgs: [{ id: 'existing' }] }
      : { signedIn: true, accessToken: null })
    const existing = renderHook(() => useCompletionSpace(true))
    await waitFor(() => expect(existing.result.current.loading).toBe(false))
    expect(existing.result.current.needed).toBe(false)
    await act(async () => { await existing.result.current.complete(vi.fn()) })
    const byok = renderHook(() => useCompletionSpace(false))
    await act(async () => { await byok.result.current.complete(vi.fn()) })
    expect(invoke.mock.calls.some(([channel]) => channel === 'spaces:createOrg')).toBe(false)
  })

  it('keeps onboarding open after creation fails and allows retry', async () => {
    const done = vi.fn()
    const { result } = renderHook(() => useCompletionSpace(true))
    await waitFor(() => expect(result.current.needed).toBe(true))
    invoke.mockImplementationOnce(async () => ({ orgs: [] }))
    invoke.mockRejectedValueOnce(new Error('Offline'))
    await act(async () => { await result.current.complete(done) })
    expect(done).not.toHaveBeenCalled()
    expect(result.current.error).toContain('Could not create')
    await act(async () => { await result.current.complete(done) })
    expect(done).toHaveBeenCalledTimes(1)
  })
})
