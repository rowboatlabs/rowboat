import { describe, expect, it, vi } from 'vitest';
import { createRelayAuthServer, openLoopback } from './loopback-server.js';

// Regression: createAuthServer rebuilds its CallbackHandlingOpts — dropping
// `relay` there made the client-side relay listener render a success page
// without ever forwarding the callback, leaving the server's flow hanging.

describe('createRelayAuthServer', () => {
  it('forwards callback hits to the relay and renders its verdict', async () => {
    const relay = vi.fn(async (url: URL) => ({
      accepted: url.searchParams.get('code') === 'good',
      message: 'nope',
    }));
    const { server, port } = await createRelayAuthServer(18099, relay, { callbackPath: '/oauth/callback' });
    try {
      const ok = await fetch(`http://127.0.0.1:${port}/oauth/callback?code=good&state=s1`);
      expect(await ok.text()).toContain('Authorization Successful');
      expect(relay).toHaveBeenCalledTimes(1);
      expect(relay.mock.calls[0]![0].searchParams.get('state')).toBe('s1');

      const bad = await fetch(`http://127.0.0.1:${port}/oauth/callback?code=bad`);
      expect(await bad.text()).toContain('nope');
    } finally {
      server.close();
    }
  });
});

describe('openLoopback with port 0 (per-profile dynamic callbacks)', () => {
  it('binds two concurrent flows on distinct ports that each route home', async () => {
    const seen: string[] = [];
    const a = await openLoopback(0, async () => {
      seen.push('a');
    });
    const b = await openLoopback(0, async () => {
      seen.push('b');
    });
    try {
      // Two profiles starting OAuth at once must never share a port.
      expect(a.port).toBeGreaterThan(0);
      expect(b.port).toBeGreaterThan(0);
      expect(a.port).not.toBe(b.port);

      await fetch(`http://127.0.0.1:${a.port}/oauth/callback?code=x`);
      await fetch(`http://127.0.0.1:${b.port}/oauth/callback?code=y`);
      // Give the handlers a tick to run.
      await new Promise((r) => setTimeout(r, 50));
      expect(seen).toEqual(['a', 'b']);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
