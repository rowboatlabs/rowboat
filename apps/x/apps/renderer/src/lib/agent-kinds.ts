import claudeCodeLogo from '@/assets/agents/claude-code/logo.png'
import claudeCodeLogoDark from '@/assets/agents/claude-code/logo-dark.png'
import codexLogo from '@/assets/agents/codex/logo.png'
import codexLogoDark from '@/assets/agents/codex/logo-dark.png'
import cursorLogo from '@/assets/agents/cursor/logo.png'
import cursorLogoDark from '@/assets/agents/cursor/logo-dark.png'
import hermesLogo from '@/assets/agents/hermes/logo.png'
import hermesLogoDark from '@/assets/agents/hermes/logo-dark.png'
import opencodeLogo from '@/assets/agents/opencode/logo.png'
import opencodeLogoDark from '@/assets/agents/opencode/logo-dark.png'
import piLogo from '@/assets/agents/pi/logo.png'
import piLogoDark from '@/assets/agents/pi/logo-dark.png'
import replicasLogo from '@/assets/agents/replicas/logo.png'
import replicasLogoDark from '@/assets/agents/replicas/logo-dark.png'

// What an agent is, how Harbor reaches it, and how you set one up (Harbor spec
// §4 Agent members and §8 Connectors, 2026-09-30). Harbor stores every agent's
// kind (what it is underneath: hermes, a coding agent, custom) and connection
// (the path: plugin, contract, or a platform Harbor calls such as replicas);
// every surface draws the agent from them: the kind's logo on its avatar,
// "Claude Code · via Replicas" beside its name.
//
// The Agents dialog offers ways to connect (AGENT_SETUPS): each fixes the
// connection, offers one or more kinds, and says what to do on the agent's
// side, filled in with the new key and the org's address.
//
// Adding a kind: its official logo in `assets/agents/<id>/` (logo.png,
// logo-dark.png, and a SOURCE.md saying where they came from), and an entry
// in KINDS. A kind without a usable official mark shows the generic one.

export interface Logo {
    light: string
    dark: string
}

/** What an agent is underneath. Unknown kinds (from a newer Harbor) read as a generic agent. */
export const KINDS: Record<string, { label: string; logo?: Logo }> = {
    hermes: { label: 'Hermes', logo: { light: hermesLogo, dark: hermesLogoDark } },
    'claude-code': { label: 'Claude Code', logo: { light: claudeCodeLogo, dark: claudeCodeLogoDark } },
    codex: { label: 'Codex', logo: { light: codexLogo, dark: codexLogoDark } },
    cursor: { label: 'Cursor', logo: { light: cursorLogo, dark: cursorLogoDark } },
    opencode: { label: 'OpenCode', logo: { light: opencodeLogo, dark: opencodeLogoDark } },
    pi: { label: 'Pi', logo: { light: piLogo, dark: piLogoDark } },
    // Meta publishes no mark for Muse Code (2026-09-30): the generic one until it does.
    'muse-code': { label: 'Muse Code' },
    custom: { label: 'Agent' },
}

/** Platforms Harbor calls on an agent's behalf: named after the kind ("via Replicas"). */
export const PLATFORMS: Record<string, { label: string; logo?: Logo }> = {
    replicas: { label: 'Replicas', logo: { light: replicasLogo, dark: replicasLogoDark } },
}

export function kindInfo(kind: string | undefined): { label: string; logo?: Logo } {
    return (kind && KINDS[kind]) || { label: 'Agent' }
}

/** "Hermes", "Claude Code · via Replicas", or "Agent". */
export function agentLabel(kind: string | undefined, connection: string | undefined): string {
    const platform = connection ? PLATFORMS[connection] : undefined
    const what = kindInfo(kind).label
    return platform ? `${what} · via ${platform.label}` : what
}

/** Something to paste, with Copy. `secret` values read as their ends on screen and copy whole. */
export interface SetupValue {
    label?: string
    text: string
    secret?: boolean
}

export interface SetupStep {
    title: string
    note?: string
    /** Commands or text to paste as one block, under a caption ("Terminal", a file name). `copyLabel` names its Copy button. */
    code?: { caption: string; text: string; secret?: boolean; copyLabel?: string }
    /** Values to enter one by one (a dashboard's fields), under `valuesNote` when the step also has `code`. */
    values?: SetupValue[]
    valuesNote?: string
}

/** One way to do the setup, e.g. from a terminal or from the agent's own dashboard. */
export interface SetupRoute {
    id: string
    label: string
    steps: SetupStep[]
}

export interface SetupContext {
    /** The org's address, as Rowboat reaches it. */
    orgUrl: string
    agentKey: string
    /** The owner's direct messages with the agent, when the kind wants a home for unprompted messages. */
    homeChannel?: string
}

/** A way to connect an agent: one tile on the Add screen. */
export interface AgentSetup {
    id: string
    label: string
    /** One line under the label in the picker. */
    description: string
    /** The official mark, for light and dark themes. None = the generic icon. */
    logo?: Logo
    /** The connection every agent added this way has. */
    connection: string
    /** The kinds it offers: one is fixed; several are a choice on the Add screen. */
    kinds: readonly string[]
    /** What the name field suggests; empty = the chosen kind's label. */
    defaultName: string
    /** A platform key the person pastes on the Add screen; Harbor checks it with the platform and seals it. */
    credential?: { label: string; placeholder: string; note: string }
    /** Where the agent's side is documented. */
    docsUrl?: string
    /** Opens the owner's DM with the agent before setup, for `homeChannel`. */
    wantsHomeChannel?: boolean
    setup: (ctx: SetupContext) => SetupRoute[]
}

// The Hermes plugin (rowboatlabs/hermes-rowboat): Hermes's settings, the plugin, and a restart.
// `hermes config set` merges into config.yaml rather than duplicating its keys; `${VAR}`s stay
// for Hermes to fill from .env; anyone Spaces lets invoke the agent may talk to it (spec §8);
// the owner may run Hermes commands from Spaces; and the rowboat platform gets the quiet display
// defaults Hermes gives Slack (no reasoning blocks, no long-running or busy notices).
//
// Hermes can do all of that itself (2026-09-30, PR #1140): the person saves the three values
// only they have, then sends a fixed message pointing at the plugin's SETUP.md, which saves the
// rest and installs the plugin. The key never enters the chat. Terminal and dashboard stay as
// the by-hand fallback.
const HERMES_PLUGIN = 'rowboatlabs/hermes-rowboat'
const HERMES_ASK = `Connect yourself to Rowboat: read https://raw.githubusercontent.com/${HERMES_PLUGIN}/main/SETUP.md and follow it.`

function hermesSetup({ orgUrl, agentKey, homeChannel }: SetupContext): SetupRoute[] {
    const settings: Array<[string, string]> = [
        ['ROWBOAT_URL', orgUrl],
        ['ROWBOAT_AGENT_KEY', agentKey],
        ...(homeChannel ? [['ROWBOAT_HOME_CHANNEL', homeChannel] as [string, string]] : []),
        ['ROWBOAT_ALLOW_ALL_USERS', 'true'],
        ['ROWBOAT_OWNER_COMMANDS', 'true'],
    ]
    const display: Array<[string, string]> = [
        ['tool_progress', 'off'],
        ['show_reasoning', 'false'],
        ['long_running_notifications', 'false'],
        ['busy_ack_detail', 'false'],
    ]
    const config: Array<[string, string]> = [
        ['mcp_servers.rowboat.url', '${ROWBOAT_URL}/mcp'],
        ['mcp_servers.rowboat.headers.Authorization', 'Bearer ${ROWBOAT_AGENT_KEY}'],
        ...display.map(([k, v]) => [`display.platforms.rowboat.${k}`, v] as [string, string]),
    ]
    const own = settings.slice(0, homeChannel ? 3 : 2)
    return [
        {
            id: 'ask',
            label: 'Ask Hermes',
            steps: [
                {
                    title: 'Save the Rowboat settings',
                    note: 'In a terminal where Hermes runs. Not in a chat: Hermes never needs to see its key.',
                    code: { caption: 'Terminal', secret: true, text: own.map(([k, v]) => `hermes config set ${k} '${v}'`).join('\n') },
                    valuesNote: 'Or on the Hermes dashboard’s Keys page:',
                    values: own.map(([k, v]) => ({ label: k, text: v, ...(k === 'ROWBOAT_AGENT_KEY' ? { secret: true } : {}) })),
                },
                {
                    title: 'Send your Hermes this message',
                    note: 'It saves the rest, installs the Rowboat plugin, and tells you when it’s done. If it can’t, use Terminal or Dashboard above instead.',
                    code: { caption: 'Message', text: HERMES_ASK, copyLabel: 'Copy the message' },
                },
                { title: 'Restart it', note: 'Send it /restart, or press Restart Gateway on the dashboard. It connects by itself.' },
            ],
        },
        {
            id: 'terminal',
            label: 'Terminal',
            steps: [
                {
                    title: 'Save the settings',
                    note: 'In a terminal where Hermes runs. This points it at this org, gives it the Spaces tools, lets you run Hermes commands from Spaces, and keeps its progress chatter out of threads.',
                    code: { caption: 'Terminal', secret: true, text: [...settings, ...config].map(([k, v]) => `hermes config set ${k} '${v}'`).join('\n') },
                },
                {
                    title: 'Install the Rowboat plugin',
                    code: { caption: 'Terminal', text: `hermes plugins install ${HERMES_PLUGIN} --enable` },
                },
                {
                    title: 'Restart Hermes',
                    note: 'Or start it with hermes gateway run. It connects by itself.',
                    code: { caption: 'Terminal', text: 'hermes gateway restart' },
                },
            ],
        },
        {
            id: 'dashboard',
            label: 'Dashboard',
            steps: [
                {
                    title: 'Install the Rowboat plugin',
                    note: 'Plugins → Install from GitHub, with “Enable after install” on.',
                    values: [{ text: HERMES_PLUGIN }],
                },
                {
                    title: 'Fill in the Rowboat channel',
                    note: 'Channels → Rowboat: enter these, then turn the channel on. (Once the plugin is installed, its settings live on this card; the Keys page hides them.)',
                    values: settings.map(([k, v]) => ({ label: k, text: v, ...(k === 'ROWBOAT_AGENT_KEY' ? { secret: true } : {}) })),
                },
                {
                    title: 'Add the Spaces tools',
                    note: 'MCP → Add server, named rowboat, with a Bearer token.',
                    values: [
                        { label: 'URL', text: `${orgUrl}/mcp` },
                        { label: 'Bearer token', text: agentKey, secret: true },
                    ],
                },
                {
                    title: 'Keep progress chatter out of threads',
                    note: 'Config → YAML mode: put these lines under the existing display:.',
                    code: {
                        caption: 'config.yaml',
                        text: ['  platforms:', '    rowboat:', ...display.map(([k, v]) => `      ${k}: ${v === 'off' ? "'off'" : v}`)].join('\n'),
                    },
                },
                { title: 'Restart the gateway', note: 'Restart Gateway, at the bottom of the sidebar. It connects by itself.' },
            ],
        },
    ]
}

function customSetup({ orgUrl, agentKey }: SetupContext): SetupRoute[] {
    return [
        {
            id: 'manual',
            label: 'By hand',
            steps: [
                { title: 'Copy its key', note: 'Whatever runs the agent sends it as Authorization: Bearer.', values: [{ text: agentKey, secret: true }] },
                {
                    title: 'Point it at this server',
                    note: 'The server, for the agent contract (list, acknowledge and report its invocations, reply in the thread), and its MCP tools.',
                    values: [{ label: 'Server', text: orgUrl }, { label: 'MCP', text: `${orgUrl}/mcp` }],
                },
            ],
        },
    ]
}

// Replicas (2026-09-30): Harbor runs the connector, so connecting is the Replicas key on the Add
// screen. What's left on Replicas's side is optional: our MCP server and two variables on the
// environment the agent uses, so its coding agent can act in Spaces and download attachments.
// MCP servers are per environment, so one environment per Rowboat agent, and not Global.
function replicasSetup({ orgUrl, agentKey }: SetupContext): SetupRoute[] {
    return [
        {
            id: 'replicas',
            label: 'Replicas',
            steps: [
                {
                    title: 'Give it the Spaces tools (optional)',
                    note: 'In Replicas, open the environment this agent will use (not Global), then MCPs → Add server. Give each Rowboat agent its own environment: the server acts as this agent.',
                    values: [
                        { label: 'URL', text: `${orgUrl}/mcp` },
                        { label: 'Header: Authorization', text: `Bearer ${agentKey}`, secret: true },
                    ],
                },
                {
                    title: 'Let it download attachments (optional)',
                    note: 'In the same environment, add these as variables (the key as a secret).',
                    values: [
                        { label: 'ROWBOAT_URL', text: orgUrl },
                        { label: 'ROWBOAT_AGENT_KEY', text: agentKey, secret: true },
                    ],
                },
            ],
        },
    ]
}

export const AGENT_SETUPS: readonly AgentSetup[] = [
    {
        id: 'hermes',
        label: 'Hermes',
        description: 'A Hermes agent you run, connected by the Rowboat plugin',
        logo: { light: hermesLogo, dark: hermesLogoDark },
        connection: 'plugin',
        kinds: ['hermes'],
        defaultName: 'Hermes',
        docsUrl: `https://github.com/${HERMES_PLUGIN}#readme`,
        wantsHomeChannel: true,
        setup: hermesSetup,
    },
    {
        id: 'replicas',
        label: 'Replicas',
        description: 'A coding agent running in Replicas, on your Replicas account',
        logo: { light: replicasLogo, dark: replicasLogoDark },
        connection: 'replicas',
        kinds: ['claude-code', 'codex', 'cursor', 'opencode', 'pi', 'muse-code'],
        defaultName: '',
        credential: {
            label: 'Replicas API key',
            placeholder: 'Paste the key from replicas.dev → API keys',
            note: 'Harbor checks it with Replicas and keeps it sealed. Nobody sees it again, you included.',
        },
        docsUrl: 'https://docs.replicas.dev/features/environments',
        setup: replicasSetup,
    },
    {
        id: 'custom',
        label: 'Custom',
        description: 'Anything that speaks the agent contract, set up by hand with its key',
        connection: 'contract',
        kinds: ['custom'],
        defaultName: '',
        setup: customSetup,
    },
]

export const CUSTOM_SETUP = AGENT_SETUPS.find((setup) => setup.id === 'custom')!

export function agentSetup(id: string): AgentSetup {
    return AGENT_SETUPS.find((setup) => setup.id === id) ?? CUSTOM_SETUP
}

/** How an existing agent is set up, from what Harbor stores about it. */
export function setupFor(member: { agentKind?: string; agentConnection?: string }): AgentSetup {
    return AGENT_SETUPS.find((setup) => setup.connection === member.agentConnection && setup.kinds.includes(member.agentKind ?? '')) ?? CUSTOM_SETUP
}
