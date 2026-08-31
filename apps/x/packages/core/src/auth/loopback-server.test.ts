import { describe, expect, it, vi } from 'vitest';
import { createRelayAuthServer } from './loopback-server.js';

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
