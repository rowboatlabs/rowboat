import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';

// --- fake authorization server ----------------------------------------------
// RFC 8414 discovery + JWKS + JWTs minted in-test — CI never needs a real IdP.

const KID = 'test-key-1';

export interface FakeAs {
  issuer: string;
  server: Server;
  privateKey: CryptoKey;
  mint(claims: { sub?: string; iss?: string; exp?: string | number; email?: string; name?: string }): Promise<string>;
}

export async function startFakeAs(): Promise<FakeAs> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: KID, alg: 'ES256' };

  let issuer = '';
  const server = createServer((req, res) => {
    if (req.url === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    } else if (req.url === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  issuer = `http://localhost:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    server,
    privateKey,
    async mint(claims) {
      return new SignJWT({
        ...(claims.email ? { email: claims.email } : {}),
        // GoTrue's placement for social profile names.
        ...(claims.name ? { user_metadata: { full_name: claims.name } } : {}),
      })
        .setProtectedHeader({ alg: 'ES256', kid: KID })
        .setIssuer(claims.iss ?? issuer)
        .setSubject(claims.sub ?? 'sub-ramnique')
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? '5m')
        .sign(privateKey);
    },
  };
}

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
