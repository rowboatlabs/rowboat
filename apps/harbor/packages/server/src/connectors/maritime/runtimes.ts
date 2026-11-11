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
  /** The server's address with its scheme, and the agent's own Spaces key, for the runtime's MCP server and file downloads. */
  serverUrl: string;
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
  /** What the turn script found about a sign-in to a plan (Codex, 2026-10-30), when it looked: its line in the stderr file. */
  signIn?: 'chatgpt' | 'none';
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
  /** The composer's options: the runtime's own (Effort), and Model from the list the harness left on the VM, when there is a choice. */
  options(models: ModelChoice[]): InvocationOption[];
  /** A separate, best-effort catalogue execution after the turn is settled (2026-11-01). */
  modelsCommand(): string;
  /** Where the catalogue execution leaves the harness's own model list. */
  modelsPath: string;
  /** That file read into choices; nothing when it is not one. */
  models(text: string): ModelChoice[];
}

/** One model the harness offers, as the composer shows it. */
export interface ModelChoice {
  id: string;
  label: string;
}

// Models are never listed in Harbor (2026-11-01): the ChatGPT backend, the API, Rowboat's proxy and each owner's
// provider all serve different sets, and they change on their own schedule. After settling a turn, a separate
// execution leaves the harness's own list on the VM (Codex's catalog file, Hermes's provider catalog, Anthropic's
// models endpoint for Claude Code). Catalogue latency must never hold up the answer (2026-11-01).

/** The Model option only when there is a choice to make (as local agents do, local-agents.ts), at most what the protocol takes. */
function modelOption(models: ModelChoice[]): InvocationOption[] {
  const usable = models.filter((m) => m.id.length > 0 && m.id.length <= 256).slice(0, 100);
  if (usable.length < 2) return [];
  return [{ type: 'select', key: 'model', label: 'Model', choices: usable.map((m) => ({ id: m.id, label: clip(m.label || m.id, 128) })) }];
}
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** A JSON document, or nothing. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Shell-quote one word. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Reasoning effort, the harness's own three levels (Codex's and Hermes's flag). */
const EFFORTS = ['low', 'medium', 'high'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));
/** What the Hermes turn runs on the VM for its model list: Hermes's own catalog for the configured provider, cached by Hermes itself. */
const HERMES_MODELS_PY = `import json, sys
provider, models = None, []
try:
    from hermes_cli.config import load_config
    from hermes_cli.models import provider_model_ids
    provider = (load_config().get("model") or {}).get("provider")
    models = [m for m in provider_model_ids(provider) if isinstance(m, str)]
except Exception:
    pass
json.dump({"provider": provider, "models": models}, sys.stdout)`;

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

const stderrTail = (err: string | undefined) =>
  (err ?? '')
    .trim()
    .split('\n')
    .filter((line) => line && !line.startsWith(SIGN_IN_MARK))
    .slice(-3)
    .join(' ')
    .slice(0, 600);
/** The turn script's own line on a sign-in, first in the stderr file (Codex, 2026-10-30). */
const SIGN_IN_MARK = 'rowboat-sign-in: ';
const signInOf = (err: string | undefined): 'chatgpt' | 'none' | undefined => {
  const found = /^rowboat-sign-in: (chatgpt|none)$/m.exec(err ?? '')?.[1];
  return found === 'chatgpt' || found === 'none' ? found : undefined;
};

/** The MCP server every runtime gets: Spaces, acting as this agent. */
const mcpJson = (serverUrl: string) =>
  JSON.stringify({ mcpServers: { rowboat: { type: 'http', url: `${serverUrl}/mcp`, headers: { Authorization: 'Bearer ${ROWBOAT_AGENT_KEY}' } } } });

// --- Hermes ---------------------------------------------------------------------------------

/** Hermes's words when its gateway is not ready to take a turn yet (`connect_gateway`, Hermes 0.22). */
const GATEWAY_NOT_READY = 'Gateway (starting|draining): ';
/** Tries five seconds apart: two minutes for the gateway to be ready. */
const GATEWAY_RETRIES = 24;

/**
 * The image Rowboat runs Hermes from on Maritime (2026-11-11): Hermes packaged as a Maritime "custom"
 * container, built from apps/harbor/images/hermes-maritime. Maritime's own `hermes` framework wrapper
 * stops the gateway on every other snapshot restore of a current Hermes image and rewrites config.yaml
 * on cold boots (measured 2026-11-10); under `custom` it does neither, and the image's shim keeps the
 * gateway up itself. Maritime's template is Hermes 0.14, too old for `hermes chat --format stream-json`.
 */
export const HERMES_IMAGE_REPO = 'ghcr.io/rowboatlabs/hermes-maritime';
export const HERMES_IMAGE = `${HERMES_IMAGE_REPO}:0.22.5-2`;
/** The model Maritime's own Hermes template configures for its proxy: the trial's choice when nothing else named one. */
const MARITIME_PROXY_MODEL = 'gpt-5.4';

const hermes: Runtime = {
  root: '/opt/data',
  sessionFor: (threadKey) => `rb-${threadKey}`,
  command(input) {
    const flags = [
      input.model ? `-m ${q(input.model)}` : '',
      input.effort ? `--reasoning ${q(input.effort)}` : '',
    ].filter(Boolean).join(' ');
    // Maritime's init rewrites config.yaml on every boot of the Hermes framework (measured 2026-10-26),
    // so the Spaces MCP server is put back before a turn whenever it is not Rowboat's. A box on Rowboat's
    // own image (framework `custom`, 2026-11-11) gets no rewrite; the guard stays for the older boxes and
    // costs a grep. The `${…}`
    // placeholders are Hermes's own, and the check is for the placeholders, never for a literal
    // address: a VM set up by hand or an earlier probe can carry a different Rowboat (seen live
    // 2026-10-26, posting to the wrong server). Hermes 0.22 runs the turn through its gateway, which
    // fills the placeholders from the profile's `.env`, not from the turn's environment (the
    // first managed agent on prod, 2026-10-26: "not set in this profile's .env or secret source"),
    // so the two values are written there too, with `hermes config set`, whenever they differ.
    return [
      'set -e',
      `export HERMES_HOME=/opt/data HOME=/opt/data ROWBOAT_URL=${q(input.serverUrl)} ROWBOAT_AGENT_KEY=${q(input.agentKey)}`,
      'export PATH="/command:/opt/hermes/bin:/opt/hermes/.venv/bin:$PATH"',
      'mkdir -p /opt/data/rowboat /opt/data/workspace',
      // The gateway runs as the hermes user; a turn run as root would leave root-owned session files behind.
      'if [ "$(id -u)" = 0 ] && [ -x /command/s6-setuidgid ]; then chown -R hermes:hermes /opt/data/rowboat 2>/dev/null || true; run() { /command/s6-setuidgid hermes env HERMES_HOME=/opt/data HOME=/opt/data PATH="$PATH" ROWBOAT_URL="$ROWBOAT_URL" ROWBOAT_AGENT_KEY="$ROWBOAT_AGENT_KEY" "$@"; }; else run() { "$@"; }; fi',
      `{ grep -q 'ROWBOAT_URL}/mcp' /opt/data/config.yaml && grep -q 'Bearer \${ROWBOAT_AGENT_KEY}' /opt/data/config.yaml; } 2>/dev/null || { run hermes config set mcp_servers.rowboat.url '\${ROWBOAT_URL}/mcp' >/dev/null 2>&1 || true; run hermes config set mcp_servers.rowboat.headers.Authorization 'Bearer \${ROWBOAT_AGENT_KEY}' >/dev/null 2>&1 || true; }`,
      `{ grep -F ROWBOAT_URL /opt/data/.env | grep -qF "$ROWBOAT_URL" && grep -F ROWBOAT_AGENT_KEY /opt/data/.env | grep -qF "$ROWBOAT_AGENT_KEY"; } 2>/dev/null || { run hermes config set ROWBOAT_URL "$ROWBOAT_URL" >/dev/null 2>&1 || true; run hermes config set ROWBOAT_AGENT_KEY "$ROWBOAT_AGENT_KEY" >/dev/null 2>&1 || true; }`,
      // The owner's own key (2026-10-27): the platform's boot rewrite points Hermes at the platform's proxy, so the
      // provider, its address, the model and the key go back into Hermes's config and .env before the turn, whenever
      // they differ. ROWBOAT_LLM_PROVIDER and ROWBOAT_LLM_MODEL are set by Harbor with the key (provisioning.ts).
      // `rowboat` (2026-11-04) is Rowboat's LLM gateway on the owner's Rowboat credits: it speaks OpenRouter's API,
      // so Hermes takes it as its OpenRouter provider at the gateway's address, ROWBOAT_LLM_BASE_URL.
      // The trial (no ROWBOAT_LLM_PROVIDER) runs on Maritime's proxy, which the platform names in OPENAI_BASE_URL and
      // OPENAI_API_KEY. Maritime's Hermes wrapper used to write that into config.yaml at boot; Rowboat's own image
      // (2026-11-11) gets no such rewrite, so the turn does it, with the template's model when none is set.
      `HP="$ROWBOAT_LLM_PROVIDER"; MD="$ROWBOAT_LLM_MODEL"; case "$ROWBOAT_LLM_PROVIDER" in openai) LB=https://api.openai.com/v1; LK="$OPENAI_API_KEY"; LN=OPENAI_API_KEY;; anthropic) LB=https://api.anthropic.com; LK="$ANTHROPIC_API_KEY"; LN=ANTHROPIC_API_KEY;; openrouter) LB=https://openrouter.ai/api/v1; LK="$OPENROUTER_API_KEY"; LN=OPENROUTER_API_KEY;; rowboat) HP=openrouter; LB="$ROWBOAT_LLM_BASE_URL"; LK="$OPENROUTER_API_KEY"; LN=OPENROUTER_API_KEY;; "") if [ -n "$OPENAI_BASE_URL" ]; then HP=openai; LB="$OPENAI_BASE_URL"; LK="$OPENAI_API_KEY"; LN=OPENAI_API_KEY; grep -q 'default: "' /opt/data/config.yaml 2>/dev/null || MD=${q(MARITIME_PROXY_MODEL)}; else LB=; LK=; LN=; fi;; *) LB=; LK=; LN=;; esac; if [ -n "$LB" ]; then { grep -q "provider: \"$HP\"" /opt/data/config.yaml && grep -q "base_url: \"$LB\"" /opt/data/config.yaml; } 2>/dev/null || { run hermes config set model.provider "$HP" >/dev/null 2>&1 || true; run hermes config set model.base_url "$LB" >/dev/null 2>&1 || true; }; [ -z "$MD" ] || grep -q "default: \"$MD\"" /opt/data/config.yaml 2>/dev/null || run hermes config set model.default "$MD" >/dev/null 2>&1 || true; [ -z "$LK" ] || grep -F "$LN" /opt/data/.env 2>/dev/null | grep -qF "$LK" || run hermes config set "$LN" "$LK" >/dev/null 2>&1 || true; fi`,
      // The rowboat-spaces skill, once: without it the first turn of every session fetches it from GitHub (seen on prod 2026-10-26).
      `{ [ -d /opt/data/skills/rowboat-spaces ] || ls -d /opt/data/skills/*/rowboat-spaces >/dev/null 2>&1; } || run hermes skills install rowboatlabs/rowboat/skills/rowboat-spaces --yes >/dev/null 2>&1 || true`,
      'cd /opt/data/workspace',
      // A VM woken from a snapshot can find its gateway still `starting`, or `draining` while the supervisor stops a
      // duplicate one, and `hermes chat` then refuses before any turn runs ("Gateway draining: not_ready", seen on prod
      // 2026-11-04). Hermes's own kanban worker waits those two states out; the turn does too, for up to two minutes.
      `n=0; while :; do rc=0; run hermes chat --query-file ${q(input.promptPath)} --oneshot --format stream-json -c ${q(input.session ?? 'rowboat')} --create-if-missing ${flags} > ${q(input.outPath)} 2> ${q(input.errPath)} || rc=$?; [ "$rc" = 0 ] && break; n=$((n+1)); [ "$n" -lt ${GATEWAY_RETRIES} ] && grep -qE ${q(GATEWAY_NOT_READY)} ${q(input.outPath)} ${q(input.errPath)} 2>/dev/null || exit "$rc"; sleep 5; done`,
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
  options: (models) => [...modelOption(models), { type: 'select', key: 'effort', label: 'Effort', choices: EFFORTS }],
  modelsCommand: () => [
    'set -e',
    'export HERMES_HOME=/opt/data HOME=/opt/data',
    'export PATH="/command:/opt/hermes/bin:/opt/hermes/.venv/bin:$PATH"',
    'if [ "$(id -u)" = 0 ] && [ -x /command/s6-setuidgid ]; then run() { /command/s6-setuidgid hermes env HERMES_HOME=/opt/data HOME=/opt/data PATH="$PATH" "$@"; }; else run() { "$@"; }; fi',
    `printf '%s\\n' ${q(HERMES_MODELS_PY)} > /opt/data/rowboat/models.py; run timeout 30 python /opt/data/rowboat/models.py > /opt/data/rowboat/models.json.tmp 2>/dev/null && mv /opt/data/rowboat/models.json.tmp /opt/data/rowboat/models.json || true`,
  ].join('\n'),
  modelsPath: '/opt/data/rowboat/models.json',
  models(text) {
    const doc = obj(parse(text));
    const rows: unknown[] = Array.isArray(doc?.models) ? doc.models : [];
    return rows.flatMap((m) => (typeof m === 'string' && m ? [{ id: m, label: m }] : []));
  },
};

// --- Codex ----------------------------------------------------------------------------------

const codex: Runtime = {
  root: '/data',
  command(input) {
    const flags = [
      input.model ? `-m ${q(input.model)}` : '',
      input.effort ? `-c ${q(`model_reasoning_effort="${input.effort}"`)}` : '',
      `-c ${q(`mcp_servers.rowboat.url="${input.serverUrl}/mcp"`)}`,
      `-c ${q('mcp_servers.rowboat.bearer_token_env_var="ROWBOAT_AGENT_KEY"')}`,
    ].filter(Boolean).join(' ');
    // The template's own flags (its server.js, read 2026-10-26): the VM is the sandbox, the final message goes to -o.
    return [
      'set -e',
      `export CODEX_HOME=/data/.codex ROWBOAT_URL=${q(input.serverUrl)} ROWBOAT_AGENT_KEY=${q(input.agentKey)}`,
      'mkdir -p /data/rowboat /data/workspace',
      'cd /data/workspace',
      `PROMPT="$(cat ${q(input.promptPath)})"`,
      // The owner's own key (2026-10-27): Codex's built-in openai provider on OPENAI_API_KEY and OPENAI_BASE_URL, which
      // Harbor set with the key, instead of the template's provider on the platform's proxy; the owner's model when the turn picked none.
      // The owner's ChatGPT sign-in (2026-10-30): Codex honours one on its built-in provider only, and the template's
      // config names its own, so a turn not on a key asks Codex whether a sign-in is there and forces the built-in
      // provider when it is, the proxy's address unset with it. Its answer goes first into the stderr file, for Harbor.
      `OWN=""; if [ "$ROWBOAT_LLM_PROVIDER" = openai ]; then OWN='-c model_provider="openai"'; elif codex login status 2>&1 | grep -q 'ChatGPT'; then OWN='-c model_provider="openai"'; unset OPENAI_BASE_URL; echo '${SIGN_IN_MARK}chatgpt' > ${q(input.errPath)}; else echo '${SIGN_IN_MARK}none' > ${q(input.errPath)}; fi`,
      `${input.model ? '' : '[ -z "$ROWBOAT_LLM_MODEL" ] || OWN="$OWN -m $ROWBOAT_LLM_MODEL"; '}true`,
      `codex exec ${input.session ? `resume ${q(input.session)}` : ''} --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -o ${q(input.lastPath)} $OWN ${flags} -- "$PROMPT" > ${q(input.outPath)} 2>> ${q(input.errPath)}`,
    ].join('\n');
  },
  read(out, last, err, exitCode) {
    const all = events(out);
    const started = all.find((e) => e.type === 'thread.started');
    const session = str(started?.thread_id);
    const failed = all.find((e) => e.type === 'turn.failed' || e.type === 'error');
    const messages = all.filter((e) => e.type === 'item.completed' && obj(e.item)?.type === 'agent_message');
    const answer = (last ?? str(obj(messages.at(-1)?.item)?.text) ?? '').trim();
    const signIn = signInOf(err);
    const seen = { ...(session ? { session } : {}), ...(signIn ? { signIn } : {}) };
    if (failed || (exitCode !== undefined && exitCode !== null && exitCode !== 0)) {
      const reason = str(obj(failed?.error)?.message) ?? str(failed?.message) ?? stderrTail(err) ?? 'Codex stopped with an error';
      return { ...(answer ? { answer } : {}), failure: reason, ...seen };
    }
    return { ...(answer ? { answer } : {}), ...seen };
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
  options: (models) => [...modelOption(models), { type: 'select', key: 'effort', label: 'Effort', choices: EFFORTS }],
  modelsCommand: () => [
    'set -e',
    'export CODEX_HOME=/data/.codex',
    // Match the turn’s account routing (2026-11-01): a ChatGPT sign-in must not fall back to the platform proxy.
    'if [ "$ROWBOAT_LLM_PROVIDER" != openai ] && codex login status 2>&1 | grep -q ChatGPT; then unset OPENAI_BASE_URL; fi',
    `cp "$CODEX_HOME/models_cache.json" /data/rowboat/models.json 2>/dev/null || { [ -n "$OPENAI_BASE_URL" ] && curl -sf -m 15 "$OPENAI_BASE_URL/models" -H "Authorization: Bearer $OPENAI_API_KEY" > /data/rowboat/models.json.tmp && mv /data/rowboat/models.json.tmp /data/rowboat/models.json; } || true`,
  ].join('\n'),
  modelsPath: '/data/rowboat/models.json',
  // Codex's catalog (`models`: slug, display_name, visibility, priority), or a plain models endpoint (`data`: id).
  models(text) {
    const doc = obj(parse(text));
    const rows: unknown[] = Array.isArray(doc?.models) ? doc.models : Array.isArray(doc?.data) ? doc.data : [];
    const found = rows.flatMap((r) => {
      const m = obj(r);
      const id = str(m?.slug) ?? str(m?.id);
      if (!m || !id || m.visibility === 'hide' || m.hidden === true) return [];
      const priority = typeof m.priority === 'number' ? m.priority : Number.MAX_SAFE_INTEGER;
      return [{ id, label: str(m.display_name) ?? id, priority }];
    });
    return found.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map(({ id, label }) => ({ id, label }));
  },
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
      `export IS_SANDBOX=1 CLAUDE_CONFIG_DIR=/data/.claude ROWBOAT_URL=${q(input.serverUrl)} ROWBOAT_AGENT_KEY=${q(input.agentKey)}`,
      'mkdir -p /data/rowboat /data/workspace',
      'cd /data/workspace',
      `printf '%s' ${q(mcpJson(input.serverUrl))} > /data/rowboat/mcp.json`,
      'CLI="$(command -v claude 2>/dev/null || true)"',
      '[ -n "$CLI" ] || for f in /app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js /app/node_modules/@anthropic-ai/claude-code/cli.js; do [ -f "$f" ] && CLI="node $f" && break; done',
      '[ -n "$CLI" ] || { echo "no Claude Code CLI found in this VM" >&2; exit 127; }',
      `PROMPT="$(cat ${q(input.promptPath)})"`,
      `OWN=""; ${input.model ? '' : '[ -z "$ROWBOAT_LLM_MODEL" ] || OWN="--model $ROWBOAT_LLM_MODEL"; '}true`,
      `$CLI -p --output-format stream-json --verbose --dangerously-skip-permissions --mcp-config /data/rowboat/mcp.json $OWN ${flags} -- "$PROMPT" > ${q(input.outPath)} 2> ${q(input.errPath)}`,
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
  options: (models) => modelOption(models),
  modelsCommand: () => [
    'set -e',
    `f=/data/rowboat/models.json; if [ -n "$ANTHROPIC_API_KEY" ] && { [ ! -s "$f" ] || [ -n "$(find "$f" -mmin +1440 2>/dev/null)" ]; }; then curl -sf -m 15 "\${ANTHROPIC_BASE_URL:-https://api.anthropic.com}/v1/models?limit=100" -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" > "$f.tmp" && mv "$f.tmp" "$f" || true; fi`,
  ].join('\n'),
  modelsPath: '/data/rowboat/models.json',
  models(text) {
    const doc = obj(parse(text));
    const rows: unknown[] = Array.isArray(doc?.data) ? doc.data : [];
    return rows.flatMap((r) => {
      const m = obj(r);
      const id = str(m?.id);
      return m && id ? [{ id, label: str(m.display_name) ?? id }] : [];
    });
  },
};

export const RUNTIMES: Record<string, Runtime> = { hermes, codex, 'claude-code': claudeCode };

/** The kind a Maritime agent runs, from its record: by template, then by framework, then by Rowboat's own Hermes image; undefined when it does not say. */
export function kindOfAgent(agent: { framework: string; templateId: string | null; imageName?: string | null }): string | undefined {
  if (agent.templateId === 'claude_code') return 'claude-code';
  if (agent.templateId === 'codex') return 'codex';
  if (agent.templateId === 'hermes' || agent.framework === 'hermes') return 'hermes';
  if (agent.imageName?.startsWith(`${HERMES_IMAGE_REPO}:`)) return 'hermes';
  return undefined;
}
