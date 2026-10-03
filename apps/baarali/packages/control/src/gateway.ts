import type { IncomingMessage } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { Instances, InstanceTarget } from './instances.js';
import type { ControlStore, Device } from './store.js';

// The gateway between a device and its account's instance (security §2,
// decided 01/10/2026). The app's remote mode (apps/x REMOTE_SERVER.md)
// talks to `${publicUrl}/instance` as if it were rowboat-server: the
// gateway checks the device's own key, wakes the instance, and relays the
// RPC, the workspace files and the event WebSocket with the instance's key,
// which never leaves the control plane. Revoking a device revokes it alone.

export const GATEWAY_PATH = '/instance';

export interface GatewayDeps {
  store: ControlStore;
  instances: Pick<Instances, 'wake' | 'target'>;
  now: () => number;
  fetch: typeof fetch;
}

/** Last-seen is a hint for the devices list, not an audit: written once a minute at most. */
const TOUCH_MS = 60_000;

// Hop-by-hop headers (RFC 9110 §7.6.1), the device's credentials, and any
// Fly routing header: only the gateway chooses the machine.
function relayed(name: string): boolean {
  const n = name.toLowerCase();
  return !(
    ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'host', 'authorization', 'cookie', 'accept-encoding', 'content-length'].includes(n) ||
    n.startsWith('proxy-') ||
    n.startsWith('fly-')
  );
}

function keyFrom(authorization: string | undefined | null, url: URL): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  // The desktop's WebSocket cannot set headers: it sends ?token= (packages/client events.ts).
  return match ? match[1].trim() : url.searchParams.get('token');
}

/** The instance path and query, without our prefix nor the device's token. */
function upstreamPath(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete('token');
  const query = params.toString();
  return `${url.pathname.slice(GATEWAY_PATH.length) || '/'}${query ? `?${query}` : ''}`;
}

const json = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code } }), { status, headers: { 'content-type': 'application/json' } });

export function createGateway(deps: GatewayDeps) {
  const touched = new Map<string, number>();

  async function resolve(key: string | null): Promise<{ device: Device; target: InstanceTarget } | 'unauthorized' | 'suspended' | 'no_instance'> {
    const device = key ? await deps.store.deviceByKey(key) : null;
    if (!device) return 'unauthorized';
    // Suspended from the admin console (03/10/2026): the instance stays asleep.
    if ((await deps.store.account(device.accountId))?.suspendedAt) return 'suspended';
    const record = await deps.store.instance(device.accountId);
    if (!record || (record.managed && !record.machineId)) return 'no_instance';
    await deps.instances.wake(record);
    const now = deps.now();
    if ((touched.get(device.id) ?? 0) + TOUCH_MS <= now) {
      touched.set(device.id, now);
      await deps.store.touchDevice(device.id, now);
    }
    return { device, target: deps.instances.target(record) };
  }

  /** HTTP: every route under GATEWAY_PATH. */
  async function http(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // The app checks this before it sends any key (server-host.ts
    // isRowboatServer): the gateway answers for the instance behind it,
    // which wakes on the first authenticated request.
    if (url.pathname === `${GATEWAY_PATH}/health`) {
      return Response.json({ name: 'rowboat-server', via: 'baarali-gateway' });
    }
    let found: Awaited<ReturnType<typeof resolve>>;
    try {
      found = await resolve(keyFrom(req.headers.get('authorization'), url));
    } catch (err) {
      console.error('[gateway] wake failed', err);
      // Nothing was relayed: the app may ask again (@x/client starting.ts).
      return json(503, 'instance_waking');
    }
    if (found === 'unauthorized') return json(401, 'unauthorized');
    if (found === 'suspended') return json(403, 'account_suspended');
    if (found === 'no_instance') return json(409, 'no_instance');
    const { target } = found;

    const headers = new Headers();
    req.headers.forEach((value, name) => {
      if (relayed(name)) headers.set(name, value);
    });
    for (const [name, value] of Object.entries(target.headers)) headers.set(name, value);
    headers.set('authorization', `Bearer ${target.key}`);
    // Uncompressed: the body is relayed as is, and fetch would decode it under our feet.
    headers.set('accept-encoding', 'identity');

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let res: Response;
    try {
      res = await deps.fetch(`http://${target.host}:${target.port}${upstreamPath(url)}`, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        redirect: 'manual',
        // Streams the request body (Node's fetch requires it).
        ...(hasBody ? { duplex: 'half' } : {}),
      } as RequestInit);
    } catch (err) {
      console.error('[gateway] relay failed', err);
      return json(502, 'instance_unavailable');
    }
    const out = new Headers();
    res.headers.forEach((value, name) => {
      if (relayed(name) || name === 'content-length') out.set(name, value);
    });
    return new Response(res.body, { status: res.status, headers: out });
  }

  /** WebSocket (`/instance/events`): the handshake replayed with the instance's key, then the sockets spliced. */
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://gateway');
    if (!url.pathname.startsWith(`${GATEWAY_PATH}/`)) {
      socket.destroy();
      return;
    }
    const refuse = (status: string) => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    socket.on('error', () => socket.destroy());
    resolve(keyFrom(req.headers.authorization, url)).then(
      (found) => {
        if (found === 'unauthorized') return refuse('401 Unauthorized');
        if (found === 'suspended') return refuse('403 Forbidden');
        if (found === 'no_instance') return refuse('409 Conflict');
        const { target } = found;
        const upstream = net.connect(target.port, target.host, () => {
          const lines = [`${req.method} ${upstreamPath(url)} HTTP/${req.httpVersion}`];
          for (let i = 0; i < req.rawHeaders.length; i += 2) {
            const name = req.rawHeaders[i];
            // Upgrade and Connection make the handshake: kept, unlike in HTTP.
            if (relayed(name) || ['upgrade', 'connection'].includes(name.toLowerCase())) lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
          }
          lines.push(`Host: ${target.host}`, `Authorization: Bearer ${target.key}`);
          for (const [name, value] of Object.entries(target.headers)) lines.push(`${name}: ${value}`);
          upstream.write(lines.join('\r\n') + '\r\n\r\n');
          if (head.length) upstream.write(head);
          upstream.pipe(socket);
          socket.pipe(upstream);
        });
        upstream.on('error', () => socket.destroy());
        socket.on('close', () => upstream.destroy());
      },
      (err: unknown) => {
        console.error('[gateway] wake failed', err);
        refuse('503 Service Unavailable');
      },
    );
  }

  return { http, upgrade };
}

export type Gateway = ReturnType<typeof createGateway>;
