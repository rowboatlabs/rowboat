import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { ArchivedNotice, SpaceAccessProvider, useSpaceAccess } from './spaces-access'

const fixture = vi.hoisted(() => ({ members: [] as spaces.Member[] }))
vi.mock('@/hooks/use-space-members', () => ({ useSpaceMembers: () => fixture.members }))
afterEach(cleanup)

function Conversation() {
    const { writable } = useSpaceAccess()
    return <><p>Conversation history</p>{writable ? <textarea aria-label="Message" /> : <ArchivedNotice />}</>
}

it('removes the DM composer when its agent is deleted, retaining the conversation', () => {
    const agent = { id: 'agent', displayName: 'Scout', kind: 'agent' } as spaces.Member
    const space = { id: 'dm', kind: 'direct', archived: false } as spaces.Space
    fixture.members = [agent]
    const { rerender } = render(<SpaceAccessProvider orgId="org" space={space}><Conversation /></SpaceAccessProvider>)
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    fixture.members = [{ ...agent, deactivatedAt: '2026-11-11T10:00:00Z' }]
    rerender(<SpaceAccessProvider orgId="org" space={space}><Conversation /></SpaceAccessProvider>)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('This agent was deleted. You can still read this conversation.')).toBeInTheDocument()
    expect(screen.getByText('Conversation history')).toBeInTheDocument()
    rerender(<SpaceAccessProvider orgId="org" space={{ ...space, kind: 'shared' }}><Conversation /></SpaceAccessProvider>)
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument()
})
