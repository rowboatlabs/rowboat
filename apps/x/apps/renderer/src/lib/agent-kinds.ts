import hermesLogo from '@/assets/agents/hermes/logo.png'
import hermesLogoDark from '@/assets/agents/hermes/logo-dark.png'

// The kinds of agent the Agents dialog offers (Harbor spec §8 Connectors,
// 2026-09-30). Each kind says what to do on the agent's side to connect it,
// filled in with the new key and the org's address; the dialog renders any
// kind's steps the same way. The kind is chosen when the agent is added and
// not stored: Harbor knows the agent by its key.
//
// Adding a kind: its official logo in `assets/agents/<id>/` (logo.png,
// logo-dark.png, and a SOURCE.md saying where they came from), and an entry
// here with its setup.

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

export interface AgentKind {
    id: string
    label: string
    /** One line under the label in the picker. */
    description: string
    /** The official mark, for light and dark themes. None = the generic icon. */
    logo?: { light: string; dark: string }
    /** What the name field suggests. */
    defaultName: string
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

export const AGENT_KINDS: readonly AgentKind[] = [
    {
        id: 'hermes',
        label: 'Hermes',
        description: 'A Hermes agent you run, connected by the Rowboat plugin',
        logo: { light: hermesLogo, dark: hermesLogoDark },
        defaultName: 'Hermes',
        docsUrl: `https://github.com/${HERMES_PLUGIN}#readme`,
        wantsHomeChannel: true,
        setup: hermesSetup,
    },
    {
        id: 'custom',
        label: 'Custom',
        description: 'Anything that speaks the agent contract, set up by hand with its key',
        defaultName: '',
        setup: customSetup,
    },
]

export const CUSTOM_KIND = AGENT_KINDS.find((kind) => kind.id === 'custom')!

export function agentKind(id: string): AgentKind {
    return AGENT_KINDS.find((kind) => kind.id === id) ?? CUSTOM_KIND
}
