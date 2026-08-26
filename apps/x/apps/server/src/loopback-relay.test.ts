import { describe, expect, it, vi } from 'vitest';
import { openLoopback } from '@x/core/dist/auth/loopback-server.js';
import { installLoopbackRelay, deliverLoopbackCallback } from './loopback-relay.js';
import type { CapabilityTransport } from './capabilities.js';

// The relay half of Phase 8b: a fake capability transport stands in for the
// connected desktop client, so no sockets are bound anywhere.

function fakeBroker(overrides: Partial<CapabilityTransport> = {}): CapabilityTransport {
  return {
    request: vi.fn(async () => ({ port: 8080 })),
    broadcast: vi.fn(),
    hasCapableClient: () => true,
    ...overrides,
  };
}

describe('oauth loopback relay', () => {
  it('routes openLoopback through the capable client and callbacks through deliver', async () => {
    const broker = fakeBroker();
    installLoopbackRelay(broker);

    const received: string[] = [];
    const handle = await openLoopback(8080, (url) => {
      received.push(url.searchParams.get('code') ?? '');
    }, {
      validateCallback: (url) => (url.searchParams.get('state') === 'live' ? null : 'stale attempt'),
      onError: undefined,
    });
    expect(handle.port).toBe(8080);
    expect(broker.request).toHaveBeenCalledWith(
      'loopback-bind',
      expect.objectContaining({ port: 8080, callbackPath: '/oauth/callback' }),
      expect.anything(),
    );

    const bindingId = (broker.request as ReturnType<typeof vi.fn>).mock.calls[0]![1].bindingId as string;

    // Stale state → rejected by the flow's gatekeeper, callback untouched.
    const stale = await deliverLoopbackCallback({
      bindingId,
      url: 'http://localhost:8080/oauth/callback?state=old&code=nope',
    });
    expect(stale).toEqual({ accepted: false, message: 'stale attempt' });
    expect(received).toEqual([]);

    // Live callback → accepted, flow callback ran.
    const ok = await deliverLoopbackCallback({
      bindingId,
      url: 'http://localhost:8080/oauth/callback?state=live&code=abc123',
    });
    expect(ok.accepted).toBe(true);
    expect(received).toEqual(['abc123']);

    // close() broadcasts loopback-close and unregisters the binding.
    handle.close();
    expect(broker.broadcast).toHaveBeenCalledWith('loopback-close', { bindingId });
    const gone = await deliverLoopbackCallback({ bindingId, url: 'http://localhost:8080/oauth/callback?state=live' });
    expect(gone.accepted).toBe(false);
  });

  it('surfaces provider errors to the flow onError', async () => {
    const broker = fakeBroker();
    installLoopbackRelay(broker);
    const onError = vi.fn();
    await openLoopback(8080, () => {}, { onError });
    const bindingId = (broker.request as ReturnType<typeof vi.fn>).mock.calls[0]![1].bindingId as string;

    const denied = await deliverLoopbackCallback({
      bindingId,
      url: 'http://localhost:8080/oauth/callback?error=access_denied',
    });
    expect(denied).toEqual({ accepted: false, message: 'Error: access_denied' });
    expect(onError).toHaveBeenCalledWith('access_denied');
  });

  it('answers an unknown binding without a live flow', async () => {
    const res = await deliverLoopbackCallback({ bindingId: 'nope', url: 'http://localhost:8080/oauth/callback' });
    expect(res.accepted).toBe(false);
  });
});
