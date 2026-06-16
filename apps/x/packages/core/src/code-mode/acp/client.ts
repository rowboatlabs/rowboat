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

    // Spawn the adapter process. Node throws SYNCHRONOUSLY for spawn errnos
    // outside its deferred list (EACCES/EAGAIN/EMFILE/ENFILE/ENOENT) — notably
    // the macOS "spawn EBADF" (libuv posix_spawn, seen on Node 22+, sometimes
    // transient under fd churn in a busy Electron main process). Retry once
    // after a tick, and if it still fails, throw with enough context to debug.
    private spawnAdapter(spec: ReturnType<typeof getAgentLaunchSpec>): Promise<ChildProcess> {
        const doSpawn = () => spawn(spec.command, spec.args, {
            cwd: this.cwd,
            env: spec.env,
            // Capture stderr (not inherit) so we can attribute a dropped connection.
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        try {
            return Promise.resolve(doSpawn());
        } catch (first) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    try {
                        resolve(doSpawn());
                    } catch {
                        const msg = first instanceof Error ? first.message : String(first);
                        reject(new Error(
                            `Failed to spawn the ${this.agent} ACP adapter: ${msg} `
                            + `(command: ${spec.command}, entry: ${spec.args[0] ?? '?'}, cwd: ${this.cwd}, retried once)`,
                        ));
                    }
                }, 250);
            });
        }
    }

    // Spawn the adapter and negotiate the protocol. Returns once initialized.
    async start(): Promise<void> {
        const spec = getAgentLaunchSpec(this.agent);
        const child = await this.spawnAdapter(spec);
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
            const init = await this.connection.initialize({
                protocolVersion: PROTOCOL_VERSION,
                clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
            });
            this.loadSession_ = init.agentCapabilities?.loadSession === true;
        } catch (e) {
            throw this.enrich(e, 'initialize');
        }
    }

    async newSession(): Promise<string> {
        try {
            const res = await this.conn().newSession({ cwd: this.cwd, mcpServers: [] });
            return res.sessionId;
        } catch (e) {
            throw this.enrich(e, 'newSession');
        }
    }

    async loadSession(sessionId: string): Promise<void> {
        try {
            await this.conn().loadSession({ sessionId, cwd: this.cwd, mcpServers: [] });
        } catch (e) {
            throw this.enrich(e, 'loadSession');
        }
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
