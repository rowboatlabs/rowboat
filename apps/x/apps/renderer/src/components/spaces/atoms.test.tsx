import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import { AgentBadge, AgentMark, MemberAvatar } from './atoms'
import { SpaceProfilesProvider } from './member-text'

afterEach(cleanup)

const replicas = { id: '01HREPL', displayName: 'Replicas', role: 'member', kind: 'agent', agentKind: 'claude-code', agentConnection: 'replicas' } as spaces.Member
const ram = { id: '01HRAM', displayName: 'Ramnique', role: 'member', kind: 'human' } as spaces.Member

function inRoster(children: React.ReactNode) {
    return render(<SpaceProfilesProvider members={[replicas, ram]} here={new Set()} selfId={null}>{children}</SpaceProfilesProvider>)
}

// Agent members (Harbor spec §4, 2026-09-29): a round avatar, its kind's mark
// in the corner, and a label naming what it is and how it's reached (2026-09-30).
/** The kind mark beside an avatar's face, inside its own wrapper (a person's face has none). */
const corner = (title: string) => {
    const face = screen.getByTitle(title)
    return Array.from(face.parentElement?.children ?? []).find((el) => el !== face && el.getAttribute('aria-hidden') === 'true')
}

describe('agent marking', () => {
    it('rounds an agent member’s avatar, marks its kind, and names it, from the roster in context', () => {
        inRoster(<>
            <MemberAvatar id={replicas.id} name="Replicas" /><AgentMark id={replicas.id} />
            <MemberAvatar id={ram.id} name="Ramnique" /><AgentMark id={ram.id} />
        </>)
        expect(screen.getByTitle('Replicas')).toHaveClass('rounded-full')
        expect(corner('Replicas')).toBeTruthy()
        expect(screen.getByTitle('Ramnique')).not.toHaveClass('rounded-full')
        expect(corner('Ramnique')).toBeFalsy()
        expect(screen.getByText('Claude Code · via Replicas')).toBeInTheDocument()
        expect(screen.queryByText(/Agent/)).toBeNull()
    })

    it('marks an agent the same at every size, the smallest too', () => {
        for (const size of ['sm', 'md', 'lg', 'xl'] as const) {
            const { unmount } = inRoster(<MemberAvatar id={replicas.id} name="Replicas" size={size} />)
            expect(screen.getByTitle('Replicas')).toHaveClass('rounded-full')
            expect(corner('Replicas')?.querySelector('img')).toBeTruthy()
            unmount()
        }
    })

    it('takes the kind from the caller outside a roster, and names an unknown one as an agent', () => {
        render(<><MemberAvatar id={replicas.id} name="Replicas" agent agentKind="hermes" /><AgentBadge agentKind="some-future-kind" /></>)
        expect(screen.getByTitle('Replicas')).toHaveClass('rounded-full')
        expect(corner('Replicas')?.querySelector('img')).toBeTruthy() // Hermes's mark
        expect(screen.getByText('Agent')).toBeInTheDocument()
    })
})
