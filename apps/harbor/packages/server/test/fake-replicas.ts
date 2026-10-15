import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentEvent } from '../src/connectors/replicas/api.js';

// A stand-in for Replicas's API, built from its OpenAPI shapes
// (https://docs.replicas.dev/openapi.json): environments, create and send,
// the workspace list, chats, history, and the SSE event stream. Each turn
// plays a script: the test chooses what the coding agent does, and whether
// Replicas refuses, drops the stream, or never runs the turn.

export interface Turn {
  /** The coding agent's events, streamed as chat.turn.delta and kept in the chat's history. */
  events: AgentEvent[];
  prUrls?: string[];
  /** false = Replicas reports the turn interrupted. */
  complete?: boolean;
  /** Drop every open stream after this many deltas (the connector must reconnect and catch up). */
  dropAfter?: number;
  /** Don't run the turn at all: the message is recorded and nothing else happens. */
  hold?: boolean;
  /**
   * Play the moment the connector asks for the stream, before that stream is listening: the turn is
   * over, its events lost, in the gap between the connector's check and its stream connecting.
   */
  early?: boolean;
}

interface Chat {
  id: string;
  processing: boolean;
  history: AgentEvent[];
}

interface Workspace {
  id: string;
  name: string;
  environmentId: string;
  codingAgent: string;
  chat: Chat;
  streams: Set<ServerResponse>;
}

export interface Received {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

export class FakeReplicas {
  readonly received: Received[] = [];
  readonly workspaces = new Map<string, Workspace>();
  /** Replicas lists its "Global" layer among the environments (is_global); nothing runs in it. */
  environments: Array<{ id: string; name: string; is_global?: boolean }> = [
    { id: 'env-global', name: 'Global', is_global: true },
    { id: 'env-web', name: 'web-app' },
  ];
  /** What the next turn does (a Claude answer by default). */
  nextTurn: Turn | undefined;
  /** Status to refuse every call with (401, 402, 429…), or undefined. */
  refuse: { status: number; error: string; paths?: RegExp } | undefined;
  /** Refuse this many stream connections, as a booting workspace does ("Workspace is not active"). */
  refuseStreams = 0;
  /** Keep every open stream busy with events about other things, as Replicas does. */
  chatter = false;
  private chatterTimer: NodeJS.Timeout | undefined;
  private readonly early = new Map<string, Turn>();
  private server!: Server;
  private sequence = 0;

  url = '';

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, resolve));
    this.url = `http://localhost:${(this.server.address() as AddressInfo).port}`;
    this.chatterTimer = setInterval(() => {
      if (!this.chatter) return;
      for (const w of this.workspaces.values()) this.emit(w, 'engine.status.changed', { status: { uptime: Date.now() } });
    }, 40);
    return this;
  }

  async close(): Promise<void> {
    clearInterval(this.chatterTimer);
    for (const w of this.workspaces.values()) for (const s of w.streams) s.end();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  creates(): Received[] {
    return this.received.filter((r) => r.method === 'POST' && r.path === '/v1/replica');
  }
  sends(): Received[] {
    return this.received.filter((r) => r.method === 'POST' && /\/messages$/.test(r.path));
  }

  /** Play a turn now for a workspace (a test's own timing, e.g. after a restart). */
  play(workspace: Workspace, turn: Turn): Promise<void> {
    return this.run(workspace, turn);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : undefined;
    this.received.push({ method: req.method ?? 'GET', path: url.pathname, body });
    const json = (status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    };
    if (req.headers.authorization !== 'Bearer rpl_good') return json(401, { error: 'Invalid or missing API key' });
    if (this.refuse && (!this.refuse.paths || this.refuse.paths.test(url.pathname))) return json(this.refuse.status, { error: this.refuse.error });

    const parts = url.pathname.split('/').filter(Boolean); // v1, replica, :id, …
    if (url.pathname === '/v1/environments') return json(200, { environments: this.environments });
    if (parts[0] === 'v1' && parts[1] === 'agents' && parts[3] === 'models' && req.method === 'GET') {
      const models = parts[2] === 'claude' ? [{ id: 'claude-opus-5-5', displayName: 'Opus 5.5' }, { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5' }] : [];
      return json(200, { source: 'static', models, defaultModel: models[0]?.id ?? null, page: 1, total: models.length, limit: 100, totalPages: 1 });
    }
    if (url.pathname === '/v1/replica' && req.method === 'POST') {
      const id = `ws-${++this.sequence}`;
      const workspace: Workspace = {
        id,
        name: String(body!.name),
        environmentId: String(body!.environment_id),
        codingAgent: String(body!.coding_agent),
        chat: { id: `chat-${this.sequence}`, processing: false, history: [] },
        streams: new Set(),
      };
      this.workspaces.set(id, workspace);
      this.accept(workspace, String(body!.message));
      return json(201, { replica: { id, name: workspace.name, status: 'preparing', source: 'api', created_at: new Date().toISOString() } });
    }
    if (url.pathname === '/v1/replica' && req.method === 'GET') {
      return json(200, { replicas: [...this.workspaces.values()].reverse().map((w) => ({ id: w.id, name: w.name })), total: this.workspaces.size, page: 1, limit: 50, total_pages: 1 });
    }
    const workspace = parts[1] === 'replica' && parts[2] ? this.workspaces.get(parts[2]) : undefined;
    if (!workspace) return json(404, { error: 'Resource not found' });
    const rest = parts.slice(3).join('/');
    if (rest === 'messages' && req.method === 'POST') {
      const messageId = `msg-${++this.sequence}`;
      this.accept(workspace, String(body!.message), messageId);
      return json(200, { status: 'sent', message_id: messageId, chat_id: workspace.chat.id });
    }
    if (rest === 'chats') {
      // As live (2026-09-30): a new workspace also has a "Relay" chat beside the coding agent's.
      return json(200, {
        chats: [
          { id: `relay-${workspace.id}`, provider: 'relay', title: 'Relay', processing: false },
          // …and, live 2026-10-01, one chat per coding agent.
          ...['pi', 'opencode', 'muse', 'cursor', 'codex', 'claude']
            .filter((p) => p !== workspace.codingAgent)
            .map((p) => ({ id: `${p}-${workspace.id}`, provider: p, title: p, processing: false })),
          { id: workspace.chat.id, provider: workspace.codingAgent, title: 'Claude Code', processing: workspace.chat.processing },
        ],
      });
    }
    if (rest === 'history') return json(200, { events: workspace.chat.history, beforeCursor: null });
    if (rest === 'events') {
      if (this.refuseStreams > 0) {
        this.refuseStreams--;
        return json(409, { error: 'Workspace is not active' });
      }
      const early = this.early.get(workspace.id);
      if (early) {
        this.early.delete(workspace.id);
        await this.run(workspace, early);
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(': connected\n\n');
      workspace.streams.add(res);
      req.on('close', () => workspace.streams.delete(res));
      return;
    }
    return json(404, { error: 'Resource not found' });
  }

  /** A message arrives: recorded in the chat's history, then the next turn plays (unless held). */
  private accept(workspace: Workspace, text: string, messageId?: string): void {
    workspace.chat.history.push({ type: 'claude-user', payload: { type: 'user', message: { content: [{ type: 'text', text }] } } });
    const turn = this.nextTurn ?? claudeTurn('Done.');
    this.nextTurn = undefined;
    if (turn.hold) return;
    if (turn.early) {
      this.early.set(workspace.id, turn);
      return;
    }
    setTimeout(() => void this.run(workspace, turn, messageId), 30);
  }

  private async run(workspace: Workspace, turn: Turn, messageId = `msg-${++this.sequence}`): Promise<void> {
    // Like the real stream, events go only to streams open when they happen; give the connector a moment to connect.
    for (let i = 0; !turn.early && i < 50 && workspace.streams.size === 0; i++) await new Promise((r) => setTimeout(r, 20));
    const chatId = workspace.chat.id;
    workspace.chat.processing = true;
    this.emit(workspace, 'chat.turn.accepted', { chatId, messageId, queued: false, position: 0 });
    this.emit(workspace, 'chat.turn.started', { chatId, messageId });
    let sent = 0;
    for (const event of turn.events) {
      workspace.chat.history.push(event);
      this.emit(workspace, 'chat.turn.delta', { chatId, messageId, event });
      if (turn.dropAfter !== undefined && ++sent === turn.dropAfter) for (const s of [...workspace.streams]) s.destroy();
      await new Promise((r) => setTimeout(r, 5));
    }
    if (turn.prUrls?.length) this.emit(workspace, 'repo.status.changed', { repos: [{ name: 'web', prUrls: turn.prUrls }] });
    workspace.chat.processing = false;
    this.emit(workspace, 'chat.turn.completed', { chatId, isComplete: turn.complete !== false, processing: false });
  }

  private emit(workspace: Workspace, type: string, payload: Record<string, unknown>): void {
    const frame = `data: ${JSON.stringify({ id: `ev-${++this.sequence}`, ts: new Date().toISOString(), type, payload })}\n\n`;
    for (const s of workspace.streams) s.write(frame);
  }
}

/** Claude Code running a command, then answering. */
export function claudeTurn(answer: string, extra: Partial<Turn> = {}): Turn {
  return {
    events: [
      { type: 'claude-assistant', payload: { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } } },
      { type: 'claude-user', payload: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } } },
      { type: 'claude-assistant', payload: { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: answer }] } } },
      { type: 'claude-result', payload: { type: 'result', subtype: 'success', is_error: false } },
    ],
    ...extra,
  };
}

/** Codex running a shell command, then answering. */
export function codexTurn(answer: string): Turn {
  return {
    events: [
      { type: 'response_item', payload: { type: 'function_call', call_id: 'c1', name: 'shell', arguments: JSON.stringify({ command: ['pnpm', 'test'] }) } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] } },
    ],
  };
}
