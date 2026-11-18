import type { AgentHosting, AgentListing, Member } from '@rowboat/spaces-protocol';

// Agents on the phone (2026-11-13, desktop agents-view.tsx / agents-dialog.tsx /
// agent-page.tsx): the names and lines those screens use, reimplemented small
// here because the renderer's lib/agent-kinds.ts carries web logos and the
// desktop's setup steps. Only what the phone shows: a kind's name, a managed
// kind's one line on Create, and where a managed agent's machine stands.

const KIND_LABELS: Record<string, string> = {
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  pi: 'Pi',
  'muse-code': 'Muse Code',
  posthog: 'PostHog',
  cal: 'Cal.com',
  attio: 'Attio',
  jev: 'Ro',
};

const PLATFORM_LABELS: Record<string, string> = {
  replicas: 'Replicas',
  posthog: 'PostHog',
  cal: 'Cal.com',
  attio: 'Attio',
  conductor: 'Conductor',
  agent37: 'Agent37',
  maritime: 'Maritime',
};

const BOTS = new Set(['posthog', 'cal', 'attio']);

/** The connection of an agent the owner's desktop app runs (local Claude Code or Codex). */
export const LOCAL_CONNECTION = 'local';
/** The connection of the agent that comes with Rowboat. */
export const BUILT_IN_CONNECTION = 'builtin';

export function kindLabel(kind: string | undefined): string {
  return (kind && KIND_LABELS[kind]) || 'Agent';
}

/** "Hermes", "Claude Code · via Replicas", "Codex · local", "PostHog bot" (desktop agentLabel). */
export function agentLabel(agent: Pick<Member, 'agentKind' | 'agentConnection'>): string {
  const what = kindLabel(agent.agentKind);
  if (agent.agentKind && BOTS.has(agent.agentKind)) return `${what} bot`;
  if (agent.agentConnection === LOCAL_CONNECTION) return `${what} · local`;
  const platform = agent.agentConnection ? PLATFORM_LABELS[agent.agentConnection] : undefined;
  return platform ? `${what} · via ${platform}` : what;
}

/**
 * The kinds Rowboat runs for you, in the desktop Create screen's order and
 * words (agent-kinds.ts MANAGED_KINDS). The server says which it offers; on
 * one that bills (2026-11-04) there is no trial, so the line says what it runs on.
 */
export const MANAGED_KINDS: ReadonlyArray<{ kind: string; description: string; billedDescription: string }> = [
  { kind: 'hermes', description: 'A general agent with tools, memory and skills. Starts on Rowboat’s trial credit; add your own key later.', billedDescription: 'A general agent with tools, memory and skills, on your Rowboat credits.' },
  { kind: 'claude-code', description: 'Anthropic’s coding agent, on your Anthropic API key.', billedDescription: 'Anthropic’s coding agent, on your Anthropic API key.' },
  { kind: 'codex', description: 'OpenAI’s coding agent. Starts on Rowboat’s trial credit; add your OpenAI key later.', billedDescription: 'OpenAI’s coding agent, on your ChatGPT plan or OpenAI key.' },
];

/** The hosting states still moving: the screens re-read the listing while one is in them (desktop polls every 4s). */
export const MOVING_HOSTING: ReadonlySet<string> = new Set(['creating', 'deploying', 'checking', 'deleting']);
export const HOSTING_POLL_MS = 4_000;

/** A listing still worth showing: not deleted, not on its way out. */
export function isActiveListing({ agent, hosting }: AgentListing): boolean {
  return !agent.deactivatedAt && !agent.removedAt && hosting?.status !== 'deleting' && hosting?.status !== 'deleted';
}

function day(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

/** Where a managed agent's machine stands, in the desktop page's words (agent-page.tsx hostingLine). */
export function hostingLine(hosting: AgentHosting): string {
  switch (hosting.status) {
    case 'creating':
      return 'Being created… this takes a moment.';
    case 'deploying':
      return 'Deploying… a new agent takes a minute or three.';
    case 'checking':
      return 'Deployed. Waiting for it to take its first command…';
    case 'ready':
      return `Running on Rowboat since ${day(hosting.updatedAt)}. It sleeps between turns and wakes when mentioned.`;
    case 'failed':
      return `Could not be set up: ${hosting.error ?? 'no reason given'}. Delete it and create it again.`;
    case 'deleting':
      return 'Being removed… its keys are revoked, it has left every space, and its DMs are read-only.';
    case 'deleted':
      return `Removed on ${day(hosting.updatedAt)}. Its messages and DM history are kept.`;
  }
}

/** A short status for the list row. */
export function hostingStatusShort(hosting: AgentHosting): string | null {
  switch (hosting.status) {
    case 'creating':
    case 'deploying':
    case 'checking':
      return 'Setting up…';
    case 'failed':
      return 'Setup failed';
    case 'deleting':
      return 'Removing…';
    default:
      return null;
  }
}

/** Who pays for its model, one line (desktop FundingBlock, read-only on the phone). */
export function fundingLine(hosting: AgentHosting): string {
  const llm = hosting.llm;
  if (hosting.funding === 'own') {
    if (llm?.provider === 'chatgpt') return 'Runs on your ChatGPT plan.';
    return llm ? `Runs on your ${PROVIDER_LABELS[llm.provider] ?? llm.provider} key${llm.keyHint ? ` ${llm.keyHint}` : ''}.` : 'No model access: it answers nothing until you add your own API key.';
  }
  if (hosting.funding === 'credits') return 'Runs on your Rowboat credits.';
  const closed = hosting.trial?.closedReason;
  if (closed === 'exhausted') return 'Trial credit used up: it answers nothing until you add your own API key.';
  if (closed === 'expired') return 'Trial ended: it answers nothing until you add your own API key.';
  return `On Rowboat’s trial credit${hosting.trial?.endsAt ? ` until ${day(hosting.trial.endsAt)}` : ''}.`;
}

const PROVIDER_LABELS: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter', chatgpt: 'ChatGPT' };

export { AGENT_INSTRUCTIONS_MAX as INSTRUCTIONS_MAX } from '@rowboat/spaces-protocol';
/** The longest description Harbor keeps (Member.title). */
export const DESCRIPTION_MAX = 128;
