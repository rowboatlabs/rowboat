import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaaraliOnboarding } from './index'
import { STORAGE_KEY } from './model'

// BAARALI(04/10/2026): the onboarding validated by the founder: sign-in,
// the space prepared, the profile, the tools, a first request.

vi.mock('@/components/settings/mobile-channels-settings', () => ({ MobileChannelsSettings: () => <div>Phone pairing</div> }))

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub

let store: Map<string, string>
let calls: Array<[string, unknown]>
let state: { signedIn: boolean; mode: 'child' | 'remote'; notes: string }

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  calls = []
  state = { signedIn: false, mode: 'child', notes: 'Prefers short answers.' }
  ;(window as unknown as { ipc: unknown }).ipc = {
    on: () => () => undefined,
    invoke: async (channel: string, args: unknown) => {
      calls.push([channel, args])
      switch (channel) {
        case 'oauth:getState': return { config: { rowboat: { connected: state.signedIn }, google: { connected: false } } }
        case 'server:getConnection': return { mode: state.mode, url: null, fromEnv: false }
        case 'oauth:list-providers': return { providers: ['google', 'microsoft'] }
        case 'oauth:connect': return { success: true }
        case 'workspace:readFile': return { data: state.notes }
        case 'workspace:writeFile': return {}
        default: throw new Error(`no handler: ${channel}`)
      }
    },
  }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('BaaraliOnboarding', () => {
  it('welcomes and opens the sign-in, for a new account or an existing one', async () => {
    render(<BaaraliOnboarding open onComplete={() => {}} />)
    expect(screen.getByText('Welcome to Baarali')).toBeTruthy()
    fireEvent.click(screen.getByText('I already have an account'))
    await waitFor(() => expect(calls.some(([c, a]) => c === 'oauth:connect' && (a as { provider: string }).provider === 'rowboat')).toBe(true))
    expect(JSON.parse(store.get(STORAGE_KEY)!).returning).toBe(true)
    expect(screen.getByText('Sign in in the window that opened. Closed it? Click again.')).toBeTruthy()
  })

  it('picks up where it was after the reload that joins the instance', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ step: 1, profile: {}, spaceSince: Date.now() }))
    state = { ...state, signedIn: true, mode: 'remote' }
    render(<BaaraliOnboarding open onComplete={() => {}} />)
    await waitFor(() => expect(screen.getByText('Your space is ready')).toBeTruthy())
    fireEvent.click(screen.getByText('Continue'))
    expect(screen.getByText('Let’s get to know each other')).toBeTruthy()
  })

  it('keeps what the person says about themselves, and hands their first request to the composer', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ step: 2, profile: {}, spaceSince: 1 }))
    const onComplete = vi.fn()
    render(<BaaraliOnboarding open onComplete={onComplete} />)
    fireEvent.change(screen.getByLabelText('Your first name'), { target: { value: 'Awa' } })
    fireEvent.click(screen.getByText('Construction and crafts'))
    fireEvent.click(screen.getByText('Continue'))
    expect(screen.getByText('Notion')).toBeTruthy()
    fireEvent.click(screen.getByText('Later'))
    fireEvent.click(screen.getByText('Plan the week on site'))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ prompt: 'Help me plan the work of the week: who does what, and when.' }))
    const write = calls.find(([c]) => c === 'workspace:writeFile')![1] as { path: string; data: string }
    expect(write.path).toBe('knowledge/Agent Notes/user.md')
    expect(write.data).toContain('- First name: Awa')
    expect(write.data).toContain('Prefers short answers.')
    expect(store.has(STORAGE_KEY)).toBe(false)
  })

  it('lets someone who already had an account into the app once joined', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ step: 1, profile: {}, spaceSince: 1, returning: true }))
    state = { ...state, signedIn: true, mode: 'remote' }
    const onComplete = vi.fn()
    render(<BaaraliOnboarding open onComplete={onComplete} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith())
  })
})
