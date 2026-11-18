import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpacesAccount } from './spaces-account'

// One server (2026-11-09): the record the app keeps of it, under the name the store kept.
const orgs = [
  { id: 'server', name: 'Rowboat Spaces', memberId: 'me', spaces: [{ id: 's1' }] },
]
vi.mock('@/hooks/use-spaces', () => ({ useSpacesOrgs: () => ({ orgs }) }))
vi.mock('@/hooks/use-space-members', () => ({
  usePeopleOnline: () => new Set(['me']),
  useOrgRosters: () => new Map([
    ['server', [{ id: 'me', displayName: 'Arjun Maheswaran' }]],
  ]),
}))
vi.mock('@/hooks/use-profile-image', () => ({ useProfileImage: () => undefined }))
vi.mock('@/hooks/use-rowboat-config', () => ({ useRowboatConfig: () => ({ appUrl: 'https://app.example' }) }))
vi.mock('@/components/spaces/profile-settings', () => ({ ProfileSettings: () => <div>profile editor</div> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const invoke = vi.fn()
const token = `h.${btoa(JSON.stringify({ email: 'arjun@rowboatlabs.com' }))}.s`

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'account:getRowboat') return { signedIn: true, accessToken: token }
    return { success: true }
  })
  Object.assign(window, { ipc: { invoke, on: vi.fn(() => () => {}) } })
})
afterEach(cleanup)

describe('the Spaces account row', () => {
  it('shows who you are and the server, as the web app does', async () => {
    render(<SpacesAccount onOpenSettings={vi.fn()} />)
    // The row itself carries your name and presence (2026-11-09).
    expect(screen.getByRole('button', { name: 'Your account' })).toHaveTextContent('Arjun Maheswaran')
    expect(screen.getByRole('button', { name: 'Your account' })).toHaveTextContent('Online')
    fireEvent.click(screen.getByRole('button', { name: 'Your account' }))
    await waitFor(() => expect(screen.getByText('arjun@rowboatlabs.com')).toBeInTheDocument())
    expect(screen.getAllByText('Arjun Maheswaran').length).toBeGreaterThan(0)
    expect(screen.getByText('Rowboat Spaces')).toBeInTheDocument()
    // Roles live on each space's membership now, not on the account (2026-11-09).
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Plan & usage/ })).toHaveAttribute('href', 'https://app.example?intent=upgrade')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Spaces profile' }))
    expect(screen.getByText('profile editor')).toBeInTheDocument()
  })

  it('opens Settings and signs out of Rowboat', async () => {
    const onOpenSettings = vi.fn()
    render(<SpacesAccount onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole('button', { name: 'Your account' }))
    fireEvent.click(await screen.findByRole('button', { name: /Settings/ }))
    expect(onOpenSettings).toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /Sign out/ }))
    expect(invoke).toHaveBeenCalledWith('oauth:disconnect', { provider: 'rowboat' })
  })
})
