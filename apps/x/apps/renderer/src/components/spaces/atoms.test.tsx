import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import { AgentMark, MemberAvatar } from './atoms'
import { SpaceProfilesProvider } from './member-text'

afterEach(cleanup)

const replicas = { id: '01HREPL', displayName: 'Replicas', role: 'member', kind: 'agent' } as spaces.Member
const ram = { id: '01HRAM', displayName: 'Ramnique', role: 'member', kind: 'human' } as spaces.Member

function inRoster(children: React.ReactNode) {
    return render(<SpaceProfilesProvider members={[replicas, ram]} here={new Set()} selfId={null}>{children}</SpaceProfilesProvider>)
}

// Agent members (Harbor spec §4, 2026-09-29): a round avatar and an "agent" label.
describe('agent marking', () => {
    it('rounds an agent member’s avatar and labels it, from the roster in context', () => {
        inRoster(<>
            <MemberAvatar id={replicas.id} name="Replicas" /><AgentMark id={replicas.id} />
            <MemberAvatar id={ram.id} name="Ramnique" /><AgentMark id={ram.id} />
        </>)
        expect(screen.getByTitle('Replicas')).toHaveClass('rounded-full')
        expect(screen.getByTitle('Ramnique')).not.toHaveClass('rounded-full')
        expect(screen.getAllByText('agent')).toHaveLength(1)
    })

    it('takes the kind from the caller outside a roster', () => {
        render(<MemberAvatar id={replicas.id} name="Replicas" agent />)
        expect(screen.getByTitle('Replicas')).toHaveClass('rounded-full')
    })
})
