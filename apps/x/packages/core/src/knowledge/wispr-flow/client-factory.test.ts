import { afterEach, describe, expect, it, vi } from 'vitest';
import container from '../../di/container.js';
import { WisprFlowClientFactory } from './client-factory.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await WisprFlowClientFactory.clearCache();
});

describe('WisprFlowClientFactory credentials', () => {
  it.each([undefined, null])('treats %s tokens as disconnected', async (tokens) => {
    vi.spyOn(container, 'resolve').mockReturnValue({
      read: vi.fn().mockResolvedValue({ tokens }),
    } as never);
    await expect(WisprFlowClientFactory.hasCredentials()).resolves.toBe(false);
  });

  it('recognizes a stored OAuth token', async () => {
    vi.spyOn(container, 'resolve').mockReturnValue({
      read: vi.fn().mockResolvedValue({ tokens: { access_token: 'test-token' } }),
    } as never);
    await expect(WisprFlowClientFactory.hasCredentials()).resolves.toBe(true);
  });
});
