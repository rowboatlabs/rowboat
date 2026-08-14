import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';

export function restClient(harbor: RunningHarbor, token: string) {
  return {
    async get(path: string) {
      const res = await fetch(`${harbor.url}${path}`, { headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, body: (await res.json()) as any };
    },
    async post(path: string, body?: unknown) {
      const res = await fetch(`${harbor.url}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      return { status: res.status, body: (await res.json()) as any };
    },
  };
}

/** An MCP client the way a member's agent connects: their token, a display name, optionally scheduled. */
export async function agentClient(
  harbor: RunningHarbor,
  token: string,
  opts: { agentName?: string; scheduled?: boolean } = {},
): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.1' });
  const transport = new StreamableHTTPClientTransport(new URL(harbor.mcpUrl), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.agentName ? { 'x-agent-name': opts.agentName } : {}),
        ...(opts.scheduled ? { 'x-acting-mode': 'scheduled' } : {}),
      },
    },
  });
  await client.connect(transport);
  return client;
}

export async function callStructured<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`tool ${name} errored: ${JSON.stringify(result.content)}`);
  }
  return result.structuredContent as T;
}

export interface LiveClient {
  frames: ServerFrame[];
  events: () => Array<Extract<ServerFrame, { kind: 'event' }>>;
  send(frame: unknown): void;
  until(pred: (frames: ServerFrame[]) => boolean, label?: string): Promise<void>;
  close(): void;
}

export async function liveClient(harbor: RunningHarbor, token: string): Promise<LiveClient> {
  const ws = new WebSocket(`ws://localhost:${harbor.port}/v1/live?token=${token}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const frames: ServerFrame[] = [];
  let waiters: Array<() => void> = [];
  ws.on('message', (data) => {
    frames.push(JSON.parse(String(data)) as ServerFrame);
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  });
  return {
    frames,
    events: () => frames.filter((f): f is Extract<ServerFrame, { kind: 'event' }> => f.kind === 'event'),
    send: (frame) => ws.send(JSON.stringify(frame)),
    async until(pred, label = 'condition') {
      const deadline = Date.now() + 3000;
      while (!pred(frames)) {
        if (Date.now() > deadline) {
          throw new Error(`timeout waiting for ${label}; got: ${JSON.stringify(frames, null, 2)}`);
        }
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 25);
        });
      }
    },
    close: () => ws.close(),
  };
}
