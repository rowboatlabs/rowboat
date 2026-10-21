import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { AgentsView } from './agents-view'

afterEach(cleanup)

const person = (id: string, displayName: string, role: 'admin' | 'member' = 'member') => ({ id, displayName, role, kind: 'human' }) as spaces.Member
const agent = (id: string, displayName: string, ownerId: string | undefined, agentKind: string, agentConnection: string, extra: Partial<spaces.Member> = {}) =>
    ({ id, displayName, role: 'member', kind: 'agent', ...(ownerId ? { ownerId } : {}), agentKind, agentConnection, ...extra }) as spaces.Member

let roster: spaces.Member[]
let spaceMembers: Record<string, spaces.Member[]>
const invoke = vi.fn(async (channel: string, args: Record<string, string>) => {
    switch (channel) {
        case 'spaces:listOrgMembers': return { members: roster }
        case 'spaces:listMembers': return { members: spaceMembers[args.spaceId!] ?? [] }
        case 'spaces:listAgents': return { agents: roster.filter((m) => m.kind === 'agent' && m.ownerId === 'me').map((a) => ({ agent: a, keys: [] })) }
        case 'spaces:getAgentCapabilities': return { capabilities: { stop: false, options: [] }, defaults: {} }
        case 'spaces:renameAgent':
            roster = roster.map((m) => (m.id === args.agentId ? { ...m, displayName: args.displayName! } : m))
            return { agent: roster.find((m) => m.id === args.agentId) }
    }
    throw new Error(`unexpected ${channel}`)
})

// A fresh org id per test: rosters are cached per org for the session.
let n = 0
let org: OrgWithSpaces
const orgWith = (memberId = 'me') => ({
    id: `org-${++n}`,
    name: 'Rowboat Labs',
    baseUrl: 'https://rowboat.example',
    spaces: [{ id: 'S1', name: 'general' }, { id: 'S2', name: 'eng' }],
    directs: [],
    memberId,
}) as unknown as OrgWithSpaces

const hermes = agent('hermes', 'Herald', 'me', 'hermes', 'plugin')
const scout = agent('scout', 'Scout', 'harsh', 'claude-code', 'replicas')
const ro = agent('ro', 'Ro', undefined, 'jev', 'builtin')
const gone = agent('gone', 'Gone', 'harsh', 'custom', 'contract', { removedAt: '2026-10-19T10:00:00Z' })

beforeEach(() => {
    invoke.mockClear()
    window.localStorage.clear()
    roster = [person('me', 'Ramnique'), person('harsh', 'Harsh'), hermes, scout, ro, gone]
    spaceMembers = { S1: [person('me', 'Ramnique'), hermes, scout], S2: [hermes] }
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
    org = orgWith()
})

const show = () => render(<TooltipProvider><AgentsView org={org} /></TooltipProvider>)
const group = (name: string) => screen.getByRole('region', { name })
const openMenu = (name: string) => fireEvent.keyDown(screen.getByRole('button', { name: `${name} options` }), { key: 'Enter' })

describe('AgentsView', () => {
    it('counts every active agent and splits them into yours and everyone else’s', async () => {
        show()
        await screen.findByText('Scout')
        expect(screen.getByRole('heading', { name: /Agents/ })).toHaveTextContent('Agents3')
        expect(within(group('Yours')).getByText('Herald')).toBeInTheDocument()
        expect(within(group('Everyone else’s')).getByText('Scout')).toBeInTheDocument()
        expect(within(group('Everyone else’s')).getByText('Harsh')).toBeInTheDocument()
        expect(within(group('Everyone else’s')).getByText('Built in')).toBeInTheDocument()
        expect(screen.getByText('Claude Code · via Replicas')).toBeInTheDocument()
        // A removed agent is gone from the page.
        expect(screen.queryByText('Gone')).toBeNull()
    })

    it('shows how many of your spaces each agent is in', async () => {
        show()
        await screen.findByText('2 spaces')
        expect(screen.getByText('1 space')).toBeInTheDocument()
        expect(screen.getByText('No shared spaces')).toBeInTheDocument()
    })

    it('Mine shows only your agents', async () => {
        show()
        await screen.findByText('Scout')
        fireEvent.click(screen.getByRole('radio', { name: 'Mine' }))
        expect(screen.queryByText('Scout')).toBeNull()
        expect(screen.getByText('Herald')).toBeInTheDocument()
    })

    it('lets the owner rename their agent in place', async () => {
        show()
        await screen.findByText('Herald')
        openMenu('Herald')
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
        const input = await screen.findByLabelText('Agent name')
        fireEvent.change(input, { target: { value: '  Herald   Prime ' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:renameAgent', { orgId: org.id, agentId: 'hermes', displayName: 'Herald Prime' }))
        expect(await screen.findByText('Herald Prime')).toBeInTheDocument()
    })

    it('offers no options on someone else’s agent, unless you are an admin', async () => {
        show()
        await screen.findByText('Scout')
        expect(screen.queryByRole('button', { name: 'Scout options' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Open Scout' })).toBeNull()
        cleanup()

        roster = roster.map((m) => (m.id === 'me' ? { ...m, role: 'admin' } : m))
        org = orgWith()
        show()
        await screen.findByRole('button', { name: 'Scout options' })
        openMenu('Scout')
        expect(await screen.findByRole('menuitem', { name: 'Remove from server' })).toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
        // Ro is built in: nothing to manage.
        expect(screen.queryByRole('button', { name: 'Ro options' })).toBeNull()
    })

    it('New agent opens straight at adding one', async () => {
        show()
        await screen.findByText('Herald')
        fireEvent.click(screen.getByRole('button', { name: /New agent/ }))
        expect(await screen.findByRole('radiogroup', { name: 'How it connects' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'How it connects' })).toBeNull())
    })
})
