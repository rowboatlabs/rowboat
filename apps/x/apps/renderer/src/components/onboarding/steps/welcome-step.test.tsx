import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingState } from '../use-onboarding-state'
import { WelcomeStep } from './welcome-step'

vi.mock('@/lib/analytics', () => ({ spacesServerCreated: vi.fn() }))
vi.mock('@/hooks/use-spaces', () => ({ refreshSpacesOrgs: vi.fn(async () => {}) }))
const invoke = vi.fn()
const makeState = (connected = false) => ({
  providerStates: { rowboat: { isConnected: connected, isLoading: false, isConnecting: false } },
  providersLoading: false,
  startConnect: vi.fn(),
  handleComplete: vi.fn(),
}) as unknown as OnboardingState

beforeEach(() => {
  invoke.mockReset()
  Object.assign(window, { ipc: { invoke } })
})
afterEach(cleanup)

describe('welcome sign-in', () => {
  it('offers only Rowboat sign-in', () => {
    const state = makeState()
    render(<WelcomeStep state={state} />)
    expect(screen.queryByText(/ChatGPT/)).not.toBeInTheDocument()
    expect(screen.queryByText(/API key/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Rowboat' }))
    expect(state.startConnect).toHaveBeenCalledWith('rowboat')
  })

  it('finishes once signed in, making a first space when you have none', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'spaces:listOrgs') return { orgs: [] }
      if (channel === 'account:getRowboat') return { signedIn: true, accessToken: null }
      return { org: { id: 'new' } }
    })
    const state = makeState(true)
    render(<WelcomeStep state={state} />)
    const next = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(next).toBeEnabled())
    fireEvent.click(next)
    await waitFor(() => expect(state.handleComplete).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('spaces:createOrg', { name: 'My space' })
  })
})
