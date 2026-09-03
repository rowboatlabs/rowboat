import crypto from 'node:crypto';
import { URL } from 'node:url';
import { registerLoopbackHost } from '@x/core/dist/auth/loopback-server.js';
import type { capabilityBroker } from './capabilities.js';

// OAuth loopback relay (Phase 8b): with a remote rowboat-server, provider
// redirects land on 127.0.0.1 of the machine running the BROWSER — the
// client's. The registered LoopbackHost asks a loopback-capable client (the
// desktop) over the WS reverse-call channel to bind the port; the client
// relays every callback hit back via the `oauth:deliverLoopbackCallback` RPC,
// and this module runs the flow's validate/error/callback logic and answers
// with what page the client should render. With no capable client connected,
// the host returns null and core binds locally (child-mode/pre-8b behaviour
// is only reached when nothing better is available — the desktop client
// always advertises the capability, so the relay path is the one exercised
// daily).

interface PendingLoopback {
  onCallback: (url: URL) => void | Promise<void>;
  onError?: (error: string) => void;
  validateCallback?: (url: URL) => string | null;
}

const pending = new Map<string, PendingLoopback>();

type Broker = ReturnType<typeof capabilityBroker>;

export function installLoopbackRelay(broker: Broker): void {
  registerLoopbackHost(async (port, onCallback, opts) => {
    if (!broker.hasCapableClient('loopback-bind')) return null;
    const bindingId = crypto.randomUUID();
    const res = (await broker.request(
      'loopback-bind',
      {
        bindingId,
        port,
        fallback: opts.fallback === true,
        callbackPath: opts.callbackPath ?? '/oauth/callback',
      },
      { timeoutMs: 15_000 },
    )) as { port: number };
    pending.set(bindingId, {
      onCallback,
      onError: opts.onError,
      validateCallback: opts.validateCallback,
    });
    return {
      port: res.port,
      close: () => {
        pending.delete(bindingId);
        broker.broadcast('loopback-close', { bindingId });
      },
    };
  });
}

/**
 * RPC handler for `oauth:deliverLoopbackCallback` — mirrors the local
 * listener's gatekeeper order in loopback-server.ts: validate, provider
 * error, then the flow callback. The result tells the client which page to
 * render in the browser tab.
 */
export async function deliverLoopbackCallback(args: {
  bindingId: string;
  url: string;
}): Promise<{ accepted: boolean; message?: string }> {
  const entry = pending.get(args.bindingId);
  if (!entry) {
    return { accepted: false, message: 'This sign-in attempt is no longer active. Close this tab and retry from Rowboat.' };
  }
  let url: URL;
  try {
    url = new URL(args.url);
  } catch {
    return { accepted: false, message: 'Malformed callback URL' };
  }
  const rejection = entry.validateCallback?.(url) ?? null;
  if (rejection) {
    console.warn(`[OAuth] Relay rejected callback (state=${url.searchParams.get('state') ?? '<none>'}): ${rejection}`);
    return { accepted: false, message: rejection };
  }
  const error = url.searchParams.get('error');
  if (error) {
    console.warn(`[OAuth] Relay callback carried provider error: ${error}`);
    entry.onError?.(error);
    return { accepted: false, message: `Error: ${error}` };
  }
  try {
    await entry.onCallback(url);
    return { accepted: true };
  } catch (err) {
    console.error('[OAuth] Relay callback handling failed:', err);
    return { accepted: false, message: err instanceof Error ? err.message : 'Callback handling failed' };
  }
}
