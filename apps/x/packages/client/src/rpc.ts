import { ipc } from '@x/shared';

// Typed HTTP twin of window.ipc.invoke: POST /rpc/{channel} against a
// rowboat-server, request/response shapes taken from the same ipcSchemas the
// desktop IPC uses. Portable across React Native and Node (global fetch) —
// this is also what Electron main's strangler-fig forwarder becomes when it
// moves out of process.

export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface RpcClient {
  call<K extends ipc.InvokeChannels>(
    channel: K,
    args: ipc.IPCChannels[K]['req'],
  ): Promise<ipc.IPCChannels[K]['res']>;
  readonly baseUrl: string;
}

export function createRpcClient(opts: {
  baseUrl: string;
  token: string;
  /** Fired on any 401 — the server key was rotated; the pairing is dead. */
  onUnauthorized?: () => void;
}): RpcClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  return {
    baseUrl,
    async call(channel, args) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/rpc/${channel}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.token}`,
          },
          body: JSON.stringify(args ?? null),
        });
      } catch (err) {
        throw new RpcError(
          err instanceof Error ? err.message : String(err),
          0,
          'network',
        );
      }
      const body = (await res.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      if (!res.ok) {
        if (res.status === 401) opts.onUnauthorized?.();
        throw new RpcError(
          body?.error?.message ?? `rpc ${channel} failed with status ${res.status}`,
          res.status,
          body?.error?.code ?? 'internal',
        );
      }
      // The server validated the response against the channel schema already;
      // trust it rather than re-parse (z.custom channels can't re-parse anyway).
      return body as ipc.IPCChannels[typeof channel]['res'];
    },
  };
}
