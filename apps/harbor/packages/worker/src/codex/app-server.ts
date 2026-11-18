import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { errorText, type Logger } from '../log.js';

// `codex app-server` over stdio: JSON-RPC, one message per line. The client
// sends requests (id, method, params) and notifications (no id); the server
// answers results or errors by id, sends notifications of its own (turn and
// item events), and sends requests it expects an answer to (approvals). This
// is the plumbing only; what the messages mean is runtime.ts.

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class AppServerError extends Error {
  constructor(
    readonly method: string,
    readonly rpc: JsonRpcError,
  ) {
    super(`${method}: ${rpc.message} (${rpc.code})`);
  }
}

export interface AppServerHandlers {
  notification: (method: string, params: unknown) => void;
  /** The answer to a request the server makes; what is returned goes back as its result. */
  serverRequest: (method: string, params: unknown) => unknown | Promise<unknown>;
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface AppServerOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: Logger;
  /** How long a request may wait for its answer (default 60s). Turns answer at once; their work streams as notifications. */
  requestTimeoutMs?: number;
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AppServer {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  exited = false;

  constructor(
    private readonly opts: AppServerOptions,
    private readonly handlers: AppServerHandlers,
  ) {}

  start(): void {
    const child = spawn(this.opts.command, this.opts.args, { cwd: this.opts.cwd, env: this.opts.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const line = chunk.trim();
      if (line) this.opts.log('app-server stderr', { line: line.slice(0, 500) });
    });
    child.on('error', (err) => this.opts.log('app-server failed to start', { error: errorText(err) }));
    child.on('exit', (code, signal) => {
      this.exited = true;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`${p.method}: app-server exited (${code ?? signal}) before answering`));
        this.pending.delete(id);
      }
      this.handlers.exit(code, signal);
    });
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    const child = this.child;
    if (!child || this.exited) return Promise.reject(new Error(`${method}: app-server is not running`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer from app-server in ${this.opts.requestTimeoutMs ?? 60_000}ms`));
      }, this.opts.requestTimeoutMs ?? 60_000);
      timer.unref?.();
      this.pending.set(id, { method, resolve: (v) => resolve(v as T), reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  kill(): void {
    this.child?.kill();
  }

  private write(message: unknown): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let at: number;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (!line.trim()) continue;
      let msg: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: JsonRpcError };
      try {
        msg = JSON.parse(line);
      } catch {
        this.opts.log('app-server said something that is not JSON', { line: line.slice(0, 200) });
        continue;
      }
      if (msg.id !== undefined && msg.method === undefined) {
        const p = this.pending.get(Number(msg.id));
        if (!p) continue;
        this.pending.delete(Number(msg.id));
        clearTimeout(p.timer);
        if (msg.error) p.reject(new AppServerError(p.method, msg.error));
        else p.resolve(msg.result);
      } else if (msg.id !== undefined && msg.method !== undefined) {
        const id = msg.id;
        const method = msg.method;
        void Promise.resolve()
          .then(() => this.handlers.serverRequest(method, msg.params))
          .then(
            (result) => this.write({ id, result: result ?? {} }),
            (err) => this.write({ id, error: { code: -32000, message: errorText(err) } }),
          );
      } else if (msg.method !== undefined) {
        try {
          this.handlers.notification(msg.method, msg.params);
        } catch (err) {
          this.opts.log('notification handler failed', { method: msg.method, error: errorText(err) });
        }
      }
    }
  }
}
