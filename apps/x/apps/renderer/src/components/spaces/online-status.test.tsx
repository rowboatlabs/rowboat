import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { applyMemberPresence, usePeopleOnline } from '@/hooks/use-space-members'
import { MemberAvatar, MemberProfilePopover } from './atoms'
import { SpacesAccountMenu } from './account-menu'
import { AvailabilityMenu } from './availability-menu'
import { MemberDirectory } from './member-directory'
import { SpaceProfilesProvider } from './member-text'
import { SpaceRefsProvider } from './space-nav'

const fixture = vi.hoisted(() => ({
    org: { id: 'status-consistency', name: 'Spaces', memberId: 'me', spaces: [] },
    member: { id: 'me', displayName: 'Harsh', kind: 'human', role: 'member', availability: { manualAway: true } },
}))
vi.mock('@/hooks/use-spaces', () => ({ useSpacesOrgs: () => ({ orgs: [fixture.org] }) }))
vi.mock('@/hooks/use-space-members', async importOriginal => ({
    ...await importOriginal<typeof import('@/hooks/use-space-members')>(),
    useOrgRosters: () => new Map([[fixture.org.id, [fixture.member]]]),
}))
vi.mock('@/hooks/use-profile-image', () => ({ useProfileImage: () => undefined }))
vi.mock('@/components/spaces/profile-settings', () => ({ ProfileSettings: () => null }))
afterEach(cleanup)

function Surfaces() {
    const online = usePeopleOnline(fixture.org.id)
    return <SpaceRefsProvider refs={{ orgId: fixture.org.id, orgAddress: 'spaces.test', spaceId: 'space' }}>
        <SpaceProfilesProvider members={[fixture.member as spaces.Member]} here={new Set(['me'])} selfId="me">
            <div data-testid="sidebar-avatar"><MemberAvatar id="me" name="Harsh" online={online.has('me')} /></div>
            <div data-testid="directory"><MemberDirectory members={[fixture.member as spaces.SpaceMember]} here={online} selfId="me" /></div>
            <div data-testid="account"><SpacesAccountMenu email={null} variant="row" /></div>
            <div data-testid="availability"><AvailabilityMenu /></div>
            <MemberProfilePopover id="me"><button>Open profile</button></MemberProfilePopover>
        </SpaceProfilesProvider>
    </SpaceRefsProvider>
}

it('updates every human status surface together from live presence, despite stale profile and space-viewing data', () => {
    applyMemberPresence(fixture.org.id, 'me', false)
    render(<Surfaces />)
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }))
    for (const online of [false, true, false, true]) {
        act(() => applyMemberPresence(fixture.org.id, 'me', online))
        const label = online ? 'Online' : 'Away'
        for (const id of ['sidebar-avatar', 'directory']) {
            const surface = within(screen.getByTestId(id))
            const dot = surface.getByRole('img', { name: label, hidden: true })
            if (online) expect(dot).toHaveClass('bg-emerald-500')
            else expect(dot).not.toHaveClass('bg-emerald-500')
            expect(surface.queryByRole('img', { name: online ? 'Away' : 'Online', hidden: true })).toBeNull()
        }
        expect(screen.getByTestId('account')).toHaveTextContent(`${label} · set a status`)
        expect(within(screen.getByTestId('availability')).getByText(label)).toBeInTheDocument()
        expect(within(screen.getByRole('dialog')).getByText(label)).toBeInTheDocument()
    }
})
