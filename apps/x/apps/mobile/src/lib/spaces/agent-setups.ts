import { kindLabel } from './agents';

// Connecting an agent you already run, on the phone (2026-11-13). A copy of
// the desktop's AGENT_SETUPS (renderer src/lib/agent-kinds.ts) for the
// "Connect one you already run" path: the same platforms, words and setup
// steps, filled in with the new key and the server's address. The renderer
// file imports web logo assets, so the phone can't import it; keep the two in
// step when a platform or its steps change. Left out: "On this computer"
// (the desktop app runs it) and the bots (PostHog, Cal.com, Attio), which the
// desktop adds under Add bot, not New agent.

/** Something to paste, with Copy. `secret` values read as their ends on screen and copy whole. */
export interface SetupValue {
  label?: string;
  text: string;
  secret?: boolean;
}

export interface SetupStep {
  title: string;
  note?: string;
  /** Commands or text to paste as one block, under a caption ("Terminal", a file name). */
  code?: { caption: string; text: string; secret?: boolean };
  /** Values to enter one by one (a dashboard's fields), under `valuesNote` when the step also has `code`. */
  values?: SetupValue[];
  valuesNote?: string;
}

/** One way to do the setup, e.g. from a terminal or from the agent's own dashboard. */
export interface SetupRoute {
  id: string;
  label: string;
  steps: SetupStep[];
}

export interface SetupContext {
  orgUrl: string;
  agentKey: string;
  kind?: string;
  /** The platform instance the agent is (Agent37). */
  instance?: string;
  /** The owner's DM with the agent, when the kind wants a home for unprompted messages (Hermes). */
  homeChannel?: string;
}

export interface AgentSetup {
  id: string;
  label: string;
  description: string;
  connection: string;
  /** One is fixed; several are a choice under `kindChoice`. */
  kinds: readonly string[];
  kindChoice?: string;
  /** What the name field suggests; empty = the chosen kind's label. */
  defaultName: string;
  /** A platform key pasted on the form; Harbor checks it with the platform and seals it. */
  credential?: { label: string; placeholder: string; note: string };
  docsUrl?: string;
  /** The agent is one platform instance, picked (or, on Agent37, created) on the form; its kind follows the instance. */
  bindsInstance?: boolean;
  /** Opens the owner's DM with the agent before setup, for `homeChannel`. */
  wantsHomeChannel?: boolean;
  setup: (ctx: SetupContext) => SetupRoute[];
}

const HERMES_PLUGIN = 'rowboatlabs/hermes-rowboat';
const HERMES_ASK = `Connect yourself to Rowboat: read https://raw.githubusercontent.com/${HERMES_PLUGIN}/main/SETUP.md and follow it.`;
const SKILL_REPO = 'rowboatlabs/rowboat';
const HERMES_SKILL = `hermes skills install ${SKILL_REPO}/skills/rowboat-spaces --yes`;

function hermesSetup({ orgUrl, agentKey, homeChannel }: SetupContext): SetupRoute[] {
  const settings: Array<[string, string]> = [
    ['ROWBOAT_URL', orgUrl],
    ['ROWBOAT_AGENT_KEY', agentKey],
    ...(homeChannel ? [['ROWBOAT_HOME_CHANNEL', homeChannel] as [string, string]] : []),
    ['ROWBOAT_ALLOW_ALL_USERS', 'true'],
    ['ROWBOAT_OWNER_COMMANDS', 'true'],
  ];
  const display: Array<[string, string]> = [
    ['tool_progress', 'off'],
    ['show_reasoning', 'false'],
    ['long_running_notifications', 'false'],
    ['busy_ack_detail', 'false'],
  ];
  const config: Array<[string, string]> = [
    ['mcp_servers.rowboat.url', '${ROWBOAT_URL}/mcp'],
    ['mcp_servers.rowboat.headers.Authorization', 'Bearer ${ROWBOAT_AGENT_KEY}'],
    ...display.map(([k, v]) => [`display.platforms.rowboat.${k}`, v] as [string, string]),
  ];
  const own = settings.slice(0, homeChannel ? 3 : 2);
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
          code: { caption: 'Message', text: HERMES_ASK },
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
        { title: 'Install the Rowboat plugin', note: 'Plugins → Install from GitHub, with “Enable after install” on.', values: [{ text: HERMES_PLUGIN }] },
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
          code: { caption: 'config.yaml', text: ['  platforms:', '    rowboat:', ...display.map(([k, v]) => `      ${k}: ${v === 'off' ? "'off'" : v}`)].join('\n') },
        },
        { title: 'Restart the gateway', note: 'Restart Gateway, at the bottom of the sidebar. It connects by itself.' },
      ],
    },
  ];
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
  ];
}

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
  ];
}

const CONDUCTOR_MCP_JSON = JSON.stringify(
  { mcpServers: { rowboat: { type: 'http', url: '${ROWBOAT_URL}/mcp', headers: { Authorization: 'Bearer ${ROWBOAT_AGENT_KEY}' } } } },
  null,
  2,
);

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
  ];
}

function agent37Setup({ orgUrl, agentKey, kind, instance }: SetupContext): SetupRoute[] {
  const id = instance ?? '<instance>';
  const terminal = `Open the instance’s terminal: from the Agent37 dashboard, or its port 7681 (https://${id}-7681.agent37.app) through a signed URL.`;
  const restart = { title: 'Restart the instance', note: `From the Agent37 dashboard, or POST /v1/instances/${id}/restart. The agent picks up the tools and the skill when it starts.` };
  const values = {
    valuesNote: 'Or value by value, for the instance’s own dashboard:',
    values: [
      { label: 'MCP URL', text: `${orgUrl}/mcp` },
      { label: 'Agent key', text: agentKey, secret: true },
    ],
  };
  if (kind === 'openclaw') {
    return [
      {
        id: 'terminal',
        label: 'Terminal',
        steps: [
          {
            title: 'Give it the Spaces tools (recommended)',
            note: `${terminal} This adds our MCP server, acting as this agent.`,
            code: { caption: 'Terminal', secret: true, text: `openclaw mcp add rowboat --url '${orgUrl}/mcp' --transport streamable-http --header 'Authorization: Bearer ${agentKey}'` },
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
    ];
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
  ];
}

function maritimeSetup({ kind }: SetupContext): SetupRoute[] {
  const what = kindLabel(kind ?? 'hermes');
  return [
    {
      id: 'maritime',
      label: 'Maritime',
      steps: [
        {
          title: 'Nothing to set up on Maritime',
          note: `Rowboat runs ${what} inside the agent's VM for each turn, with the Spaces tools and the thread's session, and wakes the VM when it sleeps. The agent's model access stays as it is on Maritime: the metered proxy, or the key set in its environment variables.`,
        },
        {
          title: 'Keep the key scoped',
          note: 'The key needs the deploy, secrets and manage scopes (Maritime → Settings → API keys). Revoking it on Maritime stops the agent at once; replace it on the agent’s page in the desktop app.',
        },
      ],
    },
  ];
}

/** The desktop's "Connect one you already run" tiles, in its order. */
export const CONNECT_SETUPS: readonly AgentSetup[] = [
  {
    id: 'hermes',
    label: 'Hermes',
    description: 'A Hermes agent you run, connected by the Rowboat plugin',
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
    id: 'maritime',
    label: 'Maritime',
    description: 'Hermes, Claude Code or Codex in a Maritime VM, on your Maritime account',
    connection: 'maritime',
    kinds: ['hermes', 'claude-code', 'codex'],
    defaultName: '',
    credential: {
      label: 'Maritime API key',
      placeholder: 'Paste an mk_ key from maritime.sh → Settings → API keys',
      note: 'With the deploy, secrets and manage scopes. Harbor checks it with Maritime and keeps it sealed. Nobody sees it again, you included.',
    },
    docsUrl: 'https://maritime.sh/docs/sdk/agents',
    bindsInstance: true,
    setup: maritimeSetup,
  },
  {
    id: 'conductor',
    label: 'Conductor',
    description: 'Claude Code in a Conductor cloud workspace, on your Conductor account',
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
    id: 'custom',
    label: 'Custom',
    description: 'Anything that speaks the agent contract, set up by hand with its key',
    connection: 'contract',
    kinds: ['custom'],
    defaultName: '',
    setup: customSetup,
  },
];

/**
 * On screen, a long token (a key, a secret, an id) reads as its ends, so a
 * shared screen shows no secret (desktop agent-setup.tsx). Copy and Share
 * carry the full text.
 */
export function shortened(text: string): string {
  return text.replace(/[A-Za-z0-9_-]{25,}/g, (token) => `${token.slice(0, 6)}…${token.slice(-4)}`);
}

/** One route's steps as plain text, keys in full, for Copy all and Share: the person pastes them on a computer. */
export function routeText(agentName: string, setupLabel: string, route: SetupRoute, docsUrl?: string): string {
  const lines = [`Connect ${agentName} (${setupLabel}${route.label !== setupLabel ? `, ${route.label}` : ''}) to Rowboat`, ''];
  route.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.title}`);
    if (step.note) lines.push(step.note);
    if (step.code) lines.push('', `${step.code.caption}:`, step.code.text, '');
    if (step.valuesNote) lines.push(step.valuesNote);
    for (const value of step.values ?? []) lines.push(value.label ? `${value.label}: ${value.text}` : value.text);
    lines.push('');
  });
  if (docsUrl) lines.push(`${setupLabel} setup docs: ${docsUrl}`);
  return lines.join('\n').trim();
}
