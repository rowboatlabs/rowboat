import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingModal } from './index'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/analytics', () => ({ spacesServerCreated: vi.fn(), spacesInviteLinkCopied: vi.fn() }))
vi.mock('@/hooks/use-spaces', () => ({ refreshSpacesOrgs: vi.fn(async () => {}) }))

const invoke = vi.fn()
const token = (claims: object) => `header.${btoa(JSON.stringify(claims))}.signature`
let orgs: { id: string; name: string }[] = []
let signedIn = true
let didConnect: ((event: { provider: string; success: boolean }) => void) | null = null

beforeEach(() => {
  orgs = []
  signedIn = true
  didConnect = null
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, args: { name?: string }) => {
    switch (channel) {
      case 'oauth:getState': return { config: { rowboat: { connected: signedIn } } }
      case 'oauth:connect': return { success: true }
      case 'spaces:listOrgs': return { orgs }
      case 'account:getRowboat': return { signedIn: true, accessToken: token({ name: 'Arjun Kumar' }) }
      case 'spaces:createOrg': return { org: { id: 'new', name: args.name } }
      case 'spaces:createInvite': return { link: 'https://rowboat.test/join/abc' }
      case 'spaces:resolveInviteLink': return { resolved: { state: 'error' } }
      default: throw new Error(`Unexpected channel ${channel}`)
    }
  })
  Object.assign(window, {
    ipc: {
      invoke,
      on: (channel: string, cb: typeof didConnect) => {
        if (channel === 'oauth:didConnect') didConnect = cb
        return () => {}
      },
    },
  })
})
afterEach(cleanup)

describe('spaces-first onboarding', () => {
  it('offers only the Rowboat sign-in, then continues once it lands', async () => {
    signedIn = false
    render(<OnboardingModal open onComplete={vi.fn()} />)
    const signIn = await screen.findByRole('button', { name: /Continue with Rowboat/ })
    await waitFor(() => expect(signIn).toBeEnabled())
    expect(screen.queryByText(/ChatGPT/)).not.toBeInTheDocument()
    expect(screen.queryByText(/API key/)).not.toBeInTheDocument()
    fireEvent.click(signIn)
    expect(invoke).toHaveBeenCalledWith('oauth:connect', { provider: 'rowboat' })
    didConnect?.({ provider: 'rowboat', success: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Name your space')).toBeInTheDocument()
  })

  it('names and creates a space, offers its invite link, then opens it', async () => {
    const onComplete = vi.fn()
    render(<OnboardingModal open onComplete={onComplete} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText("Arjun's space")).toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(next).toBeEnabled())
    fireEvent.click(next)
    expect(await screen.findByText('Bring your team aboard')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('spaces:createOrg', { name: "Arjun's space" })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:createInvite', { orgId: 'new', spaceIds: [] }))
    fireEvent.click(screen.getByRole('button', { name: "Open Arjun's space" }))
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0]?.startTour).toBeFalsy()
  })

  it('lands someone an invite already brought in, without making a space or inviting', async () => {
    orgs = [{ id: 'acme', name: 'Acme' }]
    const onComplete = vi.fn()
    render(<OnboardingModal open onComplete={onComplete} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText("You're in Acme")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Take a 1-minute tour first' }))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ startTour: true }))
    expect(invoke.mock.calls.some(([channel]) => channel === 'spaces:createOrg' || channel === 'spaces:createInvite')).toBe(false)
  })
})
