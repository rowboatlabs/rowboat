import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpacesModeRail } from './spaces-mode-rail'

const orgs = [
  { id: 'o1', name: 'Rowboat', memberId: 'me', spaces: [{ id: 's1' }] },
  { id: 'o2', name: 'Friends', memberId: 'me2', spaces: [{ id: 's2' }] },
]
vi.mock('@/hooks/use-spaces', () => ({ useSpacesOrgs: () => ({ orgs }) }))
vi.mock('@/hooks/use-space-members', () => ({
  useOrgRosters: () => new Map([
    ['o1', [{ id: 'me', displayName: 'Arjun Maheswaran', role: 'admin' }]],
    ['o2', [{ id: 'me2', displayName: 'Arjun Maheswaran', role: 'member' }]],
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

describe('the Spaces rail account menu', () => {
  it('shows who you are and your role on each server, as the web app does', async () => {
    render(<SpacesModeRail onOpenSettings={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Your account' }))
    await waitFor(() => expect(screen.getByText('arjun@rowboatlabs.com')).toBeInTheDocument())
    expect(screen.getAllByText('Arjun Maheswaran').length).toBeGreaterThan(0)
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Member')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Plan & usage/ })).toHaveAttribute('href', 'https://app.example?intent=upgrade')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Spaces profile' }))
    expect(screen.getByText('profile editor')).toBeInTheDocument()
  })

  it('opens Settings and signs out of Rowboat', async () => {
    const onOpenSettings = vi.fn()
    render(<SpacesModeRail onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole('button', { name: 'Your account' }))
    fireEvent.click(await screen.findByRole('button', { name: /Settings/ }))
    expect(onOpenSettings).toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /Sign out/ }))
    expect(invoke).toHaveBeenCalledWith('oauth:disconnect', { provider: 'rowboat' })
  })
})
