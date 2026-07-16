import { app } from 'electron';
import { isRpcChannel } from '@x/server';
import { whenServerReady } from './server-host.js';

// Strangler-fig seam (RFC SERVER_CLIENT_SPEC.md Q4/Q15): channels that have
// migrated to rowboat-server are forwarded over real localhost HTTP instead
// of calling core in-process, so the network API is exercised by the desktop
// app on every keystroke — it cannot rot. Unmigrated channels are untouched.
//
// Kill switch: ROWBOAT_FORWARD_MIGRATED=0 pins everything in-process.
// Default: forwarding on in dev, off in packaged builds until the slice has
// soaked.

export function forwardingEnabled(): boolean {
  const env = process.env.ROWBOAT_FORWARD_MIGRATED;
  if (env !== undefined) {
    return env !== '0' && env.toLowerCase() !== 'false';
  }
  return !app.isPackaged;
}

export function shouldForwardChannel(channel: string): boolean {
  return forwardingEnabled() && isRpcChannel(channel);
}

export async function forwardRpc(channel: string, args: unknown): Promise<unknown> {
  const server = await whenServerReady();
  const res = await fetch(`http://127.0.0.1:${server.port}/rpc/${channel}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${server.key}`,
    },
    body: JSON.stringify(args ?? null),
  });
  const body = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | Record<string, unknown>
    | null;
  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `rpc ${channel} failed with status ${res.status}`;
    throw new Error(message);
  }
  return body;
}
