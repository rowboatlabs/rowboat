import { execFile } from 'node:child_process';
import { errorText, oneLine, type Logger } from '../log.js';
import { TurnOverError, type ModelChoice, type OpenSessionInput, type Runtime, type TurnEvent, type TurnHandle, type TurnInput, type TurnResult } from '../runtime.js';
import { AppServer, AppServerError } from './app-server.js';

// Codex through its app-server (the protocol in `codex app-server
// generate-ts`; measured on 2026-11-05: a turn, a steer mid-turn, a late
// steer refused with "no active turn to steer", an interrupt ending the turn
// `interrupted`). One app-server for the whole worker; one Codex thread per
// conversation, started once and resumed after; a turn is `turn/start`, its
// progress the item notifications, its end `turn/completed`. Approvals are
// off the way the exec-driven turn ran them (`--dangerously-bypass-approvals-
// and-sandbox`): the VM is the sandbox. The owner's instructions ride in the
// message (buildPrompt), as they do for the desktop's local Codex.

export interface CodexRuntimeOptions {
  /** The org's address with its scheme, for the Spaces MCP server. */
  orgUrl: string;
  /** The agent's own Spaces key: Codex's MCP server reads it from the environment. */
  agentKey: string;
  cwd: string;
  log: Logger;
  /** The executable and the arguments before Codex's own (`codex app-server`); tests point at a fake. */
  command?: string;
  commandArgs?: string[];
  env?: NodeJS.ProcessEnv;
  sandbox?: 'danger-full-access' | 'workspace-write' | 'read-only';
  /** Ask `codex login status` whether a ChatGPT sign-in is there (the owner's plan, 2026-10-30); off in tests. */
  signInProbe?: boolean;
  requestTimeoutMs?: number;
}

interface ActiveTurn {
  threadId: string;
  turnId: string;
  onEvent: (event: TurnEvent) => void;
  finalAnswer?: string;
  lastMessage?: string;
  resolve: (result: TurnResult) => void;
}

const EFFORTS: ModelChoice[] = ['low', 'medium', 'high'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export class CodexRuntime implements Runtime {
  readonly name = 'codex';
  readonly label = 'Codex';
  readonly capabilities = { steer: true };
  private server: AppServer | undefined;
  private starting: Promise<void> | undefined;
  /** Threads started or resumed by the app-server now running. */
  private readonly open = new Set<string>();
  private readonly turns = new Map<string, ActiveTurn>();
  private childEnv: NodeJS.ProcessEnv | undefined;
  private args: string[] | undefined;

  constructor(private readonly opts: CodexRuntimeOptions) {}

  async start(): Promise<void> {
    if (this.server && !this.server.exited) return;
    if (this.starting) return this.starting;
    this.starting = this.boot().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private async boot(): Promise<void> {
    if (!this.args || !this.childEnv) await this.configure();
    const server = new AppServer(
      {
        command: this.opts.command ?? 'codex',
        args: this.args!,
        cwd: this.opts.cwd,
        env: this.childEnv!,
        log: this.opts.log,
        ...(this.opts.requestTimeoutMs ? { requestTimeoutMs: this.opts.requestTimeoutMs } : {}),
      },
      {
        notification: (method, params) => this.onNotification(method, params),
        serverRequest: (method, params) => this.onServerRequest(method, params),
        exit: (code, signal) => this.onExit(server, code, signal),
      },
    );
    this.server = server;
    this.open.clear();
    server.start();
    await server.request('initialize', {
      clientInfo: { name: 'rowboat-worker', title: 'Rowboat worker', version: process.env.ROWBOAT_WORKER_VERSION ?? '0.0.0' },
      capabilities: { experimentalApi: false },
    });
    server.notify('initialized', {});
    this.opts.log('codex app-server up');
  }

  /**
   * The flags and environment the exec-driven turn used (runtimes.ts, 2026-10-26):
   * the Spaces MCP server on the agent's key, and the owner's provider: their
   * own key (`ROWBOAT_LLM_PROVIDER=openai`, set by Harbor with the key) or a
   * ChatGPT sign-in on the box, which forces Codex's built-in provider with the
   * platform proxy's address unset; otherwise the template's provider on the proxy.
   */
  private async configure(): Promise<void> {
    const env: NodeJS.ProcessEnv = { ...(this.opts.env ?? process.env), ROWBOAT_URL: this.opts.orgUrl, ROWBOAT_AGENT_KEY: this.opts.agentKey };
    const args = [
      ...(this.opts.commandArgs ?? ['app-server']),
      '-c',
      `mcp_servers.rowboat.url="${this.opts.orgUrl}/mcp"`,
      '-c',
      'mcp_servers.rowboat.bearer_token_env_var="ROWBOAT_AGENT_KEY"',
    ];
    if (env.ROWBOAT_LLM_PROVIDER === 'openai') args.push('-c', 'model_provider="openai"');
    else if (this.opts.signInProbe !== false && (await this.chatgptSignedIn(env))) {
      args.push('-c', 'model_provider="openai"');
      delete env.OPENAI_BASE_URL;
      this.opts.log('codex runs on the ChatGPT sign-in found on this machine');
    }
    this.args = args;
    this.childEnv = env;
  }

  private chatgptSignedIn(env: NodeJS.ProcessEnv): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(this.opts.command ?? 'codex', ['login', 'status'], { env, timeout: 15_000 }, (_err, stdout, stderr) => {
        resolve(/ChatGPT/.test(`${stdout}${stderr}`));
      });
    });
  }

  async stop(): Promise<void> {
    this.server?.kill();
  }

  async openSession(input: OpenSessionInput): Promise<{ sessionId: string }> {
    await this.start();
    const server = this.server!;
    if (input.sessionId) {
      if (this.open.has(input.sessionId)) return { sessionId: input.sessionId };
      try {
        const resumed = await server.request<{ thread: { id: string } }>('thread/resume', { threadId: input.sessionId, cwd: input.cwd, excludeTurns: true });
        this.open.add(resumed.thread.id);
        return { sessionId: resumed.thread.id };
      } catch (err) {
        // A thread Codex no longer has (a redeployed box, a cleared home): the conversation starts a new one.
        this.opts.log('codex could not resume the thread; starting a new one', { threadId: input.sessionId, error: errorText(err) });
      }
    }
    const started = await server.request<{ thread: { id: string } }>('thread/start', {
      cwd: input.cwd,
      approvalPolicy: 'never',
      sandbox: this.opts.sandbox ?? 'danger-full-access',
    });
    this.open.add(started.thread.id);
    return { sessionId: started.thread.id };
  }

  async turn(input: TurnInput): Promise<TurnHandle> {
    await this.start();
    const server = this.server!;
    const threadId = input.sessionId;
    if (this.turns.has(threadId)) throw new Error('a turn is already running on this thread');
    const model = input.model ?? this.childEnv?.ROWBOAT_LLM_MODEL;
    const started = await server.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: input.prompt, text_elements: [] }],
      ...(model ? { model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
    });
    const turnId = started.turn.id;
    let resolve!: (result: TurnResult) => void;
    const done = new Promise<TurnResult>((r) => (resolve = r));
    this.turns.set(threadId, { threadId, turnId, onEvent: input.onEvent, resolve });
    return {
      id: turnId,
      done,
      steer: async (text) => {
        try {
          await server.request('turn/steer', { threadId, input: [{ type: 'text', text, text_elements: [] }], expectedTurnId: turnId });
        } catch (err) {
          if (err instanceof AppServerError) throw new TurnOverError(err.rpc.message);
          throw err;
        }
      },
      interrupt: async () => {
        await server.request('turn/interrupt', { threadId, turnId }).catch((err) => this.opts.log('interrupt failed', { error: errorText(err) }));
      },
    };
  }

  async models(): Promise<ModelChoice[]> {
    await this.start();
    const listed = await this.server!.request<{ data?: unknown[] }>('model/list', {});
    const choices: ModelChoice[] = [];
    for (const row of listed.data ?? []) {
      const m = obj(row);
      const id = str(m?.id) ?? str(m?.model);
      if (!m || !id || m.hidden === true) continue;
      choices.push({ id, label: str(m.displayName) ?? id });
    }
    return choices;
  }

  efforts(): ModelChoice[] {
    return EFFORTS;
  }

  // --- what the app-server says -------------------------------------------------

  private onNotification(method: string, params: unknown): void {
    const p = obj(params);
    if (!p) return;
    const threadId = str(p.threadId);
    const active = threadId ? this.turns.get(threadId) : undefined;
    if (!active) return;
    if (method === 'item/started' || method === 'item/completed') {
      const item = obj(p.item);
      if (!item) return;
      if (item.type === 'agentMessage' && method === 'item/completed') {
        const text = str(item.text) ?? '';
        if (item.phase === 'final_answer') active.finalAnswer = text;
        else active.lastMessage = text;
        if (text.trim()) active.onEvent({ type: 'answer', text });
        return;
      }
      const activity = activityOf(item);
      if (activity) active.onEvent({ type: 'activity', activity });
      return;
    }
    if (method === 'turn/completed') {
      const turn = obj(p.turn);
      if (!turn || turn.id !== active.turnId) return;
      this.turns.delete(threadId!);
      const status = turn.status === 'interrupted' ? 'interrupted' : turn.status === 'failed' ? 'failed' : 'completed';
      const answer = active.finalAnswer ?? active.lastMessage;
      const error = str(obj(turn.error)?.message);
      active.resolve({ status, ...(answer ? { answer } : {}), ...(status === 'failed' ? { error: error ?? 'Codex stopped with an error' } : {}) });
    }
  }

  /** Approvals never come (never + full access); whatever asks anyway is declined and logged, until cards carry it. */
  private onServerRequest(method: string, params: unknown): unknown {
    this.opts.log('app-server asked; declined', { method, params: oneLine(JSON.stringify(params ?? {}), 300) });
    if (method.endsWith('requestApproval')) return { decision: 'decline' };
    return {};
  }

  private onExit(server: AppServer, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.server !== server) return;
    this.opts.log('codex app-server exited', { code, signal });
    this.server = undefined;
    this.open.clear();
    for (const [threadId, active] of this.turns) {
      this.turns.delete(threadId);
      active.resolve({ status: 'failed', error: `Codex stopped (${code ?? signal ?? 'exit'}) before finishing the turn` });
    }
  }
}

/** The thread's line for an item (the exec-driven turn's mapping, runtimes.ts). */
export function activityOf(item: Record<string, unknown>): string | undefined {
  switch (item.type) {
    case 'commandExecution': {
      const command = str(item.command);
      return command ? `is running \`${oneLine(command, 150)}\`` : 'is running a command';
    }
    case 'fileChange':
      return 'is editing files';
    case 'mcpToolCall':
      return `is using ${oneLine(str(item.tool) ?? str(item.name) ?? 'a tool', 60)}`;
    case 'webSearch':
      return 'is searching the web';
    default:
      return undefined;
  }
}
