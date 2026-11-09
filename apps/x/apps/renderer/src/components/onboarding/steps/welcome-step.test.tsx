import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingState } from '../use-onboarding-state'
import { WelcomeStep } from './welcome-step'

const refresh = vi.fn(async () => {})
vi.mock('@/hooks/use-spaces', () => ({ refreshSpacesOrgs: () => refresh() }))
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

  // One server (2026-11-09): nothing is created on the way in; the account is a member on first contact.
  it('finishes once signed in, after the server has been reached, creating nothing', async () => {
    const state = makeState(true)
    render(<WelcomeStep state={state} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(state.handleComplete).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
