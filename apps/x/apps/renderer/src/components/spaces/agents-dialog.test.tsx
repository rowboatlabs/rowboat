import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

// The Terminal tab: xterm needs a real canvas, so a stand-in records what the screen does with it.
const term = { open: vi.fn(), loadAddon: vi.fn(), write: vi.fn(), focus: vi.fn(), dispose: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })), cols: 80, rows: 24, options: {} as Record<string, unknown> }
vi.mock('@xterm/xterm', () => ({
    Terminal: vi.fn(function Terminal() {
        return term
    }),
}))
vi.mock('@xterm/addon-fit', () => ({
    FitAddon: vi.fn(function FitAddon() {
        return { fit: vi.fn() }
    }),
}))
vi.mock('@/contexts/theme-context', () => ({ useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }) }))

/** Maritime's terminal socket as the test sees it: what was sent, and frames it can push. */
class FakeSocket {
    static instances: FakeSocket[] = []
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = FakeSocket.CONNECTING
    binaryType = 'blob'
    sent: Array<string | Uint8Array> = []
    onopen: ((ev: Event) => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null
    onclose: ((ev: CloseEvent) => void) | null = null
    onerror: ((ev: Event) => void) | null = null
    readonly url: string
    constructor(url: string) {
        this.url = url
        FakeSocket.instances.push(this)
    }
    send(data: string | Uint8Array) {
        this.sent.push(data)
    }
    close(code?: number, reason?: string) {
        this.readyState = FakeSocket.CLOSED
        this.onclose?.({ code, reason: reason ?? '' } as CloseEvent)
    }
    open() {
        this.readyState = FakeSocket.OPEN
        this.onopen?.(new Event('open'))
    }
    text(data: string) {
        this.onmessage?.({ data } as MessageEvent)
    }
    bytes(data: Uint8Array) {
        this.onmessage?.({ data: data.buffer } as MessageEvent)
    }
}

import { AgentsDialog } from './agents-dialog'
import { toast } from '@/lib/toast'

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
let provisionFails = false
let claudeInstalled = true
const joinedSpaces = new Set<string>()
let listing: spaces.AgentListing[]
// Create agent (2026-10-26): the kinds this org's Harbor creates; none = no Create button.
let managedKinds: string[] = []
const hosting = (status: spaces.AgentHosting['status'], extra: Partial<spaces.AgentHosting> = {}): spaces.AgentHosting =>
    ({ provider: 'maritime', status, externalId: 'agt-m1', funding: 'trial', trial: { endsAt: '2026-11-25T10:00:00Z' }, createdBy: 'me', createdAt: '2026-10-26T10:00:00Z', updatedAt: '2026-10-26T10:00:00Z', ...extra })
// Rowboat's credit (2026-10-27): what the stand-in Harbor says a trial agent has drawn.
let spend: spaces.HostingSpend | undefined = { spentCents: 120, limitCents: 500, limitReached: false, periodEnd: '2026-11-01T00:00:00Z' }
let options: Record<string, spaces.InvocationOption[]> = {}
let defaults: Record<string, Record<string, string | boolean>> = {}
const ENVIRONMENT: spaces.InvocationOption = { type: 'select', key: 'environment', label: 'Environment', choices: [{ id: 'env-web', label: 'web-app' }, { id: 'env-api', label: 'api' }] }
const PLAN: spaces.InvocationOption = { type: 'toggle', key: 'plan_first', label: 'Plan first' }
// The management area (2026-10-27): what the stand-in Harbor says about a managed VM.
let machineStatus = 'active'
let envVars: spaces.HostingEnvVar[] = []
let consoles = 0
let triggerList: spaces.HostingTrigger[] = []
let installedSkills: spaces.HostingSkill[] = []
const invoke = vi.fn(async (channel: string, args: Record<string, string>) => {
    switch (channel) {
        case 'spaces:listOrgMembers': return { members: roster }
        case 'spaces:listAgents': return { agents: listing }
        case 'spaces:openDirect': return { space: { id: `DM-${args.memberId}`, kind: 'direct' }, created: true }
        case 'spaces:addAgent':
            if (args.credential === 'attio_refused') throw new Error('Attio did not accept this key')
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
        case 'spaces:managedAgentKinds': return { kinds: managedKinds }
        case 'spaces:setAgentPersonal': {
            const on = (args as unknown as { personal: boolean }).personal
            listing = listing.map((l) => (l.agent.id === args.agentId ? { ...l, agent: { ...l.agent, personal: on } } : l))
            return { agent: listing.find((l) => l.agent.id === args.agentId)!.agent }
        }
        case 'spaces:createManagedAgent': {
            if (args.displayName === 'Over') throw new Error('Maritime: You are on the free plan, which includes 3 agents (you have 3). Upgrade to a paid plan to create more.')
            const agent = { ...hermes, id: 'new', displayName: args.displayName, agentKind: args.kind, agentConnection: 'maritime', agentInstance: 'agt-m1' } as spaces.Member
            // The listing shows it deploying from here on, as Harbor's would.
            listing = [...listing, { agent, keys: [key('k9', 'new')], credential: { hint: '…rbmk', setBy: 'me', setAt: '2026-10-26T10:00:00Z' }, hosting: hosting('deploying') }]
            return { agent, key: { ...key('k9', 'new'), secret: NEW_KEY }, hosting: hosting('deploying') }
        }
        case 'spaces:getHosting': return { hosting: listing.find((l) => l.agent.id === args.agentId)?.hosting ?? hosting('ready'), machine: { status: machineStatus, tier: 'always_on' }, env: envVars, ...(spend ? { spend } : {}) }
        case 'spaces:setHostingLlm': {
            const own = hosting('ready', { funding: 'own', trial: { endsAt: '2026-11-25T10:00:00Z', closedAt: '2026-10-27T10:00:00Z', closedReason: 'own_key' }, llm: { provider: args.provider as spaces.LlmProvider, keyHint: `…${args.apiKey!.slice(-4)}`, ...(args.model ? { model: args.model } : {}), setBy: 'me', setAt: '2026-10-27T10:00:00Z' } })
            listing = listing.map((l) => (l.agent.id === args.agentId ? { ...l, hosting: own } : l))
            return { hosting: own }
        }
        case 'spaces:hostingPower': machineStatus = args.action === 'sleep' ? 'sleeping' : 'active'; return { machine: { status: machineStatus } }
        case 'spaces:setHostingEnv': {
            const row: spaces.HostingEnvVar = { key: args.key!, secret: Boolean(args.secret), ...(args.secret ? {} : { value: args.value! }) }
            envVars = [...envVars.filter((v) => v.key !== args.key), row]
            return { env: envVars }
        }
        case 'spaces:deleteHostingEnv': envVars = envVars.filter((v) => v.key !== args.key); return { env: envVars }
        case 'spaces:runHostingCommand': return { execution: { id: 'x1', status: 'running' } }
        case 'spaces:openHostingConsole': return { console: { url: 'wss://api.maritime.sh/api/agents/agt-m1/terminal', token: `eu_console_${++consoles}`, expiresAt: '2026-10-30T06:00:00Z' } }
        case 'spaces:getHostingCommand': return { execution: { id: 'x1', status: 'completed', exitCode: 0, stdout: `ran ${'echo hello'}\n` } }
        case 'spaces:cancelHostingCommand': return { execution: { id: 'x1', status: 'cancelled' } }
        case 'spaces:getHostingLogs': return { logs: [{ id: 'l1', level: 'info', message: 'gateway booted', timestamp: '2026-10-27T10:00:00Z', source: 'agent' }] }
        case 'spaces:listHostingFiles': return { path: args.path, entries: [{ name: 'skills', path: `${args.path}/skills`, kind: 'dir' }, { name: 'config.yaml', path: `${args.path}/config.yaml`, kind: 'file', size: 377 }] }
        case 'spaces:readHostingFile': return { path: args.path, content: 'model: gpt-5.4', truncated: false }
        case 'spaces:writeHostingFile': return {}
        case 'spaces:makeHostingDir': return {}
        case 'spaces:moveHostingFile': return {}
        case 'spaces:deleteHostingFile': return {}
        case 'spaces:listHostingSkills': return { skills: args.q ? [{ name: 'github', installed: installedSkills.some((s) => s.name === 'github'), description: 'GitHub from the catalog' }] : installedSkills }
        case 'spaces:installHostingSkill': installedSkills = [...installedSkills, { name: args.name!, installed: true }]; return { skills: installedSkills }
        case 'spaces:removeHostingSkill': installedSkills = installedSkills.filter((s) => s.name !== args.name); return { skills: installedSkills }
        case 'spaces:listHostingTriggers': return { triggers: triggerList }
        case 'spaces:createHostingTrigger': triggerList = [...triggerList, { id: `t${triggerList.length + 1}`, type: args.type!, enabled: true, config: args.config as unknown as Record<string, unknown> }]; return { triggers: triggerList }
        case 'spaces:updateHostingTrigger': triggerList = triggerList.map((t) => (t.id === args.triggerId ? { ...t, enabled: Boolean(args.enabled) } : t)); return { triggers: triggerList }
        case 'spaces:deleteHostingTrigger': triggerList = triggerList.filter((t) => t.id !== args.triggerId); return { triggers: triggerList }
        case 'spaces:deleteManagedAgent': {
            listing = listing.map((l) => (l.agent.id === args.agentId ? { ...l, keys: l.keys.map((k) => ({ ...k, revokedAt: '2026-10-26T11:00:00Z' })), hosting: hosting('deleting', { updatedAt: '2026-10-26T11:00:00Z' }) } : l))
            return { hosting: hosting('deleting') }
        }
        case 'spaces:setAgentCredential': return { credential: { hint: `…${args.secret!.slice(-4)}`, setBy: 'me', setAt: '2026-09-30T12:00:00Z' } }
        case 'spaces:createAgentKey': return { key: { ...key('k2', args.agentId!), secret: ROTATED } }
        case 'spaces:revokeAgentKey': return { key: key(args.keyId!, args.agentId!, { revokedAt: '2026-09-29T11:00:00Z' }) }
        case 'spaces:getAgentCapabilities': return { capabilities: { stop: false, options: options[args.agentId!] ?? [] }, defaults: defaults[args.agentId!] ?? {} }
        case 'spaces:setAgentHook': return { hook: { spaceId: args.spaceId, setBy: 'me', setAt: '2026-10-03T10:00:00Z' }, url: HOOK_URL }
        case 'spaces:clearAgentHook': return {}
        case 'spaces:listMembers': return { members: joinedSpaces.has(args.spaceId!) ? [{ id: 'new', displayName: 'Claude', kind: 'agent' }] : [] }
        case 'spaces:addMembers': joinedSpaces.add(args.spaceId!); return { memberships: [] }
        case 'spaces:setAgentOptionDefaults': return { defaults: (args as unknown as { defaults: Record<string, string | boolean> }).defaults }
        // Local agents (2026-10-28): what this computer runs, and code mode's engines.
        case 'spaces:localAgents': return { agents: [], defaultCwd: '/Users/me/code/rowboat' }
        case 'codeMode:checkAgentStatus': return { claude: { installed: claudeInstalled, signedIn: true }, codex: { installed: false, signedIn: false } }
        case 'dialog:openDirectory': return { path: '/Users/me/code/site' }
        // Agent personalities (2026-10-29).
        case 'spaces:writeAgentInstructions': return { instructions: `You are ${args.name}, a terse reviewer.\n- Run the tests first.` }
        case 'spaces:setAgentProfile': {
            const a = listing.find((l) => l.agent.id === args.agentId)!.agent
            const agent = { ...a, ...(args.title ? { title: args.title } : {}), ...(args.instructions ? { instructions: args.instructions } : {}) } as spaces.Member
            listing = listing.map((l) => (l.agent.id === args.agentId ? { ...l, agent } : l))
            return { agent }
        }
        case 'codeMode:provisionEngine': return provisionFails ? { success: false, error: 'download failed' } : { success: true }
        case 'spaces:addLocalAgent': {
            const agent = { id: 'new', displayName: args.displayName, role: 'member', kind: 'agent', ownerId: 'me', agentKind: args.kind, agentConnection: 'local', personal: true } as spaces.Member
            listing = [...listing, { agent, keys: [key('k9', 'new')] }]
            return { agent }
        }
    }
    throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
    consoles = 0
    FakeSocket.instances = []
    term.write.mockClear()
    vi.stubGlobal('WebSocket', FakeSocket)
    invoke.mockClear()
    joinedSpaces.clear()
    window.localStorage.clear()
    roster = [person('me', 'Ramnique'), person('harsh', 'Harsh')]
    managedKinds = []
    machineStatus = 'active'
    spend = { spentCents: 120, limitCents: 500, limitReached: false, periodEnd: '2026-11-01T00:00:00Z' }
    envVars = [{ key: 'PATH', secret: false, value: '/opt/hermes/bin:/usr/bin' }]
    triggerList = []
    installedSkills = [{ name: 'rowboat-spaces', installed: true, version: '1.0.0' }]
    options = {}
    defaults = {}
    listing = [{ agent: hermes, keys: [key('k1', 'hermes', { lastUsedAt: '2026-09-29T10:30:00Z' }), key('k0', 'hermes', { revokedAt: '2026-09-28T10:00:00Z' })] }]
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
})

// New agent opens the chooser (2026-10-28): where it runs, then that path's form.
const PATHS = { local: /^On this computer/, rowboat: /^Rowboat runs it/, connect: /^Connect one you already run/ } as const
async function newAgent(path: keyof typeof PATHS) {
    fireEvent.click(await screen.findByRole('button', { name: /New agent/ }))
    fireEvent.click(await screen.findByRole('button', { name: PATHS[path] }))
}

const setupsOffered = () => within(screen.getByRole('radiogroup', { name: 'How it connects' })).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))

// The Agents dialog (2026-09-29; screens 2026-09-30; the agent's page 2026-10-01): the list, adding one, connecting it, its page.
describe('AgentsDialog', () => {
    it('opens on the list: a roster to click into, and New agent — nothing else', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        expect(screen.getByText('Hermes · Channel · Yours · 1 key')).toBeInTheDocument()
        expect(screen.queryByText(/Key made/)).toBeNull()
        expect(screen.getByRole('button', { name: /New agent/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Create agent/ })).toBeNull()
        expect(screen.queryByRole('radiogroup')).toBeNull()
        expect(screen.queryByText(/only time its key is shown/)).toBeNull()
    })

    it('adds your own Claude Code on this computer: always personal, a folder and approvals, nothing to connect', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('local')
        expect(screen.getByRole('radio', { name: 'On this computer' })).toHaveAttribute('aria-checked', 'true')
        // Personal, with no switch: it runs on your computer.
        expect(screen.queryByRole('radiogroup', { name: 'Who can use it' })).toBeNull()
        expect(screen.getByText(/it runs on your computer, so only you can mention it/)).toBeInTheDocument()
        expect(screen.getByLabelText('Agent name')).toHaveValue("Ramnique's Claude Code")
        // Enabled and signed in here: the card says it is ready.
        expect(await screen.findByText('Claude Code is ready on this computer')).toBeInTheDocument()
        // Code mode's default project until you pick another folder.
        expect(await screen.findByText('/Users/me/code/rowboat')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
        expect(await screen.findByText('/Users/me/code/site')).toBeInTheDocument()
        // Approving everything is the default; the owner can ask to be asked.
        expect(screen.getByRole('radio', { name: 'Approve everything' })).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(screen.getByRole('radio', { name: 'Ask before changes' }))

        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await waitFor(() =>
            expect(invoke).toHaveBeenCalledWith('spaces:addLocalAgent', { orgId: 'org-1', displayName: "Ramnique's Claude Code", kind: 'claude-code', cwd: '/Users/me/code/site', policy: 'auto-approve-reads' }),
        )
        // The app is its connector: no key to paste, straight to its page.
        expect(invoke).not.toHaveBeenCalledWith('spaces:addAgent', expect.anything())
        expect(await screen.findByRole('heading', { name: "Ramnique's Claude Code" })).toBeInTheDocument()
        expect(toast).toHaveBeenCalledWith("Ramnique's Claude Code added", 'success', 2000)
        expect(screen.queryByText(/only time its key is shown/)).toBeNull()
    })

    it('gives a new agent a description and a personality written from a few words, both optional (2026-10-29)', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('local')
        await screen.findByText('Claude Code is ready on this computer')
        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reviews pull requests' } })
        expect(screen.getByRole('button', { name: 'Write' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Describe its personality'), { target: { value: 'a terse reviewer' } })
        fireEvent.click(screen.getByRole('button', { name: 'Write' }))
        await waitFor(() => expect(screen.getByLabelText('Personality')).toHaveValue("You are Ramnique's Claude Code, a terse reviewer.\n- Run the tests first."))
        expect(invoke).toHaveBeenCalledWith('spaces:writeAgentInstructions', { name: "Ramnique's Claude Code", kind: 'Claude Code', brief: 'a terse reviewer' })
        // Editable after it is written.
        fireEvent.change(screen.getByLabelText('Personality'), { target: { value: 'You are terse.' } })
        expect(screen.getByRole('button', { name: 'Rewrite' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAgentProfile', { orgId: 'org-1', agentId: 'new', title: 'Reviews pull requests', instructions: 'You are terse.' }))
        // Its page shows them, for its owner to change.
        expect(await screen.findByDisplayValue('You are terse.')).toBeInTheDocument()
    })

    it('saves no profile when both are left empty', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('connect')
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByRole('heading', { name: 'Connect Hermes' })
        expect(invoke).not.toHaveBeenCalledWith('spaces:setAgentProfile', expect.anything())
    })

    it('enables a local Codex during setup, then adds it', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('local')
        fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
        // Not enabled here yet: the card says so and offers it, and Add enables it anyway. No trip to Settings.
        const card = await screen.findByRole('status', { name: 'Codex on this computer' })
        await within(card).findByText('Enable Codex for Rowboat')
        expect(within(card).getByText(/installs the Codex engine and uses your own Codex login on this computer/)).toBeInTheDocument()
        expect(within(card).getByRole('button', { name: 'Enable now' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Enable Codex and add' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeMode:provisionEngine', { agent: 'codex' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:addLocalAgent', expect.objectContaining({ kind: 'codex' })))
        const order = invoke.mock.calls.map(([channel]) => channel)
        expect(order.indexOf('codeMode:provisionEngine')).toBeLessThan(order.indexOf('spaces:addLocalAgent'))
    })

    it('says why when enabling the engine fails, and offers to try again', async () => {
        // Claude Code here, so Codex's install in the test above stays its own.
        claudeInstalled = false
        provisionFails = true
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('local')
        await screen.findByText('Enable Claude Code for Rowboat')
        fireEvent.click(within(screen.getByRole('status', { name: 'Claude Code on this computer' })).getByRole('button', { name: 'Enable now' }))
        const card = await screen.findByRole('alert', { name: 'Claude Code on this computer' })
        expect(within(card).getByText('Couldn’t enable Claude Code')).toBeInTheDocument()
        expect(within(card).getByText('download failed')).toBeInTheDocument()
        expect(within(card).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
        expect(invoke).not.toHaveBeenCalledWith('spaces:addLocalAgent', expect.anything())
        claudeInstalled = true
        provisionFails = false
    })

    it('adds a Hermes agent: pick how it connects and a name, then have Hermes connect itself', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('connect')
        // On this computer is its own path on the chooser, not one of these.
        expect(setupsOffered()).toEqual(['Hermes', 'Replicas', 'Agent37', 'Maritime', 'Conductor', 'Custom'])
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
        await screen.findByRole('button', { name: /New agent/ })
    })

    it('adds a custom agent: the key and the endpoints, by hand', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('connect')
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

    it('adds a personal agent: named for you until you type one, sent as personal (2026-10-26)', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('connect')
        fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
        expect(screen.getByRole('radio', { name: 'Channel' })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByLabelText('Agent name')).toHaveValue('Agent')
        fireEvent.click(screen.getByRole('radio', { name: 'Personal' }))
        expect(screen.getByLabelText('Agent name')).toHaveValue("Ramnique's Agent")
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByRole('heading', { name: "Connect Ramnique's Agent" })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: "Ramnique's Agent", kind: 'custom', connection: 'contract', personal: true })
    })

    it('marks a personal agent in the list', async () => {
        listing = [{ agent: { ...hermes, personal: true }, keys: [key('k1', 'hermes')] }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        expect(await screen.findByText('Hermes · Personal · Yours · 1 key')).toBeInTheDocument()
    })

    it('creates a personal agent on Maritime too, named for you (2026-10-27)', async () => {
        managedKinds = ['hermes', 'claude-code', 'codex']
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await newAgent('rowboat')
        await screen.findByRole('heading', { name: 'Create an agent' })
        expect(screen.getByRole('radio', { name: 'Channel' })).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(screen.getByRole('radio', { name: 'Personal' }))
        expect(screen.getByLabelText('Agent name')).toHaveValue("Ramnique's Hermes")
        fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
        await screen.findByRole('heading', { name: "Ramnique's Hermes" })
        expect(invoke).toHaveBeenCalledWith('spaces:createManagedAgent', { orgId: 'org-1', displayName: "Ramnique's Hermes", kind: 'hermes', personal: true })
    })

    it('its owner switches it between channel and personal from its page (2026-10-27)', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Hermes/ }))
        const access = await screen.findByRole('radiogroup', { name: 'Who can use it' })
        expect(within(access).getByRole('radio', { name: 'Channel' })).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(within(access).getByRole('radio', { name: 'Personal' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAgentPersonal', { orgId: 'org-1', agentId: 'hermes', personal: true }))
        await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Who can use it' })).getByRole('radio', { name: 'Personal' })).toHaveAttribute('aria-checked', 'true'))
        expect(screen.getByText(/Hermes · Personal · Yours/)).toBeInTheDocument()
    })

    it('someone else’s agent says which it is, with no switch', async () => {
        listing = [{ agent: { ...scout, personal: true }, keys: [key('k5', 'scout')] }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Scout/ }))
        expect(await screen.findByText(/Personal: only its owner can mention it or DM it/)).toBeInTheDocument()
        expect(screen.queryByRole('radiogroup', { name: 'Who can use it' })).toBeNull()
    })

    it('switching kind keeps a typed name; Back returns to the chooser, then the list', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('connect')
        fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Athena' } })
        fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
        expect(screen.getByLabelText('Agent name')).toHaveValue('Athena')
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
        expect(await screen.findByText('Where should it run?')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
        expect(await screen.findByText('Hermes · Channel · Yours · 1 key')).toBeInTheDocument()
    })

    it('an agent’s page shows its setup any time, its key a placeholder until a new one fills it in', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Hermes/ }))
        await screen.findByRole('heading', { name: 'Hermes' })
        expect(screen.getAllByText(/Key made .* · last used/)).toHaveLength(1) // the live key, not the revoked one
        expect(screen.queryByRole('heading', { name: 'Defaults' })).toBeNull() // Hermes declares no options
        expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Setup']) // nothing to put in a Danger zone
        fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
        expect(await screen.findByText(/ROWBOAT_AGENT_KEY 'YOUR_AGENT_KEY'/)).toBeInTheDocument()
        expect(screen.getByText(/A key is shown only once/)).toBeInTheDocument()
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
        await newAgent('connect')
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
        expect(screen.queryByRole('heading', { name: /^Connect (?!an agent you run)/ })).toBeNull()

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
        await newAgent('connect')
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
        await newAgent('connect')
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
        await newAgent('connect')
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
        await newAgent('connect')
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
        expect(screen.getByText(/Claude Code · via Replicas · Channel · Yours · 1 key/)).toBeInTheDocument()
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
        expect(within(screen.getByRole('radiogroup', { name: 'Which service' })).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['PostHog', 'Cal.com', 'Attio'])
        fireEvent.click(screen.getByRole('radio', { name: 'Cal.com' }))
        expect(screen.getByLabelText('Bot name')).toHaveValue('Cal')
        fireEvent.change(screen.getByLabelText('Cal.com API key'), { target: { value: 'cal_live_ab12' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add bot' }))
        await screen.findByRole('heading', { name: 'Connect Cal' })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Cal', kind: 'cal', connection: 'cal', credential: 'cal_live_ab12' })
        expect(screen.getByText(/such as @Cal today/)).toBeInTheDocument()
    })

    it('adds Attio with read permissions and sharing guidance, and keeps a refused key editable', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.click(screen.getByRole('button', { name: /Add bot/ }))
        fireEvent.click(screen.getByRole('radio', { name: 'Attio' }))
        expect(screen.getByLabelText('Bot name')).toHaveValue('Attio')
        expect(screen.getByLabelText('Attio workspace API key')).toHaveAttribute('type', 'password')
        expect(screen.getByRole('button', { name: 'Add bot' })).toBeDisabled()
        expect(screen.getByText(/object_configuration:read and record_permission:read/)).toHaveTextContent('replies are visible to everyone in that space')
        fireEvent.change(screen.getByLabelText('Attio workspace API key'), { target: { value: 'attio_refused' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add bot' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Attio did not accept this key')
        expect(screen.getByRole('heading', { name: 'Add a bot' })).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Attio workspace API key'), { target: { value: 'attio_good' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add bot' }))
        await screen.findByRole('heading', { name: 'Connect Attio' })
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Attio', kind: 'attio', connection: 'attio', credential: 'attio_good' })
        expect(screen.getByText(/@Attio company acme.com/)).toBeInTheDocument()
        expect(screen.getByText(/@Attio person jane@acme.com/)).toBeInTheDocument()
        expect(screen.getByText(/@Attio record companies/)).toBeInTheDocument()
        expect(screen.queryByText(/Send its alerts/)).toBeNull()
    })

    it.each([true, false])('shows Attio as a bot and restricts credential replacement to its owner (owner: %s)', async (owner) => {
        roster = [person('me', 'Ramnique', 'admin'), person('harsh', 'Harsh')]
        const attio = { ...cal, id: 'attio', displayName: 'Attio', agentKind: 'attio', agentConnection: 'attio', ownerId: owner ? 'me' : 'harsh' }
        listing = [{ agent: attio, keys: [], credential: { hint: '…ab12', setBy: attio.ownerId!, setAt: '2026-10-12T10:00:00Z', rejectedAt: '2026-10-12T11:00:00Z', rejectedReason: 'Attio rejected this key.' } }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        expect(await screen.findByRole('region', { name: 'Bots' })).toHaveTextContent('Attio bot')
        fireEvent.click(screen.getByRole('button', { name: /Attio/ }))
        expect(await screen.findByText(/Attio key …ab12/)).toBeInTheDocument()
        expect(screen.getByText(/replace it to bring the agent back/)).toBeInTheDocument()
        expect(screen.queryByRole('tab', { name: 'Alerts' })).toBeNull() // a bot without alerts has no Alerts tab
        fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
        expect(screen.getByText(/@Attio company acme.com/)).toBeInTheDocument()
        expect(screen.queryByText(/Send its alerts/)).toBeNull()
        fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
        if (owner) {
            fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
            fireEvent.change(screen.getByLabelText('New Attio key'), { target: { value: 'attio_replacement' } })
            fireEvent.click(screen.getByRole('button', { name: 'Save' }))
            await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAgentCredential', { orgId: 'org-1', agentId: 'attio', secret: 'attio_replacement' }))
        } else {
            expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
        }
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
        expect(within(screen.getByRole('region', { name: 'Bots' })).getByText('Cal.com bot · Channel · Yours · 1 key')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Cal/ }))
        fireEvent.click(await screen.findByRole('tab', { name: 'Alerts' }))
        expect(screen.queryByRole('tab', { name: 'Danger zone' })).toBeNull() // nothing to turn off yet
        fireEvent.change(await screen.findByLabelText('Space for alerts'), { target: { value: 'S1' } })
        listing = [listing[0]!, { ...listing[1]!, hook: { spaceId: 'S1', setBy: 'me', setAt: '2026-10-03T10:00:00Z' } }]
        fireEvent.click(screen.getByRole('button', { name: 'Get address' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAgentHook', { orgId: 'org-1', agentId: 'cal', spaceId: 'S1' }))
        fireEvent.click(await screen.findByRole('button', { name: `Copy URL` }))
        expect(vi.mocked(navigator.clipboard.writeText)).toHaveBeenCalledWith(HOOK_URL)
        expect(screen.getByText(/only time this address is shown/)).toBeInTheDocument()
        fireEvent.click(await screen.findByRole('tab', { name: 'Danger zone' }))
        fireEvent.click(screen.getByRole('button', { name: 'Turn alerts off' }))
        expect(invoke).not.toHaveBeenCalledWith('spaces:clearAgentHook', expect.anything())
        fireEvent.click(screen.getByRole('button', { name: 'Confirm turn off' }))
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

    // Create agent (2026-10-26): Rowboat runs it on its own Maritime account; the page follows it to ready, and deletes it.
    it('creates a Hermes agent on Rowboat’s Maritime: a kind, a name, the spaces; then its page shows it deploying, and ready once it is', async () => {
        managedKinds = ['hermes', 'claude-code', 'codex']
        const orgWithSpaces = { ...org, spaces: [{ id: 'eng', name: 'eng', kind: 'channel' }, { id: 'design', name: 'design', kind: 'channel' }] } as unknown as OrgWithSpaces
        render(<AgentsDialog org={orgWithSpaces} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await newAgent('rowboat')
        await screen.findByRole('heading', { name: 'Create an agent' })
        const kinds = screen.getByRole('radiogroup', { name: 'Agent' })
        expect(within(kinds).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Hermes', 'Claude Code', 'Codex'])
        expect(within(kinds).getByRole('radio', { name: 'Hermes' })).toHaveAttribute('aria-checked', 'true')
        // No key to paste: Rowboat's own account runs it.
        expect(screen.queryByLabelText(/API key/)).toBeNull()
        expect(screen.getByLabelText('Agent name')).toHaveValue('Hermes')
        fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Scout' } })
        fireEvent.click(within(screen.getByRole('list', { name: 'Add it to' })).getByRole('checkbox', { name: '#design' }))
        fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

        // Straight to its page: nothing to connect.
        await screen.findByRole('heading', { name: 'Scout' })
        expect(invoke).toHaveBeenCalledWith('spaces:createManagedAgent', { orgId: 'org-1', displayName: 'Scout', kind: 'hermes' })
        expect(invoke).toHaveBeenCalledWith('spaces:addMembers', { orgId: 'org-1', spaceId: 'eng', memberIds: ['new'] })
        expect(invoke).not.toHaveBeenCalledWith('spaces:addMembers', { orgId: 'org-1', spaceId: 'design', memberIds: ['new'] })
        expect(invoke).toHaveBeenCalledWith('spaces:openDirect', { orgId: 'org-1', memberId: 'new' })
        expect(screen.getByRole('status')).toHaveTextContent('Deploying on Maritime')
        // No setup steps, and Rowboat's Maritime key is not the owner's to see or replace.
        expect(screen.queryByText('Nothing to set up on Maritime')).toBeNull()
        expect(screen.queryByText(/Maritime key …/)).toBeNull()
        expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()

        // The page keeps asking while it moves; once Maritime has it up and taking commands, it says so.
        listing = listing.map((l) => (l.agent.id === 'new' ? { ...l, hosting: hosting('ready', { updatedAt: '2026-10-26T10:03:00Z' }) } : l))
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Running on Rowboat's Maritime account since .*2026\. It sleeps between turns/), { timeout: 6_000 })
        // The list reads it like any agent of yours.
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
        await screen.findByText('Hermes · via Maritime · Channel · Yours · 1 key')
    }, 10_000)

    it('creates Claude Code with the person’s Anthropic key and environment variables, which travel once', async () => {
        managedKinds = ['hermes', 'claude-code', 'codex']
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await newAgent('rowboat')
        fireEvent.click(screen.getByRole('radio', { name: 'Claude Code' }))
        expect(screen.getByLabelText('Agent name')).toHaveValue('Claude Code')
        // Not without the key it runs on.
        expect(screen.getByRole('button', { name: 'Create agent' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-1' } })
        expect(screen.getByRole('button', { name: 'Create agent' })).toBeEnabled()
        fireEvent.click(screen.getByRole('button', { name: 'Environment variables' }))
        fireEvent.change(screen.getByLabelText('Environment variables'), { target: { value: 'GH_TOKEN=ghp_x\nnot a variable' } })
        expect(screen.getByText('Not a KEY=value line: not a variable')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Create agent' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Environment variables'), { target: { value: 'GH_TOKEN=ghp_x\n\n# a comment\nREPO=rowboat' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
        await screen.findByRole('heading', { name: 'Claude Code' })
        expect(invoke).toHaveBeenCalledWith('spaces:createManagedAgent', {
            orgId: 'org-1',
            displayName: 'Claude Code',
            kind: 'claude-code',
            anthropicApiKey: 'sk-ant-1',
            env: [{ key: 'GH_TOKEN', value: 'ghp_x' }, { key: 'REPO', value: 'rowboat' }],
        })
    })

    it('New agent asks where it runs: this computer, Rowboat, or one you already run; a bot is the small print', async () => {
        managedKinds = ['hermes', 'claude-code', 'codex']
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /New agent/ }))
        expect(await screen.findByText('Where should it run?')).toBeInTheDocument()
        await screen.findByRole('button', { name: PATHS.rowboat })
        expect(screen.getAllByRole('button', { name: /^(On this computer|Rowboat runs it|Connect one you already run)/ }).map((b) => b.querySelector('.font-medium')?.textContent)).toEqual([
            'On this computer',
            'Rowboat runs it',
            'Connect one you already run',
        ])
        // Each path, and Back to the chooser.
        fireEvent.click(screen.getByRole('button', { name: PATHS.rowboat }))
        await screen.findByRole('radiogroup', { name: 'Agent' })
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
        fireEvent.click(await screen.findByRole('button', { name: PATHS.local }))
        expect(await screen.findByRole('heading', { name: 'Run an agent on this computer' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
        fireEvent.click(await screen.findByRole('button', { name: /Looking for a bot/ }))
        expect(await screen.findByRole('radiogroup', { name: 'Which service' })).toBeInTheDocument()
    })

    it('offers Rowboat runs it only on a Harbor that creates agents', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:managedAgentKinds', { orgId: 'org-1' }))
        fireEvent.click(screen.getByRole('button', { name: /New agent/ }))
        await screen.findByRole('button', { name: PATHS.connect })
        expect(screen.queryByRole('button', { name: PATHS.rowboat })).toBeNull()
    })

    it('shows Maritime’s refusal under the form; nothing was created', async () => {
        managedKinds = ['hermes']
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await newAgent('rowboat')
        // Only what this Harbor creates is offered.
        expect(within(screen.getByRole('radiogroup', { name: 'Agent' })).getAllByRole('radio')).toHaveLength(1)
        fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Over' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Maritime: You are on the free plan')
        expect(screen.getByRole('heading', { name: 'Create an agent' })).toBeInTheDocument()
        expect(invoke).not.toHaveBeenCalledWith('spaces:addMembers', expect.anything())
    })

    it('deletes a managed agent from Maritime on a second click; an admin may, a member may not', async () => {
        const scoutM = { ...scout, id: 'sm', displayName: 'Scout', agentKind: 'codex', agentConnection: 'maritime', agentInstance: 'agt-m1' } as spaces.Member
        listing = [{ agent: scoutM, keys: [key('k7', 'sm')], hosting: hosting('ready') }]
        const { unmount } = render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        // Harsh's agent: another member may look, not delete; an admin may.
        await screen.findByText(/Codex · via Maritime · Channel · Owned by Harsh/)
        fireEvent.click(screen.getByRole('button', { name: /Scout/ }))
        expect(await screen.findByRole('status')).toHaveTextContent(/Running on Rowboat's Maritime account/)
        expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview']) // not theirs to manage
        unmount()
        roster = [person('me', 'Ramnique', 'admin'), person('harsh', 'Harsh')]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Scout/ }))
        fireEvent.click(await screen.findByRole('tab', { name: 'Danger zone' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Delete agent' }))
        // Its name, typed, is the confirmation.
        expect(screen.getByRole('button', { name: 'Delete Scout' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Scout' } })
        fireEvent.click(screen.getByRole('button', { name: 'Delete Scout' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:deleteManagedAgent', { orgId: 'org-1', agentId: 'sm' }))
        // Back on Overview: the Danger zone has nothing left.
        expect(await screen.findByRole('status')).toHaveTextContent('Removing from Maritime')
        expect(screen.queryByRole('tab', { name: 'Danger zone' })).toBeNull()
        expect(screen.getByText('No active keys.')).toBeInTheDocument()
    })

    // The management area (2026-10-27): the owner manages the VM from the page.
    const jarvis = { ...hermes, id: 'jv', displayName: 'Jarvis', agentConnection: 'maritime', agentInstance: 'agt-m1' } as spaces.Member
    const openJarvis = async () => {
        listing = [{ agent: jarvis, keys: [key('k8', 'jv')], hosting: hosting('ready') }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Jarvis/ }))
        return await screen.findByRole('group', { name: 'Machine' })
    }

    it('shows the machine as Maritime sees it, and puts it to sleep and wakes it', async () => {
        const machine = await openJarvis()
        expect(within(machine).getByText('active')).toBeInTheDocument()
        expect(within(machine).getByText('always on tier · as Maritime sees it')).toBeInTheDocument()
        expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Environment1', 'Commands', 'Terminal', 'Logs', 'Files', 'Skills', 'Automations', 'Danger zone'])
        fireEvent.click(within(machine).getByRole('button', { name: 'Sleep' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:hostingPower', { orgId: 'org-1', agentId: 'jv', action: 'sleep' }))
        expect(await within(machine).findByRole('button', { name: 'Wake' })).toBeInTheDocument()
        expect(within(machine).getByText('sleeping')).toBeInTheDocument()
    })

    it('environment variables: a secret is added without ever showing, replaced from its row, and deleted from the Danger zone', async () => {
        await openJarvis()
        fireEvent.click(screen.getByRole('tab', { name: /Environment/ }))
        const list = await screen.findByRole('list', { name: 'Environment variables' })
        expect(within(list).getByText('PATH')).toBeInTheDocument()
        expect(within(list).queryByRole('button', { name: /Delete/ })).toBeNull() // that is on the Danger zone
        fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'gh_token' } })
        fireEvent.change(screen.getByLabelText('Variable value'), { target: { value: 'ghp_x' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setHostingEnv', { orgId: 'org-1', agentId: 'jv', key: 'GH_TOKEN', value: 'ghp_x', secret: true }))
        expect(await within(list).findByText('GH_TOKEN')).toBeInTheDocument()
        expect(within(list).getByText('secret')).toBeInTheDocument()
        expect(within(list).queryByText('ghp_x')).toBeNull()
        expect(screen.getByRole('tab', { name: /Environment/ })).toHaveTextContent('2')
        // Replace fills the form with the row's name; the value is typed anew.
        fireEvent.click(within(list).getAllByRole('button', { name: 'Replace' })[1]!)
        expect(screen.getByLabelText('Variable name')).toHaveValue('GH_TOKEN')
        expect(screen.getByRole('button', { name: 'Replace variable' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('tab', { name: 'Danger zone' }))
        fireEvent.change(await screen.findByLabelText('Variable'), { target: { value: 'GH_TOKEN' } })
        fireEvent.click(screen.getByRole('button', { name: 'Delete variable' }))
        expect(invoke).not.toHaveBeenCalledWith('spaces:deleteHostingEnv', expect.anything())
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete GH_TOKEN' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:deleteHostingEnv', { orgId: 'org-1', agentId: 'jv', key: 'GH_TOKEN' }))
        expect(await screen.findByLabelText('Variable')).toHaveValue('PATH')
    })

    it('runs a command and shows its output and exit status', async () => {
        await openJarvis()
        fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
        fireEvent.change(await screen.findByLabelText('Command'), { target: { value: 'echo hello' } })
        fireEvent.click(screen.getByRole('button', { name: 'Run' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:runHostingCommand', { orgId: 'org-1', agentId: 'jv', command: 'echo hello' }))
        expect(await screen.findByLabelText('Command output', {}, { timeout: 3000 })).toHaveTextContent('ran echo hello')
        expect(screen.getByText('Exited 0.')).toBeInTheDocument()
    })

    it('the Terminal tab is a live shell: Harbor mints a console token, the browser opens Maritime’s socket with it, and a drop offers Reconnect', async () => {
        await openJarvis()
        fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }))
        expect(await screen.findByText('Opening a console…')).toBeInTheDocument()
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:openHostingConsole', { orgId: 'org-1', agentId: 'jv' }))
        await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
        const ws = FakeSocket.instances[0]!
        expect(ws.url).toBe('wss://api.maritime.sh/api/agents/agt-m1/terminal?token=eu_console_1')
        expect(ws.binaryType).toBe('arraybuffer')
        act(() => ws.open())
        expect(await screen.findByText('Connected. Leaving the page ends the session.')).toBeInTheDocument()
        // The size goes up first; the platform's pings are answered; its bytes are the terminal's.
        expect(ws.sent[0]).toBe(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }))
        act(() => ws.text(JSON.stringify({ type: 'ping' })))
        expect(ws.sent.at(-1)).toBe(JSON.stringify({ type: 'pong' }))
        act(() => ws.bytes(new TextEncoder().encode('# ')))
        expect(Array.from(term.write.mock.calls.at(-1)![0] as Uint8Array)).toEqual([35, 32])
        // Keystrokes go down as bytes.
        const onData = (term.onData.mock.calls.at(-1) as unknown as [(data: string) => void])[0]
        act(() => onData('ls\n'))
        expect(Array.from(ws.sent.at(-1) as Uint8Array)).toEqual([108, 115, 10])
        // A drop says so; Reconnect asks Harbor for a new token and opens a new socket.
        act(() => ws.close(1006, 'gone'))
        expect(await screen.findByText('Disconnected.')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
        await waitFor(() => expect(FakeSocket.instances).toHaveLength(2))
        expect(FakeSocket.instances[1]!.url).toBe('wss://api.maritime.sh/api/agents/agt-m1/terminal?token=eu_console_2')
    })

    it('logs, files, skills and automations load when their tab is chosen; removing is on the Danger zone', async () => {
        await openJarvis()
        fireEvent.click(screen.getByRole('tab', { name: 'Logs' }))
        expect(await screen.findByText(/gateway booted/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Warnings' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:getHostingLogs', { orgId: 'org-1', agentId: 'jv', limit: 100, level: 'warning' }))

        fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
        const files = await screen.findByRole('list', { name: 'Files' })
        expect(invoke).toHaveBeenCalledWith('spaces:listHostingFiles', { orgId: 'org-1', agentId: 'jv', path: '/opt/data' })
        fireEvent.click(within(files).getByRole('button', { name: /config\.yaml/ }))
        expect(await screen.findByLabelText('File content')).toHaveValue('model: gpt-5.4')

        fireEvent.click(screen.getByRole('tab', { name: 'Skills' }))
        expect(await within(await screen.findByRole('list', { name: 'Installed skills' })).findByText('rowboat-spaces')).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Skill search'), { target: { value: 'git' } })
        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        const catalog = await screen.findByRole('list', { name: 'Catalog skills' })
        fireEvent.click(within(catalog).getByRole('button', { name: 'Install' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:installHostingSkill', { orgId: 'org-1', agentId: 'jv', name: 'github' }))

        fireEvent.click(screen.getByRole('tab', { name: 'Automations' }))
        expect(await screen.findByText('No automations yet.')).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: '0 9 * * 1-5' } })
        fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Summarize #main and post it there' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add automation' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:createHostingTrigger', { orgId: 'org-1', agentId: 'jv', type: 'cron', config: { schedule: '0 9 * * 1-5', prompt: 'Summarize #main and post it there' } }))
        const automations = await screen.findByRole('list', { name: 'Automations' })
        expect(within(automations).getByText('0 9 * * 1-5')).toBeInTheDocument()
        expect(within(automations).getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true')
        expect(within(automations).queryByRole('button', { name: /Delete/ })).toBeNull()

        // The Danger zone picks from what the tabs loaded: the installed skill, the automation, any path.
        fireEvent.click(screen.getByRole('tab', { name: 'Danger zone' }))
        fireEvent.change(await screen.findByLabelText('Skill'), { target: { value: 'github' } })
        fireEvent.click(screen.getByRole('button', { name: 'Remove skill' }))
        fireEvent.click(screen.getByRole('button', { name: 'Confirm remove github' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:removeHostingSkill', { orgId: 'org-1', agentId: 'jv', name: 'github' }))
        fireEvent.click(screen.getByRole('button', { name: 'Delete automation' }))
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:deleteHostingTrigger', { orgId: 'org-1', agentId: 'jv', triggerId: 't1' }))
        fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/opt/data/workspace/old' } })
        fireEvent.click(screen.getByRole('button', { name: 'Delete path' }))
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:deleteHostingFile', { orgId: 'org-1', agentId: 'jv', path: '/opt/data/workspace/old' }))
        expect(screen.getByRole('tab', { name: /^Automations/ })).toHaveTextContent('Automations0')
    })

    // Trial credit, then the owner's key (2026-10-27): first thing on Overview.
    it('shows the trial’s credit and the way out of it; the owner’s key ends the trial and the agent runs on it', async () => {
        await openJarvis()
        const access = screen.getByRole('group', { name: 'Model access' })
        expect(within(access).getByText("On Rowboat's trial credit")).toBeInTheDocument()
        expect(within(access).getByText(/\$1\.20 of \$5\.00 used this month/)).toBeInTheDocument()
        expect(within(access).getByRole('progressbar', { name: 'Trial credit used' })).toHaveAttribute('aria-valuenow', '24')
        fireEvent.click(within(access).getByRole('button', { name: 'Add your API key' }))
        // Hermes takes three providers; the key never shows; the model is optional.
        fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'anthropic' } })
        fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-ant-api03-mine-wxyz' } })
        fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-sonnet-4-5' } })
        fireEvent.click(screen.getByRole('button', { name: 'Use this key' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setHostingLlm', { orgId: 'org-1', agentId: 'jv', provider: 'anthropic', apiKey: 'sk-ant-api03-mine-wxyz', model: 'claude-sonnet-4-5' }))
        expect(await screen.findByText('Runs on your Anthropic key …wxyz')).toBeInTheDocument()
        expect(screen.getByText(/Model claude-sonnet-4-5/)).toBeInTheDocument()
        expect(screen.queryByText(/trial credit/)).toBeNull()
        expect(screen.getByRole('button', { name: 'Replace key' })).toBeInTheDocument()
    })

    it('a trial at its cap says so in red, with the same way out; a member without the agent sees why it is silent', async () => {
        listing = [{ agent: jarvis, keys: [key('k8', 'jv')], hosting: hosting('ready', { trial: { endsAt: '2026-11-25T10:00:00Z', closedAt: '2026-10-27T09:00:00Z', closedReason: 'exhausted' } }) }]
        spend = undefined
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        expect(await screen.findByRole('button', { name: /Jarvis/ })).toHaveTextContent(/Hermes · via Maritime · .*1 key · trial over$/)
        fireEvent.click(screen.getByRole('button', { name: /Jarvis/ }))
        const access = await screen.findByRole('group', { name: 'Model access' })
        expect(within(access).getByText('Trial credit used up')).toBeInTheDocument()
        expect(within(access).getByText(/Jarvis answers nothing until you add your own API key/)).toBeInTheDocument()
        expect(within(access).getByRole('button', { name: 'Add your API key' })).toBeEnabled()
    })

    it('Codex offers OpenAI only; Claude Code is on its owner’s key from the start', async () => {
        const cx = { ...jarvis, id: 'cx', displayName: 'Cx', agentKind: 'codex' } as spaces.Member
        const cc = { ...jarvis, id: 'cc', displayName: 'Cc', agentKind: 'claude-code' } as spaces.Member
        listing = [
            { agent: cx, keys: [key('k1', 'cx')], hosting: hosting('ready') },
            { agent: cc, keys: [key('k2', 'cc')], hosting: { provider: 'maritime', status: 'ready', externalId: 'agt-m2', funding: 'own', llm: { provider: 'anthropic', keyHint: '…ab12', setBy: 'me', setAt: '2026-10-26T10:00:00Z' }, createdBy: 'me', createdAt: '2026-10-26T10:00:00Z', updatedAt: '2026-10-26T10:00:00Z' } },
        ]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        expect(await screen.findByRole('button', { name: /Cx/ })).toHaveTextContent(/Codex · via Maritime · .*1 key · trial credit$/)
        expect(screen.getByRole('button', { name: /Cc/ })).toHaveTextContent(/Claude Code · via Maritime · .*1 key$/)
        fireEvent.click(screen.getByRole('button', { name: /Cx/ }))
        const access = await screen.findByRole('group', { name: 'Model access' })
        fireEvent.click(within(access).getByRole('button', { name: 'Add your API key' }))
        expect(screen.queryByLabelText('Provider')).toBeNull()
        expect(screen.getByText('OpenAI')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
        fireEvent.click(await screen.findByRole('button', { name: /Cc/ }))
        expect(await screen.findByText('Runs on your Anthropic key …ab12')).toBeInTheDocument()
        expect(screen.queryByText(/trial/)).toBeNull()
    })

    it('lets an admin revoke someone else’s agent’s key, but not mint one', async () => {
        roster = [person('me', 'Ramnique', 'admin'), person('harsh', 'Harsh')]
        listing = [{ agent: scout, keys: [key('k5', 'scout')] }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Agent · Channel · Owned by Harsh · 1 key')
        fireEvent.click(screen.getByRole('button', { name: /Scout/ }))
        await screen.findByRole('heading', { name: 'Scout' })
        expect(screen.queryByRole('button', { name: /New key/ })).not.toBeInTheDocument()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument())
    })
})
