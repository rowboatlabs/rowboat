import type { InvocationOption } from '@rowboat/spaces-protocol';
import { activityOf, answerOf, failureOf, type AgentEvent } from '../common/agent-events.js';

// The runtimes the Maritime connector drives (spec §8 Connectors, Maritime,
// 2026-10-26): each turn is the runtime's own CLI, run once in the agent's VM
// as a detached execution, reading the request from a file on the volume and
// writing its event stream to another. The connector never parses chat prose:
// every runtime here has a non-interactive mode with a resumable session, a
// JSON event stream, and the answer as a typed event. Measured on 2026-10-26
// (the plan's section 11): Codex and Hermes end to end; Claude Code from its
// template's own server code and the CLI's documented flags, not yet run.
//
// Where things live on the VM is each image's: Hermes keeps everything under
// `/opt/data`, the coding templates under `/data`; both survive sleep,
// restart and redeploy. The request and output files go in a `rowboat/`
// folder there, named by the invocation, so a restart finds them.

export interface TurnInput {
  /** The org's address with its scheme, and the agent's own Spaces key, for the runtime's MCP server and file downloads. */
  orgUrl: string;
  agentKey: string;
  /** The files for this turn, absolute on the VM: the request, the event stream, stderr, and the final message. */
  promptPath: string;
  outPath: string;
  errPath: string;
  lastPath: string;
  /** The thread's session on the runtime: Hermes's session name, Codex's thread id, Claude Code's session id. */
  session?: string;
  model?: string;
  effort?: string;
}

/** What a finished turn's files say. */
export interface TurnReading {
  answer?: string;
  failure?: string;
  /** The session the next turn in this thread resumes. */
  session?: string;
}

export interface Runtime {
  /** The persistent volume's mount, where the files go. */
  root: string;
  /** The `sh -c` script for one turn. */
  command(input: TurnInput): string;
  /** The session name a new thread gets, when the runtime names sessions rather than minting ids. */
  sessionFor?(threadKey: string): string;
  /** The answer, failure and session a finished turn left in its files. */
  read(out: string, last: string | undefined, err: string | undefined, exitCode: number | null | undefined): TurnReading;
  /** What the newest events show the agent doing, if anything. */
  activity(out: string): string | undefined;
  options: InvocationOption[];
}

/** Shell-quote one word. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const EFFORTS = ['low', 'medium', 'high'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));
const CODEX_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.5-codex', 'o3'].map((id) => ({ id, label: id }));
const CLAUDE_MODELS = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
];

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Every JSON object in a JSONL stream, skipping what is not JSON. */
function events(out: string): Json[] {
  const found: Json[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = obj(JSON.parse(trimmed));
      if (parsed) found.push(parsed);
    } catch {
      // a partial last line while the turn runs
    }
  }
  return found;
}

const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const stderrTail = (err: string | undefined) => (err ?? '').trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 600);

/** The MCP server every runtime gets: Spaces, acting as this agent. */
const mcpJson = (orgUrl: string) =>
  JSON.stringify({ mcpServers: { rowboat: { type: 'http', url: `${orgUrl}/mcp`, headers: { Authorization: 'Bearer ${ROWBOAT_AGENT_KEY}' } } } });

// --- Hermes ---------------------------------------------------------------------------------

const hermes: Runtime = {
  root: '/opt/data',
  sessionFor: (threadKey) => `rb-${threadKey}`,
  command(input) {
    const flags = [
      input.model ? `-m ${q(input.model)}` : '',
      input.effort ? `--reasoning ${q(input.effort)}` : '',
    ].filter(Boolean).join(' ');
    // Maritime's init rewrites config.yaml on every boot of the Hermes framework (measured 2026-10-26),
    // so the Spaces MCP server is put back before a turn whenever it is not Rowboat's. The `${…}`
    // placeholders are Hermes's own, and the check is for the placeholders, never for a literal
    // address: a VM set up by hand or an earlier probe can carry a different Rowboat (seen live
    // 2026-10-26, posting to the wrong org). Hermes 0.22 runs the turn through its gateway, which
    // fills the placeholders from the profile's `.env`, not from the turn's environment (the
    // first managed agent on prod, 2026-10-26: "not set in this profile's .env or secret source"),
    // so the two values are written there too, with `hermes config set`, whenever they differ.
    return [
      'set -e',
      `export HERMES_HOME=/opt/data HOME=/opt/data ROWBOAT_URL=${q(input.orgUrl)} ROWBOAT_AGENT_KEY=${q(input.agentKey)}`,
      'export PATH="/command:/opt/hermes/bin:/opt/hermes/.venv/bin:$PATH"',
      'mkdir -p /opt/data/rowboat /opt/data/workspace',
      // The gateway runs as the hermes user; a turn run as root would leave root-owned session files behind.
      'if [ "$(id -u)" = 0 ] && [ -x /command/s6-setuidgid ]; then chown -R hermes:hermes /opt/data/rowboat 2>/dev/null || true; run() { /command/s6-setuidgid hermes env HERMES_HOME=/opt/data HOME=/opt/data PATH="$PATH" ROWBOAT_URL="$ROWBOAT_URL" ROWBOAT_AGENT_KEY="$ROWBOAT_AGENT_KEY" "$@"; }; else run() { "$@"; }; fi',
      `{ grep -q 'ROWBOAT_URL}/mcp' /opt/data/config.yaml && grep -q 'Bearer \${ROWBOAT_AGENT_KEY}' /opt/data/config.yaml; } 2>/dev/null || { run hermes config set mcp_servers.rowboat.url '\${ROWBOAT_URL}/mcp' >/dev/null 2>&1 || true; run hermes config set mcp_servers.rowboat.headers.Authorization 'Bearer \${ROWBOAT_AGENT_KEY}' >/dev/null 2>&1 || true; }`,
      `{ grep -F ROWBOAT_URL /opt/data/.env | grep -qF "$ROWBOAT_URL" && grep -F ROWBOAT_AGENT_KEY /opt/data/.env | grep -qF "$ROWBOAT_AGENT_KEY"; } 2>/dev/null || { run hermes config set ROWBOAT_URL "$ROWBOAT_URL" >/dev/null 2>&1 || true; run hermes config set ROWBOAT_AGENT_KEY "$ROWBOAT_AGENT_KEY" >/dev/null 2>&1 || true; }`,
      // The rowboat-spaces skill, once: without it the first turn of every session fetches it from GitHub (seen on prod 2026-10-26).
      `{ [ -d /opt/data/skills/rowboat-spaces ] || ls -d /opt/data/skills/*/rowboat-spaces >/dev/null 2>&1; } || run hermes skills install rowboatlabs/rowboat/skills/rowboat-spaces --yes >/dev/null 2>&1 || true`,
      'cd /opt/data/workspace',
      `run hermes chat --query-file ${q(input.promptPath)} --oneshot --format stream-json -c ${q(input.session ?? 'rowboat')} --create-if-missing ${flags} > ${q(input.outPath)} 2> ${q(input.errPath)}`,
    ].join('\n');
  },
  // The thread's session is its name (`-c`), kept from the first turn; the id a result reports is not read back.
  read(out, _last, err, exitCode) {
    const all = events(out);
    const result = [...all].reverse().find((e) => e.type === 'result');
    const text = str(result?.text)?.trim();
    const failed = (typeof result?.exit_code === 'number' && result.exit_code !== 0) || (exitCode !== undefined && exitCode !== null && exitCode !== 0);
    if (failed) return { ...(text ? { answer: text } : {}), failure: str(result?.error) ?? stderrTail(err) ?? 'Hermes stopped with an error' };
    if (!result) return { failure: stderrTail(err) || 'Hermes ended without a result' };
    return text ? { answer: text } : {};
  },
  activity(out) {
    for (const e of events(out).reverse()) {
      if (e.type !== 'tool_call' && e.type !== 'tool') continue;
      const name = str(e.name) ?? str(e.tool);
      if (name) return `is using ${oneLine(name, 60)}`;
    }
    return undefined;
  },
  options: [{ type: 'select', key: 'effort', label: 'Effort', choices: EFFORTS }],
};

// --- Codex ----------------------------------------------------------------------------------

const codex: Runtime = {
  root: '/data',
  command(input) {
    const flags = [
      input.model ? `-m ${q(input.model)}` : '',
      input.effort ? `-c ${q(`model_reasoning_effort="${input.effort}"`)}` : '',
      `-c ${q(`mcp_servers.rowboat.url="${input.orgUrl}/mcp"`)}`,
      `-c ${q('mcp_servers.rowboat.bearer_token_env_var="ROWBOAT_AGENT_KEY"')}`,
    ].filter(Boolean).join(' ');
    // The template's own flags (its server.js, read 2026-10-26): the VM is the sandbox, the final message goes to -o.
    return [
      'set -e',
      `export CODEX_HOME=/data/.codex ROWBOAT_URL=${q(input.orgUrl)} ROWBOAT_AGENT_KEY=${q(input.agentKey)}`,
      'mkdir -p /data/rowboat /data/workspace',
      'cd /data/workspace',
      `PROMPT="$(cat ${q(input.promptPath)})"`,
      `codex exec ${input.session ? `resume ${q(input.session)}` : ''} --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -o ${q(input.lastPath)} ${flags} -- "$PROMPT" > ${q(input.outPath)} 2> ${q(input.errPath)}`,
    ].join('\n');
  },
  read(out, last, err, exitCode) {
    const all = events(out);
    const started = all.find((e) => e.type === 'thread.started');
    const session = str(started?.thread_id);
    const failed = all.find((e) => e.type === 'turn.failed' || e.type === 'error');
    const messages = all.filter((e) => e.type === 'item.completed' && obj(e.item)?.type === 'agent_message');
    const answer = (last ?? str(obj(messages.at(-1)?.item)?.text) ?? '').trim();
    if (failed || (exitCode !== undefined && exitCode !== null && exitCode !== 0)) {
      const reason = str(obj(failed?.error)?.message) ?? str(failed?.message) ?? stderrTail(err) ?? 'Codex stopped with an error';
      return { ...(answer ? { answer } : {}), failure: reason, ...(session ? { session } : {}) };
    }
    return { ...(answer ? { answer } : {}), ...(session ? { session } : {}) };
  },
  activity(out) {
    for (const e of events(out).reverse()) {
      if (e.type !== 'item.started' && e.type !== 'item.completed') continue;
      const item = obj(e.item);
      if (!item) continue;
      if (item.type === 'command_execution') return str(item.command) ? `is running \`${oneLine(str(item.command)!, 150)}\`` : 'is running a command';
      if (item.type === 'file_change') return 'is editing files';
      if (item.type === 'mcp_tool_call') return `is using ${oneLine(str(item.tool) ?? str(item.name) ?? 'a tool', 60)}`;
      if (item.type === 'web_search') return 'is searching the web';
    }
    return undefined;
  },
  options: [
    { type: 'select', key: 'model', label: 'Model', choices: CODEX_MODELS },
    { type: 'select', key: 'effort', label: 'Effort', choices: EFFORTS },
  ],
};

// --- Claude Code ------------------------------------------------------------------------------

const claudeCode: Runtime = {
  root: '/data',
  command(input) {
    const flags = [input.model ? `--model ${q(input.model)}` : '', input.session ? `--resume ${q(input.session)}` : ''].filter(Boolean).join(' ');
    // The template keeps Claude Code's state on the volume and runs as root in a disposable VM (its server.js);
    // the CLI ships inside the Agent SDK the template installs, or on PATH in an image that installs it.
    return [
      'set -e',
      `export IS_SANDBOX=1 CLAUDE_CONFIG_DIR=/data/.claude ROWBOAT_URL=${q(input.orgUrl)} ROWBOAT_AGENT_KEY=${q(input.agentKey)}`,
      'mkdir -p /data/rowboat /data/workspace',
      'cd /data/workspace',
      `printf '%s' ${q(mcpJson(input.orgUrl))} > /data/rowboat/mcp.json`,
      'CLI="$(command -v claude 2>/dev/null || true)"',
      '[ -n "$CLI" ] || for f in /app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js /app/node_modules/@anthropic-ai/claude-code/cli.js; do [ -f "$f" ] && CLI="node $f" && break; done',
      '[ -n "$CLI" ] || { echo "no Claude Code CLI found in this VM" >&2; exit 127; }',
      `PROMPT="$(cat ${q(input.promptPath)})"`,
      `$CLI -p --output-format stream-json --verbose --dangerously-skip-permissions --mcp-config /data/rowboat/mcp.json ${flags} -- "$PROMPT" > ${q(input.outPath)} 2> ${q(input.errPath)}`,
    ].join('\n');
  },
  read(out, _last, err, exitCode) {
    const all = events(out);
    const asEvents: AgentEvent[] = all.map((e) => ({ type: `claude-${str(e.type) ?? 'unknown'}`, payload: e }));
    const result = [...all].reverse().find((e) => e.type === 'result');
    const session = str(result?.session_id) ?? str(all.find((e) => str(e.session_id))?.session_id);
    const answer = (str(result?.result) ?? answerOf('claude-code', asEvents) ?? '').trim();
    const failure = failureOf('claude-code', asEvents) ?? (exitCode !== undefined && exitCode !== null && exitCode !== 0 ? stderrTail(err) || 'Claude Code stopped with an error' : undefined);
    return { ...(answer ? { answer } : {}), ...(failure ? { failure } : {}), ...(session ? { session } : {}) };
  },
  activity(out) {
    for (const e of events(out).reverse()) {
      const line = activityOf('claude-code', { type: `claude-${str(e.type) ?? ''}`, payload: e });
      if (line) return line;
    }
    return undefined;
  },
  options: [{ type: 'select', key: 'model', label: 'Model', choices: CLAUDE_MODELS }],
};

export const RUNTIMES: Record<string, Runtime> = { hermes, codex, 'claude-code': claudeCode };

/** The kind a Maritime agent runs, from its record: by template, then by framework; undefined when it does not say. */
export function kindOfAgent(agent: { framework: string; templateId: string | null }): string | undefined {
  if (agent.templateId === 'claude_code') return 'claude-code';
  if (agent.templateId === 'codex') return 'codex';
  if (agent.templateId === 'hermes' || agent.framework === 'hermes') return 'hermes';
  return undefined;
}
