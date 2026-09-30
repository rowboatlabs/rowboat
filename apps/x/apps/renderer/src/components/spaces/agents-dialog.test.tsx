import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { AgentsDialog } from './agents-dialog'

afterEach(cleanup)

const person = (id: string, displayName: string, role: 'admin' | 'member' = 'member') => ({ id, displayName, role, kind: 'human' }) as spaces.Member
const hermes = { id: 'hermes', displayName: 'Hermes', role: 'member', kind: 'agent', ownerId: 'me' } as spaces.Member
const scout = { id: 'scout', displayName: 'Scout', role: 'member', kind: 'agent', ownerId: 'harsh' } as spaces.Member
const key = (id: string, agentId: string, extra: Partial<spaces.AgentKey> = {}): spaces.AgentKey =>
    ({ id, agentId, createdBy: 'me', createdAt: '2026-09-29T10:00:00Z', ...extra })
const org = { id: 'org-1', name: 'Rowboat Labs', baseUrl: 'https://rowboat.example', spaces: [], directs: [], memberId: 'me' } as unknown as OrgWithSpaces

// Real keys are long: on screen they read as their ends, and Copy copies them whole.
const NEW_KEY = 'rbk_LXNtIBXAl77aMYBiJ2Z2qesaySzSrqaJCbspX72zz9U'
const ROTATED = 'rbk_R0tat3dR0tat3dR0tat3dR0tat3dR0tat3dR0tat3d'

let roster: spaces.Member[]
let listing: spaces.AgentListing[]
const invoke = vi.fn(async (channel: string, args: Record<string, string>) => {
    switch (channel) {
        case 'spaces:listOrgMembers': return { members: roster }
        case 'spaces:listAgents': return { agents: listing }
        case 'spaces:openDirect': return { space: { id: `DM-${args.memberId}`, kind: 'direct' }, created: true }
        case 'spaces:addAgent': return { agent: { ...hermes, id: 'new', displayName: args.displayName }, key: { ...key('k9', 'new'), secret: NEW_KEY } }
        case 'spaces:createAgentKey': return { key: { ...key('k2', args.agentId!), secret: ROTATED } }
        case 'spaces:revokeAgentKey': return { key: key(args.keyId!, args.agentId!, { revokedAt: '2026-09-29T11:00:00Z' }) }
    }
    throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
    invoke.mockClear()
    window.localStorage.clear()
    roster = [person('me', 'Ramnique'), person('harsh', 'Harsh')]
    listing = [{ agent: hermes, keys: [key('k1', 'hermes', { lastUsedAt: '2026-09-29T10:30:00Z' }), key('k0', 'hermes', { revokedAt: '2026-09-28T10:00:00Z' })] }]
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
})

const kindsOffered = () => within(screen.getByRole('radiogroup', { name: 'Kind of agent' })).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))

// The Agents dialog (2026-09-29; three screens, 2026-09-30): the list, adding one, connecting it.
describe('AgentsDialog', () => {
    it('opens on the list: agents, their live keys, and Add agent — nothing else', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        expect(screen.getByText('Yours · 1 key')).toBeInTheDocument()
        expect(screen.getAllByText(/Key made/)).toHaveLength(1)
        expect(screen.getByRole('button', { name: /Add agent/ })).toBeInTheDocument()
        expect(screen.queryByRole('radiogroup')).toBeNull()
        expect(screen.queryByText(/only time its key is shown/)).toBeNull()
    })

    it('adds a Hermes agent: pick the kind and name, then have Hermes connect itself', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        expect(kindsOffered()).toEqual(['Hermes', 'Custom'])
        expect(screen.getByRole('radio', { name: 'Hermes' })).toHaveAttribute('aria-checked', 'true')
        // The name suggests the kind's own.
        expect(screen.getByLabelText('Agent name')).toHaveValue('Hermes')
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))

        await screen.findByRole('heading', { name: 'Connect Hermes' })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Hermes' })
        // Its home channel is the owner's DM with the new agent.
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:openDirect', { orgId: 'org-1', memberId: 'new' }))
        // First: the three settings only the person has, then a fixed message; Hermes does the rest.
        expect(await screen.findByText('Save the Rowboat settings')).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: 'Ask Hermes' })).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Copy the commands' }))
        expect(vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0].split('\n')).toEqual([
            "hermes config set ROWBOAT_URL 'https://rowboat.example'",
            `hermes config set ROWBOAT_AGENT_KEY '${NEW_KEY}'`,
            "hermes config set ROWBOAT_HOME_CHANNEL 'DM-new'",
        ])
        fireEvent.click(screen.getByRole('button', { name: 'Copy the message' }))
        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
            'Connect yourself to Rowboat: read https://raw.githubusercontent.com/rowboatlabs/hermes-rowboat/main/SETUP.md and follow it.',
        )
        expect(screen.getByText('Restart it')).toBeInTheDocument()
        expect(screen.getByText('Add it to a space')).toBeInTheDocument()
        // By hand, from a terminal.
        fireEvent.click(screen.getByRole('radio', { name: 'Terminal' }))
        expect(screen.getByText('Save the settings')).toBeInTheDocument()
        expect(screen.getByText('Install the Rowboat plugin')).toBeInTheDocument()
        expect(screen.getByText('Restart Hermes')).toBeInTheDocument()
        expect(screen.getByText('Add it to a space')).toBeInTheDocument()
        expect(screen.getByText('hermes plugins install rowboatlabs/hermes-rowboat --enable')).toBeInTheDocument()
        // The key reads as its ends; Copy takes the whole commands.
        expect(screen.getByText(/ROWBOAT_AGENT_KEY 'rbk_LX…zz9U'/)).toBeInTheDocument()
        expect(screen.queryByText(new RegExp(NEW_KEY))).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Copy the commands' }))
        const copied = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0]
        expect(copied.split('\n')).toEqual([
            "hermes config set ROWBOAT_URL 'https://rowboat.example'",
            `hermes config set ROWBOAT_AGENT_KEY '${NEW_KEY}'`,
            "hermes config set ROWBOAT_HOME_CHANNEL 'DM-new'",
            "hermes config set ROWBOAT_ALLOW_ALL_USERS 'true'",
            "hermes config set ROWBOAT_OWNER_COMMANDS 'true'",
            "hermes config set mcp_servers.rowboat.url '${ROWBOAT_URL}/mcp'",
            "hermes config set mcp_servers.rowboat.headers.Authorization 'Bearer ${ROWBOAT_AGENT_KEY}'",
            "hermes config set display.platforms.rowboat.tool_progress 'off'",
            "hermes config set display.platforms.rowboat.show_reasoning 'false'",
            "hermes config set display.platforms.rowboat.long_running_notifications 'false'",
            "hermes config set display.platforms.rowboat.busy_ack_detail 'false'",
        ])
        // Hosted Hermes: the same values, as the dashboard's fields.
        fireEvent.click(screen.getByRole('radio', { name: 'Dashboard' }))
        expect(screen.getByText('Fill in the Rowboat channel')).toBeInTheDocument()
        expect(screen.getByText('ROWBOAT_OWNER_COMMANDS')).toBeInTheDocument()
        expect(screen.getByText('Add the Spaces tools')).toBeInTheDocument()
        expect(screen.getByText('https://rowboat.example/mcp')).toBeInTheDocument()
        expect(screen.getByText('ROWBOAT_HOME_CHANNEL')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Hermes setup docs/ })).toBeInTheDocument()
        // The list is not on this screen; Done goes back to it.
        expect(screen.queryByText(/Key made/)).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
        await screen.findByRole('button', { name: /Add agent/ })
    })

    it('adds a custom agent: the key and the endpoints, by hand', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
        fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Scout' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByRole('heading', { name: 'Connect Scout' })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Scout' })
        expect(screen.getByText('rbk_LX…zz9U')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: `Copy ${NEW_KEY}` }))
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(NEW_KEY)
        expect(screen.getByText('https://rowboat.example/mcp')).toBeInTheDocument()
        expect(invoke).not.toHaveBeenCalledWith('spaces:openDirect', expect.anything())
    })

    it('switching kind keeps a typed name; Back returns to the list', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Athena' } })
        fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
        expect(screen.getByLabelText('Agent name')).toHaveValue('Athena')
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
        expect(await screen.findByText(/Key made/)).toBeInTheDocument()
    })

    it('a new key goes straight to connecting and asks how the agent runs', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /New key/ }))
        await screen.findByRole('heading', { name: 'Connect Hermes' })
        const how = screen.getByRole('radiogroup', { name: 'How does it run?' })
        expect(within(how).getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByText('https://rowboat.example/mcp')).toBeInTheDocument()
        fireEvent.click(within(how).getByRole('radio', { name: 'Hermes' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:openDirect', { orgId: 'org-1', memberId: 'hermes' }))
        expect(await screen.findByText(/ROWBOAT_AGENT_KEY 'rbk_R0…at3d'/)).toBeInTheDocument()
    })

    it('revokes on a second click', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
        expect(invoke).not.toHaveBeenCalledWith('spaces:revokeAgentKey', expect.anything())
        fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:revokeAgentKey', { orgId: 'org-1', agentId: 'hermes', keyId: 'k1' }))
    })

    it('lets an admin revoke someone else’s agent’s key, but not mint one', async () => {
        roster = [person('me', 'Ramnique', 'admin'), person('harsh', 'Harsh')]
        listing = [{ agent: scout, keys: [key('k5', 'scout')] }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Owned by Harsh · 1 key')
        expect(screen.queryByRole('button', { name: /New key/ })).not.toBeInTheDocument()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument())
    })
})
