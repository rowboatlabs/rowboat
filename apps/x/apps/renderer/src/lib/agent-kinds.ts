import agent37Logo from '@/assets/agents/agent37/logo.png'
import agent37LogoDark from '@/assets/agents/agent37/logo-dark.png'
import claudeCodeLogo from '@/assets/agents/claude-code/logo.png'
import claudeCodeLogoDark from '@/assets/agents/claude-code/logo-dark.png'
import conductorLogo from '@/assets/agents/conductor/logo.png'
import conductorLogoDark from '@/assets/agents/conductor/logo-dark.png'
import codexLogo from '@/assets/agents/codex/logo.png'
import codexLogoDark from '@/assets/agents/codex/logo-dark.png'
import cursorLogo from '@/assets/agents/cursor/logo.png'
import cursorLogoDark from '@/assets/agents/cursor/logo-dark.png'
import hermesLogo from '@/assets/agents/hermes/logo.png'
import hermesLogoDark from '@/assets/agents/hermes/logo-dark.png'
import openclawLogo from '@/assets/agents/openclaw/logo.png'
import openclawLogoDark from '@/assets/agents/openclaw/logo-dark.png'
import opencodeLogo from '@/assets/agents/opencode/logo.png'
import opencodeLogoDark from '@/assets/agents/opencode/logo-dark.png'
import piLogo from '@/assets/agents/pi/logo.png'
import piLogoDark from '@/assets/agents/pi/logo-dark.png'
import replicasLogo from '@/assets/agents/replicas/logo.png'
import replicasLogoDark from '@/assets/agents/replicas/logo-dark.png'

// What an agent is, how Harbor reaches it, and how you set one up (Harbor spec
// §4 Agent members and §8 Connectors, 2026-09-30). Harbor stores every agent's
// kind (what it is underneath: hermes, a coding agent, custom) and connection
// (the path: plugin, contract, or a platform Harbor calls: replicas, conductor);
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

/**
 * What an agent is underneath. Unknown kinds (from a newer Harbor) read as a generic agent.
 * `bot`: the app calls it a bot (2026-10-03, Arjun): it runs a service's commands, as a Slack
 * bot does, rather than thinking for itself. To Harbor it is an agent member like any other.
 */
export const KINDS: Record<string, { label: string; logo?: Logo; bot?: boolean }> = {
    hermes: { label: 'Hermes', logo: { light: hermesLogo, dark: hermesLogoDark } },
    openclaw: { label: 'OpenClaw', logo: { light: openclawLogo, dark: openclawLogoDark } },
    'claude-code': { label: 'Claude Code', logo: { light: claudeCodeLogo, dark: claudeCodeLogoDark } },
    codex: { label: 'Codex', logo: { light: codexLogo, dark: codexLogoDark } },
    cursor: { label: 'Cursor', logo: { light: cursorLogo, dark: cursorLogoDark } },
    opencode: { label: 'OpenCode', logo: { light: opencodeLogo, dark: opencodeLogoDark } },
    pi: { label: 'Pi', logo: { light: piLogo, dark: piLogoDark } },
    // Meta publishes no mark for Muse Code (2026-09-30): the generic one until it does.
    'muse-code': { label: 'Muse Code' },
    // Integrations (2026-10-03) show the generic mark until their official ones are added.
    posthog: { label: 'PostHog', bot: true },
    cal: { label: 'Cal.com', bot: true },
    custom: { label: 'Agent' },
    // Ro (Harbor spec §8 Jev, 2026-10-07): the agent Harbor itself is, run on
    // TypeSafe's Jev through Rowboat's OpenRouter key. People meet it as Ro,
    // so its kind reads Ro too. No mark yet: the generic one.
    jev: { label: 'Ro' },
}

/** The connection of an agent Harbor itself is: nothing to set up, no keys (Harbor spec §8 Jev). */
export const BUILT_IN_CONNECTION = 'builtin'

/** Platforms Harbor calls on an agent's behalf: named after the kind ("via Replicas"). */
export const PLATFORMS: Record<string, { label: string; logo?: Logo }> = {
    replicas: { label: 'Replicas', logo: { light: replicasLogo, dark: replicasLogoDark } },
    posthog: { label: 'PostHog' },
    cal: { label: 'Cal.com' },
    conductor: { label: 'Conductor', logo: { light: conductorLogo, dark: conductorLogoDark } },
    agent37: { label: 'Agent37', logo: { light: agent37Logo, dark: agent37LogoDark } },
}

/** A platform instance as people see it: its name, then its id. */
export function instanceLabel(i: { id: string; name: string | null }): string {
    return i.name ? `${i.name} (${i.id})` : i.id
}

export function isBot(kind: string | undefined): boolean {
    return kindInfo(kind).bot === true
}

export function kindInfo(kind: string | undefined): { label: string; logo?: Logo; bot?: boolean } {
    return (kind && KINDS[kind]) || { label: 'Agent' }
}

/** "Hermes", "Claude Code · via Replicas", "PostHog bot", or "Agent". */
export function agentLabel(kind: string | undefined, connection: string | undefined): string {
    const platform = connection ? PLATFORMS[connection] : undefined
    const what = kindInfo(kind).label
    // A bot is its own platform: "PostHog bot", not "PostHog · via PostHog".
    if (isBot(kind)) return `${what} bot`
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
    /** What the agent is, for a setup that offers several kinds. */
    kind?: string
    /** The platform instance the agent is (Agent37). */
    instance?: string
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
    /** The kinds it offers: one is fixed; several are a choice on the Add screen, under `kindChoice` ("Agent" when unset). */
    kinds: readonly string[]
    kindChoice?: string
    /** What the name field suggests; empty = the chosen kind's label. */
    defaultName: string
    /** A platform key the person pastes on the Add screen; Harbor checks it with the platform and seals it. */
    credential?: { label: string; placeholder: string; note: string }
    /** Where the agent's side is documented. */
    docsUrl?: string
    /** The agent is one platform instance, picked or created on the Add screen; its kind follows the instance (Agent37, 2026-10-05). */
    bindsInstance?: boolean
    /** Opens the owner's DM with the agent before setup, for `homeChannel`. */
    wantsHomeChannel?: boolean
    /** A bot rather than an agent (KINDS `bot`): offered under Add bot. */
    bot?: boolean
    /** The service can post alerts through the agent (Harbor spec §8 Alerts): where its address goes, on the agent's page. */
    alerts?: { note: string }
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

// The rowboat-spaces skill (spec §8, 2026-10-01): how to behave in Spaces (mentions, hand-offs,
// threads, the tools), published once from the monorepo for every kind of agent.
const SKILL_REPO = 'rowboatlabs/rowboat'
const HERMES_SKILL = `hermes skills install ${SKILL_REPO}/skills/rowboat-spaces --yes`

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
                    title: 'Install the Rowboat plugin and skill',
                    note: 'The skill teaches it how to behave in Spaces: mentions, hand-offs, threads.',
                    code: { caption: 'Terminal', text: `hermes plugins install ${HERMES_PLUGIN} --enable\n${HERMES_SKILL}` },
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
                    title: 'Add the Spaces skill',
                    note: 'It teaches Hermes how to behave in Spaces: mentions, hand-offs, threads. Run it where Hermes runs, or ask your Hermes to run it.',
                    code: { caption: 'Terminal', text: HERMES_SKILL },
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
                {
                    title: 'Teach it Spaces (recommended)',
                    note: 'A skill on how to behave in Spaces: mentions, hand-offs, threads, the tools. For agents that load skills (Claude Code, Codex, Cursor, OpenCode and more).',
                    code: { caption: 'Terminal', text: `npx skills add ${SKILL_REPO} --skill rowboat-spaces` },
                },
            ],
        },
    ]
}

// Replicas (2026-09-30): Harbor runs the connector, so connecting is the Replicas key on the Add
// screen. What's left on Replicas's side is optional: our MCP server and two variables on the
// environment the agent uses, so its coding agent can act in Spaces and download attachments,
// and our repository as a skill registry, for the rowboat-spaces skill (2026-10-01). MCP servers
// are per environment, so one environment per Rowboat agent, and not Global.
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
                {
                    title: 'Teach it Spaces (recommended)',
                    note: 'In the same environment’s Skills tab, add this repository as a skill registry. Its rowboat-spaces skill teaches the agent how to behave in Spaces: mentions, hand-offs, threads.',
                    values: [{ label: 'Registry', text: `https://github.com/${SKILL_REPO}` }],
                },
            ],
        },
    ]
}

// A bot (Harbor spec §8 Integrations, 2026-10-03) needs nothing on the service's side
// beyond its key: it answers commands, and alerts are set up on its page.
function integrationSetup(name: string, example: string): () => SetupRoute[] {
    return () => [
        {
            id: 'commands',
            label: 'Commands',
            steps: [
                {
                    title: 'Ask it what it can do',
                    note: `Mention it with help for its commands, such as @${name} ${example}. It calls the service's API with your key and replies in the thread.`,
                },
                {
                    title: 'Send its alerts to a space (optional)',
                    note: "On this bot's page, under Alerts, pick a space it is in and copy the address it gives you into the service's webhook settings.",
                },
            ],
        },
    ]
}

// Conductor (2026-10-06): Harbor runs the connector, so connecting is the Conductor key on the
// Add screen. Every workspace it starts gets ROWBOAT_URL and ROWBOAT_AGENT_KEY (a key Harbor
// keeps for the agent), so nothing secret is set up by hand: a repo's .mcp.json that reads them
// gives Claude Code the Spaces tools, and the skill teaches it Spaces. Conductor's API can't set
// MCP servers itself, so both are files the repo commits.
const CONDUCTOR_MCP_JSON = JSON.stringify(
    { mcpServers: { rowboat: { type: 'http', url: '${ROWBOAT_URL}/mcp', headers: { Authorization: 'Bearer ${ROWBOAT_AGENT_KEY}' } } } },
    null,
    2,
)

function conductorSetup(): SetupRoute[] {
    return [
        {
            id: 'conductor',
            label: 'Conductor',
            steps: [
                {
                    title: 'Give it the Spaces tools (recommended)',
                    note: 'Commit this as .mcp.json at the root of each repository it works in (or merge it into the one there). It holds no secret: Rowboat fills both variables in every workspace it starts.',
                    code: { caption: '.mcp.json', text: CONDUCTOR_MCP_JSON },
                },
                {
                    title: 'Teach it Spaces (recommended)',
                    note: 'The rowboat-spaces skill teaches it how to behave in Spaces: mentions, hand-offs, threads. Run this in the repository and commit what it adds.',
                    code: { caption: 'Terminal', text: `npx skills add ${SKILL_REPO} --skill rowboat-spaces` },
                },
                {
                    title: 'Pick its repository when you mention it',
                    note: 'With one Conductor project it uses that one. With several it asks, or name it in your message as [env:project-name].',
                },
            ],
        },
    ]
}

// Agent37 (2026-10-01): Harbor runs the connector, so connecting is the Agent37 key on the Add
// screen; Harbor drives the instance's Hermes or OpenClaw through Agent37's API. What's left on
// the instance is optional and the same as for any agent: our MCP server on the agent's key, the
// key itself for downloading earlier attachments, and the rowboat-spaces skill. Agent37 has no
// dashboard or API for MCP servers or skills; they go in the harness's own config, from the
// instance's terminal (https://www.agent37.com/docs/agents-api/custom-image), and the harness
// reads them at boot, hence the restart. OpenClaw's commands are its own CLI's
// (https://docs.openclaw.ai/cli/mcp/registry, https://docs.openclaw.ai/cli/skills).
function agent37Setup({ orgUrl, agentKey, kind, instance }: SetupContext): SetupRoute[] {
    const id = instance ?? '<instance>'
    const terminal = `Open the instance’s terminal: from the Agent37 dashboard, or its port 7681 (https://${id}-7681.agent37.app) through a signed URL.`
    const restart = { title: 'Restart the instance', note: `From the Agent37 dashboard, or POST /v1/instances/${id}/restart. The agent picks up the tools and the skill when it starts.` }
    // The key on its own too (2026-10-06, found by Arjun): inside the commands it reads shortened and
    // their Copy takes them all, so without this the key itself could not be copied.
    const values = {
        valuesNote: 'Or value by value, for the instance’s own dashboard:',
        values: [
            { label: 'MCP URL', text: `${orgUrl}/mcp` },
            { label: 'Agent key', text: agentKey, secret: true },
        ],
    }
    if (kind === 'openclaw') {
        return [
            {
                id: 'terminal',
                label: 'Terminal',
                steps: [
                    {
                        title: 'Give it the Spaces tools (recommended)',
                        note: `${terminal} This adds our MCP server, acting as this agent.`,
                        code: {
                            caption: 'Terminal',
                            secret: true,
                            text: `openclaw mcp add rowboat --url '${orgUrl}/mcp' --transport streamable-http --header 'Authorization: Bearer ${agentKey}'`,
                        },
                        ...values,
                    },
                    {
                        title: 'Teach it Spaces (recommended)',
                        note: 'The rowboat-spaces skill teaches it how to behave in Spaces: mentions, hand-offs, threads.',
                        code: {
                            caption: 'Terminal',
                            text: `git clone --depth 1 https://github.com/${SKILL_REPO} /tmp/rowboat-skills && openclaw skills install /tmp/rowboat-skills/skills/rowboat-spaces --global --force && rm -rf /tmp/rowboat-skills`,
                        },
                    },
                    restart,
                ],
            },
        ]
    }
    return [
        {
            id: 'terminal',
            label: 'Terminal',
            steps: [
                {
                    title: 'Give it the Spaces tools (recommended)',
                    note: `${terminal} This adds our MCP server, acting as this agent, and lets it download files attached earlier in a thread.`,
                    code: {
                        caption: 'Terminal',
                        secret: true,
                        text: [
                            `hermes config set ROWBOAT_URL '${orgUrl}'`,
                            `hermes config set ROWBOAT_AGENT_KEY '${agentKey}'`,
                            `hermes config set mcp_servers.rowboat.url '\${ROWBOAT_URL}/mcp'`,
                            `hermes config set mcp_servers.rowboat.headers.Authorization 'Bearer \${ROWBOAT_AGENT_KEY}'`,
                        ].join('\n'),
                    },
                    ...values,
                },
                {
                    title: 'Teach it Spaces (recommended)',
                    note: 'The rowboat-spaces skill teaches it how to behave in Spaces: mentions, hand-offs, threads.',
                    code: { caption: 'Terminal', text: HERMES_SKILL },
                },
                restart,
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
        kindChoice: 'Coding agent',
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
        id: 'agent37',
        label: 'Agent37',
        description: 'Hermes or OpenClaw on an Agent37 instance, on your Agent37 account',
        logo: { light: agent37Logo, dark: agent37LogoDark },
        connection: 'agent37',
        kinds: ['hermes', 'openclaw'],
        defaultName: '',
        credential: {
            label: 'Agent37 API key',
            placeholder: 'Paste an sk_live_ key from agent37.com → API keys',
            note: 'Harbor checks it with Agent37 and keeps it sealed. A key reaches every instance in its Agent37 workspace (there are no per-instance keys), so make one just for Rowboat.',
        },
        docsUrl: 'https://www.agent37.com/docs/agents-api/concepts',
        bindsInstance: true,
        setup: agent37Setup,
    },
    {
        id: 'conductor',
        label: 'Conductor',
        description: 'Claude Code in a Conductor cloud workspace, on your Conductor account',
        logo: { light: conductorLogo, dark: conductorLogoDark },
        connection: 'conductor',
        kinds: ['claude-code'],
        defaultName: 'Claude',
        credential: {
            label: 'Conductor API key',
            placeholder: 'Paste the key from app.conductor.build → API keys',
            note: 'Make it in your Conductor team org (Pro or higher), which needs a Claude key or subscription under Settings → Agents, and GitHub repositories. Harbor checks it with Conductor and keeps it sealed. Nobody sees it again, you included.',
        },
        docsUrl: 'https://www.conductor.build/docs/api',
        setup: conductorSetup,
    },
    {
        id: 'posthog',
        label: 'PostHog',
        description: 'Your PostHog project: event counts, HogQL, insights, flags and alerts',
        connection: 'posthog',
        kinds: ['posthog'],
        bot: true,
        defaultName: 'PostHog',
        credential: {
            label: 'PostHog personal API key',
            placeholder: 'phx_… (self-hosted: https://your-posthog phx_…)',
            note: 'Settings → Personal API keys, with read access to user, query, insight and feature flag. Harbor checks it with PostHog and keeps it sealed.',
        },
        docsUrl: 'https://posthog.com/docs/api',
        alerts: {
            note: 'In PostHog, Data pipelines → Destinations → New → HTTP Webhook, with this as the URL. Send it from an alert, or any event. A body of {"text": "…"} is posted as written.',
        },
        setup: integrationSetup('PostHog', 'count signup 30'),
    },
    {
        id: 'cal',
        label: 'Cal.com',
        description: 'Your Cal.com calendar: bookings, links, open times, booking and cancelling',
        connection: 'cal',
        kinds: ['cal'],
        bot: true,
        defaultName: 'Cal',
        credential: {
            label: 'Cal.com API key',
            placeholder: 'cal_live_…',
            note: 'Settings → Developer → API keys. The agent acts as you, in your time zone. Harbor checks it with Cal.com and keeps it sealed.',
        },
        docsUrl: 'https://cal.com/docs/api-reference/v2/introduction',
        alerts: {
            note: 'In Cal.com, Settings → Developer → Webhooks → New, with this as the Subscriber URL and the booking events you want. Ping test posts a hello.',
        },
        setup: integrationSetup('Cal', 'today'),
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
