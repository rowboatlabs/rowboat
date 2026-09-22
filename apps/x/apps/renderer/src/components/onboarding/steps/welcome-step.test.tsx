import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingState } from '../use-onboarding-state'
import { WelcomeStep } from './welcome-step'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const invoke = vi.fn()
const makeState = (connected = false) => ({
  providerStates: { rowboat: { isConnected: connected, isLoading: false, isConnecting: false } },
  providersLoading: false,
  startConnect: vi.fn(),
  setOnboardingPath: vi.fn(),
  setCurrentStep: vi.fn(),
}) as unknown as OnboardingState

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ signedIn: false })
  Object.assign(window, { ipc: { invoke } })
})
afterEach(cleanup)

describe('welcome sign-in', () => {
  it('lets ChatGPT-only users continue after browser sign-in', async () => {
    let finish!: (value: { signedIn: boolean }) => void
    invoke.mockImplementation((channel: string) => channel === 'chatgpt:signIn'
      ? new Promise(resolve => { finish = resolve })
      : Promise.resolve({ signedIn: false }))
    const state = makeState()
    render(<WelcomeStep state={state} />)
    const signIn = screen.getByRole('button', { name: 'Sign in with ChatGPT' })
    await waitFor(() => expect(signIn).toBeEnabled())
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    fireEvent.click(signIn)
    expect(invoke).toHaveBeenCalledWith('chatgpt:signIn', null)
    expect(screen.getByText(/Complete sign in in your browser/)).toBeInTheDocument()
    await act(async () => finish({ signedIn: true }))
    expect(screen.getByRole('status')).toHaveTextContent('ChatGPT Connected')
    expect(state.setCurrentStep).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(state.setOnboardingPath).toHaveBeenCalledWith('chatgpt')
    expect(state.setCurrentStep).toHaveBeenCalledWith(2)
  })

  it('keeps ChatGPT available after Rowboat connects and preserves the Rowboat path', async () => {
    const state = makeState()
    const view = render(<WelcomeStep state={state} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Rowboat' }))
    expect(state.startConnect).toHaveBeenCalledWith('rowboat')
    state.providerStates.rowboat.isConnected = true
    view.rerender(<WelcomeStep state={state} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeEnabled())
    expect(state.setCurrentStep).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(state.setOnboardingPath).toHaveBeenCalledWith('rowboat')
  })

  it('allows a cancelled ChatGPT login to be retried and keeps API key setup available', async () => {
    invoke.mockImplementation((channel: string) => channel === 'chatgpt:signIn'
      ? new Promise(() => {}) : Promise.resolve({ signedIn: false }))
    const state = makeState()
    render(<WelcomeStep state={state} />)
    const signIn = screen.getByRole('button', { name: 'Sign in with ChatGPT' })
    await waitFor(() => expect(signIn).toBeEnabled())
    fireEvent.click(signIn)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(invoke).toHaveBeenCalledWith('chatgpt:cancelSignIn', null)
    expect(signIn).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'I want to bring my own API key' }))
    expect(state.setOnboardingPath).toHaveBeenCalledWith('byok')
    expect(state.setCurrentStep).toHaveBeenCalledWith(1)
  })
})
