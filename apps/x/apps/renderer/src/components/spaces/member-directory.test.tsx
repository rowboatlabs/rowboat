import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import { MemberDirectory } from './member-directory'

const members = [
    { id: 'harsh', displayName: 'Harsh', kind: 'human', role: 'admin' },
    { id: 'ram', displayName: 'Ramnique', kind: 'human', role: 'member' },
    { id: 'ai', displayName: 'Assistant', kind: 'agent', agentKind: 'claude-code', agentConnection: 'replicas', role: 'member' },
    { id: 'bot', displayName: 'Analytics', kind: 'agent', agentKind: 'posthog', agentConnection: 'posthog', role: 'member' },
] as spaces.Member[]
afterEach(cleanup)

it('defaults to actual people and separates both AI agents and service bots with independent counts', () => {
    render(<MemberDirectory members={members} here={new Set(['ram'])} selfId="harsh" />)
    expect(screen.getByRole('tab', { name: 'People 2' })).toHaveAttribute('aria-selected', 'true')
    const people = within(screen.getByRole('tabpanel')).getAllByRole('button')
    expect(people).toHaveLength(2)
    expect(people[0]).toHaveTextContent('Ramnique')
    expect(people[1]).toHaveTextContent('Harsh')
    expect(screen.queryByText('Assistant')).not.toBeInTheDocument()
    const integrations = screen.getByRole('tab', { name: 'Bots & AI integrations 2' })
    fireEvent.mouseDown(integrations, { button: 0, ctrlKey: false })
    expect(integrations).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
    expect(screen.queryByText('Harsh')).not.toBeInTheDocument()
})

it('shows an empty integrations tab instead of mixing in people', () => {
    render(<MemberDirectory members={members.slice(0, 2)} here={new Set()} selfId="harsh" />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Bots & AI integrations 0' }), { button: 0, ctrlKey: false })
    expect(screen.getByText('No bots or AI integrations in this space.')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).queryByRole('button')).not.toBeInTheDocument()
})
