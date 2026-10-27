import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditProfile } from './edit-profile'
import { MemberAvatar, MemberProfilePopover } from './atoms'
import { SpaceProfilesProvider } from './member-text'
import { SpaceRefsProvider, SpaceNavContext } from './space-nav'
import type { spaces } from '@x/shared'

const apply = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-space-members', () => ({ applyProfileUpdate: apply }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const member = { id: 'me', displayName: 'Harsh', title: 'Engineer', role: 'member', kind: 'human' } as spaces.Member
const invoke = vi.fn()
const close = vi.fn()
beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockImplementation(async (channel: string, args: Record<string, string>) => {
        if (channel === 'spaces:getProfile') return { member }
        if (channel === 'spaces:updateProfile') return { member: { ...member, displayName: args.displayName, title: args.title } }
        if (channel === 'spaces:clearAvatar') return { member }
        if (channel === 'spaces:getProfileImage') return { src: 'data:image/png;base64,AA==' }
        return { member }
    })
    Object.assign(window, { ipc: { invoke, on: () => () => {} } })
})
afterEach(cleanup)

describe('profile editing', () => {
    it('loads and saves normalized values in the selected organization', async () => {
        render(<EditProfile orgId="selected-org" orgName="Rowboat" onClose={close} />)
        const name = await screen.findByLabelText('Display name')
        fireEvent.change(name, { target: { value: ' Harsh   V ' } })
        fireEvent.change(screen.getByLabelText('Job title'), { target: { value: '' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
        await waitFor(() => expect(close).toHaveBeenCalled())
        expect(invoke).toHaveBeenCalledWith('spaces:updateProfile', { orgId: 'selected-org', displayName: 'Harsh V', title: '' })
        expect(apply).toHaveBeenCalledWith('selected-org', expect.objectContaining({ displayName: 'Harsh V', title: '' }))
    })
    it('cancel leaves all profile fields unchanged', async () => {
        render(<EditProfile orgId="org" onClose={close} />)
        fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Unsaved' } })
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(close).toHaveBeenCalled()
        expect(invoke).toHaveBeenCalledTimes(1)
    })
    it('uploads a chosen photo only on Save', async () => {
        render(<EditProfile orgId="upload-org" onClose={close} />)
        await screen.findByLabelText('Display name')
        const file = new File(['png'], 'photo.png', { type: 'image/png' })
        Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
        fireEvent.change(screen.getByLabelText('Profile photo'), { target: { files: [file] } })
        await screen.findByAltText('Profile preview')
        expect(invoke.mock.calls.some(([channel]) => channel === 'spaces:setAvatar')).toBe(false)
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAvatar', { orgId: 'upload-org', bytes: 'AQID', mime: 'image/png' }))
    })
    it('keeps failed saves open and allows retry', async () => {
        render(<EditProfile orgId="org" onClose={close} />)
        await screen.findByLabelText('Display name')
        invoke.mockRejectedValueOnce(new Error('Server unavailable'))
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
        expect(close).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
        await waitFor(() => expect(close).toHaveBeenCalled())
    })
    it('rejects blank names and oversized or unsupported photos before sending', async () => {
        render(<EditProfile orgId="org" onClose={close} />)
        fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: '  ' } })
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Profile photo'), { target: { files: [new File(['x'], 'x.svg', { type: 'image/svg+xml' })] } })
        expect(screen.getByRole('alert')).toHaveTextContent('PNG, JPEG')
        fireEvent.change(screen.getByLabelText('Profile photo'), { target: { files: [new File([new Uint8Array(1024 * 1024 + 1)], 'x.png', { type: 'image/png' })] } })
        expect(screen.getByRole('alert')).toHaveTextContent('smaller than 1 MB')
        expect(invoke.mock.calls.every(([channel]) => channel !== 'spaces:setAvatar')).toBe(true)
    })
    it('does not remove a photo until Save', async () => {
        invoke.mockResolvedValueOnce({ member: { ...member, avatarUrl: 'https://org/v1/images/' + 'a'.repeat(64) } })
        render(<EditProfile orgId="photo-org" onClose={close} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Remove photo' }))
        expect(invoke.mock.calls.some(([channel]) => channel === 'spaces:clearAvatar')).toBe(false)
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:clearAvatar', { orgId: 'photo-org' }))
    })
})

function profile(person: spaces.Member, selfId = 'me') {
    const openDirect = vi.fn()
    render(<SpaceRefsProvider refs={{ orgId: 'profile-org', orgAddress: 'org.test', spaceId: 'space' }}>
        <SpaceProfilesProvider members={[person]} here={new Set([person.id])} selfId={selfId}>
            <SpaceNavContext.Provider value={{ onOpenFile: vi.fn(), onOpenDirect: openDirect }}>
                <MemberProfilePopover id={person.id}><button>Open profile</button></MemberProfilePopover>
            </SpaceNavContext.Provider>
        </SpaceProfilesProvider>
    </SpaceRefsProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }))
    return openDirect
}

it('shows title and presence and offers editing only for your own profile', async () => {
    profile(member)
    expect(screen.getByRole('dialog')).toHaveTextContent('Engineer')
    expect(screen.getByText('Here now')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    expect(await screen.findByLabelText('Display name')).toHaveValue('Harsh')
})
it('opens a DM with another member from the profile panel', () => {
    const openDirect = profile({ ...member, id: 'other' })
    expect(screen.queryByRole('button', { name: 'Edit profile' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(openDirect).toHaveBeenCalledWith('profile-org', 'other')
})
it('loads photos through the selected org and falls back to initials on decode failure', async () => {
    const { container } = render(<MemberAvatar id="me" name="Harsh V" orgId="avatar-org" avatarUrl={'https://org/v1/images/' + 'b'.repeat(64)} />)
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy())
    expect(invoke).toHaveBeenCalledWith('spaces:getProfileImage', { orgId: 'avatar-org', hash: 'b'.repeat(64) })
    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByText('HV')).toBeInTheDocument()
})
