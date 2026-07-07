import { spawn, type ChildProcess } from 'child_process';
import { Writable, Readable } from 'node:stream';
import fs from 'fs/promises';
import {
    ClientSideConnection,
    ndJsonStream,
    PROTOCOL_VERSION,
    type Client,
    type RequestPermissionRequest,
    type RequestPermissionResponse,
    type SessionNotification,
    type SessionUpdate,
    type PromptResponse,
    type ReadTextFileRequest,
    type ReadTextFileResponse,
    type WriteTextFileRequest,
    type WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { CodingAgent, CodeRunEvent } from './types.js';
import type { PermissionBroker } from './permission-broker.js';
import { getAgentLaunchSpec } from './agents.js';

export interface AcpClientOptions {
    agent: CodingAgent;
    cwd: string;
    broker: PermissionBroker;
    onEvent: (event: CodeRunEvent) => void;
}

// Deadline for the startup phases (initialize / session create+load). A healthy cold
// start — adapter boot, engine spawn, SDK handshake, MCP connects — takes seconds; only
// a wedged engine takes this long. Without a deadline that failure mode is an infinite
// "(pending...)" with zero feedback. Prompts are intentionally NOT time-limited: turns
// legitimately run for many minutes and may wait on user permission asks. Overridable
// via ROWBOAT_ACP_STARTUP_TIMEOUT_MS (CI smoke test; escape hatch for MCP-heavy setups).
const STARTUP_TIMEOUT_MS = Number(process.env.ROWBOAT_ACP_STARTUP_TIMEOUT_MS) > 0
    ? Number(process.env.ROWBOAT_ACP_STARTUP_TIMEOUT_MS)
    : 60_000;

export interface CodeAgentOption { value: string; label: string }
export interface CodeAgentModelOptions { models: CodeAgentOption[]; efforts: CodeAgentOption[] }

// The agent advertises its model + effort choices on the session it opens (the
// same data that backs its `/model` picker), in one of two shapes:
//   - `configOptions`: select options with id "model" / "effort" (Claude).
//   - `models`: a SessionModelState { availableModels: [{ modelId, name }] }
//     (Codex — which folds effort into the model id, so no separate effort).
// We read configOptions first and fall back to `models`, then prepend a
// synthetic "Default" so the user can always keep the engine default.
type RawSelectOption = { value?: unknown; name?: unknown; options?: Array<{ value?: unknown; name?: unknown }> };
type RawConfigOption = { id?: string; options?: RawSelectOption[] };
type RawModelState = { availableModels?: Array<{ modelId?: unknown; name?: unknown }> };

function withDefault(choices: CodeAgentOption[]): CodeAgentOption[] {
    return choices.some((c) => c.value === 'default')
        ? choices
        : [{ value: 'default', label: 'Default' }, ...choices];
}

function toChoices(option: RawConfigOption | undefined): CodeAgentOption[] {
    const flat = (option?.options ?? []).flatMap((o) => (Array.isArray(o.options) ? o.options : [o]));
    return flat
        .filter((o): o is { value: string; name?: unknown } => typeof o.value === 'string')
        .map((o) => ({ value: o.value, label: typeof o.name === 'string' && o.name ? o.name : o.value }));
}

function modelStateChoices(models: RawModelState | undefined): CodeAgentOption[] {
    return (models?.availableModels ?? [])
        .filter((m): m is { modelId: string; name?: unknown } => typeof m.modelId === 'string')
        .map((m) => ({ value: m.modelId, label: typeof m.name === 'string' && m.name ? m.name : m.modelId }));
}

export function extractModelOptions(configOptions: unknown, models?: unknown): CodeAgentModelOptions {
    const list = (Array.isArray(configOptions) ? configOptions : []) as RawConfigOption[];
    const modelOpt = list.find((o) => o.id === 'model');
    const effortOpt = list.find((o) => o.id === 'effort');
    const modelChoices = toChoices(modelOpt);
    return {
        // configOptions is authoritative when present; otherwise fall back to the
        // SessionModelState list (Codex reports models only there).
        models: withDefault(modelChoices.length ? modelChoices : modelStateChoices(models as RawModelState)),
        efforts: effortOpt ? withDefault(toChoices(effortOpt)) : [],
    };
}

// Claude's `availableModels` exposes its top model only as "Default
// (recommended)" and omits an explicit "Opus" row (the interactive `/model`
// lists it, the ACP adapter dedupes it). Surface the canonical aliases
// explicitly for clarity — the adapter resolves "opus"/"sonnet"/"haiku" to the
// concrete model. Deduped against what the engine already returned, so in
// practice this only adds the missing "Opus" entry, placed right after Default.
const CLAUDE_ALIAS_ROWS: CodeAgentOption[] = [
    { value: 'opus', label: 'Opus' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' },
];

function withClaudeAliases(options: CodeAgentModelOptions): CodeAgentModelOptions {
    const have = new Set(options.models.map((m) => m.value));
    const extra = CLAUDE_ALIAS_ROWS.filter((r) => !have.has(r.value));
    if (extra.length === 0) return options;
    const at = options.models.findIndex((m) => m.value === 'default');
    const models = [...options.models];
    models.splice(at >= 0 ? at + 1 : 0, 0, ...extra);
    return { ...options, models };
}

// Map a raw ACP session/update notification onto our small CodeRunEvent union.
function toEvent(update: SessionUpdate): CodeRunEvent {
    switch (update.sessionUpdate) {
        case 'agent_message_chunk':
        case 'user_message_chunk': {
            const c = update.content;
            const role = update.sessionUpdate === 'user_message_chunk' ? 'user' : 'agent';
            return { type: 'message', role, text: c.type === 'text' ? c.text : `[${c.type}]` };
        }
        case 'agent_thought_chunk':
            return { type: 'thought' };
        case 'tool_call':
            return {
                type: 'tool_call',
                id: update.toolCallId,
                title: update.title,
                kind: update.kind ?? undefined,
                status: update.status ?? undefined,
            };
        case 'tool_call_update': {
            const diffs = (update.content ?? [])
                .filter((c): c is Extract<typeof c, { type: 'diff' }> => c.type === 'diff')
                .map((c) => c.path);
            return { type: 'tool_call_update', id: update.toolCallId, status: update.status ?? undefined, diffs };
        }
        case 'plan':
            return {
                type: 'plan',
                entries: (update.entries ?? []).map((e) => ({
                    content: e.content,
                    status: e.status ?? undefined,
                    priority: e.priority ?? undefined,
                })),
            };
        case 'usage_update':
            return { type: 'usage', used: update.used, size: update.size };
        default:
            return { type: 'other', sessionUpdate: update.sessionUpdate };
    }
}

// Owns one spawned adapter process + ACP connection. Stateless about sessions —
// the manager decides whether to newSession or loadSession.
//
// The connection is long-lived and reused across follow-up prompts, but each prompt
// may stream to a different message's UI, so broker + onEvent are swappable via
// setHandlers() rather than fixed at construction.
export class AcpClient {
    readonly agent: CodingAgent;
    readonly cwd: string;
    private broker: PermissionBroker;
    private onEvent: (event: CodeRunEvent) => void;
    private child?: ChildProcess;
    private connection?: ClientSideConnection;
    private loadSession_ = false;
    // Diagnostics: the adapter's stderr/exit are captured so a dropped connection
    // reports WHY (e.g. a crash) instead of the SDK's bare "ACP connection closed".
    private stderrTail = '';
    private exitInfo: string | null = null;

    constructor(opts: AcpClientOptions) {
        this.agent = opts.agent;
        this.cwd = opts.cwd;
        this.broker = opts.broker;
        this.onEvent = opts.onEvent;
    }

    get loadSupported(): boolean {
        return this.loadSession_;
    }

    // Re-point the live connection at a new prompt's broker / event sink.
    setHandlers(broker: PermissionBroker, onEvent: (event: CodeRunEvent) => void): void {
        this.broker = broker;
        this.onEvent = onEvent;
    }

    // Spawn the adapter and negotiate the protocol. Returns once initialized.
    async start(): Promise<void> {
        const spec = getAgentLaunchSpec(this.agent);
        const child = spawn(spec.command, spec.args, {
            cwd: this.cwd,
            env: spec.env,
            // Capture stderr (not inherit) so we can attribute a dropped connection.
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.child = child;
        child.stderr?.on('data', (d: Buffer) => {
            this.stderrTail = (this.stderrTail + d.toString()).slice(-4000);
        });
        child.on('exit', (code, signal) => {
            this.exitInfo = `adapter exited (code ${code}${signal ? `, signal ${signal}` : ''})`;
        });
        child.on('error', (err) => {
            this.stderrTail = (this.stderrTail + `\nspawn error: ${err.message}`).slice(-4000);
        });

        const stream = ndJsonStream(
            Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
            Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
        );
        const client = this.buildClient();
        this.connection = new ClientSideConnection(() => client, stream);

        try {
            const init = await this.withStartupTimeout(this.connection.initialize({
                protocolVersion: PROTOCOL_VERSION,
                clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
            }));
            this.loadSession_ = init.agentCapabilities?.loadSession === true;
        } catch (e) {
            throw this.enrich(e, 'initialize');
        }
    }

    // Race a startup-phase request against the deadline so a wedged engine fails with a
    // clear, enriched error instead of leaving the turn pending forever. Callers dispose
    // the client on failure, which kills the spawned adapter.
    private async withStartupTimeout<T>(work: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(
                    `timed out after ${STARTUP_TIMEOUT_MS / 1000}s — the ${this.agent} engine failed to ` +
                    `complete startup (it may be wedged or misconfigured)`,
                ));
            }, STARTUP_TIMEOUT_MS);
            timer.unref?.();
        });
        try {
            return await Promise.race([work, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async newSession(): Promise<string> {
        try {
            const res = await this.withStartupTimeout(this.conn().newSession({ cwd: this.cwd, mcpServers: [] }));
            return res.sessionId;
        } catch (e) {
            throw this.enrich(e, 'newSession');
        }
    }

    // Open a throwaway session purely to read the agent's advertised model +
    // effort choices, then let the caller dispose this client. Used for the
    // model picker before any real session exists.
    async describeModelOptions(): Promise<CodeAgentModelOptions> {
        try {
            const res = await this.withStartupTimeout(this.conn().newSession({ cwd: this.cwd, mcpServers: [] }));
            const r = res as { configOptions?: unknown; models?: unknown };
            const options = extractModelOptions(r.configOptions, r.models);
            return this.agent === 'claude' ? withClaudeAliases(options) : options;
        } catch (e) {
            throw this.enrich(e, 'describeModelOptions');
        }
    }

    async loadSession(sessionId: string): Promise<void> {
        try {
            await this.withStartupTimeout(this.conn().loadSession({ sessionId, cwd: this.cwd, mcpServers: [] }));
        } catch (e) {
            throw this.enrich(e, 'loadSession');
        }
    }

    // Point the open session at a specific model. The adapter resolves aliases
    // ("opus"/"sonnet"/…) to concrete ids. Throws if the model is unknown; the
    // caller applies this best-effort so a bad value never blocks a turn.
    // ACP 1.x folded model selection into the generic config-option system (the
    // 'model' category), so this goes through setSessionConfigOption just like
    // effort does — matching the id extractModelOptions reads.
    async setModel(sessionId: string, modelId: string): Promise<void> {
        await this.conn().setSessionConfigOption({ sessionId, configId: 'model', value: modelId });
    }

    // Set the reasoning-effort level via the agent's "effort" config option.
    // The option only exists for models that support it, so this throws for
    // others — again applied best-effort by the caller.
    async setEffort(sessionId: string, value: string): Promise<void> {
        await this.conn().setSessionConfigOption({ sessionId, configId: 'effort', value });
    }

    async prompt(sessionId: string, text: string): Promise<PromptResponse> {
        try {
            return await this.conn().prompt({ sessionId, prompt: [{ type: 'text', text }] });
        } catch (e) {
            throw this.enrich(e, 'prompt');
        }
    }

    // Wrap a connection error with the adapter's exit/stderr so failures are
    // self-explanatory rather than the SDK's opaque "ACP connection closed".
    private enrich(err: unknown, phase: string): Error {
        const base = err instanceof Error ? err.message : String(err);
        const parts = [
            this.exitInfo,
            this.stderrTail.trim() ? `adapter output: ${this.stderrTail.trim().slice(-1200)}` : '',
        ].filter(Boolean);
        return new Error(parts.length ? `${base} — ${parts.join(' | ')} [during ${phase}]` : `${base} [during ${phase}]`);
    }

    async cancel(sessionId: string): Promise<void> {
        await this.conn().cancel({ sessionId });
    }

    dispose(): void {
        try {
            this.child?.kill();
        } catch {
            // already gone
        }
        this.child = undefined;
        this.connection = undefined;
    }

    private conn(): ClientSideConnection {
        if (!this.connection) throw new Error('AcpClient not started');
        return this.connection;
    }

    // The client side of ACP: the agent calls these on us. These read the CURRENT
    // handlers off `self` so follow-up prompts can swap them via setHandlers().
    private buildClient(): Client {
        const self = this;
        return {
            async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
                return self.broker.resolve(params);
            },
            async sessionUpdate(params: SessionNotification): Promise<void> {
                self.onEvent(toEvent(params.update));
            },
            async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
                const content = await fs.readFile(params.path, 'utf8');
                return { content };
            },
            async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
                await fs.writeFile(params.path, params.content);
                return {};
            },
        };
    }
}
