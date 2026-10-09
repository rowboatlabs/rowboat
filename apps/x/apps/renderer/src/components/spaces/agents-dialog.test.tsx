import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { AgentsDialog } from './agents-dialog'

afterEach(cleanup)

const person = (id: string, displayName: string, role: 'admin' | 'member' = 'member') => ({ id, displayName, role, kind: 'human' }) as spaces.Member
const hermes = { id: 'hermes', displayName: 'Hermes', role: 'member', kind: 'agent', ownerId: 'me', agentKind: 'hermes', agentConnection: 'plugin' } as spaces.Member
const scout = { id: 'scout', displayName: 'Scout', role: 'member', kind: 'agent', ownerId: 'harsh', agentKind: 'custom', agentConnection: 'contract' } as spaces.Member
const claude = { id: 'claude', displayName: 'Claude', role: 'member', kind: 'agent', ownerId: 'me', agentKind: 'claude-code', agentConnection: 'replicas' } as spaces.Member
const cal = { id: 'cal', displayName: 'Cal', role: 'member', kind: 'agent', ownerId: 'me', agentKind: 'cal', agentConnection: 'cal' } as spaces.Member
const key = (id: string, agentId: string, extra: Partial<spaces.AgentKey> = {}): spaces.AgentKey =>
    ({ id, agentId, createdBy: 'me', createdAt: '2026-09-29T10:00:00Z', ...extra })
const org = { id: 'org-1', name: 'Rowboat Labs', baseUrl: 'https://rowboat.example', spaces: [], directs: [], memberId: 'me' } as unknown as OrgWithSpaces

// Real keys are long: on screen they read as their ends, and Copy copies them whole.
const NEW_KEY = 'rbk_LXNtIBXAl77aMYBiJ2Z2qesaySzSrqaJCbspX72zz9U'
const HOOK_URL = 'https://rowboat.example/v1/hooks/cal/rbh_H00kH00kH00kH00kH00kH00kH00kH00kH00kH00kH00'
const ROTATED = 'rbk_R0tat3dR0tat3dR0tat3dR0tat3dR0tat3dR0tat3d'

let roster: spaces.Member[]
const joinedSpaces = new Set<string>()
let listing: spaces.AgentListing[]
let options: Record<string, spaces.InvocationOption[]> = {}
let defaults: Record<string, Record<string, string | boolean>> = {}
const ENVIRONMENT: spaces.InvocationOption = { type: 'select', key: 'environment', label: 'Environment', choices: [{ id: 'env-web', label: 'web-app' }, { id: 'env-api', label: 'api' }] }
const PLAN: spaces.InvocationOption = { type: 'toggle', key: 'plan_first', label: 'Plan first' }
const invoke = vi.fn(async (channel: string, args: Record<string, string>) => {
    switch (channel) {
        case 'spaces:listOrgMembers': return { members: roster }
        case 'spaces:listAgents': return { agents: listing }
        case 'spaces:openDirect': return { space: { id: `DM-${args.memberId}`, kind: 'direct' }, created: true }
        case 'spaces:addAgent':
            if (args.credential === 'rpl_refused') throw new Error('Replicas did not accept this key: Invalid or missing API key')
            return { agent: { ...hermes, id: 'new', displayName: args.displayName, agentKind: args.kind, agentConnection: args.connection, ...(args.instance ? { agentInstance: args.instance } : {}) }, key: { ...key('k9', 'new'), secret: NEW_KEY } }
        case 'spaces:agent37Instances':
            if (args.key === 'sk_live_bad') throw new Error('Agent37 did not accept this key: Missing, malformed, or revoked API key.')
            return { instances: [
                { id: 'ab12cd34ef', name: 'main', template: 'agent37-hermes', status: 'running', kind: 'hermes' },
                { id: 'cd34ef56gh', name: 'claws', template: 'agent37-openclaw', status: 'sleeping', kind: 'openclaw' },
                { id: 'ef56gh78ij', name: 'coder', template: 'agent37-codex', status: 'running' },
            ] }
        case 'spaces:agent37CreateInstance': return { instance: { id: 'zz99', name: args.name, template: 'agent37-openclaw', status: 'running', kind: 'openclaw' } }
        case 'spaces:setAgentCredential': return { credential: { hint: `…${args.secret!.slice(-4)}`, setBy: 'me', setAt: '2026-09-30T12:00:00Z' } }
        case 'spaces:createAgentKey': return { key: { ...key('k2', args.agentId!), secret: ROTATED } }
        case 'spaces:revokeAgentKey': return { key: key(args.keyId!, args.agentId!, { revokedAt: '2026-09-29T11:00:00Z' }) }
        case 'spaces:getAgentCapabilities': return { capabilities: { stop: false, options: options[args.agentId!] ?? [] }, defaults: defaults[args.agentId!] ?? {} }
        case 'spaces:setAgentHook': return { hook: { spaceId: args.spaceId, setBy: 'me', setAt: '2026-10-03T10:00:00Z' }, url: HOOK_URL }
        case 'spaces:clearAgentHook': return {}
        case 'spaces:listMembers': return { members: joinedSpaces.has(args.spaceId!) ? [{ id: 'new', displayName: 'Claude', kind: 'agent' }] : [] }
        case 'spaces:addMembers': joinedSpaces.add(args.spaceId!); return { memberships: [] }
        case 'spaces:setAgentOptionDefaults': return { defaults: (args as unknown as { defaults: Record<string, string | boolean> }).defaults }
    }
    throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
    invoke.mockClear()
    joinedSpaces.clear()
    window.localStorage.clear()
    roster = [person('me', 'Ramnique'), person('harsh', 'Harsh')]
    options = {}
    defaults = {}
    listing = [{ agent: hermes, keys: [key('k1', 'hermes', { lastUsedAt: '2026-09-29T10:30:00Z' }), key('k0', 'hermes', { revokedAt: '2026-09-28T10:00:00Z' })] }]
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
})

const setupsOffered = () => within(screen.getByRole('radiogroup', { name: 'How it connects' })).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))

// The Agents dialog (2026-09-29; screens 2026-09-30; the agent's page 2026-10-01): the list, adding one, connecting it, its page.
describe('AgentsDialog', () => {
    it('opens on the list: a roster to click into, and Add agent — nothing else', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        expect(screen.getByText('Hermes · Yours · 1 key')).toBeInTheDocument()
        expect(screen.queryByText(/Key made/)).toBeNull()
        expect(screen.getByRole('button', { name: /Add agent/ })).toBeInTheDocument()
        expect(screen.queryByRole('radiogroup')).toBeNull()
        expect(screen.queryByText(/only time its key is shown/)).toBeNull()
    })

    it('adds a Hermes agent: pick how it connects and a name, then have Hermes connect itself', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        expect(setupsOffered()).toEqual(['Hermes', 'Replicas', 'Agent37', 'Conductor', 'Custom'])
        expect(screen.getByRole('radio', { name: 'Hermes' })).toHaveAttribute('aria-checked', 'true')
        // The name suggests the kind's own.
        expect(screen.getByLabelText('Agent name')).toHaveValue('Hermes')
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))

        await screen.findByRole('heading', { name: 'Connect Hermes' })
        // Harbor records what it is and how it's reached (2026-09-30).
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Hermes', kind: 'hermes', connection: 'plugin' })
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
        expect(screen.getByText('Add it to spaces')).toBeInTheDocument()
        // By hand, from a terminal.
        fireEvent.click(screen.getByRole('radio', { name: 'Terminal' }))
        expect(screen.getByText('Save the settings')).toBeInTheDocument()
        expect(screen.getByText('Install the Rowboat plugin and skill')).toBeInTheDocument()
        expect(screen.getByText('Restart Hermes')).toBeInTheDocument()
        expect(screen.getByText('Add it to spaces')).toBeInTheDocument()
        expect(screen.getByText('hermes plugins install rowboatlabs/hermes-rowboat --enable')).toBeInTheDocument()
        expect(screen.getByText('hermes skills install rowboatlabs/rowboat/skills/rowboat-spaces --yes')).toBeInTheDocument()
        // The key reads as its ends; Copy takes the whole commands.
        expect(screen.getByText(/ROWBOAT_AGENT_KEY 'rbk_LX…zz9U'/)).toBeInTheDocument()
        expect(screen.queryByText(new RegExp(NEW_KEY))).toBeNull()
        fireEvent.click(screen.getAllByRole('button', { name: 'Copy the commands' })[0]!) // the settings; the second block installs
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
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Scout', kind: 'custom', connection: 'contract' })
        expect(screen.getByText('rbk_LX…zz9U')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: `Copy ${NEW_KEY}` }))
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(NEW_KEY)
        expect(screen.getByText('https://rowboat.example/mcp')).toBeInTheDocument()
        expect(invoke).toHaveBeenCalledWith('spaces:openDirect', { orgId: 'org-1', memberId: 'new' }) // your DM with it, ticked by default
    })

    it('switching kind keeps a typed name; Back returns to the list', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Athena' } })
        fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
        expect(screen.getByLabelText('Agent name')).toHaveValue('Athena')
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
        expect(await screen.findByText('Hermes · Yours · 1 key')).toBeInTheDocument()
    })

    it('an agent’s page shows its setup any time, its key a placeholder until a new one fills it in', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Hermes/ }))
        await screen.findByRole('heading', { name: 'Hermes' })
        expect(screen.getAllByText(/Key made .* · last used/)).toHaveLength(1) // the live key, not the revoked one
        expect(await screen.findByText(/ROWBOAT_AGENT_KEY 'YOUR_AGENT_KEY'/)).toBeInTheDocument()
        expect(screen.getByText(/A key is shown only once/)).toBeInTheDocument()
        expect(screen.queryByRole('heading', { name: 'Defaults' })).toBeNull() // Hermes declares no options
        fireEvent.click(screen.getByRole('button', { name: /New key/ }))
        expect(await screen.findByText(/ROWBOAT_AGENT_KEY 'rbk_R0…at3d'/)).toBeInTheDocument()
        expect(screen.getByText(/This is the only time this key is shown/)).toBeInTheDocument()
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:openDirect', { orgId: 'org-1', memberId: 'hermes' }))
    })

    it('lets the owner set an agent’s defaults for the options its connector declares', async () => {
        listing = [{ agent: claude, keys: [key('k3', 'claude')], credential: { hint: '…ab12', setBy: 'me', setAt: '2026-09-30T10:00:00Z' } }]
        options = { claude: [ENVIRONMENT, PLAN] }
        defaults = { claude: { environment: 'env-api' } }
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Claude/ }))
        const environment = await screen.findByLabelText('Default Environment')
        expect(environment).toHaveValue('env-api')
        fireEvent.change(environment, { target: { value: 'env-web' } })
        await waitFor(() =>
            expect(invoke).toHaveBeenCalledWith('spaces:setAgentOptionDefaults', { orgId: 'org-1', agentId: 'claude', defaults: { environment: 'env-web' } }),
        )
        fireEvent.click(screen.getByLabelText('Plan first by default'))
        await waitFor(() =>
            expect(invoke).toHaveBeenCalledWith('spaces:setAgentOptionDefaults', { orgId: 'org-1', agentId: 'claude', defaults: { environment: 'env-web', plan_first: true } }),
        )
    })

    it('shows someone else’s agent’s defaults read-only', async () => {
        roster = [person('me', 'Ramnique', 'admin'), person('harsh', 'Harsh')]
        listing = [{ agent: scout, keys: [key('k5', 'scout')] }]
        options = { scout: [ENVIRONMENT] }
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Scout/ }))
        expect(await screen.findByLabelText('Default Environment')).toBeDisabled()
        expect(screen.getByText(/Only its owner can change these/)).toBeInTheDocument()
    })

    it('adds a Replicas agent: the coding agent, a name, and the Replicas key; a refused key creates nothing', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        fireEvent.click(screen.getByRole('radio', { name: 'Replicas' }))
        const coding = screen.getByRole('radiogroup', { name: 'Coding agent' })
        expect(within(coding).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Claude Code', 'Codex', 'Cursor', 'OpenCode', 'Pi', 'Muse Code'])
        fireEvent.click(within(coding).getByRole('radio', { name: 'Codex' }))
        // The name suggests the coding agent; Add waits for the key.
        expect(screen.getByLabelText('Agent name')).toHaveValue('Codex')
        expect(screen.getByRole('button', { name: 'Add agent' })).toBeDisabled()

        fireEvent.change(screen.getByLabelText('Replicas API key'), { target: { value: 'rpl_refused' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Replicas did not accept this key')
        expect(screen.queryByRole('heading', { name: /Connect/ })).toBeNull()

        fireEvent.change(screen.getByLabelText('Replicas API key'), { target: { value: 'rpl_live_ab12' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByRole('heading', { name: 'Connect Codex' })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Codex', kind: 'codex', connection: 'replicas', credential: 'rpl_live_ab12' })
        // Optional, on Replicas's side: our MCP server and the two variables, on its own environment.
        expect(screen.getByText('Give it the Spaces tools (optional)')).toBeInTheDocument()
        expect(screen.getByText('https://rowboat.example/mcp')).toBeInTheDocument()
        expect(screen.getByText('ROWBOAT_AGENT_KEY')).toBeInTheDocument()
        expect(screen.getByText('Add it to spaces')).toBeInTheDocument()
        expect(invoke).toHaveBeenCalledWith('spaces:openDirect', { orgId: 'org-1', memberId: 'new' }) // your DM with it, ticked by default
    })

    it('adds a Conductor agent: Claude Code with the Conductor key, then the repo files that give it Spaces', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        fireEvent.click(screen.getByRole('radio', { name: 'Conductor' }))
        expect(screen.queryByRole('radiogroup', { name: 'Coding agent' })).toBeNull() // one coding agent: no choice
        expect(screen.getByLabelText('Agent name')).toHaveValue('Claude')
        expect(screen.getByText(/needs a Claude key or subscription under Settings → Agents/)).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Conductor API key'), { target: { value: 'cnd_live_ab12' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByRole('heading', { name: 'Connect Claude' })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Claude', kind: 'claude-code', connection: 'conductor', credential: 'cnd_live_ab12' })
        // Nothing secret by hand: the .mcp.json reads the variables Rowboat sets in each workspace.
        expect(screen.getByText('.mcp.json')).toBeInTheDocument()
        expect(screen.getByText(/"Authorization": "Bearer \$\{ROWBOAT_AGENT_KEY\}"/)).toBeInTheDocument()
        expect(screen.queryByText(NEW_KEY)).toBeNull()
    })

    it('adds the new agent to every space by default, minus the ones unticked, then offers the rest from its setup', async () => {
        const withSpaces = { ...org, spaces: [{ id: 'S-payments', name: 'payments', kind: 'shared' }, { id: 'S-design', name: 'design', kind: 'shared' }] } as unknown as OrgWithSpaces
        render(<AgentsDialog org={withSpaces} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        fireEvent.click(screen.getByRole('radio', { name: 'Conductor' }))
        const picker = screen.getByRole('list', { name: 'Add it to' })
        expect(within(picker).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['Direct message', '#payments', '#design'])
        expect(within(picker).getAllByRole('checkbox').map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])
        fireEvent.click(within(picker).getByRole('checkbox', { name: '#design' }))
        fireEvent.click(within(picker).getByRole('checkbox', { name: 'Direct message' }))
        fireEvent.change(screen.getByLabelText('Conductor API key'), { target: { value: 'cnd_live_ab12' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByRole('heading', { name: 'Connect Claude' })
        expect(invoke).toHaveBeenCalledWith('spaces:addMembers', { orgId: 'org-1', spaceId: 'S-payments', memberIds: ['new'] })
        expect(invoke).not.toHaveBeenCalledWith('spaces:addMembers', expect.objectContaining({ spaceId: 'S-design' }))
        expect(invoke).not.toHaveBeenCalledWith('spaces:openDirect', expect.anything())
        // The setup's last step shows where it is, and adds it to the rest.
        const spacesList = screen.getByRole('list', { name: 'Spaces' })
        expect(await within(spacesList).findByText('Added')).toBeInTheDocument()
        const add = within(spacesList).getByRole('button', { name: 'Add Claude to #design' })
        await waitFor(() => expect(add).toBeEnabled())
        fireEvent.click(add)
        await waitFor(() => expect(within(spacesList).getAllByText('Added')).toHaveLength(2))
    })

    it('adds an Agent37 agent as one of the instances its key reaches; the instance decides the kind', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        fireEvent.click(screen.getByRole('radio', { name: 'Agent37' }))
        // No kind to pick: the instance runs one.
        expect(screen.queryByRole('radiogroup', { name: 'Agent' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Find instances' })).toBeDisabled()

        fireEvent.change(screen.getByLabelText('Agent37 API key'), { target: { value: 'sk_live_bad' } })
        fireEvent.click(screen.getByRole('button', { name: 'Find instances' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Agent37 did not accept this key')

        fireEvent.change(screen.getByLabelText('Agent37 API key'), { target: { value: 'sk_live_ab12' } })
        fireEvent.click(screen.getByRole('button', { name: 'Find instances' }))
        const list = await screen.findByRole('radiogroup', { name: 'Instance' })
        expect(within(list).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['main (ab12cd34ef)', 'claws (cd34ef56gh)', 'coder (ef56gh78ij)', 'A new instance'])
        expect(within(list).getByRole('radio', { name: 'coder (ef56gh78ij)' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Add agent' })).toBeDisabled()
        fireEvent.click(within(list).getByRole('radio', { name: 'claws (cd34ef56gh)' }))
        expect(screen.getByLabelText('Agent name')).toHaveValue('OpenClaw')

        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByRole('heading', { name: 'Connect OpenClaw' })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'OpenClaw', kind: 'openclaw', connection: 'agent37', credential: 'sk_live_ab12', instance: 'cd34ef56gh' })
        expect(invoke).not.toHaveBeenCalledWith('spaces:agent37CreateInstance', expect.anything())
        // On the instance: OpenClaw's own commands, with our MCP server on the new key, and its own address.
        fireEvent.click(screen.getAllByRole('button', { name: /Copy/ })[0]!)
        expect(vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0]).toBe(
            `openclaw mcp add rowboat --url 'https://rowboat.example/mcp' --transport streamable-http --header 'Authorization: Bearer ${NEW_KEY}'`,
        )
        expect(screen.getByText(/https:\/\/cd34ef56gh-7681\.agent37\.app/)).toBeInTheDocument()
        // The key on its own copies whole, though it reads shortened on screen.
        fireEvent.click(screen.getByRole('button', { name: 'Copy Agent key' }))
        expect(vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0]).toBe(NEW_KEY)
        expect(screen.queryByText(NEW_KEY)).toBeNull()
    })

    it('adds an Agent37 agent on a new instance, created with the key, a model budget and sleep', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add agent/ }))
        fireEvent.click(screen.getByRole('radio', { name: 'Agent37' }))
        fireEvent.change(screen.getByLabelText('Agent37 API key'), { target: { value: 'sk_live_ab12' } })
        fireEvent.click(screen.getByRole('button', { name: 'Find instances' }))
        fireEvent.click(within(await screen.findByRole('radiogroup', { name: 'Instance' })).getByRole('radio', { name: 'A new instance' }))
        fireEvent.click(within(screen.getByRole('radiogroup', { name: 'New instance runs' })).getByRole('radio', { name: 'OpenClaw' }))
        fireEvent.change(screen.getByLabelText('Monthly model budget'), { target: { value: '10' } })
        fireEvent.click(screen.getByLabelText('Sleep when idle'))
        fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Claws' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByRole('heading', { name: 'Connect Claws' })
        expect(invoke).toHaveBeenCalledWith('spaces:agent37CreateInstance', { key: 'sk_live_ab12', kind: 'openclaw', name: 'rowboat-claws', monthlyBudgetUsd: 10, autoSleep: false })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Claws', kind: 'openclaw', connection: 'agent37', credential: 'sk_live_ab12', instance: 'zz99' })
    })

    it('shows a Replicas agent’s key by its end, flags a rejected one, and lets its owner replace it', async () => {
        listing = [{ agent: claude, keys: [key('k3', 'claude')], credential: { hint: '…ab12', setBy: 'me', setAt: '2026-09-30T10:00:00Z', rejectedAt: '2026-09-30T11:00:00Z', rejectedReason: 'Replicas rejected this agent\'s API key.' } }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Claude')
        expect(screen.getByText(/Claude Code · via Replicas · Yours · 1 key/)).toBeInTheDocument()
        expect(screen.getByText(/Key rejected/)).toBeInTheDocument() // flagged on the list, too
        fireEvent.click(screen.getByRole('button', { name: /Claude/ }))
        expect(await screen.findByText(/Replicas key …ab12/)).toBeInTheDocument()
        expect(screen.getByText(/replace it to bring the agent back/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
        fireEvent.change(screen.getByLabelText('New Replicas key'), { target: { value: 'rpl_live_cd34' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAgentCredential', { orgId: 'org-1', agentId: 'claude', secret: 'rpl_live_cd34' }))
    })

    it('adds a Cal.com bot on its key, under Add bot, and says how to use it', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add bot/ }))
        expect(screen.getByRole('heading', { name: 'Add a bot' })).toBeInTheDocument()
        expect(within(screen.getByRole('radiogroup', { name: 'Which service' })).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['PostHog', 'Cal.com'])
        fireEvent.click(screen.getByRole('radio', { name: 'Cal.com' }))
        expect(screen.getByLabelText('Bot name')).toHaveValue('Cal')
        fireEvent.change(screen.getByLabelText('Cal.com API key'), { target: { value: 'cal_live_ab12' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add bot' }))
        await screen.findByRole('heading', { name: 'Connect Cal' })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Cal', kind: 'cal', connection: 'cal', credential: 'cal_live_ab12' })
        expect(screen.getByText(/such as @Cal today/)).toBeInTheDocument()
    })

    it('lets the owner send a bot’s alerts to a space, shows the address once, and turns them off', async () => {
        const withSpaces = { ...org, spaces: [{ id: 'S1', name: 'growth' }] } as unknown as OrgWithSpaces
        listing = [
            { agent: hermes, keys: [key('k1', 'hermes')] },
            { agent: cal, keys: [key('k5', 'cal')], credential: { hint: '…ab12', setBy: 'me', setAt: '2026-10-03T09:00:00Z' } },
        ]
        render(<AgentsDialog org={withSpaces} open onOpenChange={vi.fn()} />)
        await screen.findByText('Cal')
        // Bots are listed apart from agents, and labelled as bots.
        expect(within(screen.getByRole('region', { name: 'Agents' })).getByText('Hermes')).toBeInTheDocument()
        expect(within(screen.getByRole('region', { name: 'Bots' })).getByText('Cal.com bot · Yours · 1 key')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Cal/ }))
        fireEvent.change(await screen.findByLabelText('Space for alerts'), { target: { value: 'S1' } })
        listing = [listing[0]!, { ...listing[1]!, hook: { spaceId: 'S1', setBy: 'me', setAt: '2026-10-03T10:00:00Z' } }]
        fireEvent.click(screen.getByRole('button', { name: 'Get address' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAgentHook', { orgId: 'org-1', agentId: 'cal', spaceId: 'S1' }))
        fireEvent.click(await screen.findByRole('button', { name: `Copy URL` }))
        expect(vi.mocked(navigator.clipboard.writeText)).toHaveBeenCalledWith(HOOK_URL)
        expect(screen.getByText(/only time this address is shown/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Turn alerts off' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:clearAgentHook', { orgId: 'org-1', agentId: 'cal' }))
    })

    it('revokes on a second click', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Hermes/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
        expect(invoke).not.toHaveBeenCalledWith('spaces:revokeAgentKey', expect.anything())
        fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:revokeAgentKey', { orgId: 'org-1', agentId: 'hermes', keyId: 'k1' }))
    })

    it('lets an admin revoke someone else’s agent’s key, but not mint one', async () => {
        roster = [person('me', 'Ramnique', 'admin'), person('harsh', 'Harsh')]
        listing = [{ agent: scout, keys: [key('k5', 'scout')] }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Agent · Owned by Harsh · 1 key')
        fireEvent.click(screen.getByRole('button', { name: /Scout/ }))
        await screen.findByRole('heading', { name: 'Scout' })
        expect(screen.queryByRole('button', { name: /New key/ })).not.toBeInTheDocument()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument())
    })
})
