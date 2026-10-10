import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../di/container.js', () => ({
  default: {
    resolve: vi.fn(),
  },
}));

vi.mock('../services/service_logger.js', () => ({
  serviceLogger: {
    log: vi.fn(async () => undefined),
  },
}));

import { performSync, resetCooldownNoticeForTests } from './sync_outlook.js';
import {
  noteOutlookRateLimit,
  outlookRateLimitCooldownMs,
  resetOutlookRateLimitForTests,
} from './outlook-rate-limit.js';
import { serviceLogger } from '../services/service_logger.js';
import { OutlookClientFactory } from './outlook-client-factory.js';

describe('sync_outlook rate-limit cooldown behavior', () => {
  beforeEach(() => {
    resetOutlookRateLimitForTests();
    resetCooldownNoticeForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  it('skips performSync immediately when cooldown is active and posts debounced notice', async () => {
    noteOutlookRateLimit('60');
    expect(outlookRateLimitCooldownMs()).toBeGreaterThan(0);

    const graphFetchSpy = vi.spyOn(OutlookClientFactory, 'graphFetch');
    await performSync();

    // Did not make any Graph calls
    expect(graphFetchSpy).not.toHaveBeenCalled();

    // Posted rate limit notice to serviceLogger
    expect(serviceLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'progress',
        service: 'outlook',
        runId: 'outlook_rate_limit_notice',
        level: 'warn',
        message: expect.stringContaining('Rate limited by Microsoft Graph'),
      }),
    );
  });

  it('does not log duplicate notice on subsequent sync attempts within same lockout window', async () => {
    noteOutlookRateLimit('60');
    await performSync();
    expect(serviceLogger.log).toHaveBeenCalledTimes(1);

    // Second tick still in cooldown
    await performSync();
    // Notice is debounced on the lockout deadline
    expect(serviceLogger.log).toHaveBeenCalledTimes(1);
  });
});
